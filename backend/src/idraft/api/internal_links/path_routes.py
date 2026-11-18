"""The path finder (spec 7.10). Needs `data:read`; `410 links_dropped` for a crawl whose links
were dropped. The permission dependency refuses unknown query parameters."""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from idraft.api.internal_links.route_finder import RouteFinder
from idraft.api.permissions import Permission
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.internal_links import UrlId
from idraft.api.schemas.internal_links_extra import RoutesResponse
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links",
    tags=["internal-links"],
)
ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
Run = Annotated[Literal["latest"] | UUID, Query(description="`latest` or a crawl id.")]


def get_finder(resources: Annotated[Resources, Depends(get_resources)]) -> RouteFinder:
    return resources.route_finder


@router.get(
    "/paths",
    summary="The shortest route from the home page to a page",
    description="`any` follows every followed link, `editorial` only editorial links; a redirect "
    "is one step to its target. A route is null when the page is not reached in 12 clicks.",
    response_model=RoutesResponse,
)
async def paths(
    project_id: UUID,
    access: ReadData,
    finder: Annotated[RouteFinder, Depends(get_finder)],
    url_id: Annotated[UrlId, Query()],
    run: Run = "latest",
) -> RoutesResponse:
    run_id = run if isinstance(run, UUID) else None
    return RoutesResponse(data=await finder.routes(access, project_id, run=run_id, url_id=url_id))
