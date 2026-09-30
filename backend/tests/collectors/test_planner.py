"""The planner (docs/21-scheduler-workers.md section 3.1). As `app_worker`, with a fake workload."""

import asyncio
import json
import uuid
from datetime import datetime, time, timedelta
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors import planner
from sightline.collectors.planner import PlannerReport, plan_due
from sightline.collectors.registry import Registry
from sightline.domain.schedules import Cadence, ScheduleRule, next_occurrence
from sightline.domain.tasks import STAGGER_SHARE, partition_month
from tests.api.auth.support import execute, fetch, fetchrow
from tests.collectors.support import (
    NOW,
    FakeWorkload,
    Project,
    another_project,
    make_budget,
    make_schedule,
    make_tenant,
    task_rows,
)
from tests.conftest import PostgresServer
from tests.db.support import connection

Ledger = async_sessionmaker[AsyncSession]
DAY = timedelta(days=1)
DAILY = ScheduleRule(cadence=Cadence.DAILY, timezone="UTC", window_start_local=time(2, 0))
# The window of today's schedule that has most recently started: within the last day.
LATEST = next_occurrence(DAILY, NOW - DAY)


def _registry(workload: FakeWorkload | None = None) -> Registry:
    registry = Registry()
    registry.add_workload(workload or FakeWorkload())
    return registry


async def _runs(pg: PostgresServer, schedule_id: uuid.UUID) -> list[dict[str, Any]]:
    rows = await fetch(
        pg,
        "SELECT * FROM ops.collection_runs WHERE schedule_id = $1 ORDER BY window_start",
        schedule_id,
    )
    return [dict(row) for row in rows]


async def _schedule(pg: PostgresServer, schedule_id: uuid.UUID) -> dict[str, Any]:
    return dict(await fetchrow(pg, "SELECT * FROM ops.schedules WHERE id = $1", schedule_id))


async def _due_schedule(pg: PostgresServer, project: Project, **fields: Any) -> uuid.UUID:
    return await make_schedule(pg, project, **{"next_run_at": LATEST, **fields})


async def test_a_due_schedule_becomes_a_run_with_its_tasks_spread_over_the_window(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    schedule_id = await _due_schedule(migrated, project)
    workload = FakeWorkload(subjects=3)

    report = await plan_due(worker_db, _registry(workload), now=NOW)

    assert report == PlannerReport(planned=1)
    (run,) = await _runs(migrated, schedule_id)
    assert (run["status"], run["trigger"], run["workload"]) == ("running", "schedule", "seo_rank")
    assert (run["workspace_id"], run["project_id"]) == (project.workspace_id, project.id)
    assert (run["window_start"], run["window_end"]) == (LATEST, LATEST + timedelta(hours=6))
    assert (run["tasks_total"], run["estimated_cost_usd"]) == (3, Decimal("0.0030"))
    assert json.loads(run["config_snapshot"]) == {
        "adapter": "fake@1",
        "provider_mode": "standard_queue",
    }
    tasks = await task_rows(migrated, run["id"])
    assert [task["subject_id"] for task in tasks] == ["keyword-0", "keyword-1", "keyword-2"]
    assert {task["status"] for task in tasks} == {"pending"}
    assert {(task["workspace_id"], task["project_id"]) for task in tasks} == {
        (project.workspace_id, project.id)
    }
    assert {task["created_at"] for task in tasks} == {partition_month(LATEST)}
    # Spread over the first four fifths of the window, not all at its start.
    spread_over = timedelta(hours=6) * STAGGER_SHARE
    assert all(LATEST <= task["scheduled_for"] < LATEST + spread_over for task in tasks)
    assert len({task["scheduled_for"] for task in tasks}) == 3
    # The workload was asked about this window of this schedule.
    (window,) = workload.windows
    assert (window.schedule_id, window.window_start, window.window_hours) == (
        schedule_id,
        LATEST,
        6,
    )
    assert (window.selector, window.provider_mode) == ({}, "standard_queue")
    # The schedule has moved on to tomorrow's window and remembers its run.
    schedule = await _schedule(migrated, schedule_id)
    assert (schedule["next_run_at"], schedule["last_run_id"]) == (LATEST + DAY, run["id"])


async def test_planning_again_adds_nothing(worker_db: Ledger, migrated: PostgresServer) -> None:
    project = await make_tenant(migrated)
    schedule_id = await _due_schedule(migrated, project)
    registry = _registry()

    await plan_due(worker_db, registry, now=NOW)
    again = await plan_due(worker_db, registry, now=NOW)

    assert again == PlannerReport()
    (run,) = await _runs(migrated, schedule_id)
    assert len(await task_rows(migrated, run["id"])) == 3


async def test_two_planners_at_once_plan_each_schedule_once(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    schedule_ids = [await _due_schedule(migrated, project) for _ in range(6)]
    registry = _registry()

    reports = await asyncio.gather(
        plan_due(worker_db, registry, now=NOW), plan_due(worker_db, registry, now=NOW)
    )

    assert sum(report.planned for report in reports) == 6
    assert sum(report.failed for report in reports) == 0
    for schedule_id in schedule_ids:
        (run,) = await _runs(migrated, schedule_id)
        assert (run["status"], run["tasks_total"]) == ("running", 3)


async def test_windows_missed_are_recorded_and_only_the_latest_is_planned(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    # The worker was down for three days.
    schedule_id = await _due_schedule(migrated, project, next_run_at=LATEST - 3 * DAY)

    report = await plan_due(worker_db, _registry(), now=NOW)

    assert report == PlannerReport(planned=1)
    runs = await _runs(migrated, schedule_id)
    assert [(run["window_start"], run["status"], run["status_reason"]) for run in runs] == [
        (LATEST - 3 * DAY, "cancelled", "missed_window"),
        (LATEST - 2 * DAY, "cancelled", "missed_window"),
        (LATEST - DAY, "cancelled", "missed_window"),
        (LATEST, "running", None),
    ]
    # A run that never ran has no tasks and is closed.
    assert {run["completed_at"] for run in runs[:3]} == {NOW}
    assert [len(await task_rows(migrated, run["id"])) for run in runs] == [0, 0, 0, 3]
    schedule = await _schedule(migrated, schedule_id)
    assert (schedule["next_run_at"], schedule["last_run_id"]) == (LATEST + DAY, runs[-1]["id"])


async def test_a_long_gap_records_only_its_most_recent_windows(
    worker_db: Ledger, migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(planner, "MISSED_RECORDED_MAX", 2)
    project = await make_tenant(migrated)
    schedule_id = await _due_schedule(migrated, project, next_run_at=LATEST - 20 * DAY)

    await plan_due(worker_db, _registry(), now=NOW)

    runs = await _runs(migrated, schedule_id)
    assert [(run["window_start"], run["status"]) for run in runs] == [
        (LATEST - 2 * DAY, "cancelled"),
        (LATEST - DAY, "cancelled"),
        (LATEST, "running"),
    ]


async def test_a_run_over_budget_is_recorded_with_the_budget_and_has_no_tasks(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    budget_id = await make_budget(migrated, project, "2.99")
    schedule_id = await _due_schedule(migrated, project)

    report = await plan_due(worker_db, _registry(FakeWorkload(subjects=3, price="1")), now=NOW)

    assert report == PlannerReport(blocked=1)
    (run,) = await _runs(migrated, schedule_id)
    assert (run["status"], run["status_reason"], run["blocked_by_budget_id"]) == (
        "budget_blocked",
        "budget_exceeded",
        budget_id,
    )
    assert (run["estimated_cost_usd"], run["tasks_total"]) == (Decimal("3.0000"), 0)
    assert await task_rows(migrated, run["id"]) == []
    # The window is dealt with: tomorrow's is judged afresh.
    schedule = await _schedule(migrated, schedule_id)
    assert (schedule["next_run_at"], schedule["last_run_id"]) == (LATEST + DAY, run["id"])


async def test_two_runs_planned_in_one_tick_cannot_both_take_the_budget(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    """The first run has sent nothing yet when the second is judged. Its estimate counts."""
    project = await make_tenant(migrated)
    await make_budget(migrated, project, "5.00")
    first = await _due_schedule(migrated, project, next_run_at=LATEST - timedelta(minutes=1))
    second = await _due_schedule(migrated, project)

    # Each run alone fits the budget of 5; the two together, 6, do not.
    report = await plan_due(worker_db, _registry(FakeWorkload(subjects=3, price="1")), now=NOW)

    assert report == PlannerReport(planned=1, blocked=1)
    assert [run["status"] for run in await _runs(migrated, first)] == ["cancelled", "running"]
    assert [run["status"] for run in await _runs(migrated, second)] == ["budget_blocked"]


async def test_a_schedule_that_selects_nothing_still_has_its_run(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    schedule_id = await _due_schedule(migrated, project)

    report = await plan_due(worker_db, _registry(FakeWorkload(subjects=0)), now=NOW)

    assert report == PlannerReport(planned=1)
    (run,) = await _runs(migrated, schedule_id)
    # Running with nothing to do: the reconciler's sweep completes it.
    assert (run["status"], run["tasks_total"], run["estimated_cost_usd"]) == (
        "running",
        0,
        Decimal("0.0000"),
    )


async def test_schedules_the_planner_has_no_business_with_are_left_as_they_are(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    left_alone = {
        "inactive": await _due_schedule(migrated, project, is_active=False),
        # No workload of this name is registered with this worker.
        "unknown workload": await _due_schedule(migrated, project, workload="ai_prompt"),
        # Reserved in the schema; there is no rule for it yet.
        "cron": await _due_schedule(migrated, project, cadence="cron"),
        "not due": await _due_schedule(migrated, project, next_run_at=NOW + timedelta(minutes=1)),
    }
    before = {name: await _schedule(migrated, left) for name, left in left_alone.items()}

    report = await plan_due(worker_db, _registry(), now=NOW)

    assert report == PlannerReport()
    for name, schedule_id in left_alone.items():
        assert await _runs(migrated, schedule_id) == [], name
        assert await _schedule(migrated, schedule_id) == before[name], name


async def test_a_worker_with_no_workload_plans_nothing(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    schedule_id = await _due_schedule(migrated, project)

    assert await plan_due(worker_db, Registry(), now=NOW) == PlannerReport()
    assert await _runs(migrated, schedule_id) == []


@pytest.mark.parametrize(
    "stop",
    [
        "UPDATE core.projects SET status = 'paused' WHERE id = $1",
        "UPDATE core.projects SET status = 'archived' WHERE id = $1",
        "UPDATE core.projects SET deleted_at = now() WHERE id = $1",
        "UPDATE auth.workspaces SET status = 'suspended' "
        "WHERE id = (SELECT workspace_id FROM core.projects WHERE id = $1)",
    ],
)
async def test_the_windows_of_a_project_that_is_not_collecting_pass_with_no_run(
    worker_db: Ledger, migrated: PostgresServer, stop: str
) -> None:
    """Nothing is spent for it, and no run is recorded as missed: the gap is meant. When the
    project collects again its schedule is at its next window, not days behind."""
    project = await make_tenant(migrated)
    schedule_id = await _due_schedule(migrated, project, next_run_at=LATEST - 5 * DAY)
    await execute(migrated, stop, project.id)
    workload = FakeWorkload()

    report = await plan_due(worker_db, _registry(workload), now=NOW)

    assert report == PlannerReport(passed=1)
    assert await _runs(migrated, schedule_id) == []
    assert workload.windows == []
    schedule = await _schedule(migrated, schedule_id)
    assert (schedule["next_run_at"], schedule["last_run_id"]) == (LATEST + DAY, None)


async def test_a_schedule_that_names_another_workspaces_project_is_never_planned(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    """The worker bypasses row-level security. A schedule whose workspace is not its
    project's would make a run that bills one tenant for another's work."""
    project = await make_tenant(migrated)
    other = await make_tenant(migrated)
    crossed = Project(workspace_id=other.workspace_id, id=project.id)
    schedule_id = await _due_schedule(migrated, crossed)

    assert await plan_due(worker_db, _registry(), now=NOW) == PlannerReport()
    assert await _runs(migrated, schedule_id) == []


async def test_a_schedule_that_cannot_be_planned_does_not_hold_up_the_others(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    # The two that fail have waited longest, so they are found first.
    broken = await _due_schedule(migrated, project, next_run_at=LATEST - timedelta(minutes=2))
    no_zone = await _due_schedule(
        migrated, project, next_run_at=LATEST - timedelta(minutes=1), timezone="Mars/Olympus"
    )
    fine = await _due_schedule(migrated, project)
    workload = FakeWorkload()
    workload.broken.add(broken)
    before = await _schedule(migrated, broken)

    report = await plan_due(worker_db, _registry(workload), now=NOW)

    assert report == PlannerReport(planned=1, failed=2)
    assert [run["status"] for run in await _runs(migrated, fine)] == ["running"]
    # Nothing of the failed attempt is left, the missed window it had recorded included.
    for failed in (broken, no_zone):
        assert await _runs(migrated, failed) == []
    assert await _schedule(migrated, broken) == before

    # Once what was wrong is put right, the next tick plans it.
    workload.broken.clear()
    later = await plan_due(worker_db, _registry(workload), now=NOW)
    assert later == PlannerReport(planned=1, failed=1)
    assert [run["status"] for run in await _runs(migrated, broken)] == ["cancelled", "running"]


async def test_a_workspace_another_planner_is_at_work_in_is_left_for_the_next_tick(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    """Planning takes its turn at a workspace's budget and does not wait long for it. Not
    getting the turn is not a failure, and the rest of the tick goes on elsewhere."""
    project = await make_tenant(migrated)
    other = await make_tenant(migrated)
    waiting = [await _due_schedule(migrated, project) for _ in range(2)]
    free = await _due_schedule(migrated, other)
    registry = _registry()

    async with connection(migrated, "app_worker") as holder:
        turn = holder.transaction()
        await turn.start()
        await holder.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            f"budget:{project.workspace_id}",
        )
        report = await plan_due(worker_db, registry, now=NOW)
        await turn.rollback()

    # One schedule waited and gave up; the workspace's other one was not even tried.
    assert report == PlannerReport(planned=1, deferred=1)
    assert [run["status"] for run in await _runs(migrated, free)] == ["running"]
    for schedule_id in waiting:
        assert await _runs(migrated, schedule_id) == []

    assert await plan_due(worker_db, registry, now=NOW) == PlannerReport(planned=2)


async def test_a_window_that_already_has_its_run_is_not_planned_again(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    schedule_id = await _due_schedule(migrated, project)
    registry = _registry()
    await plan_due(worker_db, registry, now=NOW)
    # Someone set the schedule back by hand.
    await execute(
        migrated, "UPDATE ops.schedules SET next_run_at = $2 WHERE id = $1", schedule_id, LATEST
    )

    report = await plan_due(worker_db, registry, now=NOW)

    assert report == PlannerReport()
    (run,) = await _runs(migrated, schedule_id)
    assert len(await task_rows(migrated, run["id"])) == 3
    # It does not stay due for ever.
    assert (await _schedule(migrated, schedule_id))["next_run_at"] == LATEST + DAY


async def test_a_tick_plans_the_schedules_that_have_waited_longest_up_to_its_limit(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    sibling = await another_project(migrated, project)
    schedule_ids = [
        await _due_schedule(
            migrated, (project, sibling)[age % 2], next_run_at=LATEST - timedelta(minutes=age)
        )
        for age in range(5)
    ]

    report = await plan_due(worker_db, _registry(), now=NOW, limit=3)

    assert report == PlannerReport(planned=3)
    planned = [bool(await _runs(migrated, schedule_id)) for schedule_id in schedule_ids]
    assert planned == [False, False, True, True, True]


@pytest.mark.parametrize(
    ("cadence", "days", "fields"),
    [
        ("weekly", 7, {"weekday": (LATEST.isoweekday() % 7)}),
        ("monthly", None, {"month_day": min(LATEST.day, 28)}),
    ],
)
async def test_a_weekly_or_monthly_schedule_moves_on_by_its_own_period(
    worker_db: Ledger,
    migrated: PostgresServer,
    cadence: str,
    days: int | None,
    fields: dict[str, int],
) -> None:
    project = await make_tenant(migrated)
    schedule_id = await _due_schedule(migrated, project, cadence=cadence, **fields)

    assert await plan_due(worker_db, _registry(), now=NOW) == PlannerReport(planned=1)

    following: datetime = (await _schedule(migrated, schedule_id))["next_run_at"]
    assert following > NOW
    assert (following.hour, following.minute) == (2, 0)
    if days is not None:
        assert following - LATEST == timedelta(days=days)
    else:
        assert following.day == fields["month_day"]
        assert 28 <= (following - LATEST).days <= 31
