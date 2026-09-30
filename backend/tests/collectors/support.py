"""Helpers for ledger tests: tenants, runs and tasks made directly."""

from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors import ledger
from sightline.collectors.ledger import NewRun, NewTask, Trigger
from sightline.collectors.registry import Plan, ScheduleWindow
from sightline.domain.tasks import scheduled_for
from sightline.domain.workloads import TaskWorkload
from tests.api.auth.support import execute, fetch, fetchrow, make_workspace
from tests.api.workspaces.support import make_project
from tests.conftest import PostgresServer

# The real clock: the ledger's partitions exist for the months around today.
NOW = datetime.now(UTC).replace(microsecond=0)


@dataclass(frozen=True)
class Project:
    workspace_id: uuid.UUID
    id: uuid.UUID


async def empty_ledger(pg: PostgresServer) -> None:
    """Remove every schedule, run, task, cost event and budget. Planning, claiming and
    reconciling look at all of them, whoever made them."""
    await execute(
        pg,
        "TRUNCATE ops.collection_tasks, ops.provider_cost_events, ops.collection_runs, "
        "ops.schedules, ops.budgets CASCADE",
    )


async def make_tenant(pg: PostgresServer) -> Project:
    workspace = await make_workspace(pg)
    return Project(workspace_id=workspace.id, id=await make_project(pg, workspace.id))


async def another_project(pg: PostgresServer, project: Project) -> Project:
    """A second project in the same workspace."""
    return Project(
        workspace_id=project.workspace_id, id=await make_project(pg, project.workspace_id)
    )


def new_run(
    project: Project,
    *,
    schedule_id: uuid.UUID | None = None,
    workload: TaskWorkload = TaskWorkload.SEO_RANK,
    window_start: datetime = NOW,
    hours: int = 6,
    trigger: Trigger | None = None,
) -> NewRun:
    if trigger is None:
        trigger = "schedule" if schedule_id is not None else "manual"
    return NewRun(
        workspace_id=project.workspace_id,
        project_id=project.id,
        schedule_id=schedule_id,
        workload=workload,
        window_start=window_start,
        window_end=window_start + timedelta(hours=hours),
        trigger=trigger,
        config_snapshot={"adapter": 1},
    )


def new_task(
    number: int,
    *,
    scheduled_for: datetime = NOW,
    provider: str = "fake",
    endpoint: str = "serp",
    depth: int | None = 20,
) -> NewTask:
    subject = f"keyword-{number}"
    return NewTask(
        subject_type="tracked_keyword",
        subject_id=subject,
        engine_code=None,
        location_id=2356,
        replicate_index=1,
        depth=depth,
        request_fingerprint=hashlib.sha256(subject.encode()).digest(),
        provider_code=provider,
        provider_endpoint=endpoint,
        scheduled_for=scheduled_for,
    )


async def make_schedule(
    pg: PostgresServer,
    project: Project,
    *,
    next_run_at: datetime = NOW,
    priority: str = "standard",
    workload: str = "seo_rank",
    cadence: str = "daily",
    timezone: str = "UTC",
    window_start_local: str = "02:00",
    window_hours: int = 6,
    weekday: int | None = None,
    month_day: int | None = None,
    is_active: bool = True,
    selector: dict[str, Any] | None = None,
) -> uuid.UUID:
    row = await fetchrow(
        pg,
        "INSERT INTO ops.schedules (workspace_id, project_id, workload, name, cadence, timezone, "
        "window_start_local, window_hours, weekday, month_day, priority, is_active, "
        "next_run_at, selector) "
        "VALUES ($1, $2, $3, 'Ranks', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb) "
        "RETURNING id",
        project.workspace_id,
        project.id,
        workload,
        cadence,
        timezone,
        time.fromisoformat(window_start_local),
        window_hours,
        weekday,
        month_day,
        priority,
        is_active,
        next_run_at,
        json.dumps(selector or {}),
    )
    schedule_id: uuid.UUID = row["id"]
    return schedule_id


async def seed_run(
    sessions: async_sessionmaker[AsyncSession],
    project: Project,
    tasks: int,
    *,
    schedule_id: uuid.UUID | None = None,
    scheduled_for: datetime = NOW,
    window_start: datetime = NOW,
    provider: str = "fake",
    endpoint: str = "serp",
    workload: TaskWorkload = TaskWorkload.SEO_RANK,
    trigger: Trigger | None = None,
    estimate: str = "0",
) -> uuid.UUID:
    """A running run with `tasks` pending tasks, made through the ledger itself."""
    run = new_run(
        project,
        schedule_id=schedule_id,
        window_start=window_start,
        workload=workload,
        trigger=trigger,
    )
    async with sessions() as db, db.begin():
        run_id = await ledger.create_run(db, run, now=window_start)
        assert run_id is not None
        await ledger.insert_tasks(
            db,
            run_id,
            [
                new_task(number, scheduled_for=scheduled_for, provider=provider, endpoint=endpoint)
                for number in range(tasks)
            ],
        )
        await ledger.start_run(db, run_id, tasks_total=tasks, estimated_cost_usd=Decimal(estimate))
    return run_id


async def task_rows(pg: PostgresServer, run_id: uuid.UUID) -> list[dict[str, Any]]:
    rows = await fetch(
        pg, "SELECT * FROM ops.collection_tasks WHERE run_id = $1 ORDER BY subject_id", run_id
    )
    return [dict(row) for row in rows]


async def run_row(pg: PostgresServer, run_id: uuid.UUID) -> dict[str, Any]:
    return dict(await fetchrow(pg, "SELECT * FROM ops.collection_runs WHERE id = $1", run_id))


async def spend(
    pg: PostgresServer,
    project: Project,
    amount: str,
    *,
    workload: str = "seo_rank",
    when: datetime = NOW,
    run_id: uuid.UUID | None = None,
) -> None:
    """A cost event of `amount` dollars for the project."""
    await fetch(
        pg,
        "INSERT INTO ops.provider_cost_events (occurred_at, workspace_id, project_id, "
        "provider_code, endpoint, workload, channel, cost_usd, cost_source, billing_period, "
        "run_id) "
        "VALUES ($1, $2, $3, 'fake', 'serp', $4, 'seo', $5, 'provider_reported', $6, $7)",
        when,
        project.workspace_id,
        project.id,
        workload,
        Decimal(amount),
        when.astimezone(UTC).date().replace(day=1),
        run_id,
    )


async def make_budget(
    pg: PostgresServer,
    project: Project,
    limit: str,
    *,
    workload: str | None = "seo_rank",
    for_project: bool = False,
    soft_limit_pct: int = 80,
    action: str = "pause",
) -> uuid.UUID:
    row = await fetchrow(
        pg,
        "INSERT INTO ops.budgets (workspace_id, project_id, workload, limit_usd, soft_limit_pct, "
        "action_on_hard) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
        project.workspace_id,
        project.id if for_project else None,
        workload,
        Decimal(limit),
        soft_limit_pct,
        action,
    )
    budget_id: uuid.UUID = row["id"]
    return budget_id


class FakeWorkload:
    """Plans one task per subject, spread over the window, at a fixed price."""

    name = TaskWorkload.SEO_RANK

    def __init__(self, subjects: int = 3, *, price: str = "0.001") -> None:
        self.subjects = subjects
        self.price = Decimal(price)
        self.windows: list[ScheduleWindow] = []
        # Schedules this workload cannot plan.
        self.broken: set[uuid.UUID] = set()
        # Schedules whose planning waits: set when it has begun, goes on when released.
        self.gates: dict[uuid.UUID, tuple[asyncio.Event, asyncio.Event]] = {}
        # A statement this workload runs while it plans, which it has no business running.
        self.writes: str | None = None
        # Whether it plans its first task twice.
        self.repeats = False

    async def plan(self, db: AsyncSession, window: ScheduleWindow) -> Plan:
        if window.schedule_id in self.broken:
            raise RuntimeError("the selector names a group that is gone")
        if window.schedule_id in self.gates:
            begun, go_on = self.gates[window.schedule_id]
            begun.set()
            await go_on.wait()
        if self.writes is not None:
            await db.execute(text(self.writes))
        self.windows.append(window)
        tasks = [
            NewTask(
                subject_type="tracked_keyword",
                subject_id=f"keyword-{number}",
                engine_code=None,
                location_id=2356,
                replicate_index=1,
                depth=20,
                request_fingerprint=hashlib.sha256(f"keyword-{number}".encode()).digest(),
                provider_code="fake",
                provider_endpoint="serp",
                scheduled_for=scheduled_for(
                    window_start=window.window_start,
                    subject_id=f"keyword-{number}",
                    workload=window.workload,
                    window_hours=window.window_hours,
                ),
            )
            for number in range(self.subjects)
        ]
        if self.repeats:
            tasks.append(tasks[0])
        return Plan(
            tasks=tasks,
            estimated_cost_usd=self.price * len(tasks),
            config_snapshot={"adapter": "fake@1", "provider_mode": window.provider_mode},
        )
