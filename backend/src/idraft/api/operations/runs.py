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

import structlog
from redis.exceptions import RedisError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api import audit
from idraft.api.keywords import repository as keywords
from idraft.api.operations import runs_repository as runs
from idraft.api.operations.runs_repository import RunFilter, RunRecord
from idraft.api.pagination import decode_cursor, encode_cursor, invalid_cursor
from idraft.api.permissions import Permission
from idraft.api.problems import (
    ForbiddenError,
    InvalidStateTransitionError,
    ManualRunLimitError,
    NotFoundError,
    ProviderPausedError,
    QuotaExceededError,
    invalid_field,
)
from idraft.api.request_info import RequestInfo
from idraft.api.schemas.keywords import MetricsRefresh
from idraft.api.schemas.ranks import CheckNow
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.providers.dataforseo.provider import CODE as DATAFORSEO
from idraft.providers.pauses import RedisPauses

# docs/24 section 8.
MANUAL_RUNS_PER_DAY: Final = 20
# How long a manual run has to send its tasks.
MANUAL_WINDOW: Final = timedelta(hours=1)
KEYWORD_METRICS: Final = "keyword_metrics"
SEO_RANK: Final = "seo_rank"
# What a refused check now tells the caller to wait; a pause lasts at most fifteen minutes.
PAUSED_RETRY_SECONDS: Final = 300
CANCELLED_BY_USER: Final = "cancelled_by_user"
_OPEN: Final = frozenset({"planned", "running"})
_log = structlog.get_logger(__name__)


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


async def _month_start(db: AsyncSession) -> datetime:
    """The start of the month (UTC) by the database clock."""
    return (await _today(db)).replace(day=1)


async def _live_project(db: AsyncSession, access: WorkspaceAccess, project_id: UUID) -> None:
    """A deleted project has no runs to show or cancel."""
    if await keywords.project_defaults(db, access.workspace_id, project_id) is None:
        raise NotFoundError


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
    def __init__(
        self, *, sessions: async_sessionmaker[AsyncSession], pauses: RedisPauses | None = None
    ) -> None:
        self._sessions = sessions
        self._pauses = pauses

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
            await _live_project(db, access, project_id)
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

    async def _provider_paused(self) -> bool:
        """Whether the provider is being left alone. Redis being out is not a reason to refuse:
        the dispatcher looks at the pause again before it sends anything."""
        if self._pauses is None:
            return False
        try:
            return DATAFORSEO in await self._pauses.paused([DATAFORSEO])
        except RedisError:
            _log.warning("provider pause not read; the check goes ahead", exc_info=True)
            return False

    async def check_now(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        body: CheckNow,
        info: RequestInfo,
    ) -> RunRecord:
        """A manual rank run of the given tracked keywords, each asked of the provider live.
        `422 quota_exceeded` when the month's live checks would pass the workspace's limit,
        `503 provider_paused` while the provider is refusing everyone."""
        if await self._provider_paused():
            raise ProviderPausedError(
                "The data provider is not being asked just now. Try again in a few minutes.",
                headers={"Retry-After": str(PAUSED_RETRY_SECONDS)},
            )
        wanted = sorted(set(body.tracked_keyword_ids))
        async with self._transaction(access) as db:
            await _live_project(db, access, project_id)
            tracked = await runs.active_tracked_ids(db, access.workspace_id, project_id, wanted)
            if len(tracked) != len(wanted):
                raise invalid_field(
                    "tracked_keyword_ids",
                    code="keyword_unknown",
                    message="A keyword the project does not track, or has archived.",
                )
            await runs.lock_manual_runs(db, project_id)
            used = await runs.manual_runs_since(
                db, access.workspace_id, project_id, await _today(db)
            )
            if used >= MANUAL_RUNS_PER_DAY:
                raise ManualRunLimitError(
                    f"The project has had its {MANUAL_RUNS_PER_DAY} manual runs today (UTC).",
                    limit=MANUAL_RUNS_PER_DAY,
                )
            limit = await runs.lock_serp_check_limit(db, access.workspace_id)
            checks = await runs.live_serp_checks_since(
                db, access.workspace_id, await _month_start(db)
            )
            if checks + len(wanted) > limit:
                raise QuotaExceededError(
                    f"The workspace has made {checks} of its {limit} live checks this month "
                    f"(UTC); {len(wanted)} more do not fit.",
                    limit=limit,
                    used=checks,
                    requested=len(wanted),
                    quota="max_serp_checks_per_month",
                )
            selector: dict[str, object] = {
                "tracked_keyword_ids": [str(tracked_id) for tracked_id in wanted],
                "live": True,
            }
            if body.depth is not None:
                selector["depth"] = body.depth
            run_id = await runs.insert_manual_run(
                db,
                workspace_id=access.workspace_id,
                project_id=project_id,
                workload=SEO_RANK,
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
                    "workload": SEO_RANK,
                    "keyword_count": len(wanted),
                    "depth": body.depth,
                    "live": True,
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
            await _live_project(db, access, project_id)
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
            await _live_project(db, access, project_id)
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
        if not (access.holds(Permission.SCHEDULES_WRITE) or access.holds(Permission.RUNS_TRIGGER)):
            # Refused before the run is locked: a reader holds up nothing.
            raise ForbiddenError("Cancelling a run needs schedules:write or runs:trigger.")
        async with self._transaction(access) as db:
            await _live_project(db, access, project_id)
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
