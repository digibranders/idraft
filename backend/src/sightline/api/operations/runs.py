"""Rules for collection runs the API asks for (docs/19-api-specification.md section 3.11.4;
plan decision D9).

A manual run is recorded as `planned` with its selector; the worker's planner plans it, judges
it against the budget and starts it. A project has `MANUAL_RUNS_PER_DAY` runs people ask for
each day (UTC); runs the system starts for new keywords do not count.

A planned or running run can be cancelled: by whoever holds `schedules:write`, and by the
person who asked for a manual run if they hold `runs:trigger`. The reconciler cancels its
pending tasks; tasks the provider already has are still fetched (they are paid for).
"""

from __future__ import annotations

from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Final
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.api import audit
from sightline.api.keywords import repository as keywords
from sightline.api.operations import runs_repository as runs
from sightline.api.operations.runs_repository import RunFilter, RunRecord
from sightline.api.pagination import decode_cursor, encode_cursor, invalid_cursor
from sightline.api.permissions import Permission
from sightline.api.problems import (
    ForbiddenError,
    InvalidStateTransitionError,
    ManualRunLimitError,
    NotFoundError,
    invalid_field,
)
from sightline.api.request_info import RequestInfo
from sightline.api.schemas.keywords import MetricsRefresh
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.db.engine import workspace_transaction

# docs/24 section 8.
MANUAL_RUNS_PER_DAY: Final = 20
# How long a manual run has to send its tasks.
MANUAL_WINDOW: Final = timedelta(hours=1)
KEYWORD_METRICS: Final = "keyword_metrics"
CANCELLED_BY_USER: Final = "cancelled_by_user"
_OPEN: Final = frozenset({"planned", "running"})


@dataclass(frozen=True, slots=True)
class RunPage:
    runs: list[RunRecord]
    next_cursor: str | None
    manual_runs_today: int


@dataclass(frozen=True, slots=True)
class RunDetail:
    run: RunRecord
    tasks_by_status: dict[str, int]


async def _today(db: AsyncSession) -> datetime:
    """The start of the day (UTC) by the database clock."""
    now: datetime = (await db.execute(select(func.now()))).scalar_one()
    return now.astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)


def _scope(project_id: UUID, given: RunFilter) -> dict[str, object]:
    """What a cursor is bound to: the project and the filter."""
    return {
        "project_id": str(project_id),
        "schedule_id": None if given.schedule_id is None else str(given.schedule_id),
        "workloads": sorted(given.workloads),
        "statuses": sorted(given.statuses),
        "triggers": sorted(given.triggers),
        "from": None if given.created_from is None else given.created_from.isoformat(),
        "to": None if given.created_to is None else given.created_to.isoformat(),
    }


def _after(cursor: str, scope: dict[str, object]) -> tuple[datetime, UUID]:
    key = decode_cursor(cursor, scope=scope)
    if len(key) != 2 or not all(isinstance(part, str) for part in key):
        raise invalid_cursor()
    try:
        created_at = datetime.fromisoformat(str(key[0]))
        run_id = UUID(str(key[1]))
    except ValueError:
        raise invalid_cursor() from None
    if created_at.tzinfo is None:
        raise invalid_cursor()
    return created_at, run_id


class RunService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    async def refresh_metrics(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        body: MetricsRefresh,
        info: RequestInfo,
    ) -> RunRecord:
        """A manual keyword metrics run: the given keywords (tracked by the project), else
        the project's keywords whose metrics are older than `stale_days`."""
        async with self._transaction(access) as db:
            if await keywords.project_defaults(db, access.workspace_id, project_id) is None:
                raise NotFoundError
            selector: dict[str, object] = {}
            if body.keyword_ids is not None:
                tracked = await runs.tracked_keyword_ids(
                    db, access.workspace_id, project_id, body.keyword_ids
                )
                if any(keyword_id not in tracked for keyword_id in body.keyword_ids):
                    raise invalid_field(
                        "keyword_ids",
                        code="keyword_unknown",
                        message="A keyword the project does not track, or has archived.",
                    )
                selector["keyword_ids"] = sorted(
                    str(keyword_id) for keyword_id in set(body.keyword_ids)
                )
            if body.stale_days is not None:
                selector["stale_days"] = body.stale_days
            await runs.lock_manual_runs(db, project_id)
            used = await runs.manual_runs_since(
                db, access.workspace_id, project_id, await _today(db)
            )
            if used >= MANUAL_RUNS_PER_DAY:
                raise ManualRunLimitError(
                    f"The project has had its {MANUAL_RUNS_PER_DAY} manual runs today (UTC).",
                    limit=MANUAL_RUNS_PER_DAY,
                )
            run_id = await runs.insert_manual_run(
                db,
                workspace_id=access.workspace_id,
                project_id=project_id,
                workload=KEYWORD_METRICS,
                user_id=access.user_id,
                request_id=info.request_id,
                selector=selector,
                window=MANUAL_WINDOW,
            )
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="collection_run.requested",
                target_type="collection_run",
                target_id=run_id,
                info=info,
                after={
                    "project_id": str(project_id),
                    "workload": KEYWORD_METRICS,
                    "keyword_count": len(body.keyword_ids or ()),
                    "stale_days": body.stale_days,
                },
            )
            created = await runs.get_run(db, access.workspace_id, project_id, run_id)
        if created is None:  # pragma: no cover - inserted by this transaction
            raise NotFoundError
        return created

    async def page(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        given: RunFilter,
        *,
        cursor: str | None,
        limit: int,
    ) -> RunPage:
        """The project's runs newest first, and how many manual runs people asked for today."""
        scope = _scope(project_id, given)
        after = None if cursor is None else _after(cursor, scope)
        async with self._transaction(access) as db:
            if await keywords.project_defaults(db, access.workspace_id, project_id) is None:
                raise NotFoundError
            found = await runs.list_runs(
                db, access.workspace_id, project_id, given, after=after, limit=limit + 1
            )
            used = await runs.manual_runs_since(
                db, access.workspace_id, project_id, await _today(db)
            )
        shown = found[:limit]
        next_cursor = None
        if len(found) > limit:
            last = shown[-1]
            next_cursor = encode_cursor([last.created_at.isoformat(), str(last.id)], scope=scope)
        return RunPage(runs=shown, next_cursor=next_cursor, manual_runs_today=used)

    async def detail(self, access: WorkspaceAccess, project_id: UUID, run_id: UUID) -> RunDetail:
        async with self._transaction(access) as db:
            found = await runs.get_run(db, access.workspace_id, project_id, run_id)
            if found is None:
                raise NotFoundError
            counts = await runs.task_counts(db, access.workspace_id, run_id)
        return RunDetail(run=found, tasks_by_status=counts)

    async def cancel(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        run_id: UUID,
        reason: str | None,
        info: RequestInfo,
    ) -> RunRecord:
        """`409 invalid_state_transition` for a run that has ended."""
        async with self._transaction(access) as db:
            found = await runs.lock_run(db, access.workspace_id, project_id, run_id)
            if found is None:
                raise NotFoundError
            asked_for_it = (
                found.trigger == "manual"
                and found.created_by_type == "user"
                and found.created_by_id == str(access.user_id)
            )
            if not (
                access.holds(Permission.SCHEDULES_WRITE)
                or (asked_for_it and access.holds(Permission.RUNS_TRIGGER))
            ):
                raise ForbiddenError(
                    "Cancelling a run needs schedules:write, or runs:trigger for a manual run "
                    "you asked for."
                )
            if found.status not in _OPEN:
                raise InvalidStateTransitionError(f"The run has ended ({found.status}).")
            await runs.cancel_run(db, access.workspace_id, run_id, reason=CANCELLED_BY_USER)
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="collection_run.cancelled",
                target_type="collection_run",
                target_id=run_id,
                info=info,
                before={"status": found.status},
                after={"status": "cancelled", "reason": reason},
            )
            cancelled = await runs.get_run(db, access.workspace_id, project_id, run_id)
        if cancelled is None:  # pragma: no cover - locked by this transaction
            raise NotFoundError
        return cancelled
