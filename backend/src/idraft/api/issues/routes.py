"""The list of checks of the Issues page (spec 6.1). Needs `data:read`; `run` is `latest` or a
crawl id, as on the internal links reads."""

from __future__ import annotations

from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from idraft.api.internal_links.csv_export import csv_text
from idraft.api.issues.service import IssueService
from idraft.api.permissions import Permission
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.issues import IssueListResponse
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/issues", tags=["issues"]
)

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
Run = Annotated[Literal["latest"] | UUID, Query(description="`latest` or a crawl id.")]
Output = Annotated[Literal["json", "csv"], Query(alias="format")]
_CSV: dict[int | str, dict[str, Any]] = {
    200: {"content": {"text/csv": {}}, "description": "With `format=csv`: the rows as CSV."}
}
_CSV_HEADER = ("Tab", "Category", "Check", "Severity", "Found by", "State", "Pages", "Clicks")


def get_issues(resources: Annotated[Resources, Depends(get_resources)]) -> IssueService:
    return resources.issues


Issues = Annotated[IssueService, Depends(get_issues)]


@router.get(
    "",
    summary="The checks of a crawl, with the pages each found and the totals of the strip",
    response_model=IssueListResponse,
    responses=_CSV,
)
async def list_issues(
    project_id: UUID,
    access: ReadData,
    issues: Issues,
    run: Run = "latest",
    output: Output = "json",
) -> IssueListResponse | Response:
    listed = await issues.checks(access, project_id, run=run if isinstance(run, UUID) else None)
    if output == "json":
        return listed
    text = csv_text(
        _CSV_HEADER,
        (
            (
                row.tab,
                row.category,
                row.id,
                row.severity,
                row.found_by,
                row.state,
                row.pages,
                row.clicks,
            )
            for row in listed.data
        ),
    )
    return Response(
        content=text,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="issues.csv"'},
    )
