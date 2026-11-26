"""Google's last crawl of a page, from Search Console's URL inspection (page history, section 6).

For one property, read the pages to inspect, call `urlInspection.index.inspect` for the least
recently inspected first (never inspected before all), and keep `lastCrawlTime` and `coverageState`
in `seo.page_google_crawl`, one row per page. A page is read at most once in `MIN_AGE`. A property
spends at most `INSPECTIONS_PER_DAY` calls a UTC day (Google allows 2,000; the rest is left to the
same account's other tools), counted from `inspected_at`. Every call takes one token from the
`GscLimiter`; a quota answer slows the property's bucket and ends the pass.

No transaction is held across a call to Google: read, call, then write one row. Every statement
names the workspace (the worker's role bypasses row-level security). Only class names, reasons and
ids are logged, never a page address or a token.

Not wired yet: the schedule (`gsc_plan`) and the `TrackedSource` that reads `core.tracked_pages`
are a follow-up, once branch `claude/gsc-page-detail-monitoring-6f43c3`, which adds that table,
has landed.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Final, Protocol

import structlog
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.gsc_limits import GscLimiter
from idraft.collectors.gsc_store import IntegrationFacts
from idraft.db.engine import workspace_transaction
from idraft.db.tables import page_google_crawl
from idraft.providers.google.client import GoogleClient, UrlInspection
from idraft.providers.google.errors import (
    GoogleQuotaError,
    GoogleResponseError,
    GoogleUnauthorizedError,
    GoogleUnavailableError,
)

INSPECTIONS_PER_DAY: Final = 1_500
MIN_AGE: Final = timedelta(hours=20)
_log = structlog.get_logger(__name__)

type PageToInspect = tuple[int, str]  # (url_id, page address)


class TrackedSource(Protocol):
    """Where the pages to inspect come from (the project's tracked pages, once that table lands)."""

    async def pages(self, db: AsyncSession, facts: IntegrationFacts) -> Sequence[PageToInspect]: ...


class AccessTokens(Protocol):
    """The property's access token: made from the account's refresh token by the caller, who
    keeps the secrets. `renew` asks for a new one, after Google refused the last."""

    async def __call__(self, *, renew: bool) -> str: ...


@dataclass(frozen=True, slots=True)
class InspectContext:
    sessions: async_sessionmaker[AsyncSession]
    google: GoogleClient
    limiter: GscLimiter
    now: Callable[[], datetime] = lambda: datetime.now(UTC)
    daily_cap: int = INSPECTIONS_PER_DAY
    min_age: timedelta = MIN_AGE


@dataclass(frozen=True, slots=True)
class InspectReport:
    calls: int = 0
    stored: int = 0
    # Pages whose call failed in a way a later pass may not meet again; they are tried next pass.
    skipped: int = 0
    quota_hit: bool = False
    cap_reached: bool = False


async def refresh_inspections(
    ctx: InspectContext, facts: IntegrationFacts, source: TrackedSource, token: AccessTokens
) -> InspectReport:
    """One pass over one property. Raises the `GoogleError` that makes every later call useless
    (a refused token, a lost permission); the pages stored before it stay stored."""
    day_start = ctx.now().astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    async with workspace_transaction(ctx.sessions, facts.workspace_id) as db:
        pages = await source.pages(db, facts)
        spent = await _spent_today(db, facts, day_start)
        seen = await _inspected_at(db, facts, [url_id for url_id, _ in pages])
    cutoff = ctx.now() - ctx.min_age
    # Never inspected first, then the oldest; a page inspected within `min_age` is left.
    due = sorted(
        (page for page in pages if page[0] not in seen or seen[page[0]] <= cutoff),
        key=lambda page: (page[0] in seen, seen.get(page[0], cutoff), page[0]),
    )
    room = max(0, ctx.daily_cap - spent)

    calls = stored = skipped = 0
    for url_id, page_url in due[:room]:
        await ctx.limiter.acquire(user=facts.account, site=facts.site_url)
        calls += 1
        try:
            found = await _inspect(ctx, facts, token, page_url)
        except GoogleQuotaError:
            ctx.limiter.quota_exceeded(site=facts.site_url)
            _log.warning("gsc inspection quota", integration_id=str(facts.integration_id))
            return InspectReport(calls, stored, skipped, quota_hit=True)
        except (GoogleUnavailableError, GoogleResponseError) as error:
            _log.warning(
                "gsc inspection skipped",
                reason=error.reason,
                integration_id=str(facts.integration_id),
                url_id=url_id,
            )
            skipped += 1
            continue
        async with workspace_transaction(ctx.sessions, facts.workspace_id) as db:
            await _store(db, facts, url_id, found, ctx.now())
        stored += 1
    return InspectReport(calls, stored, skipped, cap_reached=len(due) > room)


async def _inspect(
    ctx: InspectContext, facts: IntegrationFacts, token: AccessTokens, page_url: str
) -> UrlInspection:
    """One call. A 401 gets one new access token and one more try."""
    try:
        return await ctx.google.inspect_url(
            await token(renew=False), site_url=facts.site_url, page_url=page_url
        )
    except GoogleUnauthorizedError:
        return await ctx.google.inspect_url(
            await token(renew=True), site_url=facts.site_url, page_url=page_url
        )


async def _spent_today(db: AsyncSession, facts: IntegrationFacts, day_start: datetime) -> int:
    found = await db.execute(
        select(func.count()).where(
            page_google_crawl.c.workspace_id == facts.workspace_id,
            page_google_crawl.c.project_id == facts.project_id,
            page_google_crawl.c.inspected_at >= day_start,
        )
    )
    return int(found.scalar_one())


async def _inspected_at(
    db: AsyncSession, facts: IntegrationFacts, url_ids: Sequence[int]
) -> dict[int, datetime]:
    found = await db.execute(
        select(page_google_crawl.c.url_id, page_google_crawl.c.inspected_at).where(
            page_google_crawl.c.workspace_id == facts.workspace_id,
            page_google_crawl.c.project_id == facts.project_id,
            page_google_crawl.c.url_id.in_(list(url_ids)),
        )
    )
    return {row.url_id: row.inspected_at for row in found}


async def _store(
    db: AsyncSession, facts: IntegrationFacts, url_id: int, found: UrlInspection, at: datetime
) -> None:
    values = {
        "last_crawl_time": found.last_crawl_time,
        "coverage_state": found.coverage_state,
        "inspected_at": at,
    }
    await db.execute(
        upsert(page_google_crawl)
        .values(
            project_id=facts.project_id, url_id=url_id, workspace_id=facts.workspace_id, **values
        )
        .on_conflict_do_update(
            index_elements=[page_google_crawl.c.project_id, page_google_crawl.c.url_id],
            set_=values,
            where=page_google_crawl.c.workspace_id == facts.workspace_id,
        )
    )
