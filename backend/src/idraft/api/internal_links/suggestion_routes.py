"""Suggested tiers (spec 7.10): the list needs `data:read`, accept and dismiss `projects:write`.
The permission dependencies refuse unknown query parameters."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from idraft.api.internal_links.suggestions import SuggestionService
from idraft.api.permissions import Permission
from idraft.api.request_info import Info
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.internal_links import BulkResponse, BulkResult
from idraft.api.schemas.internal_links_extra import SuggestionSelection, TierSuggestionList
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/tier-suggestions",
    tags=["internal-links"],
)
ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
WriteProject = Annotated[WorkspaceAccess, Depends(require_permission(Permission.PROJECTS_WRITE))]


def get_suggestions(resources: Annotated[Resources, Depends(get_resources)]) -> SuggestionService:
    return resources.tier_suggestions


Suggestions = Annotated[SuggestionService, Depends(get_suggestions)]


@router.get(
    "",
    summary="Pages whose clicks or keyword ranks say they belong in a higher tier",
    response_model=TierSuggestionList,
)
async def list_suggestions(
    project_id: UUID, access: ReadData, suggestions: Suggestions
) -> TierSuggestionList:
    return await suggestions.suggestions(access, project_id)


@router.post("/accept", summary="Set the suggested tiers by hand", response_model=BulkResponse)
async def accept_suggestions(
    project_id: UUID,
    body: SuggestionSelection,
    access: WriteProject,
    suggestions: Suggestions,
    info: Info,
) -> BulkResponse:
    matched, changed = await suggestions.accept(access, project_id, body, info)
    return BulkResponse(data=BulkResult(matched=matched, changed=changed))


@router.post("/dismiss", summary="Hide suggestions for the project", response_model=BulkResponse)
async def dismiss_suggestions(
    project_id: UUID,
    body: SuggestionSelection,
    access: WriteProject,
    suggestions: Suggestions,
    info: Info,
) -> BulkResponse:
    matched, changed = await suggestions.dismiss(access, project_id, body, info)
    return BulkResponse(data=BulkResult(matched=matched, changed=changed))
