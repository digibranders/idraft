"""Tracked pages and page search of a project's Search Console property (spec
docs/superpowers/specs/2026-11-26-page-search-and-monitoring-design.md section 7). Reading needs
`data:read`; tracking and untracking need `projects:write`."""

from __future__ import annotations

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from idraft.api.fp.tracked import PeriodQuery, TrackedPagesService
from idraft.api.permissions import Permission
from idraft.api.request_info import Info
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.fp_pages import (
    SuggestionsResponse,
    TrackedIdsResponse,
    TrackedPagesResponse,
    TrackPagesRequest,
    TrackPagesResponse,
    UntrackRequest,
    UntrackResponse,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission
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
