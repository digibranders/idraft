"""The planner: schedules whose window has come become runs (docs/21-scheduler-workers.md
section 3.1).

One tick takes the due schedules one at a time, each in its own transaction with the schedule's
row locked, so two planners never plan the same schedule and one schedule that cannot be planned
does not hold up the others. For each: the run is recorded, judged against the budget, given
its tasks, and the schedule moves on to its next window. All of it commits together or not at
all.

Windows missed while the worker was down are not caught up. Only the latest is planned, and
only if its tasks could still be sent; the others are recorded as runs that never ran, so the
gap is visible. A schedule whose project is not collecting (paused, archived, deleted, or in a
workspace that is suspended) lets its windows pass with no run at all: that gap is meant.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal
from uuid import UUID

import structlog
from sqlalchemy import Row, and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors import budget, ledger
from sightline.collectors.ledger import SEND_WITHIN, NewRun
from sightline.collectors.read_only import read_only
from sightline.collectors.registry import Registry, ScheduleWindow
from sightline.db.errors import gave_way
from sightline.db.tables import projects, schedules, workspaces
from sightline.domain.schedules import Cadence, ScheduleRule, next_occurrence, occurrences_until
from sightline.domain.workloads import TaskWorkload

# Schedules one tick deals with at most (docs/21 section 3.1).
PLAN_LIMIT = 50
# Schedules one tick gives up on at most. They do not count against the limit above: a
# schedule that fails is found first on every tick, and fifty of them would otherwise be all
# a tick ever looked at.
FAILURES_MAX = 50
# Missed windows recorded for one schedule in one tick: the most recent ones. A schedule that
# was out of reach for a year does not need a run for every day of it.
MISSED_RECORDED_MAX = 60
MISSED_WINDOW = "missed_window"
_INSTANT = timedelta(microseconds=1)

Outcome = Literal["planned", "blocked", "passed", "missed", "nothing"]
_log = structlog.get_logger(__name__)
_collecting = and_(
    projects.c.status == "active",
    projects.c.deleted_at.is_(None),
    workspaces.c.status == "active",
).label("collecting")


class DuplicateTaskError(ValueError):
    """A workload planned the same task twice in one run."""


@dataclass(frozen=True, slots=True)
class PlannerReport:
    planned: int = 0
    # Recorded and not started: the run would have passed a budget's hard limit.
    blocked: int = 0
    # Windows that went by with no run because the project is not collecting.
    passed: int = 0
    # Schedules whose latest window was found too late to send: recorded, not planned.
    missed: int = 0
    # Schedules that could not be planned. They are tried again on the next tick.
    failed: int = 0
    # Schedules left for the next tick because another planner was at work in their workspace.
    deferred: int = 0

    @property
    def quiet(self) -> bool:
        return self == PlannerReport()


async def _next_due(
    db: AsyncSession, registry: Registry, now: datetime, skip: set[UUID], busy: set[UUID]
) -> Row[tuple[Any, ...]] | None:
    """The schedule that has waited longest, locked. A schedule another planner holds is
    passed over."""
    statement = (
        select(schedules, _collecting)
        # A schedule that names a project of another workspace is nobody's: it is never planned.
        .select_from(
            schedules.join(
                projects,
                and_(
                    projects.c.id == schedules.c.project_id,
                    projects.c.workspace_id == schedules.c.workspace_id,
                ),
            ).join(workspaces, workspaces.c.id == projects.c.workspace_id)
        )
        .where(
            schedules.c.is_active,
            schedules.c.deleted_at.is_(None),
            schedules.c.next_run_at <= now,
            schedules.c.workload.in_(sorted(registry.workloads)),
            # `cron` is reserved in the schema and has no rule yet.
            schedules.c.cadence.in_(sorted(Cadence)),
        )
        .order_by(schedules.c.next_run_at, schedules.c.id)
        .limit(1)
        # Only `next_run_at` and `last_run_id` change, so the lock leaves the row's key free
        # for the run that is about to refer to it.
        .with_for_update(of=schedules, skip_locked=True, key_share=True)
    )
    if skip:
        statement = statement.where(schedules.c.id.not_in(skip))
    if busy:
        statement = statement.where(schedules.c.workspace_id.not_in(busy))
    return (await db.execute(statement)).one_or_none()


def _rule(schedule: Row[tuple[Any, ...]]) -> ScheduleRule:
    cadence = Cadence(schedule.cadence)
    return ScheduleRule(
        cadence=cadence,
        timezone=schedule.timezone,
        window_start_local=schedule.window_start_local,
        # The schema lets any schedule carry a weekday; only a weekly one runs by it.
        weekday=schedule.weekday if cadence is Cadence.WEEKLY else None,
        month_day=schedule.month_day if cadence is Cadence.MONTHLY else None,
    )


async def _plan(
    db: AsyncSession, registry: Registry, schedule: Row[tuple[Any, ...]], now: datetime
) -> Outcome:
    rule = _rule(schedule)
    workload = TaskWorkload(schedule.workload)
    hours = timedelta(hours=schedule.window_hours)
    context = {"schedule_id": str(schedule.id)}

    async def move_on(after: datetime, run_id: UUID | None = None) -> None:
        values: dict[str, Any] = {"next_run_at": next_occurrence(rule, after)}
        if run_id is not None:
            values["last_run_id"] = run_id
        await db.execute(update(schedules).where(schedules.c.id == schedule.id).values(**values))

    if not schedule.collecting:
        await move_on(now)
        return "passed"

    # The windows from the stored instant on, by the rule. The stored instant is one of them
    # unless it was set by hand or the rule was changed since: then the first window is the
    # rule's next one, which may not have come yet.
    windows = occurrences_until(rule, next_occurrence(rule, schedule.next_run_at - _INSTANT), now)
    if not windows:
        await move_on(schedule.next_run_at - _INSTANT)
        return "nothing"

    def run_for(window_start: datetime, config_snapshot: dict[str, Any]) -> NewRun:
        return NewRun(
            workspace_id=schedule.workspace_id,
            project_id=schedule.project_id,
            schedule_id=schedule.id,
            workload=workload,
            window_start=window_start,
            window_end=window_start + hours,
            trigger="schedule",
            config_snapshot=config_snapshot,
        )

    *missed, window_start = windows
    # Found so late that its tasks would be cancelled unsent: the latest window was missed
    # like the ones before it.
    too_late = now >= window_start + hours + SEND_WITHIN
    if too_late:
        missed.append(window_start)
    for start in missed[-MISSED_RECORDED_MAX:]:
        await ledger.create_run(
            db, run_for(start, {}), status="cancelled", status_reason=MISSED_WINDOW, now=now
        )
    if too_late:
        await move_on(window_start)
        _log.warning("windows missed, none planned", missed=len(missed), **context)
        return "missed"

    window = ScheduleWindow(
        schedule_id=schedule.id,
        workspace_id=schedule.workspace_id,
        project_id=schedule.project_id,
        workload=workload,
        provider_mode=schedule.provider_mode,
        selector=schedule.selector,
        window_start=window_start,
        window_end=window_start + hours,
        window_hours=schedule.window_hours,
    )
    async with read_only(db):
        plan = await registry.workload(workload).plan(db, window)
    run_id = await ledger.create_run(db, run_for(window_start, dict(plan.config_snapshot)), now=now)
    if run_id is None:
        # The window already has its run (the schedule was set back by hand). Nothing is
        # planned a second time, and the schedule still moves on.
        await move_on(window_start)
        return "nothing"
    context["run_id"] = str(run_id)

    verdict = await budget.check(
        db,
        workspace_id=schedule.workspace_id,
        project_id=schedule.project_id,
        workload=workload,
        now=now,
        estimate=plan.estimated_cost_usd,
    )
    if verdict.past_soft_limit:
        _log.warning(
            "budget past its soft limit",
            budget_ids=[str(budget_id) for budget_id in verdict.past_soft_limit],
            **context,
        )
    if verdict.blocked_by is not None:
        await ledger.block_run(
            db,
            run_id,
            budget_id=verdict.blocked_by,
            estimated_cost_usd=plan.estimated_cost_usd,
            now=now,
        )
        await move_on(window_start, run_id)
        _log.warning(
            "run blocked by budget",
            budget_id=str(verdict.blocked_by),
            missed=len(missed),
            **context,
        )
        return "blocked"

    tasks = await ledger.insert_tasks(db, run_id, plan.tasks)
    if tasks != len(plan.tasks):
        # The run is new, so a task that was not inserted was planned twice. The estimate
        # counts it twice too; planning on would hold budget for work that does not exist.
        raise DuplicateTaskError(f"{len(plan.tasks) - tasks} tasks of the plan are duplicates")
    await ledger.start_run(
        db, run_id, tasks_total=tasks, estimated_cost_usd=plan.estimated_cost_usd
    )
    await move_on(window_start, run_id)
    _log.info(
        "run planned",
        tasks=tasks,
        estimate=str(plan.estimated_cost_usd),
        missed=len(missed),
        **context,
    )
    return "planned"


async def plan_due(
    sessions: async_sessionmaker[AsyncSession],
    registry: Registry,
    *,
    now: datetime,
    limit: int = PLAN_LIMIT,
) -> PlannerReport:
    """One planner tick: deal with up to `limit` schedules whose window has come."""
    counts = dict.fromkeys(("planned", "blocked", "passed", "missed", "failed", "deferred"), 0)
    if not registry.workloads:
        return PlannerReport()
    # Schedules given up on in this tick. Each would otherwise be the first one found again.
    skip: set[UUID] = set()
    # Workspaces where another planner holds the turn at the budget.
    busy: set[UUID] = set()
    dealt_with = 0
    while dealt_with < limit and len(skip) < FAILURES_MAX:
        current: tuple[UUID, UUID] | None = None
        try:
            async with sessions() as db, db.begin():
                schedule = await _next_due(db, registry, now, skip, busy)
                if schedule is None:
                    break
                current = (schedule.id, schedule.workspace_id)
                outcome = await _plan(db, registry, schedule, now)
        except Exception as error:
            if current is None:
                # Not a schedule's fault: the tick itself cannot go on.
                raise
            # Rolled back: the schedule is as it was and is tried again on the next tick.
            schedule_id, workspace_id = current
            skip.add(schedule_id)
            if gave_way(error):
                # Nothing is wrong. The rest of the workspace would wait the same way.
                busy.add(workspace_id)
                counts["deferred"] += 1
                _log.info("schedule left for the next tick", schedule_id=str(schedule_id))
            else:
                counts["failed"] += 1
                _log.error("schedule not planned", schedule_id=str(schedule_id), exc_info=error)
            continue
        dealt_with += 1
        if outcome in counts:
            counts[outcome] += 1
    return PlannerReport(**counts)
