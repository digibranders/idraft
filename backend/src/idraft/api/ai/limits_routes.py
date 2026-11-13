"""The quota and limits read before a prompt is added or run (contract C1, WP-13).

Reading needs `data:read`; the membership dependency has already refused a project outside the
caller's scope.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from idraft.api.ai.prompt_routes import Prompts
from idraft.api.permissions import Permission
from idraft.api.schemas.ai_limits import AiLimits, AiLimitsResponse, QuotaUse
from idraft.api.schemas.operations import ManualRuns
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

PROJECT = "/api/v1/workspaces/{workspace_id}/projects/{project_id}"
router = APIRouter(prefix=f"{PROJECT}/ai", tags=["ai"])

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]


@router.get(
    "/limits",
    summary="Active prompts, monthly AI answers and manual runs: used and limit",
    description="The workspace's active prompts and AI answers this UTC month, and the "
    "project's manual runs today (UTC), each with its limit, as the writes count them. Reading "
    "changes nothing.",
)
async def ai_limits(project_id: UUID, access: ReadData, service: Prompts) -> AiLimitsResponse:
    found = await service.limits(access, project_id)
    return AiLimitsResponse(
        data=AiLimits(
            prompts=QuotaUse(limit=found.prompts.limit, used=found.prompts.used),
            ai_observations_month=QuotaUse(
                limit=found.ai_observations_month.limit, used=found.ai_observations_month.used
            ),
            manual_runs_today=ManualRuns(
                used=found.manual_runs_today.used, limit=found.manual_runs_today.limit
            ),
        )
    )
