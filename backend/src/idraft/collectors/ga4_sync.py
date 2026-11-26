"""The GA4 pull of one property (docs/18 sections 7.2 and 7.5).

One run is one report, `runReport` over the window of `domain.ga4_pull` (90 days the first time,
the last 3 days after), paged with `offset` until every row is read. The rows are classified by
`domain.ai_referrals` and the window is replaced in one transaction together with the state that
says it is stored: a run that stops at any point leaves the numbers of the run before, and a run
that is repeated leaves the same numbers.

A run stops before it asks for another page when the property has little quota left or the time
budget is spent. It then stores nothing and the planner tries again after a wait that grows
(`Ga4PullState.failed`).

The refresh token is read for the run and the access token is made from it; both stay in this
object's memory and are never logged, stored or put in an error.
"""

from __future__ import annotations

import contextlib
import re
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Final
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors import ga4_store, gsc_store
from idraft.collectors.gsc_store import IntegrationFacts
from idraft.collectors.gsc_sync import Outcome, pacific_today
from idraft.db.engine import workspace_transaction
from idraft.domain.ai_referrals import ReferralRow, Rule, SessionRow, classify
from idraft.domain.ga4_pull import Ga4PullState
from idraft.providers.google.client import (
    GA4_REPORT_ROW_LIMIT,
    Ga4Report,
    Ga4Row,
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
    GoogleUnavailableError,
)
from idraft.vault import store as vault
from idraft.vault.envelope import EnvelopeCipher, SecretUnreadableError

# Well inside the queue's handler limit (`worker.queues.HANDLER_TIME_LIMIT`, 8 minutes), so a run
# ends by itself and its message is acknowledged.
PASS_BUDGET = timedelta(minutes=5)
DIMENSIONS: Final = (
    "date",
    "sessionSource",
    "sessionMedium",
    "sessionManualSource",
    "sessionDefaultChannelGroup",
)
METRICS: Final = ("sessions", "engagedSessions", "keyEvents", "totalRevenue")
# docs/18 section 7.5: 40,000 tokens per property per hour. A run goes on to another page only
# while at least 30 percent of that is left; the rest is for the other tools on the property.
# shortcut: the tokens left are read from the last answer of this run, not shared between workers
# (the doc keeps them in Redis, `ga4:prop:{id}`); move them there before a second worker runs.
HOURLY_TOKENS: Final = 40_000
QUOTA_FLOOR_TOKENS: Final = HOURLY_TOKENS * 30 // 100
# numeric(14,2) holds less than this.
_LIMIT: Final = Decimal(10) ** 12
_HALF_CENT: Final = Decimal("0.005")
# `sessions` and `engaged_sessions` are integer columns.
_INT32_MAX: Final = 2**31 - 1
_WHOLE = re.compile(r"[0-9]+", re.ASCII)
_NUMBER = re.compile(r"-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?", re.ASCII)
_log = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class SyncReport:
    outcome: Outcome
    rows_written: int = 0
    calls: int = 0
    error: str | None = None


@dataclass(frozen=True, slots=True)
class Ga4Context:
    sessions: async_sessionmaker[AsyncSession]
    google: GoogleClient
    cipher: EnvelopeCipher
    now: Callable[[], datetime] = lambda: datetime.now(UTC)
    monotonic: Callable[[], float] = time.monotonic
    budget: timedelta = PASS_BUDGET
    page_size: int = GA4_REPORT_ROW_LIMIT


def _day(value: str) -> date:
    """GA4 writes the `date` dimension as `YYYYMMDD`."""
    if len(value) == 8 and _WHOLE.fullmatch(value):
        try:
            return date(int(value[:4]), int(value[4:6]), int(value[6:]))
        except ValueError:
            pass
    raise GoogleResponseError("a day of the report is not a date")


def _count(value: str) -> int:
    if _WHOLE.fullmatch(value) is None:
        raise GoogleResponseError("a count of the report is not a whole number")
    try:
        count = int(value)
    except ValueError:  # more digits than Python converts
        count = _INT32_MAX + 1
    if count > _INT32_MAX:
        raise GoogleResponseError("a count of the report is out of range")
    return count


def _fits(number: Decimal) -> bool:
    """Whether numeric(14,2) holds `number`, after it is rounded to two decimals."""
    return abs(number) < _LIMIT - _HALF_CENT


def _number(value: str) -> Decimal:
    if _NUMBER.fullmatch(value) is None:
        raise GoogleResponseError("a number of the report is not a number")
    try:
        number = Decimal(value)
        in_range = _fits(number)
    except ArithmeticError:  # an exponent beyond what Decimal can write
        in_range = False
    if not in_range:
        raise GoogleResponseError("a number of the report is out of range")
    return number


def _check_totals(referrals: Sequence[ReferralRow]) -> None:
    """The sums the classifier made must fit the columns too: two rows that each fit can add up
    to more. A value the insert cannot take would end the run as a fault of ours."""
    for row in referrals:
        if (
            row.sessions > _INT32_MAX
            or row.engaged_sessions > _INT32_MAX
            or not _fits(row.key_events)
            or not _fits(row.total_revenue)
        ):
            raise GoogleResponseError("a total of the report is out of range")


def session_rows(rows: Sequence[Ga4Row], start: date, end: date) -> list[SessionRow]:
    """Report rows as rows to classify. A value that is not what the API documents is refused,
    never read as 0: summed, it would be a wrong figure that looks right."""
    found: list[SessionRow] = []
    for row in rows:
        stamp, source, medium, manual, channel = row.dimensions
        sessions, engaged, key_events, revenue = row.metrics
        day = _day(stamp)
        if not start <= day <= end:
            raise GoogleResponseError("a row is of a day outside the window asked for")
        found.append(
            SessionRow(
                day=day,
                source=source,
                medium=medium,
                manual_source=manual,
                channel_group=channel,
                sessions=_count(sessions),
                engaged_sessions=_count(engaged),
                key_events=_number(key_events),
                revenue=_number(revenue),
            )
        )
    return found


class _Pull:
    """One run over one property. Raises the `GoogleError` that ended it."""

    def __init__(
        self, ctx: Ga4Context, facts: IntegrationFacts, refresh_token: str, rules: list[Rule]
    ) -> None:
        self._ctx = ctx
        self._facts = facts
        self._refresh_token = refresh_token
        self._rules = rules
        self._access: str | None = None
        self._deadline = ctx.monotonic() + ctx.budget.total_seconds()
        self.state = Ga4PullState.read(facts.backfill_state)
        self.calls = 0

    async def _access_token(self, *, renew: bool) -> str:
        if self._access is None or renew:
            self._access = (await self._ctx.google.refresh(self._refresh_token)).access_token
            async with workspace_transaction(self._ctx.sessions, self._facts.workspace_id) as db:
                await gsc_store.note_refresh(db, self._facts, self._ctx.now())
        return self._access

    async def _page(self, start: date, end: date, offset: int) -> Ga4Report:
        """One page. A 401 gets one new access token and one more try."""
        for renew in (False, True):
            token = await self._access_token(renew=renew)
            self.calls += 1
            try:
                return await self._ctx.google.run_report(
                    token,
                    self._facts.site_url,
                    start_date=start,
                    end_date=end,
                    dimensions=DIMENSIONS,
                    metrics=METRICS,
                    offset=offset,
                    limit=self._ctx.page_size,
                )
            except GoogleUnauthorizedError:
                if renew:
                    raise
        raise AssertionError("unreachable: the second try returns or raises")  # pragma: no cover

    async def _report(self, start: date, end: date) -> list[Ga4Row]:
        """Every row of the window, read page by page."""
        rows: list[Ga4Row] = []
        while True:
            if self._ctx.monotonic() >= self._deadline:
                raise GoogleUnavailableError("the run is out of time")
            page = await self._page(start, end, len(rows))
            rows.extend(page.rows)
            if len(rows) >= page.row_count:
                return rows
            if not page.rows:
                raise GoogleResponseError("the report ended before its row count")
            if page.quota_remaining is not None and page.quota_remaining < QUOTA_FLOOR_TOKENS:
                raise GoogleQuotaError("the property has little quota left")

    async def run(self) -> int:
        """The rows of the window, stored. Returns how many."""
        # shortcut: the property's own time zone is not stored, so its date is taken as Pacific.
        # A run just after Pacific midnight can read a partial day for a property west of
        # Pacific; the 3-day re-pull of the next run corrects it. Store the zone to end this.
        start, end = self.state.window(pacific_today(self._ctx.now()))
        report = await self._report(start, end)
        try:
            referrals = classify(session_rows(report, start, end), self._rules)
        except ValueError:
            # A number the classifier refuses (it checks what the parsing does not).
            raise GoogleResponseError("a row of the report has a number that is refused") from None
        _check_totals(referrals)
        now = self._ctx.now()
        async with workspace_transaction(self._ctx.sessions, self._facts.workspace_id) as db:
            replaced = await ga4_store.replace_window(db, self._facts, start, end, referrals)
            await gsc_store.save_state(
                db, self._facts, self.state.succeeded(end), last_error=None, succeeded_at=now
            )
        return replaced.written


async def sync_integration(ctx: Ga4Context, workspace_id: UUID, integration_id: UUID) -> SyncReport:
    """One run over one property. Every error of Google or of the stored credential ends in a
    recorded outcome; an error of this code or of the database is raised."""
    async with workspace_transaction(ctx.sessions, workspace_id) as db:
        facts = await gsc_store.load_integration(db, workspace_id, integration_id, "ga4")
        if facts is None or not facts.runnable or facts.credential_ref is None:
            return SyncReport(Outcome.SKIPPED)
        rules = await ga4_store.load_rules(db)
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
        _log.error("ga4 secret unreadable", **context)
        return await _reauth(ctx, facts, "secret_unreadable")

    pull = _Pull(ctx, facts, refresh_token, rules)
    try:
        written = await pull.run()
    except GoogleInvalidGrantError:
        _log.warning("ga4 refresh token refused", **context)
        return await _reauth(ctx, facts, "invalid_grant", pull)
    except GooglePermissionError as error:
        _log.warning("ga4 property not readable", **context)
        async with workspace_transaction(ctx.sessions, workspace_id) as db:
            await gsc_store.mark_integration_error(db, facts, error.reason)
        return SyncReport(Outcome.PERMISSION_REVOKED, calls=pull.calls, error=error.reason)
    except GoogleError as error:
        # Quota, a server that did not answer, an answer that is not what the API documents, a
        # client Google does not accept: the integration stays active and the planner tries it
        # again after a wait that grows (`Ga4PullState.failed`).
        if isinstance(error, GoogleResponseError):
            # The message names what was wrong, never what was received: ours and the client's
            # are fixed strings (a model name, an HTTP status, a row shape), with no body or token.
            _log.error("ga4 run failed", reason=error.reason, detail=str(error), **context)
        elif isinstance(error, GoogleClientRejectedError):
            _log.error("ga4 run failed", reason=error.reason, **context)
        else:
            _log.warning("ga4 run failed", reason=error.reason, **context)
        async with workspace_transaction(ctx.sessions, workspace_id) as db:
            await gsc_store.save_state(
                db, facts, pull.state.failed(ctx.now()), last_error=error.reason
            )
        return SyncReport(Outcome.FAILED, calls=pull.calls, error=error.reason)
    except Exception:
        # A fault of ours or of the database. Say so on the integration and wait before the next
        # run, so a fault that repeats does not call Google every minute; then raise it.
        with contextlib.suppress(Exception):
            async with workspace_transaction(ctx.sessions, workspace_id) as db:
                await gsc_store.save_state(
                    db, facts, pull.state.failed(ctx.now()), last_error="internal_error"
                )
        raise
    _log.info("ga4 run done", rows=written, calls=pull.calls, **context)
    return SyncReport(Outcome.DONE, rows_written=written, calls=pull.calls)


async def _reauth(
    ctx: Ga4Context, facts: IntegrationFacts, code: str, pull: _Pull | None = None
) -> SyncReport:
    async with workspace_transaction(ctx.sessions, facts.workspace_id) as db:
        await gsc_store.mark_reauth_required(db, facts, code)
    return SyncReport(Outcome.REAUTH_REQUIRED, calls=0 if pull is None else pull.calls, error=code)
