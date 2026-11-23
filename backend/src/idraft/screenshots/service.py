"""Capture the screenshot of one AI answer: the page the engine showed.

Steps: the answer must be from a platform that has a page and not older than DataForSEO's
7 days; a screenshot already stored is returned as it is, with no spend; otherwise one
provider call ($0.004), a download of the PNG the same day (the link lives one day), trimming,
storage in the raw bucket, then the row and the cost event are recorded together.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Final, Protocol
from uuid import UUID

from idraft.providers.dataforseo.screenshot import PATH, SCREENSHOT_HEIGHT, TASK_WINDOW_DAYS
from idraft.screenshots.trim import trim_capture
from idraft.storage.raw import ObjectStore
from idraft.storage.screenshots import put_screenshot

# Engines whose answer has a platform page: the ChatGPT and Gemini scrapers and AI Mode.
PAGE_ENGINES: Final = frozenset({"chatgpt_web", "gemini_web", "google_ai_mode"})


class ExpiredError(Exception):
    """The answer is past DataForSEO's 7 days: its page can no longer be screenshotted."""


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

    async def record(self, row: dict[str, object], cost: dict[str, object]) -> None:
        """Insert the screenshot row and the cost event in one transaction."""


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
    if now - ref.observed_at > timedelta(days=TASK_WINDOW_DAYS):
        raise ExpiredError(ref.observation_id)
    url, cost = await provider.screenshot(ref.provider_task_id)
    raw = await download(url)
    trimmed = trim_capture(raw, requested_height=SCREENSHOT_HEIGHT)
    key = await put_screenshot(
        store, ref.workspace_id, ref.project_id, ref.observation_id, trimmed.png
    )
    await ledger.record(
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
        },
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
        },
    )
    return CaptureOutcome(
        storage_key=key,
        created=True,
        truncated=trimmed.truncated,
        width=trimmed.width,
        height=trimmed.height,
    )
