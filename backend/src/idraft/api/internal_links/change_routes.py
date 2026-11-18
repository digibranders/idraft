"""Changes between crawls (spec 7.10). Every route needs `data:read`; `run` is `latest` or a
crawl id. `410 links_dropped` for the link lists of a crawl whose links were dropped."""

from __future__ import annotations

from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from idraft.api.internal_links.changes import ChangeService
from idraft.api.permissions import Permission
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.internal_links_extra import (
    ChangeLinkPage,
    ChangesSummaryResponse,
    MovedPageList,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/changes",
    tags=["internal-links"],
)
ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
Run = Annotated[Literal["latest"] | UUID, Query(description="`latest` or a crawl id.")]
_CSV: dict[int | str, dict[str, Any]] = {
    200: {"content": {"text/csv": {}}, "description": "With `format=csv`: the rows as CSV."}
}


def get_changes(resources: Annotated[Resources, Depends(get_resources)]) -> ChangeService:
    return resources.link_changes


Changes = Annotated[ChangeService, Depends(get_changes)]


def _run(run: Literal["latest"] | UUID) -> UUID | None:
    return run if isinstance(run, UUID) else None


@router.get(
    "/summary",
    summary="Counts of what the crawl changed, and the alert for links lost to important pages",
    response_model=ChangesSummaryResponse,
)
async def changes_summary(
    project_id: UUID, access: ReadData, changes: Changes, run: Run = "latest"
) -> ChangesSummaryResponse:
    return ChangesSummaryResponse(data=await changes.summary(access, project_id, run=_run(run)))


@router.get(
    "/links",
    summary="Lost or added links against the previous crawl, important targets first",
    response_model=ChangeLinkPage,
    responses=_CSV,
)
async def changes_links(
    project_id: UUID,
    access: ReadData,
    changes: Changes,
    change: Annotated[Literal["lost", "added"], Query()],
    run: Run = "latest",
    link_scope: Annotated[Literal["editorial", "all"], Query()] = "editorial",
    only: Annotated[Literal["top", "all"], Query()] = "all",
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    output: Annotated[Literal["json", "csv"], Query(alias="format")] = "json",
) -> ChangeLinkPage | Response:
    if output == "csv":
        body = await changes.links_csv(
            access, project_id, run=_run(run), change=change, link_scope=link_scope, only=only
        )
        return Response(
            content=body,
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="internal-links-{change}.csv"'},
        )
    return await changes.links(
        access,
        project_id,
        run=_run(run),
        change=change,
        link_scope=link_scope,
        only=only,
        offset=offset,
        limit=limit,
    )


@router.get(
    "/pages",
    summary="Pages whose editorial links in, equity or depth moved most",
    response_model=MovedPageList,
)
async def changes_pages(
    project_id: UUID,
    access: ReadData,
    changes: Changes,
    run: Run = "latest",
    limit: Annotated[int, Query(ge=1, le=50)] = 8,
) -> MovedPageList:
    return await changes.moved(access, project_id, run=_run(run), limit=limit)
