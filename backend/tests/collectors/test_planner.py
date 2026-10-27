"""The planner (docs/21-scheduler-workers.md section 3.1). As `app_worker`, with a fake workload."""

import asyncio
import io
import json
import uuid
from datetime import datetime, time, timedelta
from decimal import Decimal
from typing import Any

import asyncpg
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors import planner
from idraft.collectors.planner import PlannerReport, plan_due
from idraft.collectors.registry import Registry
from idraft.config.logging import configure_logging
from idraft.domain.schedules import Cadence, ScheduleRule, next_occurrence
from idraft.domain.tasks import STAGGER_SHARE, partition_month
from tests.api.auth.support import execute, fetch, fetchrow
from tests.collectors.support import NOW as TODAY
from tests.collectors.support import (
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
HOUR = timedelta(hours=1)
_SECOND = timedelta(seconds=1)
DAILY = ScheduleRule(cadence=Cadence.DAILY, timezone="UTC", window_start_local=time(2, 0))
# The planner is told the time, so these tests have their own: 03:00 UTC on the 15th of this
# month, whatever today is. The ledger has partitions for this month and the one before.
NOW = partition_month(TODAY) + timedelta(days=14, hours=3)
# The window of a daily 02:00 schedule that began an hour before.
LATEST = NOW - HOUR
assert next_occurrence(DAILY, NOW - DAY) == LATEST


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
    # A weekday on a daily schedule is allowed by the schema and means nothing.
    schedule_id = await _due_schedule(migrated, project, selector={"groups": ["brand"]}, weekday=3)
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
    assert window.window_end == LATEST + 6 * HOUR
    assert (window.selector, window.provider_mode) == ({"groups": ["brand"]}, "standard_queue")
    assert (window.workspace_id, window.project_id) == (project.workspace_id, project.id)
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
    # A run that never ran has no tasks, was planned with nothing, and is closed.
    assert {run["completed_at"] for run in runs[:3]} == {NOW}
    assert {run["config_snapshot"] for run in runs[:3]} == {"{}"}
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
    assert [run["status"] for run in await _runs(migrated, first)] == ["running"]
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
        "deleted": await _due_schedule(migrated, project, deleted_at=NOW - timedelta(days=1)),
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
    project's would make a run that bills one tenant for another's work, so the key refuses
    one (migration 0011) and the planner never meets it."""
    project = await make_tenant(migrated)
    other = await make_tenant(migrated)
    crossed = Project(workspace_id=other.workspace_id, id=project.id)

    with pytest.raises(asyncpg.ForeignKeyViolationError):
        await _due_schedule(migrated, crossed)
    assert await plan_due(worker_db, _registry(), now=NOW) == PlannerReport()


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
    # Nothing of the failed attempt is left.
    for failed in (broken, no_zone):
        assert await _runs(migrated, failed) == []
    assert await _schedule(migrated, broken) == before

    # Once what was wrong is put right, the next tick plans it.
    workload.broken.clear()
    later = await plan_due(worker_db, _registry(workload), now=NOW)
    assert later == PlannerReport(planned=1, failed=1)
    # Its stored instant, two minutes before the window, was no window of its own.
    assert [run["status"] for run in await _runs(migrated, broken)] == ["running"]


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
        ("monthly", None, {"month_day": 15}),
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
        assert following.day == 15
        assert 28 <= (following - LATEST).days <= 31


async def test_a_schedule_is_due_at_the_instant_its_window_starts(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    schedule_id = await _due_schedule(migrated, project)

    assert await plan_due(worker_db, _registry(), now=LATEST - _SECOND) == PlannerReport()
    assert await plan_due(worker_db, _registry(), now=LATEST) == PlannerReport(planned=1)
    assert len(await _runs(migrated, schedule_id)) == 1


async def test_the_lock_on_a_schedule_being_planned_does_not_block_runs_that_refer_to_it(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    """Only `next_run_at` and `last_run_id` change, so the row's key stays free: a manual run
    of the same schedule, or a retry, can be recorded while the planner works."""
    project = await make_tenant(migrated)
    schedule_id = await _due_schedule(migrated, project)
    workload = FakeWorkload()
    begun, go_on = asyncio.Event(), asyncio.Event()
    workload.gates[schedule_id] = (begun, go_on)

    planning = asyncio.create_task(plan_due(worker_db, _registry(workload), now=NOW))
    await asyncio.wait_for(begun.wait(), timeout=10)
    try:
        async with connection(migrated) as other:
            await other.execute("SET lock_timeout = '1s'")
            # Refers to the locked row through its foreign key.
            await other.execute(
                "INSERT INTO ops.collection_runs (workspace_id, project_id, schedule_id, "
                "workload, window_start, window_end, trigger, status, config_snapshot) "
                "VALUES ($1, $2, $3, 'seo_rank', $4, $4, 'schedule', 'planned', '{}')",
                project.workspace_id,
                project.id,
                schedule_id,
                NOW + DAY,
            )
    finally:
        go_on.set()
    assert await planning == PlannerReport(planned=1)


async def test_a_planner_does_not_wait_for_a_schedule_another_one_holds(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    """The schedule's row is locked while it is planned. A second planner passes it over:
    it neither waits for it nor plans it as well."""
    project = await make_tenant(migrated)
    held = await _due_schedule(migrated, project, next_run_at=LATEST - DAY)
    others = [await _due_schedule(migrated, project) for _ in range(2)]
    workload = FakeWorkload()
    begun, go_on = asyncio.Event(), asyncio.Event()
    workload.gates[held] = (begun, go_on)
    registry = _registry(workload)

    first = asyncio.create_task(plan_due(worker_db, registry, now=NOW))
    await asyncio.wait_for(begun.wait(), timeout=10)
    try:
        second = await asyncio.wait_for(plan_due(worker_db, registry, now=NOW), timeout=2)
    finally:
        go_on.set()
    report = await first

    assert second == PlannerReport(planned=2)
    assert report == PlannerReport(planned=1)
    assert [run["status"] for run in await _runs(migrated, held)] == ["cancelled", "running"]
    for schedule_id in others:
        assert [run["status"] for run in await _runs(migrated, schedule_id)] == ["running"]


@pytest.mark.parametrize(
    ("late_by", "planned"),
    [
        # The window closed 24 hours ago to the second: its tasks would be cancelled unsent.
        (timedelta(hours=6 + 24), False),
        (timedelta(hours=6 + 24) - _SECOND, True),
        (timedelta(days=5), False),
    ],
)
async def test_a_window_found_too_late_to_send_is_recorded_as_missed_and_not_planned(
    worker_db: Ledger, migrated: PostgresServer, late_by: timedelta, planned: bool
) -> None:
    """A weekly schedule found five days late would send a week-old check, have the rest
    cancelled, and run again two days later."""
    project = await make_tenant(migrated)
    start = NOW - late_by
    weekly = {"cadence": "weekly", "weekday": start.isoweekday() % 7}
    schedule_id = await _due_schedule(
        migrated,
        project,
        next_run_at=start,
        window_start_local=start.strftime("%H:%M:%S"),
        **weekly,
    )
    workload = FakeWorkload()

    report = await plan_due(worker_db, _registry(workload), now=NOW)

    (run,) = await _runs(migrated, schedule_id)
    if planned:
        assert report == PlannerReport(planned=1)
        assert run["status"] == "running"
    else:
        assert report == PlannerReport(missed=1)
        assert (run["status"], run["status_reason"]) == ("cancelled", "missed_window")
        assert await task_rows(migrated, run["id"]) == []
        assert workload.windows == []
    schedule = await _schedule(migrated, schedule_id)
    assert schedule["next_run_at"] == start + 7 * DAY


@pytest.mark.parametrize(
    ("now", "report", "statuses"),
    [
        # Half an hour before the real window: nothing is due, and the schedule is put right.
        (LATEST - timedelta(minutes=30), PlannerReport(), []),
        # After it: the window is planned, and the instant that was no window is not
        # recorded as one that was missed.
        (NOW, PlannerReport(planned=1), ["running"]),
    ],
)
async def test_a_stored_instant_that_is_no_window_of_the_rule_is_not_planned_as_one(
    worker_db: Ledger,
    migrated: PostgresServer,
    now: datetime,
    report: PlannerReport,
    statuses: list[str],
) -> None:
    """The schedule's time was changed, or its next run set by hand."""
    project = await make_tenant(migrated)
    schedule_id = await _due_schedule(migrated, project, next_run_at=LATEST - HOUR)

    assert await plan_due(worker_db, _registry(), now=now) == report

    runs = await _runs(migrated, schedule_id)
    assert [run["status"] for run in runs] == statuses
    assert {run["window_start"] for run in runs} <= {LATEST}
    following = (await _schedule(migrated, schedule_id))["next_run_at"]
    assert following == (LATEST if not statuses else LATEST + DAY)


async def test_a_workload_cannot_write_while_it_plans(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    """The session is the planner's, as the role that bypasses row-level security. What a
    workload wrote through it would commit with the run, in any workspace."""
    project = await make_tenant(migrated)
    victim = await make_tenant(migrated)
    target = await _due_schedule(migrated, victim, is_active=False)
    schedule_id = await _due_schedule(migrated, project)
    before = await _schedule(migrated, target)
    workload = FakeWorkload()
    workload.writes = "UPDATE ops.schedules SET next_run_at = next_run_at + interval '10 years'"

    report = await plan_due(worker_db, _registry(workload), now=NOW)

    assert report == PlannerReport(failed=1)
    assert await _schedule(migrated, target) == before
    assert await _runs(migrated, schedule_id) == []

    # A workload that only reads is planned, and the planner's own writes go through.
    workload.writes = "SELECT count(*) FROM ops.schedules"
    assert await plan_due(worker_db, _registry(workload), now=NOW) == PlannerReport(planned=1)


async def test_a_plan_that_names_a_task_twice_is_refused(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    """One of the two would be dropped, and the estimate would hold budget for both."""
    project = await make_tenant(migrated)
    schedule_id = await _due_schedule(migrated, project)
    workload = FakeWorkload()
    workload.repeats = True

    assert await plan_due(worker_db, _registry(workload), now=NOW) == PlannerReport(failed=1)
    assert await _runs(migrated, schedule_id) == []


async def test_schedules_that_fail_do_not_use_up_the_tick(
    worker_db: Ledger, migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A schedule that fails is found first on every tick. Counted against the tick's limit,
    a few of them would be all the planner ever looked at."""
    project = await make_tenant(migrated)
    for minutes in (3, 2):
        await _due_schedule(
            migrated, project, next_run_at=LATEST - DAY * minutes, timezone="Mars/Olympus"
        )
    fine = await _due_schedule(migrated, project)

    report = await plan_due(worker_db, _registry(), now=NOW, limit=1)

    assert report == PlannerReport(planned=1, failed=2)
    assert len(await _runs(migrated, fine)) == 1

    # There is an end to it all the same: a tick gives up on so many and no more.
    monkeypatch.setattr(planner, "FAILURES_MAX", 2)
    another = await _due_schedule(migrated, project)
    assert await plan_due(worker_db, _registry(), now=NOW) == PlannerReport(failed=2)
    assert await _runs(migrated, another) == []


async def test_a_tick_that_cannot_read_the_schedules_fails_as_a_whole(
    worker_db: Ledger, migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def unreachable(*arguments: object) -> None:
        raise ConnectionError("the database is gone")

    monkeypatch.setattr(planner, "_next_due", unreachable)

    with pytest.raises(ConnectionError):
        await plan_due(worker_db, _registry(), now=NOW)


async def test_a_run_that_takes_its_budget_past_the_soft_limit_is_planned_and_reported(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    stream = io.StringIO()
    configure_logging(service="worker", version="test", level="info", stream=stream)
    project = await make_tenant(migrated)
    budget_id = await make_budget(migrated, project, "3.50", soft_limit_pct=80)
    schedule_id = await _due_schedule(migrated, project)

    report = await plan_due(worker_db, _registry(FakeWorkload(subjects=3, price="1")), now=NOW)

    assert report == PlannerReport(planned=1)
    lines = [json.loads(line) for line in stream.getvalue().splitlines()]
    (warning,) = [line for line in lines if line["msg"] == "budget past its soft limit"]
    assert (warning["budget_ids"], warning["schedule_id"]) == ([str(budget_id)], str(schedule_id))
    (planned,) = [line for line in lines if line["msg"] == "run planned"]
    assert (planned["tasks"], planned["estimate"], planned["missed"]) == (3, "3", 0)
