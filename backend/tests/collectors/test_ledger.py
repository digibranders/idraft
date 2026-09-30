"""The task ledger (docs/21-scheduler-workers.md sections 1, 3.4, 4 and 6). As `app_worker`."""

import asyncio
from datetime import timedelta
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors import ledger
from sightline.collectors.ledger import LedgerTask, TaskRef
from sightline.domain.retries import ProviderErrorKind, RetryDecision, decide
from sightline.domain.tasks import partition_month
from tests.api.auth.support import execute, fetch
from tests.collectors.support import (
    NOW,
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


async def _claim(sessions: Ledger, **options: object) -> list[LedgerTask]:
    async with sessions() as db, db.begin():
        tasks = await ledger.claim_due(db, now=NOW, **options)  # type: ignore[arg-type]
        await ledger.mark_dispatched(db, [task.ref for task in tasks], now=NOW)
        return tasks


async def _in_flight(sessions: Ledger, pg: PostgresServer, count: int = 1) -> list[LedgerTask]:
    """Tasks taken for a provider call: dispatched, then `submit_unknown`."""
    project = await make_tenant(pg)
    await seed_run(sessions, project, count)
    claimed = await _claim(sessions)
    async with sessions() as db, db.begin():
        return await ledger.begin_submission(db, [task.ref for task in claimed], now=NOW)


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


async def test_tasks_are_added_once_however_often_a_run_is_planned(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    run = new_run(project)
    tasks = [new_task(number) for number in range(3)]

    async with worker_db() as db, db.begin():
        run_id = await ledger.create_run(db, run, now=NOW)
        assert run_id is not None
        first = await ledger.insert_tasks(db, run_id, run, tasks)
        again = await ledger.insert_tasks(db, run_id, run, [*tasks, new_task(3)])
        # The same keyword to another depth is another task.
        deeper = await ledger.insert_tasks(db, run_id, run, [new_task(0, depth=100)])

    assert (first, again, deeper) == (3, 1, 1)
    rows = await task_rows(migrated, run_id)
    assert len(rows) == 5
    assert {row["status"] for row in rows} == {"pending"}
    # Every row carries the run's workspace and project, and sits in the window's month.
    assert {(row["workspace_id"], row["project_id"]) for row in rows} == {
        (project.workspace_id, project.id)
    }
    assert {row["created_at"] for row in rows} == {partition_month(NOW)}
    assert len({bytes(row["idempotency_key"]) for row in rows}) == 5


async def test_a_large_run_is_inserted_in_batches(
    worker_db: Ledger, migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ledger, "INSERT_BATCH", 40)
    project = await make_tenant(migrated)
    run = new_run(project)

    async with worker_db() as db, db.begin():
        run_id = await ledger.create_run(db, run, now=NOW)
        assert run_id is not None
        added = await ledger.insert_tasks(db, run_id, run, [new_task(n) for n in range(101)])

    assert added == 101
    assert len(await task_rows(migrated, run_id)) == 101


async def test_a_run_over_budget_is_recorded_and_not_started(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    (budget,) = await fetch(
        migrated,
        "INSERT INTO ops.budgets (workspace_id, workload, limit_usd) VALUES ($1, 'seo_rank', 1) "
        "RETURNING id",
        project.workspace_id,
    )
    async with worker_db() as db, db.begin():
        run_id = await ledger.create_run(db, new_run(project), now=NOW)
        assert run_id is not None
        await ledger.block_run(
            db, run_id, budget_id=budget["id"], estimated_cost_usd=Decimal("2.5"), now=NOW
        )
        # A blocked run is not started afterwards by a second planner.
        await ledger.start_run(db, run_id, tasks_total=9, estimated_cost_usd=Decimal("2.5"))

    row = await run_row(migrated, run_id)
    assert (row["status"], row["status_reason"], row["blocked_by_budget_id"]) == (
        "budget_blocked",
        "budget_exceeded",
        budget["id"],
    )
    assert (row["estimated_cost_usd"], row["tasks_total"], row["completed_at"]) == (
        Decimal("2.5000"),
        0,
        NOW,
    )


async def test_a_running_run_says_which_budget_holds_its_tasks_back(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    budget_id = await make_budget(migrated, project, "1.00")
    running = await seed_run(worker_db, project, 2)
    async with worker_db() as db, db.begin():
        blocked = await ledger.create_run(db, new_run(project), now=NOW)
        assert blocked is not None
        await ledger.block_run(
            db, blocked, budget_id=budget_id, estimated_cost_usd=Decimal("5"), now=NOW
        )
        await ledger.note_budget_hold(db, [], budget_id)
        await ledger.note_budget_hold(db, [running, blocked], budget_id)

    row = await run_row(migrated, running)
    assert (row["status"], row["status_reason"], row["blocked_by_budget_id"]) == (
        "running",
        "budget_exceeded",
        budget_id,
    )
    # The tasks wait; nothing about them changes.
    assert {task["status"] for task in await task_rows(migrated, running)} == {"pending"}
    # A run that has already ended is left as it ended.
    assert (await run_row(migrated, blocked))["status"] == "budget_blocked"


# -------------------------------------------------------------------------------------------------
# Claiming


async def test_only_tasks_that_are_due_are_claimed_oldest_first(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    run = new_run(project)
    async with worker_db() as db, db.begin():
        run_id = await ledger.create_run(db, run, now=NOW)
        assert run_id is not None
        await ledger.insert_tasks(
            db,
            run_id,
            run,
            [
                new_task(1, scheduled_for=NOW - 5 * MINUTE),
                new_task(2, scheduled_for=NOW - 10 * MINUTE),
                new_task(3, scheduled_for=NOW),
                new_task(4, scheduled_for=NOW + MINUTE),
                new_task(5, scheduled_for=NOW - MINUTE),
                new_task(6, scheduled_for=NOW - MINUTE),
            ],
        )
    # One is waiting for its retry delay, one is no longer pending.
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET next_attempt_at = $1 WHERE subject_id = 'keyword-5'",
        NOW + MINUTE,
    )
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET status = 'submitted' WHERE subject_id = 'keyword-6'",
    )

    claimed = await _claim(worker_db)

    assert [task.subject_id for task in claimed] == ["keyword-2", "keyword-1", "keyword-3"]
    assert {task.status for task in claimed} == {"pending"}
    # A run without a schedule is someone waiting: it goes first.
    assert {task.priority for task in claimed} == {"high"}
    # Dispatched tasks are not claimed a second time.
    assert await _claim(worker_db) == []
    rows = {row["subject_id"]: row for row in await task_rows(migrated, run_id)}
    assert rows["keyword-2"]["dispatched_at"] == NOW
    assert rows["keyword-4"]["dispatched_at"] is None


async def test_a_task_takes_its_priority_from_its_schedule(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    low = await make_schedule(migrated, project, priority="low")
    standard = await make_schedule(migrated, project)
    await seed_run(worker_db, project, 1, schedule_id=low)
    await seed_run(worker_db, project, 1, schedule_id=standard)

    claimed = await _claim(worker_db)

    assert sorted(task.priority for task in claimed) == ["low", "standard"]
    assert {task.window_end for task in claimed} == {NOW + timedelta(hours=6)}


async def test_a_large_project_cannot_take_a_whole_tick_from_a_small_one(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    large = await make_tenant(migrated)
    small = await make_tenant(migrated)
    tiny = await make_tenant(migrated)
    await seed_run(worker_db, large, 60, scheduled_for=NOW - 10 * MINUTE)
    await seed_run(worker_db, small, 8, scheduled_for=NOW - MINUTE)
    await seed_run(worker_db, tiny, 2, scheduled_for=NOW)

    claimed = await _claim(worker_db, limit=30, per_project=20)

    by_project = {
        project.id: sum(task.project_id == project.id for task in claimed)
        for project in (large, small, tiny)
    }
    # An equal share each (10), then what is left over (10) to the project with more to do,
    # never past the cap per project.
    assert by_project == {large.id: 20, small.id: 8, tiny.id: 2}
    assert len(claimed) == 30

    later = await _claim(worker_db, limit=30, per_project=20)
    assert len(later) == 20
    assert {task.project_id for task in later} == {large.id}


async def test_two_dispatchers_at_once_never_claim_the_same_task(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    await seed_run(worker_db, project, 40)

    async def dispatcher() -> list[LedgerTask]:
        async with worker_db() as db, db.begin():
            tasks = await ledger.claim_due(db, now=NOW, limit=25)
            # Hold the rows for a moment, as a real tick does while it enqueues.
            await asyncio.sleep(0.2)
            await ledger.mark_dispatched(db, [task.ref for task in tasks], now=NOW)
            return tasks

    first, second = await asyncio.gather(dispatcher(), dispatcher())

    refs = [task.ref for task in first + second]
    assert len(refs) == len(set(refs))
    assert len(refs) >= 25
    remaining = await _claim(worker_db)
    assert len(refs) + len(remaining) == 40


async def test_tasks_of_a_paused_provider_wait(worker_db: Ledger, migrated: PostgresServer) -> None:
    project = await make_tenant(migrated)
    await seed_run(worker_db, project, 2, provider="dataforseo")
    await seed_run(worker_db, project, 3, provider="other")

    claimed = await _claim(worker_db, paused_providers=["dataforseo"])

    assert {task.provider_code for task in claimed} == {"other"}
    assert len(claimed) == 3
    assert len(await _claim(worker_db)) == 2


async def test_a_released_task_is_due_again(worker_db: Ledger, migrated: PostgresServer) -> None:
    project = await make_tenant(migrated)
    await seed_run(worker_db, project, 2)
    claimed = await _claim(worker_db)

    async with worker_db() as db, db.begin():
        await ledger.release(db, [claimed[0].ref])
        await ledger.release(db, [])

    assert [task.ref for task in await _claim(worker_db)] == [claimed[0].ref]


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


async def test_an_accepted_task_is_submitted_with_the_providers_id(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    (task,) = await _in_flight(worker_db, migrated)

    async with worker_db() as db, db.begin():
        first = await ledger.mark_submitted(
            db, task.ref, provider_task_id="09301200-1234", cost_usd=Decimal("0.0006")
        )
        again = await ledger.mark_submitted(
            db, task.ref, provider_task_id="another", cost_usd=Decimal("9")
        )
        await ledger.record_cost(
            db, task, cost_usd=Decimal("0.0006"), cost_source="provider_reported", now=NOW
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
    assert event["billing_period"] == NOW.date().replace(day=1)


@pytest.mark.parametrize(
    ("kind", "status", "delay", "attempts"),
    [
        (ProviderErrorKind.RATE_LIMITED, "pending", timedelta(seconds=30), 1),
        (ProviderErrorKind.TIMEOUT, "pending", timedelta(seconds=60), 1),
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


async def test_a_task_is_tried_again_until_the_policy_gives_up(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    run_id = await seed_run(worker_db, project, 1)
    statuses = []
    for _ in range(4):
        await execute(migrated, "UPDATE ops.collection_tasks SET next_attempt_at = NULL")
        (claimed,) = await _claim(worker_db)
        async with worker_db() as db, db.begin():
            (task,) = await ledger.begin_submission(db, [claimed.ref], now=NOW)
            decision = decide(ProviderErrorKind.PROVIDER_ERROR, attempts=task.attempts, jitter=0.0)
            await ledger.record_failure(
                db,
                task.ref,
                kind=ProviderErrorKind.PROVIDER_ERROR,
                message="502",
                decision=decision,
                now=NOW,
            )
        (row,) = await task_rows(migrated, run_id)
        statuses.append((row["status"], row["attempts"]))

    assert statuses == [("pending", 1), ("pending", 2), ("pending", 3), ("dead", 4)]
    assert await _claim(worker_db) == []


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
            db, pending.ref, provider_task_id="x", cost_usd=None
        )
        failed = await ledger.record_failure(
            db, pending.ref, kind=ProviderErrorKind.TIMEOUT, message="m", decision=retry, now=NOW
        )
        unknown = TaskRef(id=pending.ref.id + 10_000, created_at=pending.ref.created_at)
        missing = await ledger.mark_submitted(db, unknown, provider_task_id="x", cost_usd=None)

    assert (submitted, failed, missing) == (False, False, False)
    (row,) = await task_rows(migrated, run_id)
    assert (row["status"], row["attempts"], row["provider_task_id"]) == ("pending", 0, None)


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
    assert await _claim(worker_db) == []


# -------------------------------------------------------------------------------------------------
# Completion


@pytest.mark.parametrize(
    ("failed", "status"), [(0, "completed"), (1, "completed"), (2, "completed_with_errors")]
)
async def test_a_run_completes_when_every_task_has_ended(
    worker_db: Ledger, migrated: PostgresServer, failed: int, status: str
) -> None:
    project = await make_tenant(migrated)
    run_id = await seed_run(worker_db, project, 100)
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET status = 'ingested', cost_usd = 0.01 WHERE run_id = $1",
        run_id,
    )
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET status = 'dead' "
        "WHERE run_id = $1 AND subject_id = ANY($2)",
        run_id,
        [f"keyword-{number}" for number in range(failed)],
    )

    async with worker_db() as db, db.begin():
        closed = await ledger.complete_finished_runs(db, now=NOW)
        again = await ledger.complete_finished_runs(db, now=NOW)

    assert (closed, again) == (1, 0)
    row = await run_row(migrated, run_id)
    # Under 2% failed or dead is a completed run; 2% and over completed with errors.
    assert (row["status"], row["tasks_failed"], row["tasks_succeeded"]) == (
        status,
        failed,
        100 - failed,
    )
    assert (row["actual_cost_usd"], row["completed_at"]) == (Decimal("1.0000"), NOW)


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
    empty = await seed_run(worker_db, await make_tenant(migrated), 0)

    async with worker_db() as db, db.begin():
        assert await ledger.complete_finished_runs(db, now=NOW) == 0

    assert (await run_row(migrated, run_id))["status"] == "running"
    # A run with no tasks was never really started; it is not "completed" by this sweep.
    assert (await run_row(migrated, empty))["status"] == "running"


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
        stale = await ledger.release_stale_dispatches(db, older_than=10 * MINUTE, now=NOW)
        await ledger.release(db, [task.ref for task in stale])

    assert [task.subject_id for task in stale] == ["keyword-0"]
    rows = {row["subject_id"]: row["dispatched_at"] for row in await task_rows(migrated, run_id)}
    assert rows["keyword-0"] is None
    assert rows["keyword-1"] is not None


async def test_a_submission_the_provider_never_answered_is_dead(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    run_id = await seed_run(worker_db, project, 2)
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET status = 'submitted', submitted_at = CASE subject_id "
        "WHEN 'keyword-0' THEN $1::timestamptz ELSE $2::timestamptz END",
        NOW - timedelta(hours=73),
        NOW - timedelta(hours=71),
    )

    async with worker_db() as db, db.begin():
        ended = await ledger.end_old_submissions(db, older_than=timedelta(hours=72), now=NOW)

    assert ended == 1
    rows = {row["subject_id"]: row for row in await task_rows(migrated, run_id)}
    assert (rows["keyword-0"]["status"], rows["keyword-0"]["last_error_code"]) == (
        "dead",
        "provider_never_answered",
    )
    assert rows["keyword-1"]["status"] == "submitted"


async def test_a_task_never_sent_a_day_after_its_window_is_cancelled(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    old = await seed_run(worker_db, project, 2, window_start=NOW - timedelta(hours=31))
    recent = await seed_run(worker_db, project, 1, window_start=NOW - timedelta(hours=29))
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET status = 'submitted', provider_task_id = 'p1' "
        "WHERE run_id = $1 AND subject_id = 'keyword-1'",
        old,
    )

    async with worker_db() as db, db.begin():
        cancelled = await ledger.cancel_missed(db, after_window=timedelta(hours=24), now=NOW)

    # The window was 6 hours: the old run's closed 25 hours ago, the recent one's 23.
    assert cancelled == 1
    rows = {row["subject_id"]: row for row in await task_rows(migrated, old)}
    assert (rows["keyword-0"]["status"], rows["keyword-0"]["last_error_code"]) == (
        "cancelled",
        "window_missed",
    )
    assert rows["keyword-1"]["status"] == "submitted"
    assert {row["status"] for row in await task_rows(migrated, recent)} == {"pending"}
