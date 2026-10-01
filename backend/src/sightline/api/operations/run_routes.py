"""Run routes (docs/19-api-specification.md section 3.11.4) and the keyword metrics refresh,
which asks for a manual run (section 3.6.1). Asking for a run needs `runs:trigger`. The
membership dependency has already refused a project outside the caller's scope.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Annotated, Final
from uuid import UUID

from fastapi import APIRouter, Depends

from sightline.api.operations.runs import RunService
from sightline.api.operations.runs_repository import RunRecord
from sightline.api.permissions import Permission
from sightline.api.request_info import Info
from sightline.api.resources import Resources, get_resources
from sightline.api.schemas.keywords import MetricsRefresh
from sightline.api.schemas.operations import (
    Actor,
    Operation,
    OperationError,
    OperationLinks,
    OperationStatus,
    Progress,
    Run,
    RunResponse,
)
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.api.workspaces.dependencies import require_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}", tags=["operations"]
)

TriggerRuns = Annotated[WorkspaceAccess, Depends(require_permission(Permission.RUNS_TRIGGER))]

# A run's status as an operation's (docs/19 section 2.11).
_OPERATION_STATUS: Final[Mapping[str, OperationStatus]] = {
    "planned": "queued",
    "running": "running",
    "completed": "succeeded",
    "completed_with_errors": "succeeded_with_errors",
    "failed": "failed",
    "cancelled": "cancelled",
    "budget_blocked": "blocked",
}


def get_run_service(resources: Annotated[Resources, Depends(get_resources)]) -> RunService:
    return resources.runs


Runs = Annotated[RunService, Depends(get_run_service)]


def _actor(record: RunRecord) -> Actor | None:
    if record.created_by_type is None:
        return None
    if record.created_by_type == "system":
        return Actor.model_validate(
            {
                "actor_type": "system",
                "actor_id": record.created_by_id or "system",
                "label": "System",
            }
        )
    return Actor.model_validate(
        {
            "actor_type": record.created_by_type,
            "actor_id": record.created_by_id or "",
            "label": record.created_by_name or record.created_by_type,
        }
    )


def run_view(record: RunRecord, workspace_id: UUID) -> Run:
    url = f"/api/v1/workspaces/{workspace_id}/projects/{record.project_id}/runs/{record.id}"
    open_ = record.status in ("planned", "running")
    error = None
    if record.status == "budget_blocked":
        error = OperationError(code="budget_blocked", detail="A budget's hard limit holds it back.")
    elif record.status in ("failed", "cancelled") and record.status_reason is not None:
        error = OperationError(code=record.status_reason, detail=record.status_reason)
    return Run.model_validate(
        {
            "run_id": record.id,
            "project_id": record.project_id,
            "schedule_id": record.schedule_id,
            "workload": record.workload,
            "trigger": record.trigger,
            "status": record.status,
            "status_reason": record.status_reason,
            "window_start": record.window_start,
            "window_end": record.window_end,
            "tasks_total": record.tasks_total,
            "tasks_succeeded": record.tasks_succeeded,
            "tasks_failed": record.tasks_failed,
            "estimated_cost_usd": record.estimated_cost_usd,
            "actual_cost_usd": record.actual_cost_usd,
            "blocked_by_budget_id": record.blocked_by_budget_id,
            "created_by": _actor(record),
            "created_at": record.created_at,
            "completed_at": record.completed_at,
            "operation": Operation(
                kind="collection_run",
                status=_OPERATION_STATUS[record.status],
                progress=Progress(
                    done=record.tasks_succeeded + record.tasks_failed,
                    total=record.tasks_total if record.status != "planned" else None,
                    unit="tasks",
                ),
                started_at=None if record.status == "planned" else record.created_at,
                finished_at=record.completed_at,
                error=error,
                links=OperationLinks(self=url, cancel=f"{url}/cancel" if open_ else None),
            ),
        }
    )


@router.post(
    "/keyword-metrics/refresh",
    status_code=202,
    summary="Refresh keyword metrics now (a manual run)",
    description="The given keywords (which the project tracks; `422 validation_failed` with "
    "`keyword_unknown` otherwise), else the project's tracked keywords whose metrics are older "
    "than `stale_days` (default 25). The run is `planned` and the worker plans it within a "
    "minute; a budget used up blocks it (`budget_blocked`). `429 manual_run_limit` after 20 "
    "manual runs in a day (UTC), with `limit`; runs the system starts for new keywords do not "
    "count.",
)
async def refresh_keyword_metrics(
    project_id: UUID, body: MetricsRefresh, access: TriggerRuns, runs: Runs, info: Info
) -> RunResponse:
    record = await runs.refresh_metrics(access, project_id, body, info)
    return RunResponse(data=run_view(record, access.workspace_id))
