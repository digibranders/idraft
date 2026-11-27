"""A project's crawls (spec 6.2 and 9). Reading needs `data:read`; Crawl now and cancel need
`runs:trigger` (decision D15)."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from idraft.api.internal_links.crawls import CrawlRecord, CrawlService, CrawlView
from idraft.api.pagination import Cursor, CursorPageInfo
from idraft.api.permissions import Permission
from idraft.api.request_info import Info
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.common import UserRef
from idraft.api.schemas.internal_links import CrawlCreate, CrawlRun, CrawlRunPage, CrawlRunResponse
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/link-crawls",
    tags=["internal-links"],
)

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
TriggerRuns = Annotated[WorkspaceAccess, Depends(require_permission(Permission.RUNS_TRIGGER))]


def get_crawls(resources: Annotated[Resources, Depends(get_resources)]) -> CrawlService:
    return resources.crawls


Crawls = Annotated[CrawlService, Depends(get_crawls)]


def crawl_view(record: CrawlRecord, latest: UUID | None) -> CrawlRun:
    requester = (
        None
        if record.requested_by is None
        or record.requester_name is None
        or record.requester_email is None
        else UserRef(
            user_id=record.requested_by, name=record.requester_name, email=record.requester_email
        )
    )
    return CrawlRun(
        run_id=record.run_id,
        trigger=record.trigger,
        state=record.state,
        ceiling=record.ceiling,
        pages_found=record.pages_found,
        pages_crawled=record.pages_crawled,
        sitemap_pages=record.sitemap_pages,
        pages_blocked=record.pages_blocked,
        pages_variant=record.pages_variant,
        pages=record.pages,
        render_javascript=record.render_javascript,
        estimated_cost_usd=record.estimated_cost_usd,
        cost_usd=record.cost_usd,
        stop_reason=record.stop_reason,
        error_code=record.error_code,
        error_message=record.error_message,
        hints=record.hints,
        is_latest=record.run_id == latest,
        links_available=record.links_available,
        previous_run_id=record.previous_run_id,
        enrich_state=record.enrich_state,
        html_reader_stale=record.html_reader_stale,
        pages_links_suspect=record.pages_links_suspect,
        created_at=record.created_at,
        submitted_at=record.submitted_at,
        finished_at=record.finished_at,
        requested_by=requester,
    )


def _response(found: CrawlView) -> CrawlRunResponse:
    return CrawlRunResponse(data=crawl_view(found.record, found.latest))


@router.get("", summary="The project's crawls, newest first")
async def list_crawls(
    project_id: UUID, access: ReadData, crawls: Crawls, page: Cursor
) -> CrawlRunPage:
    listing = await crawls.list(access, project_id, page)
    return CrawlRunPage(
        data=[crawl_view(record, listing.latest) for record in listing.records],
        page=CursorPageInfo(
            limit=page.limit,
            next_cursor=listing.next_cursor,
            has_more=listing.next_cursor is not None,
        ),
    )


@router.post(
    "",
    status_code=202,
    summary="Crawl now",
    description="Queues a crawl of the project's website. `503 crawls_disabled` while site crawls "
    "are not switched on, and nothing is queued. One crawl per project runs at a time "
    "(`409 crawl_in_progress` with its `run_id`). `422 no_website` without a website; `422 "
    "budget_exceeded` (with `budget_id`) when the crawl would pass a budget, and nothing is "
    "queued. `higher_limit` crawls again after a crawl stopped at its ceiling, with twice the "
    "limit or what the sitemap asks for.",
)
async def start_crawl(
    project_id: UUID, body: CrawlCreate, access: TriggerRuns, crawls: Crawls, info: Info
) -> CrawlRunResponse:
    return _response(await crawls.start(access, project_id, body.higher_limit, info))


@router.get("/{run_id}", summary="One crawl, with its progress")
async def get_crawl(
    project_id: UUID, run_id: UUID, access: ReadData, crawls: Crawls
) -> CrawlRunResponse:
    return _response(await crawls.get(access, project_id, run_id))


@router.post(
    "/{run_id}/cancel",
    summary="Cancel a queued or running crawl",
    description="A queued crawl ends at once. A running one is stopped by the worker within a "
    "minute and comes back with its state unchanged. `409 invalid_state_transition` for any "
    "other state.",
)
async def cancel_crawl(
    project_id: UUID, run_id: UUID, access: TriggerRuns, crawls: Crawls, info: Info
) -> CrawlRunResponse:
    return _response(await crawls.cancel(access, project_id, run_id, info))
