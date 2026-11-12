"""The quota and limits read before a prompt is added or run (contract C1; WP-13 builds the body).

Reading needs `data:read`; the membership dependency has already refused a project outside the
caller's scope.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from idraft.api.permissions import Permission
from idraft.api.schemas.ai_limits import AiLimitsResponse
from idraft.api.stubs import not_built, not_built_yet
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

PROJECT = "/api/v1/workspaces/{workspace_id}/projects/{project_id}"
router = APIRouter(prefix=f"{PROJECT}/ai", tags=["ai"])

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]


@router.get(
    "/limits",
    summary="Active prompts, monthly AI answers and manual runs: used and limit",
    description="The workspace's active prompts and AI answers this UTC month, and the "
    "project's manual runs today (UTC), each with its limit, as the writes count them. Not "
    "built yet: `501 not_implemented`.",
)
@not_built
async def ai_limits(project_id: UUID, access: ReadData) -> AiLimitsResponse:
    raise not_built_yet()
