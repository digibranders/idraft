"""Tracked pages and page search of a project's Search Console property (spec
docs/superpowers/specs/2026-11-26-page-search-and-monitoring-design.md section 7). Reading needs
`data:read`; tracking and untracking need `projects:write`."""

from __future__ import annotations

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query

from idraft.api.fp.live import live_google
from idraft.api.fp.page_search import PageSearchService
from idraft.api.fp.tracked import PeriodQuery, TrackedPagesService
from idraft.api.permissions import Permission
from idraft.api.request_info import Info
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.fp_pages import (
    PageBreakdownResponse,
    PageSearchResponse,
    SuggestionsResponse,
    TrackedIdsResponse,
    TrackedPagesResponse,
    TrackPagesRequest,
    TrackPagesResponse,
    UntrackRequest,
    UntrackResponse,
)
from idraft.api.schemas.internal_links import UrlId
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission
from idraft.collectors.gsc_page_detail import BreakdownDimension
from idraft.domain.page_search import Compare

PROJECT = "/api/v1/workspaces/{workspace_id}/projects/{project_id}"
router = APIRouter(prefix=f"{PROJECT}/fp", tags=["first-party"])

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
WriteProject = Annotated[WorkspaceAccess, Depends(require_permission(Permission.PROJECTS_WRITE))]


def get_tracked_pages(
    resources: Annotated[Resources, Depends(get_resources)],
) -> TrackedPagesService:
    return TrackedPagesService(sessions=resources.sessions)


Tracked = Annotated[TrackedPagesService, Depends(get_tracked_pages)]


def get_page_search(resources: Annotated[Resources, Depends(get_resources)]) -> PageSearchService:
    return PageSearchService(
        sessions=resources.sessions, live=lambda facts: live_google(resources, facts)
    )


PageSearch = Annotated[PageSearchService, Depends(get_page_search)]
UrlIdPath = Annotated[UrlId, Path(description="A page of the project: a `core.urls` id.")]
FromDay = Annotated[date | None, Query(alias="from", description="First day, included.")]
ToDay = Annotated[date | None, Query(alias="to", description="Last day, included.")]
CompareWith = Annotated[
    Compare,
    Query(
        description="`previous_period`: the month before a whole month, else as many days just "
        "before; `previous_year`: the same dates a year earlier; `none`."
    ),
]


@router.get(
    "/tracked-pages",
    summary="The pages a project tracks, with their Search Console numbers",
    description="At most 200 pages, no paging, ordered by path. `from` and `to` are Pacific Time "
    "days, both included, at most 92 (`422 window_too_large`); `to` is cut to the last final "
    "day. With neither, the period is the last full calendar month that ends on or before the "
    "last final day. `compare` is `previous_period` (default), `previous_year` or `none`. A page "
    "whose daily history is not stored yet has `history: loading` and no `current`, `previous`, "
    "`health` or `trend`. `queries` is read from stored counts only, and is null for a period "
    "with none stored. `cannibalization` is reserved and always null. With `not_connected` or "
    "`pending` the pages are listed and every number is null.",
)
async def list_tracked_pages(
    project_id: UUID,
    access: ReadData,
    service: Tracked,
    start: Annotated[date | None, Query(alias="from", description="First day, included.")] = None,
    end: Annotated[date | None, Query(alias="to", description="Last day, included.")] = None,
    compare: Annotated[
        Compare,
        Query(
            description="`previous_period`: the month before a whole month, else as many days "
            "just before; `previous_year`: the same dates a year earlier; `none`."
        ),
    ] = "previous_period",
) -> TrackedPagesResponse:
    return await service.list_pages(access, project_id, PeriodQuery(start, end, compare))


@router.get(
    "/tracked-pages/ids",
    summary="The url ids of the tracked pages",
    description="For the Tracked column of the page list. At most 200 ids.",
)
async def tracked_page_ids(
    project_id: UUID, access: ReadData, service: Tracked
) -> TrackedIdsResponse:
    return await service.ids(access, project_id)


@router.post(
    "/tracked-pages",
    summary="Track pages by address or by url id",
    description="`urls` (at most 500; a path is read against the project's website) and "
    "`url_ids` (at most 500) may both be given, and the answer has one outcome per input, in "
    "order: `added` (`ok` with `dry_run`), `already_tracked`, `invalid_url`, `wrong_host`, "
    "`not_crawled` (not a page of the project) or `over_limit` (a project tracks at most 200). "
    "An address is parsed and never fetched. `dry_run` checks without writing. An audit entry "
    "`tracked_page.add` is written for a request that added pages.",
)
async def track_pages(
    project_id: UUID,
    body: TrackPagesRequest,
    access: WriteProject,
    service: Tracked,
    info: Info,
) -> TrackPagesResponse:
    return await service.add(access, project_id, body, info)


@router.post(
    "/tracked-pages/remove",
    summary="Stop tracking pages",
    description="At most 200 url ids. The numbers stored for the pages are kept. An audit entry "
    "`tracked_page.remove` is written when a page was untracked.",
)
async def untrack_pages(
    project_id: UUID,
    body: UntrackRequest,
    access: WriteProject,
    service: Tracked,
    info: Info,
) -> UntrackResponse:
    return await service.remove(access, project_id, body, info)


@router.get(
    "/tracked-pages/suggestions",
    summary="Untracked pages with the most clicks",
    description="The 25 pages of the project that are not tracked and had the most clicks in "
    "the last 28 final days, from stored rows. Empty unless the state is `ok`, "
    "`reauth_required` or `no_access`.",
)
async def tracked_page_suggestions(
    project_id: UUID, access: ReadData, service: Tracked
) -> SuggestionsResponse:
    return await service.suggestions(access, project_id)


@router.get(
    "/page-search/{url_id}",
    summary="One page: Search Console totals, health and daily series",
    description="The period is chosen as for the tracked pages (`from`, `to`, `compare`; at most "
    "92 days, `422 window_too_large`). The series has one point for every day of the period; a "
    "day without a stored row has 0 clicks and impressions and no position. The first request "
    "for a page whose history is not stored fetches it from Google, once. When that cannot be "
    "done now (this installation's budget is spent, Google is busy or does not answer, or the "
    "state is not `ok`) the answer is still `200`, with `history_from`, `current`, `previous` "
    "and `health` null and both series empty, and `retry_after` in seconds when asking again "
    "can help. `404 not_found` for a page that is not a page of the project.",
)
async def page_search(
    project_id: UUID,
    url_id: UrlIdPath,
    access: ReadData,
    service: PageSearch,
    start: FromDay = None,
    end: ToDay = None,
    compare: CompareWith = "previous_period",
) -> PageSearchResponse:
    return await service.detail(access, project_id, url_id, PeriodQuery(start, end, compare))


@router.get(
    "/page-search/{url_id}/breakdown",
    summary="One page: its rows by query, country or device, now and before",
    description="The rows of both periods under one key, most clicks first; `current` or "
    "`previous` is null for a key outside that period's stored rows. A period with no stored "
    "rows is fetched from Google, once, and stored: for `query` the read asks for 25,000 rows "
    "and 100 are kept. `coverage` is the stored rows' clicks over the page's clicks. With a "
    "state other than `ok` only stored rows are served. `429 gsc_busy` (with `retry_after`) "
    "when this installation's budget or Google's quota is spent, `503 google_unavailable` when "
    "Google does not answer.",
)
async def page_search_breakdown(
    project_id: UUID,
    url_id: UrlIdPath,
    dimension: Annotated[
        BreakdownDimension, Query(description="What the rows are by: `query`, `country`, `device`.")
    ],
    access: ReadData,
    service: PageSearch,
    start: FromDay = None,
    end: ToDay = None,
    compare: CompareWith = "previous_period",
) -> PageBreakdownResponse:
    return await service.breakdown(
        access, project_id, url_id, dimension, PeriodQuery(start, end, compare)
    )
