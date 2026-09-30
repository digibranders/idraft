"""`submit_batch` (docs/21-scheduler-workers.md sections 5 and 6). As `app_worker`, with a fake
provider: at most one submission per task, whatever the provider answers."""

import io
import json
from collections.abc import Sequence
from datetime import timedelta
from decimal import Decimal
from uuid import UUID

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors.dispatcher import SubmitBatch, dispatch
from sightline.collectors.registry import Registry
from sightline.collectors.submission import NOT_BUILT, SubmitReport, submit_batch
from sightline.config.logging import configure_logging
from sightline.domain.retries import ProviderErrorKind
from sightline.providers.contract import (
    AcceptedTask,
    CanonicalRequest,
    ProviderCallError,
    ProviderError,
    SubmitResult,
)
from tests.api.auth.support import execute, fetch
from tests.collectors.support import (
    NOW,
    FakeProvider,
    FakeWorkload,
    Pauses,
    make_tenant,
    seed_run,
    task_rows,
)
from tests.collectors.test_dispatcher import Outbox
from tests.conftest import PostgresServer

Ledger = async_sessionmaker[AsyncSession]
K = ProviderErrorKind


class World:
    """A worker with one fake workload and one fake provider, and the batches it has sent."""

    def __init__(self, sessions: Ledger, provider: FakeProvider | None = None) -> None:
        self.sessions = sessions
        self.workload = FakeWorkload()
        self.provider = provider or FakeProvider()
        self.registry = Registry()
        self.registry.add_workload(self.workload)
        self.registry.add_provider(self.provider)
        self.pauses = Pauses()
        self.outbox = Outbox()

    async def dispatch(self) -> list[SubmitBatch]:
        """The batches this tick sent."""
        before = len(self.outbox.sent)
        await dispatch(self.sessions, self.registry, self.outbox, self.pauses, now=NOW)
        return self.outbox.sent[before:]

    async def submit(self, batch: SubmitBatch) -> SubmitReport:
        try:
            return await submit_batch(
                self.sessions, self.registry, self.pauses, batch, jitter=lambda: 0.0
            )
        finally:
            # As the queue does: a handled message no longer holds its key.
            self.outbox.waiting.discard(batch.dedupe_key)


async def _one_batch(world: World, pg: PostgresServer, tasks: int = 3) -> tuple[UUID, SubmitBatch]:
    run_id = await seed_run(world.sessions, await make_tenant(pg), tasks)
    (batch,) = await world.dispatch()
    return run_id, batch


async def _costs(pg: PostgresServer) -> list[Decimal]:
    return [
        row["cost_usd"] for row in await fetch(pg, "SELECT cost_usd FROM ops.provider_cost_events")
    ]


async def test_accepted_tasks_are_submitted_with_the_providers_id_and_their_cost(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    world = World(worker_db)
    run_id, batch = await _one_batch(world, migrated)

    report = await world.submit(batch)

    assert report == SubmitReport(submitted=3)
    rows = await task_rows(migrated, run_id)
    assert {row["status"] for row in rows} == {"submitted"}
    assert {row["provider_task_id"] for row in rows} == {f"p-{row['id']}" for row in rows}
    assert {(row["attempts"], row["dispatched_at"]) for row in rows} == {(1, None)}
    assert await _costs(migrated) == [Decimal("0.000600")] * 3
    # One call, with every task's request, each tagged with the task's id.
    ((endpoint, requests),) = world.provider.calls
    assert endpoint == "serp"
    assert sorted(request.task_id for request in requests) == sorted(str(row["id"]) for row in rows)


async def test_a_message_delivered_twice_submits_nothing_twice(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    world = World(worker_db)
    _, batch = await _one_batch(world, migrated)

    await world.submit(batch)
    again = await world.submit(batch)

    assert again == SubmitReport()
    assert len(world.provider.calls) == 1
    assert len(await _costs(migrated)) == 3


async def test_a_task_the_provider_refuses_follows_the_retry_policy(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    world = World(worker_db)
    world.provider.reject(K.INVALID_REQUEST, 0)
    run_id, batch = await _one_batch(world, migrated)

    report = await world.submit(batch)

    assert report == SubmitReport(submitted=2, refused=1)
    statuses = sorted(
        (row["status"], row["last_error_code"]) for row in await task_rows(migrated, run_id)
    )
    assert statuses == [("failed", "invalid_request"), ("submitted", None), ("submitted", None)]


async def test_a_call_the_provider_refused_as_a_whole_puts_the_tasks_back_after_a_wait(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    world = World(worker_db)
    world.provider.fail_with(K.RATE_LIMITED)
    run_id, batch = await _one_batch(world, migrated)

    report = await world.submit(batch)

    assert report == SubmitReport(refused=3)
    rows = await task_rows(migrated, run_id)
    assert {(row["status"], row["attempts"], row["dispatched_at"]) for row in rows} == {
        ("pending", 1, None)
    }
    # Thirty seconds after the answer came, by the database's clock.
    (clock,) = await fetch(migrated, "SELECT now() AS now")
    for row in rows:
        wait = row["next_attempt_at"] - clock["now"]
        assert timedelta(seconds=25) < wait <= timedelta(seconds=30)
    assert await _costs(migrated) == []


@pytest.mark.parametrize("kind", [K.AUTH, K.PAYMENT, K.ACCOUNT_LIMIT])
async def test_a_provider_that_refuses_everyone_is_paused_and_the_tasks_wait(
    worker_db: Ledger, migrated: PostgresServer, kind: ProviderErrorKind
) -> None:
    world = World(worker_db)
    world.provider.fail_with(kind)
    run_id, batch = await _one_batch(world, migrated)

    report = await world.submit(batch)

    assert report == SubmitReport(refused=3)
    assert world.pauses.reasons == {"fake": kind.value}
    rows = await task_rows(migrated, run_id)
    # Not the tasks' failure: no attempt is counted, and they go out once the pause is over.
    assert {(row["status"], row["attempts"], row["next_attempt_at"]) for row in rows} == {
        ("pending", 0, None)
    }
    # While the pause lasts nothing goes out; after it, the same tasks do.
    assert await world.dispatch() == []
    world.pauses.reasons.clear()
    assert await world.dispatch() == [batch]


async def test_a_call_that_timed_out_leaves_the_tasks_unknown_and_never_resent(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    """The provider may have them, and may have charged for them."""
    world = World(worker_db)
    world.provider.fail_with(K.TIMEOUT, "no answer within 30 s")
    run_id, batch = await _one_batch(world, migrated)

    report = await world.submit(batch)

    assert report == SubmitReport(unknown=3)
    rows = await task_rows(migrated, run_id)
    assert {(row["status"], row["last_error_code"], row["last_error_message"]) for row in rows} == {
        ("submit_unknown", "timeout", "no answer within 30 s")
    }
    # Not claimed again, and a second delivery of the message takes nothing.
    assert await world.dispatch() == []
    assert await world.submit(batch) == SubmitReport()
    assert len(world.provider.calls) == 1


async def test_a_failure_the_adapter_did_not_classify_is_read_as_an_unknown_outcome(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    stream = io.StringIO()
    configure_logging(service="worker", version="test", level="info", stream=stream)
    world = World(worker_db)

    async def crashes(endpoint: str, requests: Sequence[CanonicalRequest]) -> SubmitResult:
        raise KeyError("the response had no 'tasks'")

    world.provider.answer = crashes
    run_id, batch = await _one_batch(world, migrated)

    assert await world.submit(batch) == SubmitReport(unknown=3)
    assert {row["status"] for row in await task_rows(migrated, run_id)} == {"submit_unknown"}
    (line,) = [
        json.loads(line)
        for line in stream.getvalue().splitlines()
        if "submission failed unclassified" in line
    ]
    assert (line["level"], line["err"]["type"], line["tasks"]) == ("error", "KeyError", 3)


async def test_a_task_the_answer_does_not_mention_is_unknown(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    world = World(worker_db)

    async def forgets_one(endpoint: str, requests: Sequence[CanonicalRequest]) -> SubmitResult:
        return SubmitResult(
            accepted=[
                AcceptedTask(task_id=request.task_id, provider_task_id=f"p-{request.task_id}")
                for request in requests[1:]
            ]
            # An id that was not in the batch, and one task answered twice.
            + [
                AcceptedTask(task_id="999999999", provider_task_id="stray"),
                AcceptedTask(task_id=requests[1].task_id, provider_task_id="twice"),
            ]
        )

    world.provider.answer = forgets_one
    run_id, batch = await _one_batch(world, migrated)

    assert await world.submit(batch) == SubmitReport(submitted=2, unknown=1)
    rows = await task_rows(migrated, run_id)
    assert sorted(row["status"] for row in rows) == ["submit_unknown", "submitted", "submitted"]
    assert "twice" not in {row["provider_task_id"] for row in rows}
    # No cost reported, no cost event.
    assert await _costs(migrated) == []


async def test_a_task_whose_request_cannot_be_built_fails_and_the_rest_are_sent(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    world = World(worker_db)
    world.workload.unbuildable = {"keyword-1"}
    run_id, batch = await _one_batch(world, migrated)

    assert await world.submit(batch) == SubmitReport(submitted=2, refused=1)
    rows = {row["subject_id"]: row for row in await task_rows(migrated, run_id)}
    assert (rows["keyword-1"]["status"], rows["keyword-1"]["last_error_message"]) == (
        "failed",
        NOT_BUILT,
    )
    ((_, requests),) = world.provider.calls
    assert len(requests) == 2

    # Nothing can be built: the provider is not called at all.
    world.workload.unbuildable = {f"keyword-{number}" for number in range(3)}
    run_id, _ = await _one_batch(world, migrated)
    (_, second) = world.outbox.sent
    assert await world.submit(second) == SubmitReport(refused=3)
    assert len(world.provider.calls) == 1


async def test_a_workload_cannot_write_while_it_builds_requests_and_nothing_is_taken(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    world = World(worker_db)
    run_id, batch = await _one_batch(world, migrated)
    world.workload.writes = "UPDATE ops.budgets SET limit_usd = 1000000"

    with pytest.raises(Exception, match="read-only"):
        await world.submit(batch)

    # Rolled back as a whole: the tasks are still on their way, for the reconciler to bring
    # back, and the provider was never called.
    rows = await task_rows(migrated, run_id)
    assert {(row["status"], row["attempts"], row["dispatched_at"]) for row in rows} == {
        ("pending", 0, NOW)
    }
    assert world.provider.calls == []


async def test_the_tasks_of_a_run_that_ended_are_not_sent(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    world = World(worker_db)
    run_id, batch = await _one_batch(world, migrated)
    await execute(
        migrated, "UPDATE ops.collection_runs SET status = 'cancelled' WHERE id = $1", run_id
    )

    assert await world.submit(batch) == SubmitReport()
    assert world.provider.calls == []


async def test_a_provider_error_the_call_raises_names_its_kind(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    error = ProviderCallError(ProviderError(kind=K.PROVIDER_ERROR, message="502 from upstream"))
    assert str(error) == "provider_error: 502 from upstream"
    assert error.error.kind is K.PROVIDER_ERROR
