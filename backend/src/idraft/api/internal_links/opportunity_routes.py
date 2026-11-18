"""Link opportunities (spec 7.10): reads need `data:read`, decisions `projects:write`. `run` is
`latest` or a crawl id; `410 links_dropped` for a crawl whose links were dropped."""

from __future__ import annotations

from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from idraft.api.internal_links.opportunities import OpportunityService
from idraft.api.permissions import Permission
from idraft.api.request_info import Info
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.internal_links_extra import (
    DecisionResponse,
    OpportunityDecisions,
    OpportunityPage,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/opportunities",
    tags=["internal-links"],
)
ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
WriteProject = Annotated[WorkspaceAccess, Depends(require_permission(Permission.PROJECTS_WRITE))]
_CSV: dict[int | str, dict[str, Any]] = {
    200: {
        "content": {"text/csv": {}},
        "description": "With `format=csv` or `export=planned`: the rows as CSV.",
    }
}


def get_opportunities(
    resources: Annotated[Resources, Depends(get_resources)],
) -> OpportunityService:
    return resources.link_opportunities


Opportunities = Annotated[OpportunityService, Depends(get_opportunities)]


def _csv(body: str, name: str) -> Response:
    return Response(
        content=body,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{name}.csv"'},
    )


@router.get(
    "",
    summary="Pages that mention a topic of another page without linking to it",
    response_model=OpportunityPage,
    responses=_CSV,
)
async def list_opportunities(
    project_id: UUID,
    access: ReadData,
    opportunities: Opportunities,
    run: Annotated[
        Literal["latest"] | UUID, Query(description="`latest` or a crawl id.")
    ] = "latest",
    status: Annotated[Literal["open", "accepted", "dismissed"] | None, Query()] = None,
    target_tier: Annotated[
        str | None,
        Query(
            alias="filter[target_tier]",
            pattern=r"^([1-8]|none)$",
            description="A tier position, 1 to 8, or `none` for pages without a tier.",
        ),
    ] = None,
    q: Annotated[str | None, Query(min_length=1, max_length=200)] = None,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    output: Annotated[Literal["json", "csv"], Query(alias="format")] = "json",
    export: Annotated[
        Literal["planned"] | None,
        Query(description="`planned`: the accepted rows, or every open row when none is accepted."),
    ] = None,
) -> OpportunityPage | Response:
    run_id = run if isinstance(run, UUID) else None
    if export == "planned":
        planned = await opportunities.planned_csv(access, project_id, run=run_id)
        return _csv(planned, "internal-links-planned-fixes")
    if output == "csv":
        listed = await opportunities.list_csv(
            access, project_id, run=run_id, status=status, tier=target_tier, query=q
        )
        return _csv(listed, "internal-links-opportunities")
    return await opportunities.list(
        access,
        project_id,
        run=run_id,
        status=status,
        tier=target_tier,
        query=q,
        offset=offset,
        limit=limit,
    )


@router.put(
    "/decisions",
    summary="Accept, dismiss or reopen opportunities of the latest crawl",
    response_model=DecisionResponse,
)
async def decide_opportunities(
    project_id: UUID,
    body: OpportunityDecisions,
    access: WriteProject,
    opportunities: Opportunities,
    info: Info,
) -> DecisionResponse:
    return DecisionResponse(data=await opportunities.decide(access, project_id, body, info))
