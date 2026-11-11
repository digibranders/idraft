"""A project's AI engines (docs/19-api-specification.md section 3.7.4, cut to slice 1).

Reading needs `data:read`; turning engines on or off needs `projects:write`. The membership
dependency has already refused a project outside the caller's scope.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response

from idraft.api.ai.engine_service import EngineService, EngineView
from idraft.api.permissions import Permission
from idraft.api.request_info import Info
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.ai import (
    Engine,
    EngineUpdate,
    ProjectEngine,
    ProjectEngineList,
    ProjectEngineResponse,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission
from idraft.domain.ai_engines import BASE_PLAN, PROVIDER_CODE, EngineCode

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/engines", tags=["ai"]
)

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
WriteProject = Annotated[WorkspaceAccess, Depends(require_permission(Permission.PROJECTS_WRITE))]


def get_engine_service(resources: Annotated[Resources, Depends(get_resources)]) -> EngineService:
    return resources.ai_engines


Engines = Annotated[EngineService, Depends(get_engine_service)]


def engine_view(view: EngineView) -> ProjectEngine:
    engine, configured = view.engine, view.configured
    return ProjectEngine(
        engine=Engine(
            engine_code=engine.code,
            label=engine.label,
            observation_class=engine.observation_class,
            vendor=engine.vendor,
            exposes_citations=engine.exposes_citations,
            exposes_fanout=engine.exposes_fanout,
            max_prompt_chars=engine.max_prompt_chars,
        ),
        is_configured=configured is not None,
        is_enabled=configured is not None and configured.is_enabled,
        location_ids=[] if configured is None else configured.location_ids,
        replicates=BASE_PLAN.answers_per_engine if configured is None else configured.replicates,
        provider_code=PROVIDER_CODE if configured is None else configured.provider_code,
        active_prompts=view.active_prompts,
        estimated_monthly_cost_usd=view.estimated_monthly_cost_usd,
    )


@router.get(
    "",
    summary="The AI engines and how the project runs them",
    description="Every engine offered, configured or not. `estimated_monthly_cost_usd` is what "
    "the engine costs a month with the project's active prompts on the base plan (runs a week, "
    "one answer, standard queue), as if it were on.",
)
async def list_engines(project_id: UUID, access: ReadData, engines: Engines) -> ProjectEngineList:
    views = await engines.list_engines(access, project_id)
    return ProjectEngineList(data=[engine_view(view) for view in views])


@router.put(
    "/{engine_code}",
    summary="Turn an engine on or off for the project",
    description="The first engine turned on makes the project's AI answer schedules (twice a "
    "week). `location_ids` must be active countries (`422 validation_failed` with "
    "`location_not_supported`). The provider is DataForSEO and the engine gives one answer "
    "per prompt and run.",
)
async def put_engine(
    project_id: UUID,
    engine_code: EngineCode,
    body: EngineUpdate,
    access: WriteProject,
    engines: Engines,
    info: Info,
) -> ProjectEngineResponse:
    view = await engines.put(access, project_id, engine_code, body, info)
    return ProjectEngineResponse(data=engine_view(view))


@router.delete(
    "/{engine_code}",
    status_code=204,
    summary="Remove the engine's settings; its answers stay",
)
async def delete_engine(
    project_id: UUID, engine_code: EngineCode, access: WriteProject, engines: Engines, info: Info
) -> Response:
    await engines.delete(access, project_id, engine_code, info)
    return Response(status_code=204)
