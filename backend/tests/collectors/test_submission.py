"""`submit_batch` (docs/21-scheduler-workers.md sections 5 and 6). As `app_worker`, with a fake
provider: at most one submission per task, whatever the provider answers."""

import asyncio
import io
import json
from collections.abc import Sequence
from datetime import datetime, timedelta
from decimal import Decimal
from uuid import UUID

import pytest
from pydantic import BaseModel, ValidationError
from sqlalchemy.exc import DataError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors import ledger, submission
from sightline.collectors.dispatcher import SubmitBatch, dispatch
from sightline.collectors.ledger import TaskRef
from sightline.collectors.registry import Registry
from sightline.collectors.submission import NOT_BUILT, SubmitReport, submit_batch
from sightline.config.logging import configure_logging
from sightline.domain.retries import ProviderErrorKind
from sightline.providers.contract import (
    AcceptedTask,
    CanonicalRequest,
    ProviderCallError,
    ProviderError,
    RejectedTask,
    SubmitResult,
)
from tests.api.auth.support import execute, fetch
from tests.collectors.support import (
    NOW,
    Answer,
    FakeProvider,
    FakeWorkload,
    Pauses,
    SerpParams,
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
    # The batch holds tasks of any workspace, so what the provider said stays in the log.
    assert {(row["status"], row["last_error_code"], row["last_error_message"]) for row in rows} == {
        ("submit_unknown", "timeout", "No answer from the provider; it may have the task.")
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


def _refusing(*errors: tuple[int, ProviderError]) -> Answer:
    """Refuse the requests at these positions with these errors, accept the rest."""

    async def answer(endpoint: str, requests: Sequence[CanonicalRequest]) -> SubmitResult:
        refused = {requests[position].task_id: error for position, error in errors}
        return SubmitResult(
            accepted=tuple(
                AcceptedTask(task_id=request.task_id, provider_task_id=f"p-{request.task_id}")
                for request in requests
                if request.task_id not in refused
            ),
            rejected=tuple(
                RejectedTask(task_id=task_id, error=error) for task_id, error in refused.items()
            ),
        )

    return answer


async def _row(pg: PostgresServer, run_id: UUID, subject: str) -> dict[str, object]:
    return {row["subject_id"]: row for row in await task_rows(pg, run_id)}[subject]


async def test_a_refusal_is_judged_by_the_time_of_the_answer_and_the_wait_asked_for(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    world = World(worker_db)
    accept = _refusing(
        (
            0,
            ProviderError(
                kind=K.RATE_LIMITED, message="slow down", retry_after=timedelta(seconds=90)
            ),
        ),
        (1, ProviderError(kind=K.EMPTY_RESULT, message="nothing")),
    )

    async def slow(endpoint: str, requests: Sequence[CanonicalRequest]) -> SubmitResult:
        await asyncio.sleep(1.5)
        return await accept(endpoint, requests)

    world.provider.answer = slow
    run_id, batch = await _one_batch(world, migrated)
    (before,) = await fetch(migrated, "SELECT now() AS now")

    assert await world.submit(batch) == SubmitReport(submitted=1, refused=2)

    waited = await _row(migrated, run_id, "keyword-0")
    # The wait the provider asked for, counted from its answer, not from before the call.
    assert waited["status"] == "pending"
    assert waited["next_attempt_at"] - before["now"] >= timedelta(seconds=91)
    # An empty result at submission is read as the provider going wrong: a minute's wait.
    empty = await _row(migrated, run_id, "keyword-1")
    assert (empty["status"], empty["last_error_code"]) == ("pending", "provider_error")
    assert empty["next_attempt_at"] - before["now"] >= timedelta(seconds=61)


@pytest.mark.parametrize(("window_open", "status"), [(True, "pending"), (False, "dead")])
async def test_an_expired_result_is_asked_for_again_only_while_the_window_is_open(
    worker_db: Ledger, migrated: PostgresServer, window_open: bool, status: str
) -> None:
    world = World(worker_db)
    world.provider.answer = _refusing((0, ProviderError(kind=K.NOT_FOUND_EXPIRED, message="gone")))
    run_id, batch = await _one_batch(world, migrated, tasks=1)
    if not window_open:
        await execute(
            migrated,
            "UPDATE ops.collection_runs SET window_end = now() - interval '1 minute' WHERE id = $1",
            run_id,
        )

    await world.submit(batch)

    assert (await _row(migrated, run_id, "keyword-0"))["status"] == status


async def test_a_task_the_answer_refuses_twice_is_refused_once(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    world = World(worker_db)
    refusal = ProviderError(kind=K.INVALID_REQUEST, message="bad keyword")
    world.provider.answer = _refusing((0, refusal))
    answer = world.provider.answer

    async def twice(endpoint: str, requests: Sequence[CanonicalRequest]) -> SubmitResult:
        result = await answer(endpoint, requests)
        return SubmitResult(accepted=result.accepted, rejected=result.rejected * 2)

    world.provider.answer = twice
    _, batch = await _one_batch(world, migrated)

    assert await world.submit(batch) == SubmitReport(submitted=2, refused=1)


async def test_a_call_refused_as_a_whole_does_not_copy_the_providers_words_onto_every_task(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    """A batch holds tasks of several workspaces, and the provider's message may quote any of
    their requests."""
    stream = io.StringIO()
    configure_logging(service="worker", version="test", level="info", stream=stream)
    world = World(worker_db)
    world.provider.fail_with(K.PROVIDER_ERROR, "keyword 'acme secret launch' is not allowed")
    run_id, batch = await _one_batch(world, migrated)

    await world.submit(batch)

    messages = {row["last_error_message"] for row in await task_rows(migrated, run_id)}
    assert messages == {"The provider refused the whole call (provider_error)."}
    # The provider's own words are kept where only operators read them.
    assert "acme secret launch" in stream.getvalue()


async def test_one_task_whose_outcome_cannot_be_written_does_not_lose_the_others(
    worker_db: Ledger, migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    world = World(worker_db)
    run_id, batch = await _one_batch(world, migrated)
    unlucky = batch.tasks[1].id
    mark = ledger.mark_submitted

    async def fails_for_one(db: AsyncSession, ref: TaskRef, **fields: object) -> bool:
        if ref.id == unlucky:
            raise DataError("numeric field overflow", None, Exception())
        return await mark(db, ref, **fields)  # type: ignore[arg-type]

    monkeypatch.setattr(ledger, "mark_submitted", fails_for_one)

    assert await world.submit(batch) == SubmitReport(submitted=2, unknown=1)
    statuses = {row["id"]: row["status"] for row in await task_rows(migrated, run_id)}
    assert statuses.pop(unlucky) == "submit_unknown"
    assert set(statuses.values()) == {"submitted"}
    assert len(await _costs(migrated)) == 2


async def test_an_answer_that_cannot_be_recorded_at_first_is_recorded_on_a_second_try(
    worker_db: Ledger, migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(submission, "RECORD_RETRY_AFTER_SECONDS", 0.01)
    world = World(worker_db)
    run_id, batch = await _one_batch(world, migrated)
    clock = submission._clock
    calls = 0

    async def flaky(db: AsyncSession) -> datetime:
        nonlocal calls
        calls += 1
        # The first reading is step 1's; the second, step 3's first try, fails.
        if calls == 2:
            raise OperationalError("SELECT now()", None, Exception("connection reset"))
        return await clock(db)

    monkeypatch.setattr(submission, "_clock", flaky)

    assert await world.submit(batch) == SubmitReport(submitted=3)
    assert {row["status"] for row in await task_rows(migrated, run_id)} == {"submitted"}
    assert len(await _costs(migrated)) == 3


async def test_an_answer_that_cannot_be_recorded_at_all_keeps_the_providers_ids_in_the_log(
    worker_db: Ledger, migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    stream = io.StringIO()
    configure_logging(service="worker", version="test", level="info", stream=stream)
    monkeypatch.setattr(submission, "RECORD_RETRY_AFTER_SECONDS", 0.01)
    world = World(worker_db)
    run_id, batch = await _one_batch(world, migrated, tasks=1)
    clock = submission._clock
    calls = 0

    async def gone(db: AsyncSession) -> datetime:
        nonlocal calls
        calls += 1
        if calls > 1:
            raise OperationalError("SELECT now()", None, Exception("database gone"))
        return await clock(db)

    monkeypatch.setattr(submission, "_clock", gone)

    with pytest.raises(OperationalError):
        await world.submit(batch)

    # Tried as often as it may be, then left as it was: the provider may have the task.
    assert calls == 1 + submission.RECORD_ATTEMPTS
    assert {row["status"] for row in await task_rows(migrated, run_id)} == {"submit_unknown"}
    (line,) = [
        json.loads(line)
        for line in stream.getvalue().splitlines()
        if 'answer not recorded"' in line
    ]
    assert line["accepted"] == {str(batch.tasks[0].id): f"p-{batch.tasks[0].id}"}


async def test_a_request_tagged_with_another_tasks_id_is_not_sent(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    """Answers are matched by that id: another task, perhaps another workspace's, would get
    this one's provider id and cost."""
    world = World(worker_db)
    world.workload.mistags = {"keyword-0"}
    run_id, batch = await _one_batch(world, migrated)

    assert await world.submit(batch) == SubmitReport(submitted=2, refused=1)
    mistagged = await _row(migrated, run_id, "keyword-0")
    assert (mistagged["status"], mistagged["last_error_message"]) == ("failed", NOT_BUILT)
    ((_, requests),) = world.provider.calls
    assert len(requests) == 2


async def test_a_workload_that_fails_to_build_ends_its_tasks_instead_of_retrying_them_for_ever(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    world = World(worker_db)
    world.workload.fails_to_build = True
    run_id, batch = await _one_batch(world, migrated)

    assert await world.submit(batch) == SubmitReport(refused=3)
    assert {row["status"] for row in await task_rows(migrated, run_id)} == {"failed"}
    assert world.provider.calls == []


async def test_a_batch_for_a_provider_paused_since_it_was_sent_goes_back_in_line(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    world = World(worker_db)
    run_id, batch = await _one_batch(world, migrated)
    await world.pauses.pause("fake", reason="payment")

    assert await world.submit(batch) == SubmitReport(released=3)
    assert world.provider.calls == []
    rows = await task_rows(migrated, run_id)
    assert {(row["status"], row["attempts"], row["dispatched_at"]) for row in rows} == {
        ("pending", 0, None)
    }


async def test_a_task_the_provider_accepts_but_we_cannot_place_is_logged_with_its_id(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    """It may be a provider task we pay for; it must be possible to find it."""
    stream = io.StringIO()
    configure_logging(service="worker", version="test", level="info", stream=stream)
    world = World(worker_db)
    accept = world.provider.accept_all

    async def with_a_stray(endpoint: str, requests: Sequence[CanonicalRequest]) -> SubmitResult:
        result = await accept(endpoint, requests)
        stray = AcceptedTask(task_id="999999999", provider_task_id="stray-1", cost_usd=Decimal("1"))
        return SubmitResult(accepted=(*result.accepted, stray))

    world.provider.answer = with_a_stray
    _, batch = await _one_batch(world, migrated)

    assert await world.submit(batch) == SubmitReport(submitted=3)
    (line,) = [
        json.loads(line)
        for line in stream.getvalue().splitlines()
        if "accepted task not matched" in line
    ]
    assert (line["level"], line["provider_task_id"], line["cost_usd"], line["reason"]) == (
        "error",
        "stray-1",
        "1",
        "not in the batch",
    )


def test_a_request_is_sent_with_its_own_parameters() -> None:
    request = CanonicalRequest(
        task_id="7", priority="standard", params=SerpParams(keyword="shoes", location_id=2356)
    )
    assert request.model_dump()["params"] == {"keyword": "shoes", "location_id": 2356}
    assert '"keyword":"shoes"' in request.model_dump_json()


@pytest.mark.parametrize(
    ("model", "fields"),
    [
        (AcceptedTask, {"task_id": "1", "provider_task_id": "p", "cost_usd": "-5"}),
        (AcceptedTask, {"task_id": "1", "provider_task_id": "p", "cost_usd": "1e20"}),
        (AcceptedTask, {"task_id": "1", "provider_task_id": "p", "cost_usd": "0.0000001"}),
        (AcceptedTask, {"task_id": "", "provider_task_id": "p"}),
        (ProviderError, {"kind": "timeout", "message": "m", "retry_after": -1}),
    ],
)
def test_an_answer_that_could_not_be_stored_or_would_loosen_a_budget_is_refused(
    model: type[BaseModel], fields: dict[str, object]
) -> None:
    with pytest.raises(ValidationError):
        model.model_validate(fields)


def test_an_answer_cannot_be_changed_once_made() -> None:
    result = SubmitResult(accepted=(AcceptedTask(task_id="1", provider_task_id="p"),))
    with pytest.raises(AttributeError):
        result.accepted.append(AcceptedTask(task_id="2", provider_task_id="q"))  # type: ignore[attr-defined]
