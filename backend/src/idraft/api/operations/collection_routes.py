"""The AI coverage of a run and daily AI collection (contracts C3 and N5, WP-30). Reading needs
`data:read`; the membership dependency has already refused a project outside the caller's
scope."""

from __future__ import annotations

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from idraft.api.operations.ai_coverage import AiCoverageService
from idraft.api.operations.collection_daily import CollectionDailyService
from idraft.api.pagination import Commas
from idraft.api.permissions import Permission
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.ai_collection import AiCoverageResponse, CollectionDailyResponse
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission
from idraft.domain.ai_engines import EngineCode

PROJECT = "/api/v1/workspaces/{workspace_id}/projects/{project_id}"
router = APIRouter(prefix=PROJECT, tags=["ai"])

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]


def get_coverage_service(
    resources: Annotated[Resources, Depends(get_resources)],
) -> AiCoverageService:
    return AiCoverageService(sessions=resources.sessions)


def get_daily_service(
    resources: Annotated[Resources, Depends(get_resources)],
) -> CollectionDailyService:
    return CollectionDailyService(sessions=resources.sessions)


Coverage = Annotated[AiCoverageService, Depends(get_coverage_service)]
Daily = Annotated[CollectionDailyService, Depends(get_daily_service)]


@router.get(
    "/runs/{run_id}/ai-coverage",
    summary="Per engine, what an AI run planned, stored and found valid",
    description="A run of workload `ai_prompt` (`422 not_an_ai_run` otherwise): per engine the "
    "tasks planned, the answers stored, the valid ones and the others by status, with the valid "
    "rate; and every planned task with no stored answer.",
)
async def ai_coverage(
    project_id: UUID, run_id: UUID, access: ReadData, service: Coverage
) -> AiCoverageResponse:
    return AiCoverageResponse(data=await service.coverage(access, project_id, run_id))


@router.get(
    "/ai/collection/daily",
    summary="AI collection per project day and engine",
    description="Over `from` to `to`, project-local days both included (default the 28 days "
    "ending today; at most 92, `422 window_too_large`): per day and engine the answers the "
    "schedules planned, the answers stored by status, the valid ones, the runs a budget blocked "
    "and the runs behind them.",
)
async def collection_daily(
    project_id: UUID,
    access: ReadData,
    service: Daily,
    start: Annotated[date | None, Query(alias="from")] = None,
    end: Annotated[date | None, Query(alias="to")] = None,
    engine_codes: Annotated[
        list[EngineCode] | None, Commas, Query(alias="filter[engine_code_in]", max_length=3)
    ] = None,
) -> CollectionDailyResponse:
    return await service.daily(access, project_id, start, end, engine_codes)
