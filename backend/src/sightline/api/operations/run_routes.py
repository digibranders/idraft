"""Run routes (docs/19-api-specification.md section 3.11.4) and the keyword metrics refresh,
which asks for a manual run (section 3.6.1). Reading runs needs `data:read` and asking for one
`runs:trigger`; who may cancel one is decided by the service. The membership dependency has
already refused a project outside the caller's scope.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Annotated, Final
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import AwareDatetime

from sightline.api.operations.runs import MANUAL_RUNS_PER_DAY, RunService
from sightline.api.operations.runs_repository import RunFilter, RunRecord
from sightline.api.pagination import Commas, Cursor, CursorPageInfo
from sightline.api.permissions import Permission
from sightline.api.request_info import Info
from sightline.api.resources import Resources, get_resources
from sightline.api.schemas.keywords import MetricsRefresh
from sightline.api.schemas.operations import (
    Actor,
    ManualRuns,
    Operation,
    OperationError,
    OperationLinks,
    OperationStatus,
    Progress,
    Run,
    RunCancel,
    RunDetail,
    RunDetailResponse,
    RunPage,
    RunPageMeta,
    RunResponse,
    RunResults,
    RunStatus,
    Trigger,
    Workload,
)
from sightline.api.schemas.ranks import CheckNow
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.api.workspaces.dependencies import require_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}", tags=["operations"]
)

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
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


@router.post(
    "/seo/check-now",
    status_code=202,
    summary="Check keywords now (a manual run, asked of the provider live)",
    description="The given tracked keywords (at most 100, which the project collects; "
    "`422 validation_failed` with `keyword_unknown` otherwise), each asked of the provider "
    "live, at `depth` or else its daily depth. The run is `planned` and the worker plans it "
    "within a minute; a result is normally there within seconds after that. Read the run for "
    "its progress and the keywords' rank for the answer. A budget used up blocks it "
    "(`budget_blocked`). `429 manual_run_limit` after 20 manual runs in a day (UTC), with "
    "`limit`; `422 quota_exceeded` when the month's live checks would pass the workspace's "
    "`max_serp_checks_per_month`; `503 provider_paused` while the provider is refusing every "
    "request.",
)
async def check_now(
    project_id: UUID, body: CheckNow, access: TriggerRuns, runs: Runs, info: Info
) -> RunResponse:
    record = await runs.check_now(access, project_id, body, info)
    return RunResponse(data=run_view(record, access.workspace_id))


@router.get(
    "/runs",
    summary="The project's runs",
    description="Newest first. `meta.manual_runs_today` says how many of the day's (UTC) "
    "manual runs people have used.",
)
async def list_runs(
    project_id: UUID,
    access: ReadData,
    page: Cursor,
    runs: Runs,
    schedule_id: Annotated[UUID | None, Query(alias="filter[schedule_id]")] = None,
    workloads: Annotated[
        list[Workload] | None, Commas, Query(alias="filter[workload_in]", max_length=20)
    ] = None,
    statuses: Annotated[
        list[RunStatus] | None, Commas, Query(alias="filter[status_in]", max_length=20)
    ] = None,
    triggers: Annotated[
        list[Trigger] | None, Commas, Query(alias="filter[trigger_in]", max_length=20)
    ] = None,
    created_from: Annotated[
        AwareDatetime | None, Query(alias="from", description="Created at or after.")
    ] = None,
    created_to: Annotated[
        AwareDatetime | None, Query(alias="to", description="Created before.")
    ] = None,
) -> RunPage:
    given = RunFilter(
        schedule_id=schedule_id,
        workloads=frozenset(workloads or ()),
        statuses=frozenset(statuses or ()),
        triggers=frozenset(triggers or ()),
        created_from=created_from,
        created_to=created_to,
    )
    found = await runs.page(access, project_id, given, cursor=page.cursor, limit=page.limit)
    return RunPage(
        data=[run_view(record, access.workspace_id) for record in found.runs],
        page=CursorPageInfo(
            limit=page.limit,
            next_cursor=found.next_cursor,
            has_more=found.next_cursor is not None,
        ),
        meta=RunPageMeta(
            manual_runs_today=ManualRuns(used=found.manual_runs_today, limit=MANUAL_RUNS_PER_DAY)
        ),
    )


@router.get(
    "/runs/{run_id}",
    summary="One run",
    description="With how many of its tasks are in each status, and the configuration it ran with.",
)
async def get_run(
    project_id: UUID, run_id: UUID, access: ReadData, runs: Runs
) -> RunDetailResponse:
    found = await runs.detail(access, project_id, run_id)
    view = run_view(found.run, access.workspace_id)
    selector = found.run.config_snapshot.get("selector")
    named = selector.get("tracked_keyword_ids") if isinstance(selector, dict) else None
    return RunDetailResponse(
        data=RunDetail(
            **view.model_dump(),
            tasks_by_status=found.tasks_by_status,
            config_snapshot=dict(found.run.config_snapshot),
            results=RunResults(tracked_keyword_ids=named) if isinstance(named, list) else None,
        )
    )


@router.post(
    "/runs/{run_id}/cancel",
    summary="Cancel a run",
    description="A planned or running run (`409 invalid_state_transition` otherwise). Needs "
    "`schedules:write`, or `runs:trigger` for a manual run the caller asked for. Pending tasks "
    "are cancelled within minutes; tasks the provider already has are still fetched, since "
    "they are paid for. `reason` is audited.",
)
async def cancel_run(
    project_id: UUID,
    run_id: UUID,
    access: ReadData,
    runs: Runs,
    info: Info,
    body: RunCancel | None = None,
) -> RunResponse:
    reason = None if body is None else body.reason
    record = await runs.cancel(access, project_id, run_id, reason, info)
    return RunResponse(data=run_view(record, access.workspace_id))
