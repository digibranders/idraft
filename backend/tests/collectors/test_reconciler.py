"""The reconciler and the partition job (docs/21-scheduler-workers.md sections 8.2 and 10).
As `app_worker`."""

from datetime import timedelta

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors.reconciler import ReconcileReport, ensure_partitions, reconcile
from sightline.domain.tasks import partition_month
from tests.api.auth.support import execute, fetch
from tests.collectors.support import NOW, make_tenant, run_row, seed_run, task_rows
from tests.conftest import PostgresServer

Ledger = async_sessionmaker[AsyncSession]
MINUTE = timedelta(minutes=1)
HOUR = timedelta(hours=1)


async def _set(pg: PostgresServer, run_id: object, subject: str, sql: str, *values: object) -> None:
    await execute(
        pg,
        f"UPDATE ops.collection_tasks SET {sql} WHERE run_id = $1 AND subject_id = $2",
        run_id,
        subject,
        *values,
    )


async def test_one_pass_brings_every_kind_of_stuck_work_back_or_to_an_end(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    # keyword-0: its message was lost 11 minutes ago. keyword-1: sent 9 minutes ago.
    # keyword-2: with the provider for 73 hours. keyword-3: never confirmed for 73 hours.
    current = await seed_run(worker_db, project, 5)
    await _set(migrated, current, "keyword-0", "dispatched_at = $3", NOW - 11 * MINUTE)
    await _set(migrated, current, "keyword-1", "dispatched_at = $3", NOW - 9 * MINUTE)
    await _set(
        migrated,
        current,
        "keyword-2",
        "status = 'submitted', attempts = 1, submitted_at = $3",
        NOW - 73 * HOUR,
    )
    await _set(
        migrated,
        current,
        "keyword-3",
        "status = 'submit_unknown', attempts = 1, submitted_at = $3",
        NOW - 73 * HOUR,
    )
    # A run whose window closed 25 hours ago with a task never sent, the other ingested.
    late = await seed_run(worker_db, project, 2, window_start=NOW - 31 * HOUR)
    await _set(migrated, late, "keyword-1", "status = 'ingested'")
    # A run someone cancelled.
    cancelled = await seed_run(worker_db, project, 1)
    await execute(
        migrated, "UPDATE ops.collection_runs SET status = 'cancelled' WHERE id = $1", cancelled
    )

    report = await reconcile(worker_db, now=NOW)

    assert report == ReconcileReport(released=1, dead=2, missed=1, run_ended=1, completed=1)
    rows = {row["subject_id"]: row for row in await task_rows(migrated, current)}
    assert rows["keyword-0"]["dispatched_at"] is None
    assert rows["keyword-1"]["dispatched_at"] == NOW - 9 * MINUTE
    assert {rows[subject]["status"] for subject in ("keyword-2", "keyword-3")} == {"dead"}
    assert rows["keyword-4"]["status"] == "pending"
    assert (await run_row(migrated, current))["status"] == "running"
    # The late run's last task was cancelled, so the run was completed in the same pass.
    late_run = await run_row(migrated, late)
    assert (late_run["status"], late_run["tasks_failed"], late_run["tasks_succeeded"]) == (
        "completed_with_errors",
        1,
        1,
    )
    assert {row["last_error_code"] for row in await task_rows(migrated, cancelled)} == {"run_ended"}

    # A second pass finds nothing left to do.
    assert await reconcile(worker_db, now=NOW) == ReconcileReport()


async def test_a_provider_that_keeps_results_longer_is_given_longer(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    run_id = await seed_run(worker_db, project, 1, endpoint="llm")
    await _set(
        migrated, run_id, "keyword-0", "status = 'submitted', submitted_at = $3", NOW - 73 * HOUR
    )

    kept = await reconcile(worker_db, now=NOW, lifetimes={("fake", "llm"): 76 * HOUR})

    assert kept.dead == 0
    assert (await reconcile(worker_db, now=NOW)).dead == 1


async def test_partitions_are_made_for_the_months_ahead(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    await ensure_partitions(worker_db)
    # Nothing is left to make the second time.
    assert await ensure_partitions(worker_db) == 0

    ahead = partition_month(partition_month(NOW) + timedelta(days=3 * 31 + 1))
    (found,) = await fetch(
        migrated,
        "SELECT count(*) AS partitions FROM pg_inherits i "
        "JOIN pg_class c ON c.oid = i.inhrelid "
        "WHERE i.inhparent = 'ops.collection_tasks'::regclass "
        # The partition that begins that month, not the one before that ends there.
        "AND pg_get_expr(c.relpartbound, c.oid) LIKE 'FOR VALUES FROM (''' || $1 || '%'",
        ahead.strftime("%Y-%m-01"),
    )
    assert found["partitions"] == 1
