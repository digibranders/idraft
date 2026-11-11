"""The project's AI answer schedules (spec 2026-11-11 section 4.3; plan decision A4)."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.ai.schedule import AI_SCHEDULE, ensure_ai_schedule
from idraft.db.engine import workspace_transaction
from idraft.domain.ai_engines import BASE_PLAN
from tests.api.auth.support import execute, fetch, make_workspace
from tests.api.workspaces.support import make_project
from tests.conftest import PostgresServer

# A Wednesday.
NOW = datetime(2026, 11, 11, 12, 0, tzinfo=UTC)

type Sessions = async_sessionmaker[AsyncSession]


def test_the_schedules_run_as_often_as_the_base_plan_says() -> None:
    assert len(AI_SCHEDULE.runs) == BASE_PLAN.runs_per_week
    assert len({run.weekday for run in AI_SCHEDULE.runs}) == BASE_PLAN.runs_per_week


async def test_a_project_gets_two_weekly_answer_schedules(
    sessions: Sessions, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await make_project(migrated, workspace.id)
    await execute(
        migrated, "UPDATE core.projects SET timezone = 'Europe/Berlin' WHERE id = $1", project
    )

    async with workspace_transaction(sessions, workspace.id) as db:
        await ensure_ai_schedule(db, workspace_id=workspace.id, project_id=project, now=NOW)

    rows = await fetch(
        migrated,
        "SELECT name, workload, cadence, weekday, timezone, window_start_local, window_hours, "
        "provider_mode, selector, is_active, next_run_at FROM ops.schedules "
        "WHERE project_id = $1 ORDER BY weekday",
        project,
    )
    assert [tuple(row)[:10] for row in rows] == [
        (
            name,
            "ai_prompt",
            "weekly",
            weekday,
            "Europe/Berlin",
            AI_SCHEDULE.window_start_local,
            8,
            "standard_queue",
            '{"all": true}',
            True,
        )
        for weekday, name in ((1, "AI answers, Monday"), (4, "AI answers, Thursday"))
    ]
    # 01:00 in Berlin in November is 00:00 UTC: Monday 16 and Thursday 12 November.
    assert [row["next_run_at"] for row in rows] == [
        datetime(2026, 11, 16, 0, 0, tzinfo=UTC),
        datetime(2026, 11, 12, 0, 0, tzinfo=UTC),
    ]


async def test_a_project_with_an_answer_schedule_gets_no_more(
    sessions: Sessions, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await make_project(migrated, workspace.id)

    for _ in range(2):
        async with workspace_transaction(sessions, workspace.id) as db:
            await ensure_ai_schedule(db, workspace_id=workspace.id, project_id=project, now=NOW)
    # A person deleted both: they are not made again.
    await execute(
        migrated, "UPDATE ops.schedules SET deleted_at = now() WHERE project_id = $1", project
    )
    async with workspace_transaction(sessions, workspace.id) as db:
        await ensure_ai_schedule(db, workspace_id=workspace.id, project_id=project, now=NOW)

    rows = await fetch(migrated, "SELECT id FROM ops.schedules WHERE project_id = $1", project)
    assert len(rows) == 2
