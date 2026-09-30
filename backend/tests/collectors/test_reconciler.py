"""The reconciler and the partition job (docs/21-scheduler-workers.md sections 8.2 and 10).
As `app_worker`."""

from datetime import timedelta
from decimal import Decimal
from uuid import UUID

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors import ledger, reconciler
from sightline.collectors.reconciler import ReconcileReport, ensure_partitions, reconcile
from sightline.collectors.registry import Registry
from sightline.domain.tasks import partition_month
from tests.api.auth.support import execute, fetch
from tests.collectors.support import (
    NOW,
    FakeProvider,
    make_tenant,
    run_row,
    seed_run,
    task_rows,
)
from tests.conftest import PostgresServer

Ledger = async_sessionmaker[AsyncSession]
MINUTE = timedelta(minutes=1)
HOUR = timedelta(hours=1)


@pytest.fixture
def registry() -> Registry:
    """A worker that knows the fake provider, whose endpoint `llm` keeps results 76 hours."""
    known = Registry()
    known.add_provider(FakeProvider())
    return known


async def _set(pg: PostgresServer, run_id: UUID, subject: str, sql: str, *values: object) -> None:
    await execute(
        pg,
        f"UPDATE ops.collection_tasks SET {sql} WHERE run_id = $1 AND subject_id = $2",
        run_id,
        subject,
        *values,
    )


async def _submitted_long_ago(
    pg: PostgresServer, run_id: UUID, subject: str, status: str, hours: int = 73
) -> None:
    await _set(
        pg,
        run_id,
        subject,
        f"status = '{status}', attempts = 1, submitted_at = $3",
        NOW - hours * HOUR,
    )


async def test_one_pass_brings_every_kind_of_stuck_work_back_or_to_an_end(
    worker_db: Ledger, migrated: PostgresServer, registry: Registry
) -> None:
    project = await make_tenant(migrated)
    # keyword-0: its message was lost 11 minutes ago. keyword-1: sent 9 minutes ago.
    # keyword-2: with the provider for 73 hours. keyword-3: never confirmed for 73 hours.
    current = await seed_run(worker_db, project, 5, estimate="5")
    await _set(migrated, current, "keyword-0", "dispatched_at = $3", NOW - 11 * MINUTE)
    await _set(migrated, current, "keyword-1", "dispatched_at = $3", NOW - 9 * MINUTE)
    await _submitted_long_ago(migrated, current, "keyword-2", "submitted")
    await _submitted_long_ago(migrated, current, "keyword-3", "submit_unknown")
    # A run whose window closed 25 hours ago with a task never sent, the other ingested.
    late = await seed_run(worker_db, project, 2, window_start=NOW - 31 * HOUR)
    await _set(migrated, late, "keyword-1", "status = 'ingested'")
    # A run someone cancelled, long enough ago that its window has closed too.
    cancelled = await seed_run(worker_db, project, 1, window_start=NOW - 31 * HOUR)
    await execute(
        migrated, "UPDATE ops.collection_runs SET status = 'cancelled' WHERE id = $1", cancelled
    )

    report = await reconcile(worker_db, registry, now=NOW)

    assert report == ReconcileReport(
        released=1, dead=2, missed=1, run_ended=1, completed=1, settled=1
    )
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
    # A run that ended says why its task was not sent, late as it also is.
    assert {row["last_error_code"] for row in await task_rows(migrated, cancelled)} == {"run_ended"}
    ended = await run_row(migrated, cancelled)
    assert (ended["status"], ended["tasks_failed"], ended["actual_cost_usd"]) == (
        "cancelled",
        1,
        0,
    )

    # A second pass finds nothing left to do.
    assert await reconcile(worker_db, registry, now=NOW) == ReconcileReport()


async def test_a_submission_never_confirmed_is_charged_what_it_may_have_cost(
    worker_db: Ledger, migrated: PostgresServer, registry: Registry
) -> None:
    """The provider may have charged for it. Forgetting it would let the budget spend the
    same money again."""
    project = await make_tenant(migrated)
    run_id = await seed_run(worker_db, project, 4, estimate="2")
    await _submitted_long_ago(migrated, run_id, "keyword-0", "submit_unknown")
    # One the provider did have is charged by what it reported, not here.
    await _submitted_long_ago(migrated, run_id, "keyword-1", "submitted")

    assert (await reconcile(worker_db, registry, now=NOW)).dead == 2

    events = await fetch(
        migrated,
        "SELECT subject_id, cost_usd, cost_source FROM ops.provider_cost_events WHERE run_id = $1",
        run_id,
    )
    assert [tuple(event) for event in events] == [
        ("keyword-0", Decimal("0.500000"), "price_book_estimate")
    ]
    task = {row["subject_id"]: row for row in await task_rows(migrated, run_id)}["keyword-0"]
    assert (task["last_error_code"], task["cost_usd"]) == (
        "submission_never_confirmed",
        Decimal("0.500000"),
    )


async def test_each_endpoint_is_given_as_long_as_its_provider_keeps_results(
    worker_db: Ledger, migrated: PostgresServer, registry: Registry
) -> None:
    project = await make_tenant(migrated)
    llm = await seed_run(worker_db, project, 1, endpoint="llm")
    serp = await seed_run(worker_db, project, 1)
    unknown = await seed_run(worker_db, project, 1, provider="gone")
    for run_id in (llm, serp, unknown):
        await _submitted_long_ago(migrated, run_id, "keyword-0", "submitted")

    assert (await reconcile(worker_db, registry, now=NOW)).dead == 2

    # 73 hours is inside the 76 this endpoint keeps; the others keep 72, a provider this
    # worker does not know included.
    assert [row["status"] for row in await task_rows(migrated, llm)] == ["submitted"]
    for run_id in (serp, unknown):
        assert [row["status"] for row in await task_rows(migrated, run_id)] == ["dead"]
    assert (await reconcile(worker_db, registry, now=NOW + 4 * HOUR)).dead == 1


async def test_a_run_whose_last_task_dies_is_completed_in_the_same_pass(
    worker_db: Ledger, migrated: PostgresServer, registry: Registry
) -> None:
    project = await make_tenant(migrated)
    run_id = await seed_run(worker_db, project, 1)
    await _submitted_long_ago(migrated, run_id, "keyword-0", "submitted")

    report = await reconcile(worker_db, registry, now=NOW)

    assert (report.dead, report.completed) == (1, 1)
    assert (await run_row(migrated, run_id))["status"] == "completed_with_errors"


async def test_a_step_that_fails_does_not_stop_the_others(
    worker_db: Ledger,
    migrated: PostgresServer,
    registry: Registry,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project = await make_tenant(migrated)
    run_id = await seed_run(worker_db, project, 1)
    await _submitted_long_ago(migrated, run_id, "keyword-0", "submitted")

    async def locked(*arguments: object, **options: object) -> int:
        raise TimeoutError("lock wait")

    monkeypatch.setattr(ledger, "cancel_missed", locked)

    report = await reconcile(worker_db, registry, now=NOW)

    assert report.failed == ("missed",)
    assert (report.dead, report.completed) == (1, 1)


async def test_a_large_backlog_of_lost_messages_is_released_in_one_pass(
    worker_db: Ledger,
    migrated: PostgresServer,
    registry: Registry,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """After Redis was lost with more waiting than one batch holds."""
    monkeypatch.setattr(reconciler, "RELEASE_BATCH", 4)
    project = await make_tenant(migrated)
    run_id = await seed_run(worker_db, project, 10)
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET dispatched_at = $2 WHERE run_id = $1",
        run_id,
        NOW - 11 * MINUTE,
    )

    assert (await reconcile(worker_db, registry, now=NOW)).released == 10
    assert {row["dispatched_at"] for row in await task_rows(migrated, run_id)} == {None}


async def test_partitions_are_made_for_the_months_ahead(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    ahead = partition_month(partition_month(NOW) + timedelta(days=3 * 31 + 1))
    furthest = await _partition_from(migrated, ahead)
    # Taken away, so there is something to make; it is empty that far ahead.
    await execute(migrated, f"DROP TABLE ops.{furthest}")

    assert await ensure_partitions(worker_db) >= 1
    assert await _partition_from(migrated, ahead) == furthest
    # Nothing is left to make the second time.
    assert await ensure_partitions(worker_db) == 0


async def _partition_from(pg: PostgresServer, month: object) -> str:
    """The name of the ledger partition that begins in this month."""
    (found,) = await fetch(
        pg,
        "SELECT c.relname AS name FROM pg_inherits i "
        "JOIN pg_class c ON c.oid = i.inhrelid "
        "WHERE i.inhparent = 'ops.collection_tasks'::regclass "
        # The partition that begins that month, not the one before that ends there.
        "AND pg_get_expr(c.relpartbound, c.oid) LIKE 'FOR VALUES FROM (''' || $1 || '%'",
        month.strftime("%Y-%m-01"),  # type: ignore[attr-defined]
    )
    name: str = found["name"]
    return name
