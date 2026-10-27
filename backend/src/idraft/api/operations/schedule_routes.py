"""Schedule routes (docs/19-api-specification.md section 3.11.3). Reading needs `data:read` and
writing `schedules:write`. The membership dependency has already refused a project outside the
caller's scope.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from idraft.api.operations.schedules import ScheduleService
from idraft.api.operations.schedules_repository import ScheduleRecord
from idraft.api.pagination import Offset, OffsetPageInfo
from idraft.api.permissions import Permission
from idraft.api.request_info import Info
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.operations import (
    Schedule,
    ScheduleInput,
    SchedulePage,
    SchedulePause,
    ScheduleResponse,
    ScheduleUpdate,
    Selector,
    Workload,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/schedules",
    tags=["operations"],
)

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
WriteSchedules = Annotated[WorkspaceAccess, Depends(require_permission(Permission.SCHEDULES_WRITE))]


def get_schedule_service(
    resources: Annotated[Resources, Depends(get_resources)],
) -> ScheduleService:
    return resources.schedules


Schedules = Annotated[ScheduleService, Depends(get_schedule_service)]


def schedule_view(record: ScheduleRecord) -> Schedule:
    return Schedule.model_validate(
        {
            "schedule_id": record.id,
            "project_id": record.project_id,
            "workload": record.workload,
            "name": record.name,
            "cadence": record.cadence,
            "cron_expr": record.cron_expr,
            "timezone": record.timezone,
            "window_start_local": record.window_start_local,
            "window_hours": record.window_hours,
            "weekday": record.weekday,
            "month_day": record.month_day,
            "priority": record.priority,
            "provider_mode": record.provider_mode,
            "selector": Selector.model_validate(record.selector),
            "is_active": record.is_active,
            "next_run_at": record.next_run_at,
            "last_run_id": record.last_run_id,
            "created_at": record.created_at,
        }
    )


@router.get("", summary="The project's schedules")
async def list_schedules(
    project_id: UUID,
    access: ReadData,
    page: Offset,
    schedules: Schedules,
    workload: Annotated[Workload | None, Query(alias="filter[workload]")] = None,
    is_active: Annotated[bool | None, Query(alias="filter[is_active]")] = None,
) -> SchedulePage:
    found = await schedules.page(
        access,
        project_id,
        workload=workload,
        is_active=is_active,
        offset=page.offset,
        limit=page.limit,
    )
    return SchedulePage(
        data=[schedule_view(record) for record in found.schedules],
        page=OffsetPageInfo(offset=page.offset, limit=page.limit, total=found.total),
    )


@router.post(
    "",
    status_code=201,
    summary="Create a schedule",
    description="`keyword_metrics` (provider mode `live`; selector `stale_days`, `all`, "
    "`groups`, `terms`) and `seo_rank` (selector `all`, `groups`, `terms`, `priority_lte`, "
    "and not empty) are offered; others are `422 validation_failed` with "
    "`workload_not_available`. Cadence `daily`, `weekly` (with `weekday`, 0 is Sunday) or "
    "`monthly` (with `month_day`, 1 to 28); `cron` is `cadence_not_supported`. A selector "
    "member the workload does not take is `selector_not_supported` at `selector.<member>`. "
    "`next_run_at` is the next window start in the schedule's time zone.",
)
async def create_schedule(
    project_id: UUID,
    body: ScheduleInput,
    access: WriteSchedules,
    schedules: Schedules,
    info: Info,
) -> ScheduleResponse:
    record = await schedules.create(access, project_id, body, info)
    return ScheduleResponse(data=schedule_view(record))


@router.get("/{schedule_id}", summary="One schedule")
async def get_schedule(
    project_id: UUID, schedule_id: UUID, access: ReadData, schedules: Schedules
) -> ScheduleResponse:
    return ScheduleResponse(
        data=schedule_view(await schedules.get(access, project_id, schedule_id))
    )


@router.patch(
    "/{schedule_id}",
    summary="Change a schedule",
    description="`next_run_at` is computed again. A change of cadence drops the day the new "
    "cadence does not use, and a weekly or monthly cadence needs its day (`required`).",
)
async def update_schedule(
    project_id: UUID,
    schedule_id: UUID,
    body: ScheduleUpdate,
    access: WriteSchedules,
    schedules: Schedules,
    info: Info,
) -> ScheduleResponse:
    record = await schedules.update(access, project_id, schedule_id, body, info)
    return ScheduleResponse(data=schedule_view(record))


@router.delete(
    "/{schedule_id}",
    status_code=204,
    summary="Delete a schedule",
    description="Its runs keep naming it. `409 schedule_in_use` while tracked keywords name it.",
)
async def delete_schedule(
    project_id: UUID,
    schedule_id: UUID,
    access: WriteSchedules,
    schedules: Schedules,
    info: Info,
) -> Response:
    await schedules.delete(access, project_id, schedule_id, info)
    return Response(status_code=204)


@router.post(
    "/{schedule_id}/pause",
    summary="Pause a schedule",
    description="Not planned until resumed. The body (`reason`) is optional and audited.",
)
async def pause_schedule(
    project_id: UUID,
    schedule_id: UUID,
    access: WriteSchedules,
    schedules: Schedules,
    info: Info,
    body: SchedulePause | None = None,
) -> ScheduleResponse:
    record = await schedules.pause(access, project_id, schedule_id, body or SchedulePause(), info)
    return ScheduleResponse(data=schedule_view(record))


@router.post(
    "/{schedule_id}/resume",
    summary="Resume a schedule",
    description="From its next window after now: windows missed while paused are not caught up.",
)
async def resume_schedule(
    project_id: UUID,
    schedule_id: UUID,
    access: WriteSchedules,
    schedules: Schedules,
    info: Info,
) -> ScheduleResponse:
    record = await schedules.resume(access, project_id, schedule_id, info)
    return ScheduleResponse(data=schedule_view(record))
