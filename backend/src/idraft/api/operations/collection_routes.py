"""The AI coverage of a run and daily AI collection (contracts C3 and N5; WP-30 builds the
bodies). Reading needs `data:read`."""

from __future__ import annotations

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from idraft.api.pagination import Commas
from idraft.api.permissions import Permission
from idraft.api.schemas.ai_collection import AiCoverageResponse, CollectionDailyResponse
from idraft.api.stubs import not_built, not_built_yet
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission
from idraft.domain.ai_engines import EngineCode

PROJECT = "/api/v1/workspaces/{workspace_id}/projects/{project_id}"
router = APIRouter(prefix=PROJECT, tags=["ai"])

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]


@router.get(
    "/runs/{run_id}/ai-coverage",
    summary="Per engine, what an AI run planned, stored and found valid",
    description="A run of workload `ai_prompt` (`422 not_an_ai_run` otherwise): per engine the "
    "tasks planned, the answers stored, the valid ones and the others by status, with the valid "
    "rate; and every planned task with no stored answer. Not built yet: `501 not_implemented`.",
)
@not_built
async def ai_coverage(project_id: UUID, run_id: UUID, access: ReadData) -> AiCoverageResponse:
    raise not_built_yet()


@router.get(
    "/ai/collection/daily",
    summary="AI collection per project day and engine",
    description="Over `from` to `to`, project-local days both included (default the 28 days "
    "ending today; at most 92, `422 window_too_large`): per day and engine the answers the "
    "schedules planned, the answers stored by status, the valid ones, the runs a budget blocked "
    "and the runs behind them. Not built yet: `501 not_implemented`.",
)
@not_built
async def collection_daily(
    project_id: UUID,
    access: ReadData,
    start: Annotated[date | None, Query(alias="from")] = None,
    end: Annotated[date | None, Query(alias="to")] = None,
    engine_codes: Annotated[
        list[EngineCode] | None, Commas, Query(alias="filter[engine_code_in]", max_length=3)
    ] = None,
) -> CollectionDailyResponse:
    raise not_built_yet()
