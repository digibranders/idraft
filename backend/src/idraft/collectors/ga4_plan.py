"""What the GA4 sync does and when (docs/18 sections 7.2 and 13), planned as `gsc_plan` plans the
Search Console sync.

Each GA4 property with a healthy connection has a daily schedule in `ops.schedules` (workload
`ga4_sync`, 06:00 Pacific Time), made the first time the planner sees the property. A due schedule
sends one `ga4_sync` message and moves on to its next window; windows missed while the worker was
down are not caught up (the next run reads back to the last day it has). A property whose first run
is not done, or whose last run failed, is sent again once its wait is over
(`Ga4PullState.retry_due`), so a quota error costs minutes and not a day.

`ops.schedules` is the clock only: the ledger planner skips workloads it has no plan for, and this
one has no tasks, no provider and no cost to hold against a budget.

The tick that calls `plan_syncs` runs under a lock, so one process plans at a time.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import datetime, time
from typing import Final
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import Join, and_, exists, func, insert, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.gsc_plan import PLAN_LIMIT, PlanReport
from idraft.db.tables import connections, integrations, projects, schedules, workspaces
from idraft.domain.ga4_pull import VERSION, Ga4PullState
from idraft.domain.schedules import Cadence, ScheduleRule, next_occurrence

JOB: Final = "ga4_sync"
SCHEDULE_NAME: Final = "Daily GA4 sync"
# shortcut: docs/18 section 13 sets the schedule to the property's own time zone, which the
# integration does not hold yet; Pacific Time (as for Search Console) is a fixed 06:00 slot.
SCHEDULE_TIMEZONE: Final = "America/Los_Angeles"
WINDOW_START: Final = time(6, 0)
WINDOW_HOURS: Final = 6
_collecting = and_(
    projects.c.status == "active",
    projects.c.deleted_at.is_(None),
    workspaces.c.status == "active",
)
_healthy = and_(
    integrations.c.kind == "ga4",
    integrations.c.status == "active",
    integrations.c.project_id.is_not(None),
    connections.c.status == "active",
)


class Ga4SyncTask(BaseModel):
    """The message of the `ga4_sync` job: one property."""

    workspace_id: UUID
    integration_id: UUID

    @property
    def dedupe_key(self) -> str:
        return f"{JOB}:{self.integration_id}"


type Send = Callable[[Ga4SyncTask], Awaitable[bool]]


def _joined() -> Join:
    return (
        integrations.join(
            connections,
            and_(
                connections.c.id == integrations.c.connection_id,
                connections.c.workspace_id == integrations.c.workspace_id,
            ),
        )
        .join(
            projects,
            and_(
                projects.c.id == integrations.c.project_id,
                projects.c.workspace_id == integrations.c.workspace_id,
            ),
        )
        .join(workspaces, workspaces.c.id == projects.c.workspace_id)
    )


async def _ensure_schedules(db: AsyncSession, now: datetime) -> int:
    """A schedule for every live property that has none. One a person paused, changed or deleted
    is a schedule too: it is left as it is."""
    missing = await db.execute(
        select(integrations.c.workspace_id, integrations.c.project_id)
        .select_from(_joined())
        .where(
            integrations.c.kind == "ga4",
            integrations.c.status != "disabled",
            integrations.c.project_id.is_not(None),
            connections.c.status == "active",
            ~exists().where(
                schedules.c.workspace_id == integrations.c.workspace_id,
                schedules.c.project_id == integrations.c.project_id,
                schedules.c.workload == JOB,
            ),
        )
        # One schedule per project, however many properties it has.
        .distinct()
        .limit(PLAN_LIMIT)
    )
    rule = ScheduleRule(
        cadence=Cadence.DAILY, timezone=SCHEDULE_TIMEZONE, window_start_local=WINDOW_START
    )
    made = 0
    for row in missing.all():
        await db.execute(
            insert(schedules).values(
                workspace_id=row.workspace_id,
                project_id=row.project_id,
                workload=JOB,
                name=SCHEDULE_NAME,
                cadence=rule.cadence.value,
                timezone=SCHEDULE_TIMEZONE,
                window_start_local=WINDOW_START,
                window_hours=WINDOW_HOURS,
                selector={},
                next_run_at=next_occurrence(rule, now),
            )
        )
        made += 1
    return made


async def _send_due_schedules(db: AsyncSession, send: Send, now: datetime) -> int:
    due = await db.execute(
        select(
            schedules.c.id,
            schedules.c.workspace_id,
            schedules.c.project_id,
            schedules.c.cadence,
            schedules.c.timezone,
            schedules.c.window_start_local,
            schedules.c.weekday,
            schedules.c.month_day,
        )
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
            schedules.c.workload == JOB,
            schedules.c.is_active,
            schedules.c.deleted_at.is_(None),
            schedules.c.next_run_at <= now,
            _collecting,
        )
        .order_by(schedules.c.next_run_at, schedules.c.id)
        .limit(PLAN_LIMIT)
        # Only `next_run_at` changes, so the lock leaves the row's key free.
        .with_for_update(of=schedules, skip_locked=True, key_share=True)
    )
    sent = 0
    for schedule in due.all():
        found = await db.execute(
            select(integrations.c.id)
            .select_from(_joined())
            .where(
                integrations.c.workspace_id == schedule.workspace_id,
                integrations.c.project_id == schedule.project_id,
                _healthy,
            )
        )
        ids: list[UUID] = list(found.scalars())
        for integration_id in ids:
            task = Ga4SyncTask(workspace_id=schedule.workspace_id, integration_id=integration_id)
            sent += await send(task)
        rule = ScheduleRule(
            cadence=Cadence(schedule.cadence),
            timezone=schedule.timezone,
            window_start_local=schedule.window_start_local,
            weekday=schedule.weekday if schedule.cadence == Cadence.WEEKLY else None,
            month_day=schedule.month_day if schedule.cadence == Cadence.MONTHLY else None,
        )
        await db.execute(
            update(schedules)
            .where(schedules.c.id == schedule.id, schedules.c.workspace_id == schedule.workspace_id)
            .values(next_run_at=next_occurrence(rule, now))
        )
    return sent


async def _send_unfinished(db: AsyncSession, send: Send, now: datetime) -> int:
    state = integrations.c.backfill_state["ga4"]
    unfinished = await db.execute(
        select(
            integrations.c.workspace_id,
            integrations.c.id,
            integrations.c.backfill_state,
        )
        .select_from(_joined())
        .where(
            _healthy,
            _collecting,
            # A state of another version is a run not begun (`Ga4PullState.read`), finished or
            # not; a finished one that failed since is tried again once its wait is over.
            or_(
                func.coalesce(state["version"].astext, "0") != str(VERSION),
                func.coalesce(state["complete"].astext, "false") != "true",
                func.coalesce(state["failures"].astext, "0") != "0",
            ),
        )
        .order_by(integrations.c.created_at, integrations.c.id)
        .limit(PLAN_LIMIT)
    )
    sent = 0
    for row in unfinished.all():
        if Ga4PullState.read(row.backfill_state).retry_due(now):
            sent += await send(Ga4SyncTask(workspace_id=row.workspace_id, integration_id=row.id))
    return sent


async def plan_syncs(
    sessions: async_sessionmaker[AsyncSession], send: Send, *, now: datetime
) -> PlanReport:
    """One tick: make missing schedules, send what is due, send what is unfinished. All in one
    transaction, so a schedule moves on only if its messages were sent; a message sent twice (the
    transaction failed after it) is harmless, since a run can run twice."""
    async with sessions() as db, db.begin():
        made = await _ensure_schedules(db, now)
        scheduled = await _send_due_schedules(db, send, now)
        continued = await _send_unfinished(db, send, now)
    return PlanReport(schedules_made=made, scheduled=scheduled, continued=continued)
