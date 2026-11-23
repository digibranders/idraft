"""Capturing the screenshot of one AI observation."""

from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

import pytest
from PIL import Image, ImageDraw

from idraft.providers.dataforseo.screenshot import SCREENSHOT_HEIGHT
from idraft.screenshots.service import (
    CaptureOutcome,
    ExpiredError,
    ObservationRef,
    UnsupportedEngineError,
    capture_screenshot,
)

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
    def __init__(self, existing: dict[int, str] | None = None) -> None:
        self.rows: list[dict[str, object]] = []
        self.costs: list[dict[str, object]] = []
        self.existing = existing or {}

    async def existing_key(self, observation_id: int) -> str | None:
        return self.existing.get(observation_id)

    async def record(self, row: dict[str, object], cost: dict[str, object]) -> None:
        self.rows.append(row)
        self.costs.append(cost)


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
