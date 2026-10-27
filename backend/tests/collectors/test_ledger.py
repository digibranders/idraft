"""The task ledger (docs/21-scheduler-workers.md sections 1, 3.4, 4 and 6). As `app_worker`."""

import asyncio
import uuid
from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors import ledger
from idraft.collectors.ledger import Cost, LedgerTask, NoPartitionError, Scope, TaskRef
from idraft.domain.retries import ProviderErrorKind, RetryDecision, decide
from idraft.domain.tasks import partition_month
from idraft.domain.workloads import TaskWorkload
from tests.api.auth.support import execute, fetch
from tests.collectors.support import (
    NOW,
    Project,
    another_project,
    make_budget,
    make_schedule,
    make_tenant,
    new_run,
    new_task,
    run_row,
    seed_run,
    task_rows,
)
from tests.conftest import PostgresServer

Ledger = async_sessionmaker[AsyncSession]
MINUTE = timedelta(minutes=1)
PAID = Cost(usd=Decimal("0.0006"), source="provider_reported")


async def _claim(sessions: Ledger, *, now: datetime = NOW, **options: object) -> list[LedgerTask]:
    async with sessions() as db, db.begin():
        tasks = await ledger.claim_due(db, now=now, **options)  # type: ignore[arg-type]
        await ledger.mark_dispatched(db, [task.ref for task in tasks], now=now)
        return tasks


async def _in_flight(sessions: Ledger, pg: PostgresServer, count: int = 1) -> list[LedgerTask]:
    """Tasks taken for a provider call: dispatched, then `submit_unknown`."""
    project = await make_tenant(pg)
    await seed_run(sessions, project, count)
    claimed = await _claim(sessions)
    async with sessions() as db, db.begin():
        return await ledger.begin_submission(db, [task.ref for task in claimed], now=NOW)


async def _set_run(pg: PostgresServer, run_id: uuid.UUID, status: str) -> None:
    await execute(pg, "UPDATE ops.collection_runs SET status = $2 WHERE id = $1", run_id, status)


def _scope(project: Project, workload: TaskWorkload = TaskWorkload.SEO_RANK) -> Scope:
    return Scope(workspace_id=project.workspace_id, project_id=project.id, workload=workload)


# -------------------------------------------------------------------------------------------------
# Runs and tasks


async def test_a_schedule_has_one_run_per_window(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    schedule_id = await make_schedule(migrated, project)
    run = new_run(project, schedule_id=schedule_id)

    async with worker_db() as db, db.begin():
        first = await ledger.create_run(db, run, now=NOW)
        again = await ledger.create_run(db, run, now=NOW)
        next_window = await ledger.create_run(
            db,
            new_run(project, schedule_id=schedule_id, window_start=NOW + timedelta(days=1)),
            now=NOW,
        )

    assert first is not None
    assert again is None
    assert next_window not in (None, first)
    row = await run_row(migrated, first)
    assert (row["status"], row["trigger"], row["created_by_type"]) == (
        "planned",
        "schedule",
        "system",
    )
    assert (row["workspace_id"], row["project_id"]) == (project.workspace_id, project.id)
    assert row["window_end"] - row["window_start"] == timedelta(hours=6)
    assert row["completed_at"] is None


async def test_the_window_guard_holds_however_often_the_statement_has_run(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    """After a few executions on one connection PostgreSQL plans a statement once for all
    parameters. The guard must still be matched to its index then."""
    project = await make_tenant(migrated)
    schedule_id = await make_schedule(migrated, project)

    async with worker_db() as db, db.begin():
        made = [
            await ledger.create_run(
                db,
                new_run(project, schedule_id=schedule_id, window_start=NOW + day * MINUTE),
                now=NOW,
            )
            for day in (*range(12), 0)
        ]

    assert made[-1] is None
    assert len(set(made[:-1])) == 12


async def test_runs_without_a_schedule_do_not_stand_in_each_others_way(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    """A backfill of one day for two projects is two runs, and so is the same project asked
    twice: what makes a manual run happen once is the request, not its window."""
    first = await make_tenant(migrated)
    second = await make_tenant(migrated)

    async with worker_db() as db, db.begin():
        made = [
            await ledger.create_run(db, new_run(project), now=NOW)
            for project in (first, second, first)
        ]

    assert None not in made
    assert len(set(made)) == 3


async def test_a_run_names_a_schedule_when_and_only_when_the_schedule_triggered_it(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    """The window guard covers the runs a schedule triggered. A retry that named the schedule
    would either slip past the guard or be taken for the run it retries."""
    project = await make_tenant(migrated)
    schedule_id = await make_schedule(migrated, project)

    async with worker_db() as db, db.begin():
        with pytest.raises(ValueError, match="only when"):
            await ledger.create_run(
                db, new_run(project, schedule_id=schedule_id, trigger="retry"), now=NOW
            )
        with pytest.raises(ValueError, match="only when"):
            await ledger.create_run(db, new_run(project, trigger="schedule"), now=NOW)


async def test_a_window_that_was_missed_is_recorded_as_a_run_that_never_ran(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    schedule_id = await make_schedule(migrated, project)

    async with worker_db() as db, db.begin():
        run_id = await ledger.create_run(
            db,
            new_run(project, schedule_id=schedule_id),
            status="cancelled",
            status_reason="missed_window",
            now=NOW,
        )

    assert run_id is not None
    row = await run_row(migrated, run_id)
    assert (row["status"], row["status_reason"], row["completed_at"]) == (
        "cancelled",
        "missed_window",
        NOW,
    )


async def test_tasks_are_added_once_however_often_a_run_is_planned(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    tasks = [new_task(number) for number in range(3)]

    async with worker_db() as db, db.begin():
        run_id = await ledger.create_run(db, new_run(project), now=NOW)
        assert run_id is not None
        first = await ledger.insert_tasks(db, run_id, tasks)
        again = await ledger.insert_tasks(db, run_id, [*tasks, new_task(3)])
        # The same keyword to another depth is another task.
        deeper = await ledger.insert_tasks(db, run_id, [new_task(0, depth=100)])
        nothing = await ledger.insert_tasks(db, run_id, [])

    assert (first, again, deeper, nothing) == (3, 1, 1, 0)
    rows = await task_rows(migrated, run_id)
    assert len(rows) == 5
    assert {row["status"] for row in rows} == {"pending"}
    assert {row["created_at"] for row in rows} == {partition_month(NOW)}
    assert len({bytes(row["idempotency_key"]) for row in rows}) == 5
    assert {(row["location_id"], row["engine_code"], row["replicate_index"]) for row in rows} == {
        (2356, None, 1)
    }


async def test_a_task_takes_its_workspace_project_and_workload_from_its_runs_row(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    """The worker bypasses row-level security, so nothing a caller passes decides whose a
    task is. A run that does not exist gets no tasks at all."""
    project = await make_tenant(migrated)

    async with worker_db() as db, db.begin():
        run_id = await ledger.create_run(
            db, new_run(project, workload=TaskWorkload.AI_PROMPT), now=NOW
        )
        assert run_id is not None
        await ledger.insert_tasks(db, run_id, [new_task(0)])
        orphans = await ledger.insert_tasks(db, uuid.uuid4(), [new_task(1)])

    assert orphans == 0
    (row,) = await task_rows(migrated, run_id)
    assert (row["workspace_id"], row["project_id"], row["workload"]) == (
        project.workspace_id,
        project.id,
        "ai_prompt",
    )


async def test_a_run_gets_its_tasks_while_it_is_planned_and_not_after(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    """A task added to a run that is under way would be sent under an estimate that never
    counted it; added to one that has ended, it would never be sent and never counted."""
    project = await make_tenant(migrated)
    running = await seed_run(worker_db, project, 1)
    ended = await seed_run(worker_db, project, 1)
    await _set_run(migrated, ended, "completed")

    async with worker_db() as db, db.begin():
        added = [
            await ledger.insert_tasks(db, run_id, [new_task(7)]) for run_id in (running, ended)
        ]

    assert added == [0, 0]
    assert len(await task_rows(migrated, running)) == 1


async def test_the_month_of_a_task_is_the_utc_month_whatever_the_sessions_zone(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    # The last evening of last month in UTC, already this month in India.
    window_start = partition_month(NOW) - timedelta(hours=4)

    async with worker_db() as db, db.begin():
        await db.execute(text("SET LOCAL TIME ZONE 'Asia/Kolkata'"))
        run_id = await ledger.create_run(db, new_run(project, window_start=window_start), now=NOW)
        assert run_id is not None
        await ledger.insert_tasks(db, run_id, [new_task(0)])

    (row,) = await task_rows(migrated, run_id)
    assert row["created_at"] == partition_month(window_start)
    assert row["created_at"] < partition_month(NOW)


async def test_a_run_of_thousands_of_tasks_is_inserted(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    """A statement may carry 32,767 parameters. A batch is sent as one array per column, so
    its size does not come near that however many tasks it holds."""
    project = await make_tenant(migrated)
    count = ledger.INSERT_BATCH + 1

    async with worker_db() as db, db.begin():
        run_id = await ledger.create_run(db, new_run(project), now=NOW)
        assert run_id is not None
        added = await ledger.insert_tasks(db, run_id, [new_task(n) for n in range(count)])

    assert added == count
    (stored,) = await fetch(
        migrated, "SELECT count(*) AS tasks FROM ops.collection_tasks WHERE run_id = $1", run_id
    )
    assert stored["tasks"] == count


async def test_a_window_the_ledger_has_no_partition_for_is_refused_by_name(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    long_ago = NOW - timedelta(days=120)

    async with worker_db() as db:
        run_id = await ledger.create_run(db, new_run(project, window_start=long_ago), now=NOW)
        assert run_id is not None
        with pytest.raises(NoPartitionError, match="no partition"):
            await ledger.insert_tasks(db, run_id, [new_task(0)])


async def test_a_run_over_budget_is_recorded_and_not_started(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    budget_id = await make_budget(migrated, project, "1.00")
    async with worker_db() as db, db.begin():
        run_id = await ledger.create_run(db, new_run(project), now=NOW)
        assert run_id is not None
        await ledger.block_run(
            db, run_id, budget_id=budget_id, estimated_cost_usd=Decimal("2.5"), now=NOW
        )
        # A blocked run is not started afterwards by a second planner.
        await ledger.start_run(db, run_id, tasks_total=9, estimated_cost_usd=Decimal("2.5"))

    row = await run_row(migrated, run_id)
    assert (row["status"], row["status_reason"], row["blocked_by_budget_id"]) == (
        "budget_blocked",
        "budget_exceeded",
        budget_id,
    )
    assert (row["estimated_cost_usd"], row["tasks_total"], row["completed_at"]) == (
        Decimal("2.5000"),
        0,
        NOW,
    )


async def test_a_run_never_names_another_workspaces_budget(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    foreign = await make_budget(migrated, await make_tenant(migrated), "1.00")
    running = await seed_run(worker_db, project, 1)

    async with worker_db() as db, db.begin():
        blocked = await ledger.create_run(db, new_run(project), now=NOW)
        assert blocked is not None
        await ledger.block_run(
            db, blocked, budget_id=foreign, estimated_cost_usd=Decimal("1"), now=NOW
        )
        await ledger.sync_budget_holds(db, {_scope(project): foreign})

    assert (await run_row(migrated, blocked))["blocked_by_budget_id"] is None
    held = await run_row(migrated, running)
    assert (held["status_reason"], held["blocked_by_budget_id"]) == ("budget_exceeded", None)


async def test_a_running_run_says_which_budget_holds_it_back_for_as_long_as_it_does(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    other = await another_project(migrated, project)
    budget_id = await make_budget(migrated, project, "1.00")
    held = await seed_run(worker_db, project, 2)
    prompts = await seed_run(worker_db, project, 1, workload=TaskWorkload.AI_PROMPT)
    elsewhere = await seed_run(worker_db, other, 1)
    async with worker_db() as db, db.begin():
        blocked = await ledger.create_run(db, new_run(project), now=NOW)
        assert blocked is not None
        await ledger.block_run(
            db, blocked, budget_id=budget_id, estimated_cost_usd=Decimal("5"), now=NOW
        )
        await ledger.sync_budget_holds(db, {_scope(project): budget_id})
    version = "SELECT xmin::text AS version FROM ops.collection_runs WHERE id = $1"
    before = await fetch(migrated, version, held)
    async with worker_db() as db, db.begin():
        await ledger.sync_budget_holds(db, {_scope(project): budget_id})
    # A second tick with the same holds does not write the row again.
    assert await fetch(migrated, version, held) == before

    row = await run_row(migrated, held)
    assert (row["status"], row["status_reason"], row["blocked_by_budget_id"]) == (
        "running",
        "budget_exceeded",
        budget_id,
    )
    # The tasks wait; nothing about them changes.
    assert {task["status"] for task in await task_rows(migrated, held)} == {"pending"}
    # Only the scope that is held: not the project's other workload, not another project.
    for untouched in (prompts, elsewhere):
        assert (await run_row(migrated, untouched))["status_reason"] is None
    # A run that has already ended is left as it ended.
    assert (await run_row(migrated, blocked))["status"] == "budget_blocked"

    async with worker_db() as db, db.begin():
        await ledger.sync_budget_holds(db, {_scope(other): budget_id})

    # The hold moved on: the first run no longer says it is held.
    row = await run_row(migrated, held)
    assert (row["status_reason"], row["blocked_by_budget_id"]) == (None, None)
    assert (await run_row(migrated, elsewhere))["status_reason"] == "budget_exceeded"
    async with worker_db() as db, db.begin():
        await ledger.sync_budget_holds(db, {})
    assert (await run_row(migrated, elsewhere))["status_reason"] is None
    assert (await run_row(migrated, blocked))["status_reason"] == "budget_exceeded"


# -------------------------------------------------------------------------------------------------
# Claiming


async def test_only_tasks_that_are_due_are_claimed_oldest_first(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    async with worker_db() as db, db.begin():
        run_id = await ledger.create_run(db, new_run(project), now=NOW)
        assert run_id is not None
        await ledger.insert_tasks(
            db,
            run_id,
            [
                new_task(1, scheduled_for=NOW - 5 * MINUTE),
                new_task(2, scheduled_for=NOW - 10 * MINUTE),
                new_task(3, scheduled_for=NOW),
                new_task(4, scheduled_for=NOW + MINUTE),
                new_task(5, scheduled_for=NOW - MINUTE),
                new_task(6, scheduled_for=NOW - MINUTE),
                new_task(7, scheduled_for=NOW - 20 * MINUTE),
            ],
        )
        await ledger.start_run(db, run_id, tasks_total=7, estimated_cost_usd=Decimal("0"))
    # One is waiting for its retry delay, one has waited it out, one is no longer pending.
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET next_attempt_at = $1 WHERE subject_id = 'keyword-5'",
        NOW + 2 * MINUTE,
    )
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET next_attempt_at = $1 WHERE subject_id = 'keyword-7'",
        NOW - MINUTE,
    )
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET status = 'submitted' WHERE subject_id = 'keyword-6'",
    )

    claimed = await _claim(worker_db)

    assert [task.subject_id for task in claimed] == [
        "keyword-7",
        "keyword-2",
        "keyword-1",
        "keyword-3",
    ]
    assert {task.status for task in claimed} == {"pending"}
    # Dispatched tasks are not claimed a second time.
    assert await _claim(worker_db) == []
    rows = {row["subject_id"]: row for row in await task_rows(migrated, run_id)}
    assert rows["keyword-2"]["dispatched_at"] == NOW
    assert rows["keyword-4"]["dispatched_at"] is None

    # Later, the task scheduled for then is due, and then the one whose delay has passed.
    assert [task.subject_id for task in await _claim(worker_db, now=NOW + MINUTE)] == ["keyword-4"]
    assert [task.subject_id for task in await _claim(worker_db, now=NOW + 2 * MINUTE)] == [
        "keyword-5"
    ]


async def test_a_task_has_the_priority_of_its_schedule_or_of_what_asked_for_its_run(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    low = await make_schedule(migrated, project, priority="low")
    standard = await make_schedule(migrated, project)
    runs = {
        "low": await seed_run(worker_db, project, 1, schedule_id=low),
        "standard": await seed_run(worker_db, project, 1, schedule_id=standard),
        # Someone asked for it and is waiting.
        "high": await seed_run(worker_db, project, 1, trigger="manual"),
    }
    backfill = await seed_run(worker_db, project, 1, trigger="backfill")
    retry = await seed_run(worker_db, project, 1, trigger="retry")

    claimed = {task.run_id: task for task in await _claim(worker_db)}

    assert {name: claimed[run_id].priority for name, run_id in runs.items()} == {
        "low": "low",
        "standard": "standard",
        "high": "high",
    }
    # Nobody waits for a backfill, and a retry is ordinary work.
    assert (claimed[backfill].priority, claimed[retry].priority) == ("low", "standard")
    assert {task.window_end for task in claimed.values()} == {NOW + timedelta(hours=6)}


async def test_a_large_project_cannot_take_a_whole_tick_from_a_small_one(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    large = await make_tenant(migrated)
    small = await make_tenant(migrated)
    tiny = await make_tenant(migrated)
    await seed_run(worker_db, large, 60, scheduled_for=NOW - 10 * MINUTE)
    await seed_run(worker_db, small, 8, scheduled_for=NOW - MINUTE)
    await seed_run(worker_db, tiny, 2, scheduled_for=NOW)

    # The cap per project alone would let the large project, whose tasks are the oldest, take
    # all 30.
    claimed = await _claim(worker_db, limit=30, per_project=30)

    by_project = {
        project.id: sum(task.project_id == project.id for task in claimed)
        for project in (large, small, tiny)
    }
    # An equal share each (10), then what is left over (10) to the project with more to do.
    assert by_project == {large.id: 20, small.id: 8, tiny.id: 2}
    assert len({task.ref for task in claimed}) == 30

    # The cap per project holds when there is room for more.
    later = await _claim(worker_db, limit=30, per_project=25)
    assert len(later) == 25
    assert {task.project_id for task in later} == {large.id}


async def test_more_projects_than_a_tick_takes_each_wait_their_turn(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    projects = [await make_tenant(migrated) for _ in range(5)]
    for age, project in enumerate(projects):
        await seed_run(worker_db, project, 2, scheduled_for=NOW - age * MINUTE)

    claimed = await _claim(worker_db, limit=3)

    # One each for the three projects that have waited longest, and no more than the limit.
    assert len(claimed) == 3
    assert {task.project_id for task in claimed} == {project.id for project in projects[-3:]}


async def test_a_dispatcher_does_not_wait_for_tasks_another_one_holds(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    await seed_run(worker_db, project, 40)
    holding = asyncio.Event()
    let_go = asyncio.Event()

    async def first_dispatcher() -> list[LedgerTask]:
        async with worker_db() as db, db.begin():
            tasks = await ledger.claim_due(db, now=NOW, limit=25)
            holding.set()
            # The rows stay locked, as they do while a real tick enqueues.
            await let_go.wait()
            await ledger.mark_dispatched(db, [task.ref for task in tasks], now=NOW)
            return tasks

    holder = asyncio.create_task(first_dispatcher())
    await holding.wait()
    try:
        # The second one comes back while the first still holds its rows, with the others.
        second = await asyncio.wait_for(_claim(worker_db, limit=25), timeout=10)
    finally:
        let_go.set()
    first = await holder

    assert (len(first), len(second)) == (25, 15)
    assert not {task.ref for task in first} & {task.ref for task in second}
    assert await _claim(worker_db) == []


async def test_tasks_of_a_paused_provider_wait(worker_db: Ledger, migrated: PostgresServer) -> None:
    project = await make_tenant(migrated)
    await seed_run(worker_db, project, 2, provider="dataforseo")
    await seed_run(worker_db, project, 3, provider="other")

    async with worker_db() as db:
        scopes = await ledger.due_scopes(db, now=NOW)
    claimed = await _claim(worker_db, paused_providers=["dataforseo"])

    # A budget is checked for the scope whether or not its provider is out.
    assert scopes == [_scope(project)]
    assert {task.provider_code for task in claimed} == {"other"}
    assert len(claimed) == 3
    assert len(await _claim(worker_db)) == 2


async def test_work_a_budget_holds_back_is_left_alone_and_takes_nobodys_share(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    """The held tasks are the oldest. Claimed and dropped every tick, they would keep the
    project's other work from ever being reached."""
    project = await make_tenant(migrated)
    other = await make_tenant(migrated)
    await seed_run(worker_db, project, 6, scheduled_for=NOW - 10 * MINUTE)
    await seed_run(worker_db, project, 3, workload=TaskWorkload.AI_PROMPT)
    await seed_run(worker_db, other, 2, scheduled_for=NOW + MINUTE)
    ranks = _scope(project)
    prompts = _scope(project, TaskWorkload.AI_PROMPT)

    async with worker_db() as db:
        scopes = await ledger.due_scopes(db, now=NOW)
    claimed = await _claim(worker_db, held=[ranks], limit=4, per_project=4)

    # What is due now, held or not: the dispatcher checks the budget of each.
    assert sorted(scopes, key=lambda scope: scope.workload) == [prompts, ranks]
    assert {task.workload for task in claimed} == {TaskWorkload.AI_PROMPT}
    assert len(claimed) == 3
    # Once the hold is gone the tasks are there, untouched.
    assert len(await _claim(worker_db)) == 6


async def test_thousands_of_held_scopes_cost_the_claim_nothing(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    """One agency workspace out of budget is a held scope per project and workload. Written
    into the statement as a list, a few thousand of them took PostgreSQL longer to plan than
    a statement is allowed to run; they are sent as arrays."""
    project = await make_tenant(migrated)
    held_run = await seed_run(worker_db, project, 2)
    await seed_run(worker_db, project, 1, workload=TaskWorkload.AI_PROMPT)
    elsewhere = [
        Scope(workspace_id=uuid.uuid4(), project_id=uuid.uuid4(), workload=TaskWorkload.SEO_RANK)
        for _ in range(5000)
    ]
    holds = dict.fromkeys([*elsewhere, _scope(project)], uuid.uuid4())

    async with worker_db() as db, db.begin():
        await asyncio.wait_for(ledger.sync_budget_holds(db, holds), timeout=5)
    claimed = await asyncio.wait_for(_claim(worker_db, held=list(holds)), timeout=5)

    assert [task.workload for task in claimed] == [TaskWorkload.AI_PROMPT]
    assert (await run_row(migrated, held_run))["status_reason"] == "budget_exceeded"


async def test_the_leftover_is_shared_without_waiting_for_another_dispatcher(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    """The second statement of a claim, the one that hands out the leftover, skips the rows
    another dispatcher holds just as the first does."""
    large = await make_tenant(migrated)
    small = await make_tenant(migrated)
    await seed_run(worker_db, large, 30, scheduled_for=NOW - MINUTE)
    await seed_run(worker_db, small, 2)
    holding = asyncio.Event()
    let_go = asyncio.Event()

    async def first_dispatcher() -> list[LedgerTask]:
        async with worker_db() as db, db.begin():
            # A share of 5 each, then 3 more for the large project.
            tasks = await ledger.claim_due(db, now=NOW, limit=10, per_project=8)
            holding.set()
            await let_go.wait()
            return tasks

    holder = asyncio.create_task(first_dispatcher())
    await holding.wait()
    try:
        second = await asyncio.wait_for(_claim(worker_db, limit=10, per_project=8), timeout=10)
    finally:
        let_go.set()
    first = await holder

    by_project = [sum(task.project_id == large.id for task in tasks) for tasks in (first, second)]
    assert ([len(first), len(second)], by_project) == ([10, 8], [8, 8])
    assert not {task.ref for task in first} & {task.ref for task in second}


async def test_a_run_that_is_no_longer_running_sends_nothing_more(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    cancelled = await seed_run(worker_db, project, 3)
    (in_queue,) = await _claim(worker_db, limit=1)
    await _set_run(migrated, cancelled, "cancelled")

    async with worker_db() as db, db.begin():
        scopes = await ledger.due_scopes(db, now=NOW)
        # The message of the task that was already in the queue arrives.
        taken = await ledger.begin_submission(db, [in_queue.ref], now=NOW)
    claimed = await _claim(worker_db)

    assert (scopes, taken, claimed) == ([], [], [])
    assert {row["status"] for row in await task_rows(migrated, cancelled)} == {"pending"}


async def test_a_released_task_is_due_again(worker_db: Ledger, migrated: PostgresServer) -> None:
    project = await make_tenant(migrated)
    await seed_run(worker_db, project, 2)
    claimed = await _claim(worker_db)

    async with worker_db() as db, db.begin():
        await ledger.release(db, [claimed[0].ref])
        await ledger.release(db, [])
        await ledger.mark_dispatched(db, [], now=NOW)

    assert [task.ref for task in await _claim(worker_db)] == [claimed[0].ref]


async def test_a_time_without_a_zone_is_refused(worker_db: Ledger) -> None:
    async with worker_db() as db:
        with pytest.raises(ValueError, match="aware"):
            await ledger.claim_due(db, now=NOW.replace(tzinfo=None))


# -------------------------------------------------------------------------------------------------
# Submission


async def test_a_task_leaves_pending_before_the_provider_is_called(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    run_id = await seed_run(worker_db, project, 3)
    claimed = await _claim(worker_db)
    refs = [task.ref for task in claimed]

    async with worker_db() as db, db.begin():
        taken = await ledger.begin_submission(db, refs, now=NOW)
    async with worker_db() as db, db.begin():
        # The same message delivered a second time takes nothing.
        again = await ledger.begin_submission(db, refs, now=NOW)
        nothing = await ledger.begin_submission(db, [], now=NOW)

    assert sorted(task.ref.id for task in taken) == sorted(ref.id for ref in refs)
    assert (again, nothing) == ([], [])
    rows = await task_rows(migrated, run_id)
    assert {(row["status"], row["attempts"], row["submitted_at"]) for row in rows} == {
        ("submit_unknown", 1, NOW)
    }


async def test_a_task_that_was_not_dispatched_is_not_taken(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    """A message that names a task the reconciler has since released: the task is someone
    else's now."""
    project = await make_tenant(migrated)
    await seed_run(worker_db, project, 1)
    (task,) = await _claim(worker_db)
    async with worker_db() as db, db.begin():
        await ledger.release(db, [task.ref])

    async with worker_db() as db, db.begin():
        assert await ledger.begin_submission(db, [task.ref], now=NOW) == []


async def test_an_accepted_task_is_submitted_and_its_cost_recorded_once(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    (task,) = await _in_flight(worker_db, migrated)

    async with worker_db() as db, db.begin():
        first = await ledger.mark_submitted(
            db, task.ref, provider_task_id="09301200-1234", cost=PAID, now=NOW
        )
        # The same answer handled a second time: nothing changes and nothing is charged.
        again = await ledger.mark_submitted(
            db,
            task.ref,
            provider_task_id="another",
            cost=Cost(usd=Decimal("9"), source="price_book_estimate"),
            now=NOW,
        )

    assert (first, again) == (True, False)
    (row,) = await task_rows(migrated, task.run_id)
    assert (row["status"], row["provider_task_id"], row["cost_usd"]) == (
        "submitted",
        "09301200-1234",
        Decimal("0.000600"),
    )
    assert (row["dispatched_at"], row["submitted_at"], row["last_error_code"]) == (None, NOW, None)
    (event,) = await fetch(
        migrated, "SELECT * FROM ops.provider_cost_events WHERE run_id = $1", task.run_id
    )
    assert (event["workspace_id"], event["project_id"], event["task_id"]) == (
        task.workspace_id,
        task.project_id,
        task.ref.id,
    )
    assert (event["workload"], event["channel"], event["cost_usd"], event["cost_source"]) == (
        "seo_rank",
        "seo",
        Decimal("0.000600"),
        "provider_reported",
    )
    assert (event["provider_code"], event["endpoint"], event["subject_id"]) == (
        "fake",
        "serp",
        "keyword-0",
    )
    assert event["billing_period"] == NOW.date().replace(day=1)


async def test_a_task_sent_again_has_cost_what_both_submissions_cost(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    """A result that expired at the provider is asked for again, and paid for again."""
    (task,) = await _in_flight(worker_db, migrated)
    async with worker_db() as db, db.begin():
        await ledger.mark_submitted(db, task.ref, provider_task_id="first", cost=PAID, now=NOW)
    # Back in a provider call, as after the retry policy sent it again.
    await execute(migrated, "UPDATE ops.collection_tasks SET status = 'submit_unknown'")

    async with worker_db() as db, db.begin():
        assert await ledger.mark_submitted(
            db, task.ref, provider_task_id="second", cost=PAID, now=NOW
        )

    (row,) = await task_rows(migrated, task.run_id)
    assert (row["provider_task_id"], row["cost_usd"]) == ("second", Decimal("0.001200"))
    events = await fetch(migrated, "SELECT cost_usd FROM ops.provider_cost_events")
    assert [event["cost_usd"] for event in events] == [Decimal("0.000600")] * 2


async def test_a_submission_whose_cost_is_not_known_yet_records_no_cost(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    (task,) = await _in_flight(worker_db, migrated)

    async with worker_db() as db, db.begin():
        assert await ledger.mark_submitted(db, task.ref, provider_task_id="p", cost=None, now=NOW)

    (row,) = await task_rows(migrated, task.run_id)
    assert (row["status"], row["cost_usd"]) == ("submitted", None)
    assert await fetch(migrated, "SELECT 1 FROM ops.provider_cost_events") == []


@pytest.mark.parametrize(
    ("kind", "status", "delay", "attempts"),
    [
        (ProviderErrorKind.RATE_LIMITED, "pending", timedelta(seconds=30), 1),
        (ProviderErrorKind.PROVIDER_ERROR, "pending", timedelta(seconds=60), 1),
        (ProviderErrorKind.INVALID_REQUEST, "failed", None, 1),
        # The provider refuses everyone: the task waits, and this was not an attempt at it.
        (ProviderErrorKind.PAYMENT, "pending", None, 0),
    ],
)
async def test_a_refused_task_follows_the_retry_policy(
    worker_db: Ledger,
    migrated: PostgresServer,
    kind: ProviderErrorKind,
    status: str,
    delay: timedelta | None,
    attempts: int,
) -> None:
    (task,) = await _in_flight(worker_db, migrated)
    decision = decide(kind, attempts=task.attempts, jitter=0.0)

    async with worker_db() as db, db.begin():
        recorded = await ledger.record_failure(
            db, task.ref, kind=kind, message="x" * 900, decision=decision, now=NOW
        )

    assert recorded
    (row,) = await task_rows(migrated, task.run_id)
    assert (row["status"], row["attempts"], row["last_error_code"]) == (
        status,
        attempts,
        kind.value,
    )
    assert row["next_attempt_at"] == (None if delay is None else NOW + delay)
    assert (row["dispatched_at"], row["submitted_at"]) == (None, None)
    assert row["completed_at"] == (NOW if status == "failed" else None)
    assert len(row["last_error_message"]) == 500


async def test_a_call_that_timed_out_is_never_recorded_as_a_refusal(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    """The retry policy would send the task again, and the provider may already have it."""
    (task,) = await _in_flight(worker_db, migrated)
    retry = decide(ProviderErrorKind.TIMEOUT, attempts=1, jitter=0.0)
    assert retry.status == "pending"

    async with worker_db() as db, db.begin():
        with pytest.raises(ValueError, match="outcome is unknown"):
            await ledger.record_failure(
                db,
                task.ref,
                kind=ProviderErrorKind.TIMEOUT,
                message="read timed out",
                decision=retry,
                now=NOW,
            )

    (row,) = await task_rows(migrated, task.run_id)
    assert row["status"] == "submit_unknown"


async def test_a_task_waits_out_each_delay_and_is_tried_until_the_policy_gives_up(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    run_id = await seed_run(worker_db, project, 1)
    when = NOW
    seen = []
    for _ in range(4):
        (claimed,) = await _claim(worker_db, now=when)
        async with worker_db() as db, db.begin():
            (task,) = await ledger.begin_submission(db, [claimed.ref], now=when)
            decision = decide(ProviderErrorKind.PROVIDER_ERROR, attempts=task.attempts, jitter=0.0)
            await ledger.record_failure(
                db,
                task.ref,
                kind=ProviderErrorKind.PROVIDER_ERROR,
                message="502",
                decision=decision,
                now=when,
            )
        (row,) = await task_rows(migrated, run_id)
        seen.append((row["status"], row["attempts"], decision.delay))
        if decision.delay is not None:
            # A second before the delay is over the task is not offered; at its end it is.
            before = when + decision.delay - timedelta(seconds=1)
            assert await _claim(worker_db, now=before) == []
            when += decision.delay

    assert seen == [
        ("pending", 1, timedelta(seconds=60)),
        ("pending", 2, timedelta(seconds=120)),
        ("pending", 3, timedelta(seconds=240)),
        ("dead", 4, None),
    ]
    assert await _claim(worker_db, now=when + timedelta(days=1)) == []


async def test_a_step_is_refused_from_a_status_it_does_not_follow(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    run_id = await seed_run(worker_db, project, 1)
    (pending,) = await _claim(worker_db)
    retry = RetryDecision(status="pending")

    async with worker_db() as db, db.begin():
        # Still pending: no provider call was begun.
        submitted = await ledger.mark_submitted(
            db, pending.ref, provider_task_id="x", cost=PAID, now=NOW
        )
        failed = await ledger.record_failure(
            db,
            pending.ref,
            kind=ProviderErrorKind.PROVIDER_ERROR,
            message="m",
            decision=retry,
            now=NOW,
        )
        unknown = TaskRef(id=pending.ref.id + 10_000, created_at=pending.ref.created_at)
        missing = await ledger.mark_submitted(db, unknown, provider_task_id="x", cost=PAID, now=NOW)

    assert (submitted, failed, missing) == (False, False, False)
    (row,) = await task_rows(migrated, run_id)
    assert (row["status"], row["attempts"], row["provider_task_id"]) == ("pending", 0, None)
    assert await fetch(migrated, "SELECT 1 FROM ops.provider_cost_events") == []


async def test_a_lost_answer_leaves_the_task_unknown_and_says_why(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    (task,) = await _in_flight(worker_db, migrated)

    async with worker_db() as db, db.begin():
        await ledger.note_unknown_outcome(db, [task.ref], "no answer within 30 s")
        await ledger.note_unknown_outcome(db, [], "nothing")

    (row,) = await task_rows(migrated, task.run_id)
    assert (row["status"], row["last_error_code"], row["last_error_message"]) == (
        "submit_unknown",
        "timeout",
        "no answer within 30 s",
    )
    # Never offered to the dispatcher again: the provider may have it.
    assert await _claim(worker_db, now=NOW + timedelta(days=2)) == []
    # Its run stays open until the provider's results would have expired.
    async with worker_db() as db, db.begin():
        assert await ledger.complete_finished_runs(db, now=NOW) == 0


# -------------------------------------------------------------------------------------------------
# Completion


@pytest.mark.parametrize(
    ("dead", "cancelled", "status"),
    [
        (0, 0, "completed"),
        (1, 0, "completed"),
        (2, 0, "completed_with_errors"),
        # A task that was cancelled collected nothing either.
        (1, 1, "completed_with_errors"),
        (0, 100, "completed_with_errors"),
    ],
)
async def test_a_run_completes_when_every_task_has_ended(
    worker_db: Ledger, migrated: PostgresServer, dead: int, cancelled: int, status: str
) -> None:
    project = await make_tenant(migrated)
    budget_id = await make_budget(migrated, project, "1.00")
    run_id = await seed_run(worker_db, project, 100)
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET cost_usd = 0.01, status = CASE subject_id "
        "WHEN 'keyword-99' THEN 'skipped_cached' ELSE 'ingested' END WHERE run_id = $1",
        run_id,
    )
    for ended, numbers in (("dead", range(dead)), ("cancelled", range(dead, dead + cancelled))):
        await execute(
            migrated,
            "UPDATE ops.collection_tasks SET status = $3 "
            "WHERE run_id = $1 AND subject_id = ANY($2)",
            run_id,
            [f"keyword-{number}" for number in numbers],
            ended,
        )

    async with worker_db() as db, db.begin():
        # It was held back by a budget for a while; a finished run no longer says so.
        await ledger.sync_budget_holds(db, {_scope(project): budget_id})
        closed = await ledger.complete_finished_runs(db, now=NOW)
        again = await ledger.complete_finished_runs(db, now=NOW)

    assert (closed, again) == (1, 0)
    row = await run_row(migrated, run_id)
    # Under 2% with nothing collected is a completed run; 2% and over completed with errors.
    assert (row["status"], row["tasks_failed"], row["tasks_succeeded"]) == (
        status,
        dead + cancelled,
        100 - dead - cancelled,
    )
    assert (row["actual_cost_usd"], row["completed_at"]) == (Decimal("1.0000"), NOW)
    assert (row["status_reason"], row["blocked_by_budget_id"]) == (None, None)


async def test_a_run_with_a_task_still_open_stays_running(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    run_id = await seed_run(worker_db, project, 3)
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET status = 'ingested' WHERE run_id = $1 "
        "AND subject_id <> 'keyword-0'",
        run_id,
    )
    planned = None
    async with worker_db() as db, db.begin():
        planned = await ledger.create_run(db, new_run(project), now=NOW)
        assert planned is not None
        assert await ledger.complete_finished_runs(db, now=NOW) == 0

    assert (await run_row(migrated, run_id))["status"] == "running"
    # A run still being planned is not the sweep's business.
    assert (await run_row(migrated, planned))["status"] == "planned"


async def test_a_run_that_selected_nothing_completes(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    """A schedule whose selector matches no keyword makes a run with no tasks. It has nothing
    still open, so it is closed and not left running for ever."""
    empty = await seed_run(worker_db, await make_tenant(migrated), 0)

    async with worker_db() as db, db.begin():
        assert await ledger.complete_finished_runs(db, now=NOW) == 1

    row = await run_row(migrated, empty)
    assert (row["status"], row["tasks_succeeded"], row["tasks_failed"]) == ("completed", 0, 0)
    assert (row["actual_cost_usd"], row["completed_at"]) == (Decimal("0.0000"), NOW)


# -------------------------------------------------------------------------------------------------
# Reconciliation


async def test_tasks_dispatched_long_ago_are_offered_for_release(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    run_id = await seed_run(worker_db, project, 3)
    await _claim(worker_db)
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET dispatched_at = $1 WHERE subject_id = 'keyword-0'",
        NOW - 11 * MINUTE,
    )
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET dispatched_at = $1 WHERE subject_id = 'keyword-1'",
        NOW - 9 * MINUTE,
    )

    async with worker_db() as db, db.begin():
        stale = await ledger.stale_dispatches(db, older_than=10 * MINUTE, now=NOW)
        # A second reconciler does not wait for the rows this one holds; it finds none.
        async with worker_db() as other, other.begin():
            assert (
                await asyncio.wait_for(
                    ledger.stale_dispatches(other, older_than=10 * MINUTE, now=NOW), timeout=10
                )
                == []
            )
    # Finding them changes nothing.
    rows = {row["subject_id"]: row["dispatched_at"] for row in await task_rows(migrated, run_id)}
    assert rows["keyword-0"] is not None

    async with worker_db() as db, db.begin():
        await ledger.release(db, [task.ref for task in stale])

    assert [task.subject_id for task in stale] == ["keyword-0"]
    rows = {row["subject_id"]: row["dispatched_at"] for row in await task_rows(migrated, run_id)}
    assert rows["keyword-0"] is None
    assert rows["keyword-1"] is not None


async def test_a_submission_the_provider_never_answered_is_dead(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    run_id = await seed_run(worker_db, project, 4)
    slow = await seed_run(worker_db, project, 1, endpoint="llm")
    ages = {"keyword-0": 73, "keyword-1": 71, "keyword-2": 73, "keyword-3": 71}
    for subject, hours in ages.items():
        await execute(
            migrated,
            "UPDATE ops.collection_tasks SET submitted_at = $3, status = CASE "
            "WHEN subject_id IN ('keyword-2', 'keyword-3') THEN 'submit_unknown' "
            "ELSE 'submitted' END WHERE run_id = $1 AND subject_id = $2",
            run_id,
            subject,
            NOW - timedelta(hours=hours),
        )
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET status = 'submitted', submitted_at = $2 WHERE run_id = $1",
        slow,
        NOW - timedelta(hours=73),
    )

    async with worker_db() as db, db.begin():
        ended = await ledger.end_old_submissions(
            db,
            older_than=timedelta(hours=72),
            # This endpoint keeps its results longer.
            lifetimes={("fake", "llm"): timedelta(hours=76)},
            now=NOW,
        )

    assert ended == 2
    rows = {row["subject_id"]: row for row in await task_rows(migrated, run_id)}
    assert {subject: (row["status"], row["last_error_code"]) for subject, row in rows.items()} == {
        "keyword-0": ("dead", "provider_never_answered"),
        "keyword-1": ("submitted", None),
        # Whether the provider ever had it was never found out.
        "keyword-2": ("dead", "submission_never_confirmed"),
        "keyword-3": ("submit_unknown", None),
    }
    assert rows["keyword-0"]["completed_at"] == NOW
    assert {row["status"] for row in await task_rows(migrated, slow)} == {"submitted"}

    async with worker_db() as db, db.begin():
        later = await ledger.end_old_submissions(
            db, older_than=timedelta(hours=72), now=NOW + timedelta(hours=2)
        )
    # Without the longer lifetime the slow endpoint's task ends with the other two.
    assert later == 3


async def test_a_task_never_sent_a_day_after_its_window_is_cancelled(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    old = await seed_run(worker_db, project, 3, window_start=NOW - timedelta(hours=31))
    recent = await seed_run(worker_db, project, 1, window_start=NOW - timedelta(hours=29))
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET status = 'submitted', provider_task_id = 'p1' "
        "WHERE run_id = $1 AND subject_id = 'keyword-1'",
        old,
    )
    # Back in line after its result expired at the provider: it keeps the old provider id.
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET provider_task_id = 'expired', next_attempt_at = $2 "
        "WHERE run_id = $1 AND subject_id = 'keyword-2'",
        old,
        NOW + MINUTE,
    )

    async with worker_db() as db, db.begin():
        cancelled = await ledger.cancel_missed(db, after_window=timedelta(hours=24), now=NOW)

    # The window was 6 hours: the old run's closed 25 hours ago, the recent one's 23.
    assert cancelled == 2
    rows = {row["subject_id"]: row for row in await task_rows(migrated, old)}
    for subject in ("keyword-0", "keyword-2"):
        assert (rows[subject]["status"], rows[subject]["last_error_code"]) == (
            "cancelled",
            "window_missed",
        )
        assert (rows[subject]["completed_at"], rows[subject]["next_attempt_at"]) == (NOW, None)
    assert rows["keyword-0"]["last_error_message"] == (
        "Not sent within 24 hours of the end of its run's window."
    )
    assert rows["keyword-1"]["status"] == "submitted"
    assert {row["status"] for row in await task_rows(migrated, recent)} == {"pending"}


async def test_the_unsent_tasks_of_a_cancelled_run_are_cancelled_with_it(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    cancelled = await seed_run(worker_db, project, 3)
    running = await seed_run(worker_db, project, 1)
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET status = 'submitted' "
        "WHERE run_id = $1 AND subject_id = 'keyword-0'",
        cancelled,
    )
    await _set_run(migrated, cancelled, "cancelled")
    async with worker_db() as db, db.begin():
        planned = await ledger.create_run(db, new_run(project), now=NOW)
        assert planned is not None
        await ledger.insert_tasks(db, planned, [new_task(0)])

        ended = await ledger.cancel_for_ended_runs(db, now=NOW)

    assert ended == 2
    rows = {row["subject_id"]: row for row in await task_rows(migrated, cancelled)}
    # What the provider already has is still fetched and paid for.
    assert rows["keyword-0"]["status"] == "submitted"
    assert (rows["keyword-1"]["status"], rows["keyword-1"]["last_error_code"]) == (
        "cancelled",
        "run_ended",
    )
    # A run that is running, or still being planned, keeps its tasks.
    for kept in (running, planned):
        assert {row["status"] for row in await task_rows(migrated, kept)} == {"pending"}
