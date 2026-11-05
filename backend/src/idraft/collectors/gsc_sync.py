"""The Search Console pull of one property (docs/18 sections 4.2 to 4.6).

One pass: ask Search Console which days have final numbers (shape P), fetch the days that are
missing one at a time (shape B, `[date, query, page, country, device]`, paged by `startRow`),
and replace each day in one transaction together with the progress that says it is stored. The
order and the progress are those of `domain.gsc_pull`: the 28 days that end on the latest final
day first, then the older days oldest first, and on later runs the trailing days that were not
final yet. Only final data is read, so a stored day is never revised by Google.

A pass is bounded by `budget`. It stops cleanly between two days, and the next pass goes on where
the saved state says. Because each day is replaced as a whole, a pass cut off at any point, or run
twice, leaves the same numbers.

The refresh token is read for the pass and the access token is made from it; both stay in this
object's memory and are never logged, stored or put in an error.
"""

from __future__ import annotations

import contextlib
import hashlib
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from enum import StrEnum
from uuid import UUID
from zoneinfo import ZoneInfo

import structlog
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors import gsc_store
from idraft.collectors.gsc_limits import GscLimiter
from idraft.collectors.gsc_store import DayRow, IntegrationFacts
from idraft.db.engine import workspace_transaction
from idraft.domain.gsc_pull import (
    FINAL_LAG_DAYS,
    TRAILING_DAYS,
    PullState,
    history_start,
    window_of,
)
from idraft.extraction.urls import UrlRejectedError, canonicalize
from idraft.keywords.text import normalize
from idraft.providers.google.client import (
    SEARCH_ANALYTICS_ROW_LIMIT,
    AnalyticsRow,
    Dimension,
    GoogleClient,
)
from idraft.providers.google.errors import (
    GoogleClientRejectedError,
    GoogleError,
    GoogleInvalidGrantError,
    GooglePermissionError,
    GoogleQuotaError,
    GoogleResponseError,
    GoogleUnauthorizedError,
)
from idraft.vault import store as vault
from idraft.vault.envelope import EnvelopeCipher, SecretUnreadableError

# Search Console's days are Pacific Time calendar days (docs/18 section 4.2).
PACIFIC = ZoneInfo("America/Los_Angeles")
# Well inside the queue's handler limit (`worker.queues.HANDLER_TIME_LIMIT`, 8 minutes), so a
# pass ends by itself and its message is acknowledged.
PASS_BUDGET = timedelta(minutes=5)
DETAIL_DIMENSIONS: tuple[Dimension, ...] = ("date", "query", "page", "country", "device")
_log = structlog.get_logger(__name__)


class Outcome(StrEnum):
    # The integration is gone, paused or disabled: nothing to do.
    SKIPPED = "skipped"
    # The pass reached the end of its work, or its budget.
    DONE = "done"
    # The connection needs a new sign-in (`invalid_grant`).
    REAUTH_REQUIRED = "reauth_required"
    # The account cannot read this property any more.
    PERMISSION_REVOKED = "permission_revoked"
    # An error that a later pass may not meet again; the integration keeps its status.
    FAILED = "failed"


@dataclass(frozen=True, slots=True)
class SyncReport:
    outcome: Outcome
    days_written: int = 0
    rows_written: int = 0
    calls: int = 0
    # The pass stopped on its budget with days still to fetch.
    more: bool = False
    error: str | None = None


@dataclass(frozen=True, slots=True)
class SyncContext:
    sessions: async_sessionmaker[AsyncSession]
    google: GoogleClient
    cipher: EnvelopeCipher
    limiter: GscLimiter
    now: Callable[[], datetime] = lambda: datetime.now(UTC)
    monotonic: Callable[[], float] = time.monotonic
    budget: timedelta = PASS_BUDGET
    page_size: int = SEARCH_ANALYTICS_ROW_LIMIT


def pacific_today(now: datetime) -> date:
    return now.astimezone(PACIFIC).date()


def day_rows(rows: Sequence[AnalyticsRow], day: date) -> tuple[list[DayRow], int]:
    """Shape B rows as rows to store, and how many were left out: a page that is not an
    http(s) address, or a device or country the tables have no place for."""
    found: list[DayRow] = []
    skipped = 0
    for row in rows:
        stamp, query, page, country, device = row.keys
        if stamp != day.isoformat():
            raise GoogleResponseError("a row is of another day than the one asked for")
        iso3, kind = country.upper(), device.upper()
        try:
            url = canonicalize(page)
        except UrlRejectedError:
            skipped += 1
            continue
        if len(iso3) != 3 or kind not in gsc_store.DEVICES:
            skipped += 1
            continue
        found.append(
            DayRow(
                query_hash=hashlib.sha256(query.encode()).digest(),
                query_text=query,
                normalized_text=normalize(query),
                url=url,
                country=iso3,
                device=kind,
                clicks=row.clicks,
                impressions=row.impressions,
                position_sum=Decimal(str(row.position)) * row.impressions,
            )
        )
    return found, skipped


class _Pass:
    """One run over one property. Raises the `GoogleError` that ended it."""

    def __init__(self, ctx: SyncContext, facts: IntegrationFacts, refresh_token: str) -> None:
        self._ctx = ctx
        self._facts = facts
        self._refresh_token = refresh_token
        self._access: str | None = None
        self._deadline = ctx.monotonic() + ctx.budget.total_seconds()
        self.state = facts.state
        self.calls = 0
        self.days_written = 0
        self.rows_written = 0

    async def _access_token(self, *, renew: bool) -> str:
        if self._access is None or renew:
            self._access = (await self._ctx.google.refresh(self._refresh_token)).access_token
            async with workspace_transaction(self._ctx.sessions, self._facts.workspace_id) as db:
                await gsc_store.note_refresh(db, self._facts, self._ctx.now())
        return self._access

    async def _query(
        self, *, start: date, end: date, dimensions: Sequence[Dimension], start_row: int = 0
    ) -> list[AnalyticsRow]:
        """One call, within the budgets. A 401 gets one new access token and one more try."""
        facts = self._facts
        for renew in (False, True):
            token = await self._access_token(renew=renew)
            await self._ctx.limiter.acquire(user=facts.account, site=facts.site_url)
            self.calls += 1
            try:
                return await self._ctx.google.search_analytics(
                    token,
                    facts.site_url,
                    start_date=start,
                    end_date=end,
                    dimensions=dimensions,
                    aggregation="byProperty" if tuple(dimensions) == ("date",) else "auto",
                    start_row=start_row,
                    row_limit=self._ctx.page_size,
                )
            except GoogleUnauthorizedError:
                if renew:
                    raise
            except GoogleQuotaError:
                self._ctx.limiter.quota_exceeded(site=facts.site_url)
                raise
        raise AssertionError("unreachable: the second try returns or raises")  # pragma: no cover

    async def _final_days(self, start: date, end: date) -> list[date]:
        """Shape P: the days that have final numbers, oldest first."""
        rows = await self._query(start=start, end=end, dimensions=("date",))
        try:
            return sorted({date.fromisoformat(row.keys[0]) for row in rows})
        except ValueError:
            raise GoogleResponseError("a day of the probe is not a date") from None

    async def _day(self, day: date) -> list[AnalyticsRow]:
        rows: list[AnalyticsRow] = []
        while True:
            page = await self._query(
                start=day, end=day, dimensions=DETAIL_DIMENSIONS, start_row=len(rows)
            )
            if not page:
                return rows
            rows.extend(page)

    async def _store(self, day: date, *, history_next: date | None = None) -> None:
        """Fetch one day and write it with the progress, in one transaction."""
        rows, skipped = day_rows(await self._day(day), day)
        async with workspace_transaction(self._ctx.sessions, self._facts.workspace_id) as db:
            replaced = await gsc_store.replace_day(db, self._facts, day, rows)
            state = self.state.stored_day(
                day, replaced_rows=replaced.removed, rows=replaced.written
            )
            if history_next is not None:
                state = replace(state, history_next=history_next)
            await gsc_store.save_state(db, self._facts, state, last_error=None)
        self.state = state
        self.days_written += 1
        self.rows_written += replaced.written
        if skipped or replaced.collapsed:
            _log.info(
                "gsc rows set aside",
                integration_id=str(self._facts.integration_id),
                day=day.isoformat(),
                skipped=skipped,
                collapsed=replaced.collapsed,
            )

    def _out_of_time(self) -> bool:
        return self._ctx.monotonic() >= self._deadline

    async def _checkpoint(self, state: PullState) -> None:
        self.state = state
        async with workspace_transaction(self._ctx.sessions, self._facts.workspace_id) as db:
            await gsc_store.save_state(
                db, self._facts, state, last_error=None, succeeded_at=self._ctx.now()
            )

    async def run(self) -> bool:
        """The pass. True when it stopped on its budget with days left."""
        today = pacific_today(self._ctx.now())
        oldest = history_start(today)
        probe = await self._final_days(oldest, today)
        latest = probe[-1] if probe else today - timedelta(days=FINAL_LAG_DAYS)
        window_start, _ = window_of(latest)

        # The days that end the window first, so the Rankings columns fill; on later runs only the
        # trailing days, the ones that may have become final since.
        first_run = not self.state.recent_done
        recent_from = window_start if first_run else latest - timedelta(days=TRAILING_DAYS - 1)
        recent = [day for day in probe if recent_from <= day <= latest]
        have = await self._stored(recent_from, latest)
        for day in recent:
            if day in have:
                continue
            if self._out_of_time():
                return True
            await self._store(day)

        # The sweep's ends are set once, to the first day the recent pass covers; a state that lost
        # them (it is read tolerantly) gets them again, so the pass cannot end with the history
        # neither done nor planned, and no day between the sweep and the recent days is left out.
        state = self.state
        if not state.complete:
            state = replace(
                state,
                history_next=state.history_next or oldest,
                history_until=state.history_until or recent_from,
            )
        await self._checkpoint(replace(state, recent_done=True, window_end=latest).succeeded())

        if (
            self.state.complete
            or self.state.history_next is None
            or self.state.history_until is None
        ):
            return False
        sweep = [day for day in probe if self.state.history_next <= day < self.state.history_until]
        for day in sweep:
            if self._out_of_time():
                return True
            await self._store(day, history_next=day + timedelta(days=1))
        await self._checkpoint(replace(self.state, complete=True))
        return False

    async def _stored(self, start: date, end: date) -> set[date]:
        async with workspace_transaction(self._ctx.sessions, self._facts.workspace_id) as db:
            return await gsc_store.stored_days(db, self._facts, start, end)


async def sync_integration(
    ctx: SyncContext, workspace_id: UUID, integration_id: UUID
) -> SyncReport:
    """One pass over one property. Every error of Google or of the stored credential ends in a
    recorded outcome; an error of this code or of the database is raised."""
    async with workspace_transaction(ctx.sessions, workspace_id) as db:
        facts = await gsc_store.load_integration(db, workspace_id, integration_id)
        if facts is None or not facts.runnable or facts.credential_ref is None:
            return SyncReport(Outcome.SKIPPED)
        try:
            refresh_token = await vault.read(
                db,
                ctx.cipher,
                workspace_id=workspace_id,
                secret_id=facts.credential_ref,
                kind=vault.REFRESH_TOKEN,
            )
        except SecretUnreadableError:
            refresh_token = ""
    context = {"integration_id": str(integration_id), "workspace_id": str(workspace_id)}
    if not refresh_token:
        _log.error("gsc secret unreadable", **context)
        return await _reauth(ctx, facts, "secret_unreadable")

    pull = _Pass(ctx, facts, refresh_token)
    try:
        more = await pull.run()
    except GoogleInvalidGrantError:
        _log.warning("gsc refresh token refused", **context)
        return await _reauth(ctx, facts, "invalid_grant", pull)
    except GooglePermissionError as error:
        _log.warning("gsc property not readable", **context)
        async with workspace_transaction(ctx.sessions, workspace_id) as db:
            await gsc_store.mark_integration_error(db, facts, error.reason)
        return _report(Outcome.PERMISSION_REVOKED, pull, error=error.reason)
    except GoogleError as error:
        # Quota, a server that did not answer, an answer that is not what the API documents, a
        # client Google does not accept: the integration stays active and the planner tries it
        # again after a wait that grows (`PullState.failed`).
        if isinstance(error, GoogleResponseError | GoogleClientRejectedError):
            _log.error("gsc pass failed", reason=error.reason, **context)
        else:
            _log.warning("gsc pass failed", reason=error.reason, **context)
        state = pull.state.failed(ctx.now())
        async with workspace_transaction(ctx.sessions, workspace_id) as db:
            await gsc_store.save_state(db, facts, state, last_error=error.reason)
        return _report(Outcome.FAILED, pull, error=error.reason)
    except Exception:
        # A fault of ours or of the database. Say so on the integration and wait before the next
        # pass, so a fault that repeats does not call Google every minute; then raise it.
        with contextlib.suppress(Exception):
            async with workspace_transaction(ctx.sessions, workspace_id) as db:
                await gsc_store.save_state(
                    db, facts, pull.state.failed(ctx.now()), last_error="internal_error"
                )
        raise
    _log.info(
        "gsc pass done",
        days=pull.days_written,
        rows=pull.rows_written,
        calls=pull.calls,
        more=more,
        **context,
    )
    return _report(Outcome.DONE, pull, more=more)


def _report(
    outcome: Outcome, pull: _Pass, *, more: bool = False, error: str | None = None
) -> SyncReport:
    return SyncReport(
        outcome,
        days_written=pull.days_written,
        rows_written=pull.rows_written,
        calls=pull.calls,
        more=more,
        error=error,
    )


async def _reauth(
    ctx: SyncContext, facts: IntegrationFacts, code: str, pull: _Pass | None = None
) -> SyncReport:
    async with workspace_transaction(ctx.sessions, facts.workspace_id) as db:
        await gsc_store.mark_reauth_required(db, facts, code)
    if pull is None:
        return SyncReport(Outcome.REAUTH_REQUIRED, error=code)
    return _report(Outcome.REAUTH_REQUIRED, pull, error=code)
