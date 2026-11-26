"""The pages a project tracks (spec docs/superpowers/specs/2026-11-26-page-search-and-monitoring-
design.md section 7.2): the list with numbers, health, trend and query counts, adding, removing,
the ids and the suggestions.

Every number is a stored row; Google is never called. A number that was not stored is null, never
0. The most a project tracks is `TRACKED_PAGES_LIMIT`, kept by locking the project row while a
request counts."""

from __future__ import annotations

from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Final
from uuid import UUID

from fastapi.exceptions import RequestValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api import audit
from idraft.api.ai.engine_service import live_project
from idraft.api.fp import pages_repository as repository
from idraft.api.fp.pages_repository import PageRef, PageRow, SearchScope, SiteHosts
from idraft.api.problems import WindowTooLargeError as WindowTooLargeProblem
from idraft.api.request_info import RequestInfo
from idraft.api.schemas.fp_pages import (
    PageHealth,
    PageNumbers,
    PageQueries,
    SearchMeta,
    SearchWindow,
    SuggestionRow,
    SuggestionsMeta,
    SuggestionsResponse,
    TrackedIdsMeta,
    TrackedIdsResponse,
    TrackedPageRow,
    TrackedPagesMeta,
    TrackedPagesResponse,
    TrackOutcome,
    TrackOutcomeCode,
    TrackPagesMeta,
    TrackPagesRequest,
    TrackPagesResponse,
    UntrackRequest,
    UntrackResponse,
    UntrackResult,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.domain.page_search import (
    MAX_DAYS,
    Compare,
    Health,
    Totals,
    compare_window,
    days_of,
    health_of,
    window_of,
)
from idraft.domain.page_search import WindowTooLargeError as WindowTooLargeValue
from idraft.extraction.urls import UrlRejectedError, canonicalize

TRACKED_PAGES_LIMIT: Final = 200
SUGGESTIONS_LIMIT: Final = 25
SUGGESTION_DAYS: Final = 28
# The states whose stored numbers are served.
NUMBERED_STATES: Final = ("ok", "reauth_required", "no_access")

type Window = tuple[date, date]
type Counts = dict[int, tuple[int, bool]]


@dataclass(frozen=True, slots=True)
class PeriodQuery:
    """The route's `from`, `to` and `compare`."""

    start: date | None = None
    end: date | None = None
    compare: Compare = "previous_period"


def numbers_view(totals: Totals) -> PageNumbers:
    return PageNumbers(
        clicks=totals.clicks,
        impressions=totals.impressions,
        ctr=totals.ctr,
        position=totals.position,
    )


def health_view(health: Health) -> PageHealth:
    return PageHealth(
        verdict=health.verdict,
        basis=health.basis,
        change=health.change,
        absolute=health.absolute,
        small=health.small,
        flags=list(health.flags),
    )


def period_views(
    current: Totals, previous: Totals | None, window: Window, compared: Window | None
) -> tuple[PageNumbers, PageNumbers | None, PageHealth]:
    """The numbers of a period, the ones it is compared with, and the verdict between them."""
    days = days_of(*window)
    health = health_of(current, previous, days, days if compared is None else days_of(*compared))
    return (
        numbers_view(current),
        None if previous is None else numbers_view(previous),
        health_view(health),
    )


def window_view(window: Window) -> SearchWindow:
    return SearchWindow(from_=window[0], to=window[1], days=days_of(*window))


def resolve_windows(query: PeriodQuery, final_through: date) -> tuple[Window, Window | None]:
    """The period asked for, cut to the last final day, and the period compared with."""
    try:
        window = window_of(query.start, query.end, final_through)
    except WindowTooLargeValue:
        raise WindowTooLargeProblem(
            f"A window is at most {MAX_DAYS} days.", limit_days=MAX_DAYS
        ) from None
    except ValueError:
        raise RequestValidationError(
            [
                {
                    "loc": ("query", "from"),
                    "type": "range_invalid",
                    "msg": "`from` is after `to`.",
                }
            ]
        ) from None
    return window, compare_window(*window, query.compare)


def search_meta(scope: SearchScope, windows: tuple[Window, Window | None] | None) -> SearchMeta:
    """The meta every search route carries. `pending` and `not_connected` have no final day and no
    window, whatever the pull has stored."""
    compared = None if windows is None else windows[1]
    return SearchMeta(
        state=scope.state,
        property=scope.site_url,
        final_through=scope.final_through if scope.state in NUMBERED_STATES else None,
        window=None if windows is None else window_view(windows[0]),
        compare_window=None if compared is None else window_view(compared),
    )


def previous_totals(
    url_id: int, before: dict[int, Totals], first_day: date, compared: Window | None
) -> Totals | None:
    """The compared period's totals. None with nothing to compare with, or when the page's history
    starts after the compared period begins and the period holds no row of the page."""
    if compared is None:
        return None
    if first_day > compared[0] and url_id not in before:
        return None
    return before.get(url_id, Totals())


def queries_of(url_id: int, current: Counts, before: Counts) -> PageQueries | None:
    """The stored count of the period, and the one before it unless that is a lower bound."""
    now = current.get(url_id)
    if now is None:
        return None
    then = before.get(url_id)
    return PageQueries(
        value=now[0], previous=None if then is None or then[1] else then[0], capped=now[1]
    )


@dataclass(frozen=True, slots=True)
class Stored:
    """What the list reads for one period: the pages' totals, the compared period's, where each
    history starts, the clicks of each day, and the stored query counts of both periods."""

    now: dict[int, Totals]
    before: dict[int, Totals]
    starts: dict[int, date]
    trends: dict[int, dict[date, int]]
    counts: Counts
    earlier: Counts


def _page_row(
    page: PageRow, stored: Stored | None, window: Window, compared: Window | None
) -> TrackedPageRow:
    """One tracked page. A page without its history has no numbers (spec D19), though the rows
    of its days may exist; its query counts are read whatever its history is."""
    base = TrackedPageRow(
        url_id=str(page.url_id),
        url=page.url,
        path=page.path,
        title=page.title,
        tier_id=page.tier_id,
        added_at=page.added_at,
        history="loading",
        current=None,
        previous=None,
        health=None,
        queries=None,
        trend=None,
    )
    if stored is None:
        return base
    queries = queries_of(page.url_id, stored.counts, stored.earlier)
    start = stored.starts.get(page.url_id)
    if start is None:
        return base.model_copy(update={"queries": queries})
    current, previous, health = period_views(
        stored.now.get(page.url_id, Totals()),
        previous_totals(page.url_id, stored.before, start, compared),
        window,
        compared,
    )
    clicks = stored.trends.get(page.url_id, {})
    return base.model_copy(
        update={
            "history": "ready",
            "current": current,
            "previous": previous,
            "health": health,
            "queries": queries,
            "trend": [
                clicks.get(window[0] + timedelta(days=offset), 0)
                for offset in range(days_of(*window))
            ],
        }
    )


class TrackedPagesService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    async def list_pages(
        self, access: WorkspaceAccess, project_id: UUID, query: PeriodQuery
    ) -> TrackedPagesResponse:
        ws = access.workspace_id
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            scope = await repository.search_scope(db, ws, project_id)
            pages = await repository.tracked_rows(db, ws, project_id)
            windows = None
            stored = None
            if (
                scope.state in NUMBERED_STATES
                and scope.final_through is not None
                and scope.integration_id is not None
            ):
                windows = resolve_windows(query, scope.final_through)
                stored = await self._stored(
                    db, ws, project_id, scope.integration_id, [p.url_id for p in pages], windows
                )
        meta = search_meta(scope, windows)
        window, compared = windows or ((date.min, date.min), None)
        return TrackedPagesResponse(
            data=[_page_row(page, stored, window, compared) for page in pages],
            meta=TrackedPagesMeta(
                **meta.model_dump(), limit=TRACKED_PAGES_LIMIT, tracked=len(pages)
            ),
        )

    @staticmethod
    async def _stored(
        db: AsyncSession,
        ws: UUID,
        project_id: UUID,
        integration: UUID,
        ids: list[int],
        windows: tuple[Window, Window | None],
    ) -> Stored:
        window, compared = windows
        key = (db, ws, project_id, integration, ids)
        return Stored(
            now=await repository.totals(*key, window),
            before={} if compared is None else await repository.totals(*key, compared),
            starts=await repository.history_starts(*key),
            trends=await repository.clicks_by_day(*key, window),
            counts=await repository.query_counts(*key, window),
            earlier={} if compared is None else await repository.query_counts(*key, compared),
        )

    async def ids(self, access: WorkspaceAccess, project_id: UUID) -> TrackedIdsResponse:
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            found = await repository.tracked_ids(db, access.workspace_id, project_id)
        return TrackedIdsResponse(
            data=[str(url_id) for url_id in found], meta=TrackedIdsMeta(limit=TRACKED_PAGES_LIMIT)
        )

    async def add(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        body: TrackPagesRequest,
        info: RequestInfo,
    ) -> TrackPagesResponse:
        ws = access.workspace_id
        async with self._transaction(access) as db:
            # Two requests count one after the other, so they cannot pass the limit together.
            await live_project(db, access, project_id, lock=True)
            site = await repository.site_hosts_of(db, ws, project_id)
            checks = [(raw, *_address(raw, site)) for raw in body.urls]
            by_hash = await repository.pages_by_hash(
                db, ws, project_id, [url_hash for _, _, url_hash in checks if url_hash]
            )
            by_id = await repository.pages_by_id(db, ws, project_id, body.url_ids)
            tracked = set(await repository.tracked_ids(db, ws, project_id))
            asked: list[tuple[str, TrackOutcomeCode | None, PageRef | None]] = [
                (raw, failure, None if url_hash is None else by_hash.get(url_hash))
                for raw, failure, url_hash in checks
            ] + [(str(url_id), None, by_id.get(url_id)) for url_id in body.url_ids]

            room = TRACKED_PAGES_LIMIT - len(tracked)
            seen = set(tracked)
            to_add: list[int] = []
            decided: list[tuple[str, TrackOutcomeCode, PageRef | None]] = []
            for raw, failure, page in asked:
                outcome: TrackOutcomeCode
                if failure is not None:
                    outcome = failure
                elif page is None:
                    outcome = "not_crawled"
                elif page.url_id in seen:
                    outcome = "already_tracked"
                elif room > 0:
                    outcome = "ok" if body.dry_run else "added"
                    room -= 1
                    seen.add(page.url_id)
                    to_add.append(page.url_id)
                else:
                    outcome = "over_limit"
                decided.append((raw, outcome, page))

            clicks = await self._clicks_28d(
                db, ws, project_id, [page.url_id for _, _, page in decided if page]
            )
            if to_add and not body.dry_run:
                await repository.add_tracked(db, ws, project_id, access.user_id, to_add)
                await audit.record(
                    db,
                    workspace_id=ws,
                    actor_id=access.user_id,
                    action="tracked_page.add",
                    target_type="project",
                    target_id=project_id,
                    info=info,
                    after={"url_ids": [str(url_id) for url_id in to_add], "added": len(to_add)},
                )
        added = 0 if body.dry_run else len(to_add)
        return TrackPagesResponse(
            data=[
                TrackOutcome(
                    input=raw,
                    outcome=outcome,
                    url_id=None if page is None else str(page.url_id),
                    path=None if page is None else page.path,
                    clicks_28d=None if page is None else clicks.get(page.url_id),
                )
                for raw, outcome, page in decided
            ],
            meta=TrackPagesMeta(
                limit=TRACKED_PAGES_LIMIT, tracked=len(tracked) + added, added=added
            ),
        )

    @staticmethod
    async def _clicks_28d(
        db: AsyncSession, ws: UUID, project_id: UUID, url_ids: list[int]
    ) -> dict[int, int]:
        """The stored clicks of the 28 final days; a page with no row there is absent."""
        scope = await repository.search_scope(db, ws, project_id)
        if scope.integration_id is None or scope.final_through is None:
            return {}
        window = (scope.final_through - timedelta(days=SUGGESTION_DAYS - 1), scope.final_through)
        found = await repository.totals(db, ws, project_id, scope.integration_id, url_ids, window)
        return {url_id: totals.clicks for url_id, totals in found.items()}

    async def remove(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        body: UntrackRequest,
        info: RequestInfo,
    ) -> UntrackResponse:
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            removed = await repository.remove_tracked(
                db, access.workspace_id, project_id, body.url_ids
            )
            if removed:
                await audit.record(
                    db,
                    workspace_id=access.workspace_id,
                    actor_id=access.user_id,
                    action="tracked_page.remove",
                    target_type="project",
                    target_id=project_id,
                    info=info,
                    after={
                        "url_ids": [str(url_id) for url_id in removed],
                        "removed": len(removed),
                    },
                )
        return UntrackResponse(data=UntrackResult(removed=len(removed)))

    async def suggestions(self, access: WorkspaceAccess, project_id: UUID) -> SuggestionsResponse:
        ws = access.workspace_id
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            scope = await repository.search_scope(db, ws, project_id)
            found: list[repository.Suggestion] = []
            if (
                scope.state in NUMBERED_STATES
                and scope.integration_id is not None
                and scope.final_through is not None
            ):
                window = (
                    scope.final_through - timedelta(days=SUGGESTION_DAYS - 1),
                    scope.final_through,
                )
                found = await repository.suggestions(
                    db, ws, project_id, scope.integration_id, window, SUGGESTIONS_LIMIT
                )
        return SuggestionsResponse(
            data=[
                SuggestionRow(
                    url_id=str(row.url_id),
                    url=row.url,
                    path=row.path,
                    title=row.title,
                    clicks_28d=row.clicks,
                    impressions_28d=row.impressions,
                )
                for row in found
            ],
            meta=SuggestionsMeta(state=scope.state),
        )


def _address(raw: str, site: SiteHosts) -> tuple[TrackOutcomeCode | None, bytes | None]:
    """The hash of an address or a path of the project's website, or why it is not one. The
    address is parsed and never fetched."""
    if raw.startswith("/"):
        if site.primary is None:
            return "invalid_url", None
        raw = f"https://{site.primary}{raw}"
    try:
        url = canonicalize(raw)
    except UrlRejectedError:
        return "invalid_url", None
    if url.host.name not in site.hosts:
        return "wrong_host", None
    return None, url.url_hash
