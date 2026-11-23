"""Capture the screenshot of one AI answer: the page the engine showed.

Steps: the answer must be from a platform that has a page and not older than DataForSEO's
7 days less a margin (`CAPTURE_WINDOW`); a screenshot already stored is returned as it is, with
no spend; otherwise the budget is asked, then one provider call ($0.004). The provider charges
when it answers, so the cost event is recorded at once, before anything that can fail: the
download of the PNG the same day (the link lives one day), trimming, storage in the raw bucket.
The screenshot row is written last.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Final, Literal, Protocol
from uuid import UUID

from idraft.providers.dataforseo.screenshot import (
    CAPTURE_WINDOW,
    PATH,
    PRICE_USD,
    SCREENSHOT_HEIGHT,
    ScreenshotTaskExpiredError,
)
from idraft.screenshots.trim import Trimmed, trim_capture
from idraft.storage.raw import ObjectStore
from idraft.storage.screenshots import put_screenshot

# Engines whose answer has a platform page: the ChatGPT and Gemini scrapers and AI Mode.
PAGE_ENGINES: Final = frozenset({"chatgpt_web", "gemini_web", "google_ai_mode"})

# `available`: a stored image. `capturable`: none yet and the provider can still make one.
# `expired`: none, and too late. `unsupported`: the engine has no platform page.
ScreenshotState = Literal["available", "capturable", "expired", "unsupported"]


def screenshot_state(
    engine_code: str, observed_at: datetime, *, stored: bool, now: datetime
) -> ScreenshotState:
    """What can be done about the screenshot of one answer; the one rule the capture route and
    the prompts summary share."""
    if stored:
        return "available"
    if engine_code not in PAGE_ENGINES:
        return "unsupported"
    return "capturable" if now - observed_at <= CAPTURE_WINDOW else "expired"


class ExpiredError(Exception):
    """The answer is too old, or the provider no longer holds its task: its page can no longer be
    screenshotted."""


class BudgetBlockedError(Exception):
    """A budget would be passed by the call. Carries the id of the budget."""

    def __init__(self, budget_id: str) -> None:
        super().__init__(budget_id)
        self.budget_id = budget_id


class UnsupportedEngineError(Exception):
    """The engine's answer has no platform page to photograph."""


@dataclass(frozen=True, slots=True)
class ObservationRef:
    observation_id: int
    observed_at: datetime
    workspace_id: UUID
    project_id: UUID
    engine_code: str
    provider_task_id: str


@dataclass(frozen=True, slots=True)
class CaptureOutcome:
    storage_key: str
    created: bool
    truncated: bool
    width: int | None
    height: int | None


class Provider(Protocol):
    async def screenshot(self, task_id: str) -> tuple[str, Decimal]:
        """The image address and the cost the provider reported."""


class Ledger(Protocol):
    async def existing_key(self, observation_id: int) -> str | None: ...

    async def check_budget(self, estimate: Decimal) -> None:
        """Raise `BudgetBlockedError` when a call costing `estimate` would pass a budget."""

    async def record_cost(self, cost: dict[str, object]) -> None:
        """Insert the cost event, in a transaction of its own."""

    async def record_screenshot(self, row: dict[str, object]) -> None:
        """Insert the screenshot row."""


Download = Callable[[str], Awaitable[bytes]]


async def capture_screenshot(
    ref: ObservationRef,
    *,
    provider: Provider,
    download: Download,
    store: ObjectStore,
    ledger: Ledger,
    now: datetime,
    captured_by: UUID | None = None,
) -> CaptureOutcome:
    if ref.engine_code not in PAGE_ENGINES:
        raise UnsupportedEngineError(ref.engine_code)
    existing = await ledger.existing_key(ref.observation_id)
    if existing is not None:
        return CaptureOutcome(
            storage_key=existing, created=False, truncated=False, width=None, height=None
        )
    if now - ref.observed_at > CAPTURE_WINDOW:
        raise ExpiredError(ref.observation_id)
    await ledger.check_budget(PRICE_USD)
    try:
        url, cost = await provider.screenshot(ref.provider_task_id)
    except ScreenshotTaskExpiredError:
        raise ExpiredError(ref.observation_id) from None
    # Charged: kept whatever happens next.
    await ledger.record_cost(
        {
            "occurred_at": now,
            "workspace_id": ref.workspace_id,
            "project_id": ref.project_id,
            "provider_code": "dataforseo",
            "endpoint": PATH,
            "workload": "ai_prompt",
            "channel": "ai",
            "subject_type": "ai_observation",
            "subject_id": str(ref.observation_id),
            "engine_code": ref.engine_code,
            "units": 1,
            "price_unit": "request",
            "cost_usd": cost,
            "cost_source": "provider_reported",
            "billing_period": now.date().replace(day=1),
        }
    )
    raw = await download(url)
    trimmed: Trimmed = await asyncio.to_thread(
        trim_capture, raw, requested_height=SCREENSHOT_HEIGHT
    )
    key = await put_screenshot(
        store, ref.workspace_id, ref.project_id, ref.observation_id, trimmed.png
    )
    await ledger.record_screenshot(
        {
            "observation_id": ref.observation_id,
            "observed_at": ref.observed_at,
            "workspace_id": ref.workspace_id,
            "project_id": ref.project_id,
            "storage_key": key,
            "width": trimmed.width,
            "height": trimmed.height,
            "byte_size": len(trimmed.png),
            "truncated": trimmed.truncated,
            "cost_usd": cost,
            "provider_task_id": ref.provider_task_id,
            "captured_by": captured_by,
        }
    )
    return CaptureOutcome(
        storage_key=key,
        created=True,
        truncated=trimmed.truncated,
        width=trimmed.width,
        height=trimmed.height,
    )
