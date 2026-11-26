"""One page's Search Console numbers (spec docs/superpowers/specs/2026-11-26-page-search-and-
monitoring-design.md sections 7.2 and 9): the totals, health and daily series, and the breakdowns
by query, location and device.

Stored rows answer. A page whose history, or a period whose breakdown, was never fetched is fetched
from Google once, within this process's own budget and never waited on, and stored. A page that
cannot be fetched now answers with no numbers (the detail) or `429 gsc_busy` (a breakdown).
"""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.ai.engine_service import live_project
from idraft.api.fp import pages_repository as repository
from idraft.api.fp.live import GscBusyError, LiveGoogle, LiveStateError
from idraft.api.fp.pages_repository import PageInfo, SearchScope
from idraft.api.fp.tracked import (
    NUMBERED_STATES,
    PeriodQuery,
    Window,
    numbers_view,
    period_views,
    previous_totals,
    resolve_windows,
    search_meta,
)
from idraft.api.problems import NotFoundError, ServiceUnavailableError
from idraft.api.schemas.fp_pages import (
    BreakdownRow,
    PageBreakdownMeta,
    PageBreakdownResponse,
    PageSearchData,
    PageSearchMeta,
    PageSearchResponse,
    SeriesPoint,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.collectors import gsc_page_detail as detail
from idraft.collectors import gsc_store
from idraft.collectors.gsc_page_detail import KEEP_LIMITS, BreakdownDimension
from idraft.collectors.gsc_store import IntegrationFacts
from idraft.collectors.gsc_sync import pacific_today
from idraft.db.engine import workspace_transaction
from idraft.domain.page_search import Totals, days_of

type LiveFactory = Callable[[IntegrationFacts], LiveGoogle | None]
type Windows = tuple[Window, Window | None]


def _points(window: Window, found: dict[date, Totals]) -> list[SeriesPoint]:
    """One point for every day of the period; a day without a row is 0 with no position."""
    points: list[SeriesPoint] = []
    for offset in range(days_of(*window)):
        day = window[0] + timedelta(days=offset)
        totals = found.get(day, Totals())
        points.append(
            SeriesPoint(
                date=day,
                clicks=totals.clicks,
                impressions=totals.impressions,
                position=totals.position,
            )
        )
    return points


async def _with_numbers(
    key: tuple[AsyncSession, UUID, UUID, UUID],
    data: PageSearchData,
    history: date,
    windows: Windows,
) -> PageSearchData:
    """The page with its stored totals, health and series for the periods. `key` is the
    database, workspace, project and integration the statements of the repository take."""
    url_id = int(data.url_id)
    window, compared = windows
    now = (await repository.totals(*key, [url_id], window)).get(url_id, Totals())
    before = {} if compared is None else await repository.totals(*key, [url_id], compared)
    previous = previous_totals(url_id, before, history, compared)
    current_view, previous_view, health = period_views(now, previous, window, compared)
    earlier: list[SeriesPoint] = []
    if previous is not None and compared is not None:
        earlier = _points(compared, await repository.series(*key, url_id, compared))
    return data.model_copy(
        update={
            "current": current_view,
            "previous": previous_view,
            "health": health,
            "series": _points(window, await repository.series(*key, url_id, window)),
            "previous_series": earlier,
        }
    )


def _not_available() -> ServiceUnavailableError:
    return ServiceUnavailableError(
        "Search Console is not available on this installation.", code="google_unavailable"
    )


def _row_order(row: BreakdownRow) -> tuple[int, int, str]:
    """Most clicks now first, then before; a key outside a period's rows follows those with one."""
    now, before = row.current, row.previous
    return (-(now.clicks if now else -1), -(before.clicks if before else -1), row.key)


class PageSearchService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession], live: LiveFactory) -> None:
        self._sessions = sessions
        self._live = live

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    @staticmethod
    async def _page(
        db: AsyncSession, access: WorkspaceAccess, project_id: UUID, url_id: int
    ) -> PageInfo:
        """The page of the project, else 404 (also for a project outside the workspace)."""
        await live_project(db, access, project_id)
        page = await repository.page_row(db, access.workspace_id, project_id, url_id)
        if page is None:
            raise NotFoundError
        return page

    @staticmethod
    def _windows(scope: SearchScope, query: PeriodQuery) -> Windows | None:
        """The periods asked for; None where the state has no numbers to serve."""
        if scope.state not in NUMBERED_STATES or scope.final_through is None:
            return None
        return resolve_windows(query, scope.final_through)

    async def detail(
        self, access: WorkspaceAccess, project_id: UUID, url_id: int, query: PeriodQuery
    ) -> PageSearchResponse:
        ws = access.workspace_id
        facts: IntegrationFacts | None = None
        async with self._transaction(access) as db:
            page = await self._page(db, access, project_id, url_id)
            scope = await repository.search_scope(db, ws, project_id)
            windows = self._windows(scope, query)
            if scope.state == "ok" and scope.integration_id is not None:
                starts = await repository.history_starts(
                    db, ws, project_id, scope.integration_id, [url_id]
                )
                if url_id not in starts:
                    facts = await gsc_store.load_integration(db, ws, scope.integration_id, "gsc")
        retry_after: int | None = None
        if facts is not None and scope.final_through is not None:
            try:
                await self._fetch_history(facts, page, scope.final_through)
            except GscBusyError as busy:
                retry_after = busy.retry_after
            except LiveStateError as refused:
                scope = replace(scope, state=refused.state)
            except ServiceUnavailableError:
                pass  # the panel asks again; the page has no numbers meanwhile
        data = PageSearchData(
            url_id=str(page.url_id),
            url=page.url,
            path=page.path,
            title=page.title,
            tier_id=page.tier_id,
            tracked=page.tracked,
            current=None,
            previous=None,
            health=None,
            series=[],
            previous_series=[],
        )
        history: date | None = None
        if windows is not None and scope.integration_id is not None:
            async with self._transaction(access) as db:
                key = (db, ws, project_id, scope.integration_id)
                history = (await repository.history_starts(*key, [url_id])).get(url_id)
                if history is not None:
                    data = await _with_numbers(key, data, history, windows)
        meta = search_meta(scope, windows)
        return PageSearchResponse(
            data=data,
            meta=PageSearchMeta(**meta.model_dump(), history_from=history, retry_after=retry_after),
        )

    async def _fetch_history(
        self, facts: IntegrationFacts, page: PageInfo, final_through: date
    ) -> None:
        live = self._live(facts)
        if live is None:
            raise _not_available()
        await detail.ensure_history(
            self._sessions,
            live.query,
            facts,
            detail.PageRef(page.url_id, page.url),
            today=pacific_today(datetime.now(UTC)),
            final_through=final_through,
        )

    async def breakdown(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        url_id: int,
        dimension: BreakdownDimension,
        query: PeriodQuery,
    ) -> PageBreakdownResponse:
        ws = access.workspace_id
        missing: list[Window] = []
        facts: IntegrationFacts | None = None
        async with self._transaction(access) as db:
            page = await self._page(db, access, project_id, url_id)
            scope = await repository.search_scope(db, ws, project_id)
            windows = self._windows(scope, query)
            if scope.state == "ok" and windows is not None and scope.integration_id is not None:
                for period in (windows[0], windows[1]):
                    if period is None:
                        continue
                    marker = await repository.fetch_marker(
                        db, ws, project_id, scope.integration_id, url_id, dimension, period
                    )
                    if marker is None:
                        missing.append(period)
                if missing:
                    facts = await gsc_store.load_integration(db, ws, scope.integration_id, "gsc")
        if facts is not None:
            # A busy budget or an unavailable Google is the caller's to hear about.
            scope = await self._fetch_breakdown(facts, page, dimension, missing, scope)
        rows: list[BreakdownRow] = []
        marker = None
        coverage: float | None = None
        if windows is not None and scope.integration_id is not None:
            window, compared = windows
            async with self._transaction(access) as db:
                key = (db, ws, project_id, scope.integration_id)
                now = await repository.breakdown_rows(*key, url_id, window, dimension)
                before = (
                    {}
                    if compared is None
                    else await repository.breakdown_rows(*key, url_id, compared, dimension)
                )
                marker = await repository.fetch_marker(*key, url_id, dimension, window)
                clicks = (await repository.totals(*key, [url_id], window)).get(url_id, Totals())
            rows = sorted(
                (
                    BreakdownRow(
                        key=name,
                        current=None if name not in now else numbers_view(now[name]),
                        previous=None if name not in before else numbers_view(before[name]),
                    )
                    for name in now.keys() | before.keys()
                ),
                key=_row_order,
            )
            if marker is not None and clicks.clicks:
                coverage = min(1.0, sum(row.clicks for row in now.values()) / clicks.clicks)
        meta = search_meta(scope, windows)
        return PageBreakdownResponse(
            data=rows,
            meta=PageBreakdownMeta(
                **meta.model_dump(),
                dimension=dimension,
                row_limit=KEEP_LIMITS[dimension],
                truncated=marker is not None and marker.truncated,
                coverage=coverage,
                fetched_at=None if marker is None else marker.fetched_at,
            ),
        )

    async def _fetch_breakdown(
        self,
        facts: IntegrationFacts,
        page: PageInfo,
        dimension: BreakdownDimension,
        periods: list[Window],
        scope: SearchScope,
    ) -> SearchScope:
        """Fetch the periods without rows. Google refusing the token or the property gives the
        scope that state, to answer what is stored."""
        live = self._live(facts)
        if live is None:
            raise _not_available()
        ref = detail.PageRef(page.url_id, page.url)
        try:
            for start, end in periods:
                await detail.ensure_breakdown(
                    self._sessions, live.query, facts, ref, start, end, only=(dimension,)
                )
        except LiveStateError as refused:
            return replace(scope, state=refused.state)
        return scope
