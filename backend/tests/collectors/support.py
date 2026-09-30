"""Helpers for ledger tests: tenants, runs and tasks made directly."""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors import ledger
from sightline.collectors.ledger import NewRun, NewTask
from sightline.domain.workloads import TaskWorkload
from tests.api.auth.support import fetch, fetchrow, make_workspace
from tests.api.workspaces.support import make_project
from tests.conftest import PostgresServer

# The real clock: the ledger's partitions exist for the months around today.
NOW = datetime.now(UTC).replace(microsecond=0)


@dataclass(frozen=True)
class Project:
    workspace_id: uuid.UUID
    id: uuid.UUID


async def make_tenant(pg: PostgresServer) -> Project:
    workspace = await make_workspace(pg)
    return Project(workspace_id=workspace.id, id=await make_project(pg, workspace.id))


def new_run(
    project: Project,
    *,
    schedule_id: uuid.UUID | None = None,
    workload: TaskWorkload = TaskWorkload.SEO_RANK,
    window_start: datetime = NOW,
    hours: int = 6,
) -> NewRun:
    return NewRun(
        workspace_id=project.workspace_id,
        project_id=project.id,
        schedule_id=schedule_id,
        workload=workload,
        window_start=window_start,
        window_end=window_start + timedelta(hours=hours),
        trigger="schedule" if schedule_id is not None else "manual",
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
) -> uuid.UUID:
    row = await fetchrow(
        pg,
        "INSERT INTO ops.schedules (workspace_id, project_id, workload, name, cadence, timezone, "
        "window_start_local, window_hours, weekday, month_day, priority, is_active, "
        "next_run_at) "
        "VALUES ($1, $2, $3, 'Ranks', $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id",
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
) -> uuid.UUID:
    """A running run with `tasks` pending tasks, made through the ledger itself."""
    run = new_run(project, schedule_id=schedule_id, window_start=window_start)
    async with sessions() as db, db.begin():
        run_id = await ledger.create_run(db, run, now=window_start)
        assert run_id is not None
        await ledger.insert_tasks(
            db,
            run_id,
            run,
            [
                new_task(number, scheduled_for=scheduled_for, provider=provider, endpoint=endpoint)
                for number in range(tasks)
            ],
        )
        await ledger.start_run(db, run_id, tasks_total=tasks, estimated_cost_usd=Decimal("0"))
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
) -> None:
    """A cost event of `amount` dollars for the project."""
    await fetch(
        pg,
        "INSERT INTO ops.provider_cost_events (occurred_at, workspace_id, project_id, "
        "provider_code, endpoint, workload, channel, cost_usd, cost_source, billing_period) "
        "VALUES ($1, $2, $3, 'fake', 'serp', $4, 'seo', $5, 'provider_reported', $6)",
        when,
        project.workspace_id,
        project.id,
        workload,
        Decimal(amount),
        when.date().replace(day=1),
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
