"""Capturing the screenshot of one AI observation."""

from __future__ import annotations

import asyncio
import io
import threading
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

import pytest
from PIL import Image, ImageDraw

from idraft.providers.dataforseo.screenshot import (
    PRICE_USD,
    SCREENSHOT_HEIGHT,
    ScreenshotTaskExpiredError,
)
from idraft.screenshots.service import (
    BudgetBlockedError,
    CaptureOutcome,
    ExpiredError,
    ObservationRef,
    UnsupportedEngineError,
    capture_screenshot,
    screenshot_state,
)
from idraft.screenshots.trim import Trimmed, trim_capture

NOW = datetime(2026, 11, 23, 12, 0, tzinfo=UTC)
WORKSPACE = UUID("11111111-1111-1111-1111-111111111111")
PROJECT = UUID("22222222-2222-2222-2222-222222222222")


def _page(height: int = SCREENSHOT_HEIGHT) -> bytes:
    """A page as the provider renders ChatGPT: exactly the height asked for."""
    image = Image.new("RGB", (1920, height), (250, 250, 250))
    ImageDraw.Draw(image).rectangle((800, 100, 1400, 900), fill=(20, 20, 20))
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


@dataclass
class FakeProvider:
    link: str = "https://api.dataforseo.com/v3/serp/screenshot/abc.png"
    cost: Decimal = Decimal("0.004")
    calls: int = 0

    async def screenshot(self, task_id: str) -> tuple[str, Decimal]:
        self.calls += 1
        return self.link, self.cost


class FakeDownloader:
    def __init__(self, data: bytes) -> None:
        self.data = data
        self.urls: list[str] = []

    async def __call__(self, url: str) -> bytes:
        self.urls.append(url)
        return self.data


class FakeStore:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    async def put(self, key: str, data: bytes) -> None:
        self.objects[key] = data

    async def get(self, key: str) -> bytes:
        return self.objects[key]


class FakeLedger:
    def __init__(
        self, existing: dict[int, str] | None = None, *, over_budget: bool = False
    ) -> None:
        self.rows: list[dict[str, object]] = []
        self.costs: list[dict[str, object]] = []
        self.estimates: list[Decimal] = []
        self.existing = existing or {}
        self.over_budget = over_budget

    async def existing_key(self, observation_id: int) -> str | None:
        return self.existing.get(observation_id)

    async def check_budget(self, estimate: Decimal) -> None:
        self.estimates.append(estimate)
        if self.over_budget:
            raise BudgetBlockedError("budget-1")

    async def record_cost(self, cost: dict[str, object]) -> None:
        self.costs.append(cost)

    async def record_screenshot(self, row: dict[str, object]) -> None:
        self.rows.append(row)


def _ref(*, age_days: float = 1, engine: str = "chatgpt_web") -> ObservationRef:
    return ObservationRef(
        observation_id=77,
        observed_at=NOW - timedelta(days=age_days),
        workspace_id=WORKSPACE,
        project_id=PROJECT,
        engine_code=engine,
        provider_task_id="11231230-2666-0066-0000-4cb2621d82f1",
    )


async def test_a_recent_answer_is_captured_trimmed_stored_and_costed() -> None:
    provider, store, ledger = FakeProvider(), FakeStore(), FakeLedger()
    downloader = FakeDownloader(_page())
    outcome = await capture_screenshot(
        _ref(), provider=provider, download=downloader, store=store, ledger=ledger, now=NOW
    )
    assert isinstance(outcome, CaptureOutcome)
    assert outcome.created is True
    assert outcome.truncated is False
    assert provider.calls == 1
    assert downloader.urls == [provider.link]
    assert len(store.objects) == 1
    assert isinstance(ledger.rows[0]["height"], int)
    assert ledger.rows[0]["height"] < 3000
    assert ledger.rows[0]["storage_key"] in store.objects
    assert ledger.costs[0]["cost_usd"] == Decimal("0.004")
    assert ledger.costs[0]["endpoint"] == "/v3/serp/screenshot"


async def test_a_second_press_returns_the_stored_screenshot_and_spends_nothing() -> None:
    provider = FakeProvider()
    ledger = FakeLedger(existing={77: "screenshots/v1/x.png.zst"})
    outcome = await capture_screenshot(
        _ref(),
        provider=provider,
        download=FakeDownloader(_page()),
        store=FakeStore(),
        ledger=ledger,
        now=NOW,
    )
    assert outcome.created is False
    assert outcome.storage_key == "screenshots/v1/x.png.zst"
    assert provider.calls == 0


async def test_an_answer_older_than_seven_days_cannot_be_captured() -> None:
    provider = FakeProvider()
    with pytest.raises(ExpiredError):
        await capture_screenshot(
            _ref(age_days=8),
            provider=provider,
            download=FakeDownloader(_page()),
            store=FakeStore(),
            ledger=FakeLedger(),
            now=NOW,
        )
    assert provider.calls == 0


async def test_an_engine_without_a_platform_page_is_refused_before_any_spend() -> None:
    provider = FakeProvider()
    with pytest.raises(UnsupportedEngineError):
        await capture_screenshot(
            _ref(engine="claude_api"),
            provider=provider,
            download=FakeDownloader(_page()),
            store=FakeStore(),
            ledger=FakeLedger(),
            now=NOW,
        )
    assert provider.calls == 0


@pytest.mark.parametrize(
    ("engine", "age_days", "stored", "state"),
    [
        ("chatgpt_web", 1, True, "available"),
        ("chatgpt_web", 30, True, "available"),
        ("chatgpt_web", 1, False, "capturable"),
        ("gemini_web", 6.5, False, "capturable"),
        ("gemini_web", 6 + 19 / 24, False, "capturable"),
        ("gemini_web", 6 + 21 / 24, False, "expired"),
        ("gemini_web", 7, False, "expired"),
        ("google_ai_mode", 8, False, "expired"),
        ("claude_api", 1, False, "unsupported"),
    ],
)
def test_the_state_of_an_answers_screenshot(
    engine: str, age_days: int, stored: bool, state: str
) -> None:
    observed_at = NOW - timedelta(days=age_days)
    assert screenshot_state(engine, observed_at, stored=stored, now=NOW) == state


async def test_an_answer_close_to_the_providers_limit_is_refused_with_a_margin() -> None:
    # The provider counts its 7 days from posting the task, which is before `observed_at`.
    provider = FakeProvider()
    with pytest.raises(ExpiredError):
        await capture_screenshot(
            _ref(age_days=6 + 21 / 24),
            provider=provider,
            download=FakeDownloader(_page()),
            store=FakeStore(),
            ledger=FakeLedger(),
            now=NOW,
        )
    assert provider.calls == 0


async def test_a_task_the_provider_no_longer_holds_is_an_expired_answer() -> None:
    class Gone:
        async def screenshot(self, task_id: str) -> tuple[str, Decimal]:
            raise ScreenshotTaskExpiredError("task not found")

    ledger = FakeLedger()
    with pytest.raises(ExpiredError):
        await capture_screenshot(
            _ref(),
            provider=Gone(),
            download=FakeDownloader(_page()),
            store=FakeStore(),
            ledger=ledger,
            now=NOW,
        )
    assert ledger.costs == []


async def test_a_download_that_fails_after_the_provider_answered_keeps_the_cost() -> None:
    class Broken:
        async def __call__(self, url: str) -> bytes:
            raise ValueError("the link did not return an image")

    ledger, store = FakeLedger(), FakeStore()
    with pytest.raises(ValueError, match="image"):
        await capture_screenshot(
            _ref(), provider=FakeProvider(), download=Broken(), store=store, ledger=ledger, now=NOW
        )
    assert len(ledger.costs) == 1
    assert ledger.costs[0]["cost_usd"] == Decimal("0.004")
    assert ledger.rows == []
    assert store.objects == {}


async def test_an_unusable_capture_keeps_the_cost_and_stores_nothing() -> None:
    ledger, store = FakeLedger(), FakeStore()
    with pytest.raises(ValueError, match="image"):
        await capture_screenshot(
            _ref(),
            provider=FakeProvider(),
            download=FakeDownloader(b"not an image"),
            store=store,
            ledger=ledger,
            now=NOW,
        )
    assert len(ledger.costs) == 1
    assert ledger.rows == []


async def test_over_budget_makes_no_provider_call() -> None:
    provider, ledger = FakeProvider(), FakeLedger(over_budget=True)
    with pytest.raises(BudgetBlockedError):
        await capture_screenshot(
            _ref(),
            provider=provider,
            download=FakeDownloader(_page()),
            store=FakeStore(),
            ledger=ledger,
            now=NOW,
        )
    assert provider.calls == 0
    assert ledger.estimates == [PRICE_USD]
    assert ledger.costs == []


async def test_a_stored_screenshot_needs_no_budget() -> None:
    ledger = FakeLedger(existing={77: "screenshots/v1/x.png.zst"}, over_budget=True)
    outcome = await capture_screenshot(
        _ref(),
        provider=FakeProvider(),
        download=FakeDownloader(_page()),
        store=FakeStore(),
        ledger=ledger,
        now=NOW,
    )
    assert outcome.created is False
    assert ledger.estimates == []


async def test_the_image_work_runs_off_the_event_loop(monkeypatch: pytest.MonkeyPatch) -> None:
    loop_thread = threading.get_ident()
    seen: dict[str, int] = {}

    def watched(data: bytes, *, requested_height: int) -> Trimmed:
        seen["trim"] = threading.get_ident()
        return trim_capture(data, requested_height=requested_height)

    monkeypatch.setattr("idraft.screenshots.service.trim_capture", watched)
    await capture_screenshot(
        _ref(),
        provider=FakeProvider(),
        download=FakeDownloader(_page()),
        store=FakeStore(),
        ledger=FakeLedger(),
        now=NOW,
    )
    assert seen["trim"] != loop_thread
    await asyncio.sleep(0)
