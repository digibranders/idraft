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

import asyncio
from collections.abc import AsyncIterator, Callable, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Final, Protocol, cast
from uuid import UUID

import structlog
from sqlalchemy import CursorResult, func, literal, select
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

# shortcut: the cap counts stored rows per UTC day, and a page read again after `MIN_AGE` (20 hours)
# can cost two calls in one day; the headroom (1,500 against Google's 2,000) covers it.
INSPECTIONS_PER_DAY: Final = 1_500
_LOCK_NAME: Final = "gsc_inspect"
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
    # Another pass holds the property's lock; nothing was done.
    busy: bool = False


async def refresh_inspections(
    ctx: InspectContext, facts: IntegrationFacts, source: TrackedSource, token: AccessTokens
) -> InspectReport:
    """One pass over one property. Two passes over one project would both read the same count
    and overshoot the cap, so a pass holds the project's advisory lock; one that finds it taken
    returns at once with `busy`. Raises the `GoogleError` that makes every later call useless
    (a refused token, a lost permission); the pages stored before it stay stored."""
    async with _project_lock(ctx.sessions, facts.project_id) as held:
        if not held:
            return InspectReport(busy=True)
        return await _pass(ctx, facts, source, token)


@asynccontextmanager
async def _project_lock(
    sessions: async_sessionmaker[AsyncSession], project_id: UUID
) -> AsyncIterator[bool]:
    """Whether this pass holds the project's advisory lock, kept for the block on a connection
    of its own, without a transaction (the lock belongs to the connection)."""
    key = func.hashtextextended(literal(f"{_LOCK_NAME}:{project_id}"), 0)
    async with sessions() as db:
        connection = await db.connection(execution_options={"isolation_level": "AUTOCOMMIT"})
        held = bool((await connection.execute(select(func.pg_try_advisory_lock(key)))).scalar_one())
        try:
            yield held
        finally:
            if held:
                released = False
                try:
                    await connection.execute(select(func.pg_advisory_unlock(key)))
                    released = True
                except Exception as failure:
                    _log.error("gsc inspection lock not released", error=type(failure).__name__)
                finally:
                    # A connection returned to the pool still holding the lock would block the
                    # property for good: drop it unless the unlock verifiably happened.
                    if not released:
                        await asyncio.shield(connection.invalidate())


async def _pass(
    ctx: InspectContext, facts: IntegrationFacts, source: TrackedSource, token: AccessTokens
) -> InspectReport:
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
            # Note the try so the page backs off for `min_age` and counts toward the cap.
            async with workspace_transaction(ctx.sessions, facts.workspace_id) as db:
                await _store(db, facts, url_id, None, ctx.now())
            skipped += 1
            continue
        async with workspace_transaction(ctx.sessions, facts.workspace_id) as db:
            stored += await _store(db, facts, url_id, found, ctx.now())
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
    db: AsyncSession,
    facts: IntegrationFacts,
    url_id: int,
    found: UrlInspection | None,
    at: datetime,
) -> int:
    """Upsert the page's row; the rows written (0 when the guard found another workspace's row).
    With no `found` (the call failed) only `inspected_at` is set: a new row has no crawl time and
    an older good one stays."""
    values: dict[str, datetime | str | None] = {"inspected_at": at}
    if found is not None:
        values["last_crawl_time"] = found.last_crawl_time
        values["coverage_state"] = found.coverage_state
    result = await db.execute(
        upsert(page_google_crawl)
        .values(
            project_id=facts.project_id, url_id=url_id, workspace_id=facts.workspace_id, **values
        )
        .on_conflict_do_update(
            index_elements=[page_google_crawl.c.project_id, page_google_crawl.c.url_id],
            set_=values if found is not None else {"inspected_at": at},
            where=page_google_crawl.c.workspace_id == facts.workspace_id,
        )
    )
    return int(cast("CursorResult[object]", result).rowcount)
