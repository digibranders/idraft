"""The dispatcher (docs/21-scheduler-workers.md section 4). As `app_worker`, with fakes for the
provider and the queue."""

from datetime import timedelta

import pytest
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors.dispatcher import (
    DispatchReport,
    SubmitBatch,
    TaskKey,
    dispatch,
)
from sightline.collectors.registry import Registry
from sightline.domain.workloads import TaskWorkload
from tests.api.auth.support import execute
from tests.collectors.support import (
    NOW,
    FakeProvider,
    FakeWorkload,
    Pauses,
    make_budget,
    make_schedule,
    make_tenant,
    run_row,
    seed_run,
    spend,
    task_rows,
)
from tests.conftest import PostgresServer

Ledger = async_sessionmaker[AsyncSession]
MINUTE = timedelta(minutes=1)


class Outbox:
    """The queue, as far as the dispatcher can tell: a batch goes on once while it waits."""

    def __init__(self) -> None:
        self.sent: list[SubmitBatch] = []
        self.waiting: set[str] = set()
        self.broken = False

    async def send(self, batch: SubmitBatch) -> bool:
        if self.broken:
            raise ConnectionError("redis is gone")
        if batch.dedupe_key in self.waiting:
            return False
        self.waiting.add(batch.dedupe_key)
        self.sent.append(batch)
        return True


def _registry(*providers: FakeProvider) -> Registry:
    registry = Registry()
    registry.add_workload(FakeWorkload())
    registry.add_workload(FakeWorkload(name=TaskWorkload.AI_PROMPT))
    for provider in providers or (FakeProvider(),):
        registry.add_provider(provider)
    return registry


async def _dispatch(
    sessions: Ledger,
    registry: Registry,
    outbox: Outbox,
    pauses: Pauses | None = None,
    **options: int,
) -> DispatchReport:
    return await dispatch(sessions, registry, outbox, pauses or Pauses(), now=NOW, **options)


async def test_due_tasks_go_out_in_batches_of_the_providers_size_highest_priority_first(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    schedule_id = await make_schedule(migrated, project)
    standard = await seed_run(worker_db, project, 3, schedule_id=schedule_id)
    waiting = await seed_run(worker_db, project, 2, trigger="manual", scheduled_for=NOW - MINUTE)
    live = await seed_run(worker_db, project, 1, trigger="manual", endpoint="live")
    backfill = await seed_run(worker_db, project, 1, trigger="backfill", scheduled_for=NOW - MINUTE)
    outbox = Outbox()

    report = await _dispatch(worker_db, _registry(FakeProvider(size=2)), outbox)

    assert report == DispatchReport(claimed=7, batches=5)
    shape = [(batch.endpoint, batch.priority, len(batch.tasks)) for batch in outbox.sent]
    # High first (the older batch first), then standard in twos, then the backfill.
    assert shape == [
        ("serp", "high", 2),
        ("live", "high", 1),
        ("serp", "standard", 2),
        ("serp", "standard", 1),
        ("serp", "low", 1),
    ]
    assert {batch.provider for batch in outbox.sent} == {"fake"}
    # Every task is in exactly one batch, and is marked as on its way.
    sent = [key.id for batch in outbox.sent for key in batch.tasks]
    assert len(sent) == len(set(sent)) == 7
    for run_id in (standard, waiting, live, backfill):
        assert all(row["dispatched_at"] == NOW for row in await task_rows(migrated, run_id))

    # Nothing is sent a second time while it is on its way.
    assert await _dispatch(worker_db, _registry(FakeProvider(size=2)), outbox) == DispatchReport()


async def test_a_batch_that_cannot_be_sent_is_back_in_line_at_once(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    run_id = await seed_run(worker_db, project, 3)
    outbox = Outbox()
    outbox.broken = True

    report = await _dispatch(worker_db, _registry(), outbox)

    assert report == DispatchReport(claimed=3, batches=0, released=3)
    assert {row["dispatched_at"] for row in await task_rows(migrated, run_id)} == {None}

    outbox.broken = False
    assert await _dispatch(worker_db, _registry(), outbox) == DispatchReport(claimed=3, batches=1)


async def test_a_batch_already_waiting_in_the_queue_keeps_its_tasks(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    """The reconciler released the tasks of a message that was only slow. The same batch is
    claimed again; the one in the queue will take it."""
    project = await make_tenant(migrated)
    run_id = await seed_run(worker_db, project, 2)
    outbox = Outbox()
    await _dispatch(worker_db, _registry(), outbox)
    await execute(migrated, "UPDATE ops.collection_tasks SET dispatched_at = NULL")

    report = await _dispatch(worker_db, _registry(), outbox)

    assert report == DispatchReport(claimed=2, batches=1)
    assert len(outbox.sent) == 1
    assert {row["dispatched_at"] for row in await task_rows(migrated, run_id)} == {NOW}


async def test_work_whose_budget_is_used_up_is_held_back_and_its_run_says_so(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    spent = await make_tenant(migrated)
    other = await make_tenant(migrated)
    budget_id = await make_budget(migrated, spent, "1.00")
    await spend(migrated, spent, "1")
    held = await seed_run(worker_db, spent, 2)
    # The same project's work of another budget group is not held.
    prompts = await seed_run(worker_db, spent, 1, workload=TaskWorkload.AI_PROMPT)
    free = await seed_run(worker_db, other, 1)
    outbox = Outbox()

    report = await _dispatch(worker_db, _registry(), outbox)

    assert report == DispatchReport(held=1, claimed=2, batches=1)
    assert {row["dispatched_at"] for row in await task_rows(migrated, held)} == {None}
    for sent in (prompts, free):
        assert {row["dispatched_at"] for row in await task_rows(migrated, sent)} == {NOW}
    row = await run_row(migrated, held)
    assert (row["status"], row["status_reason"], row["blocked_by_budget_id"]) == (
        "running",
        "budget_exceeded",
        budget_id,
    )

    # More budget: the hold goes, and so does the note on the run.
    await execute(migrated, "UPDATE ops.budgets SET limit_usd = 5")
    assert await _dispatch(worker_db, _registry(), outbox) == DispatchReport(claimed=2, batches=1)
    assert (await run_row(migrated, held))["status_reason"] is None


async def test_work_for_a_paused_or_unknown_provider_waits(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    paused_run = await seed_run(worker_db, project, 1, provider="dataforseo")
    unknown_run = await seed_run(worker_db, project, 1, provider="nobody")
    sent_run = await seed_run(worker_db, project, 1, provider="fake")
    pauses = Pauses()
    await pauses.pause("dataforseo", reason="payment")
    registry = _registry(FakeProvider(), FakeProvider(code="dataforseo"))
    outbox = Outbox()

    report = await _dispatch(worker_db, registry, outbox, pauses)

    assert report == DispatchReport(claimed=1, batches=1)
    assert [batch.provider for batch in outbox.sent] == ["fake"]
    for waiting in (paused_run, unknown_run):
        assert {row["dispatched_at"] for row in await task_rows(migrated, waiting)} == {None}
    assert {row["dispatched_at"] for row in await task_rows(migrated, sent_run)} == {NOW}


@pytest.mark.parametrize(
    "stop",
    [
        "UPDATE core.projects SET status = 'paused' WHERE id = $1",
        "UPDATE core.projects SET deleted_at = now() WHERE id = $1",
        "UPDATE auth.workspaces SET status = 'suspended' "
        "WHERE id = (SELECT workspace_id FROM core.projects WHERE id = $1)",
    ],
)
async def test_a_project_that_stops_collecting_sends_nothing_more(
    worker_db: Ledger, migrated: PostgresServer, stop: str
) -> None:
    project = await make_tenant(migrated)
    run_id = await seed_run(worker_db, project, 2)
    still = await seed_run(worker_db, await make_tenant(migrated), 1)
    await execute(migrated, stop, project.id)
    outbox = Outbox()

    report = await _dispatch(worker_db, _registry(), outbox)

    assert report == DispatchReport(stopped=1, claimed=1, batches=1)
    row = await run_row(migrated, run_id)
    assert (row["status"], row["status_reason"], row["completed_at"]) == (
        "cancelled",
        "project_not_collecting",
        NOW,
    )
    assert {task["dispatched_at"] for task in await task_rows(migrated, run_id)} == {None}
    assert (await run_row(migrated, still))["status"] == "running"


async def test_a_worker_with_no_provider_sends_nothing_but_still_stops_runs(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    await seed_run(worker_db, project, 1)
    stopped = await seed_run(worker_db, project, 1)
    await execute(
        migrated, "UPDATE core.projects SET status = 'archived' WHERE id = $1", project.id
    )

    report = await dispatch(worker_db, Registry(), Outbox(), Pauses(), now=NOW)

    assert report == DispatchReport(stopped=2)
    assert (await run_row(migrated, stopped))["status"] == "cancelled"


def test_a_batch_is_the_same_message_whatever_the_order_of_its_tasks() -> None:
    first, second = (TaskKey(id=number, created_at=NOW) for number in (1, 2))
    one = SubmitBatch(provider="fake", endpoint="serp", priority="high", tasks=[first, second])
    other = SubmitBatch(provider="fake", endpoint="serp", priority="high", tasks=[second, first])

    assert one.dedupe_key == other.dedupe_key
    assert one.dedupe_key.startswith("submit:")
    assert one.refs[0].id == 1


@pytest.mark.parametrize(
    "fields",
    [
        {"tasks": []},
        {"tasks": [{"id": 1, "created_at": NOW.isoformat()}] * 1001},
        {"provider": ""},
        {"priority": "urgent"},
        {"extra": "field"},
    ],
)
def test_a_batch_message_is_checked(fields: dict[str, object]) -> None:
    values: dict[str, object] = {
        "provider": "fake",
        "endpoint": "serp",
        "priority": "standard",
        "tasks": [{"id": 1, "created_at": NOW.isoformat()}],
        **fields,
    }
    with pytest.raises(ValidationError):
        SubmitBatch.model_validate(values)


class _BadSize(FakeProvider):
    def __init__(self, code: str, size: int | None) -> None:
        super().__init__(code=code)
        self.wrong = size

    def batch_size(self, endpoint: str) -> int:
        if self.wrong is None:
            raise RuntimeError("the endpoint table has no entry")
        return self.wrong


@pytest.mark.parametrize("size", [0, -1, None])
async def test_a_provider_that_cannot_say_its_batch_size_holds_up_only_its_own_tasks(
    worker_db: Ledger, migrated: PostgresServer, size: int | None
) -> None:
    """Its tasks are claimed and left unmarked, not marked and stranded for ten minutes."""
    project = await make_tenant(migrated)
    broken = await seed_run(worker_db, project, 2, provider="broken")
    fine = await seed_run(worker_db, project, 1)
    outbox = Outbox()

    report = await _dispatch(worker_db, _registry(FakeProvider(), _BadSize("broken", size)), outbox)

    assert report == DispatchReport(claimed=3, batches=1)
    assert [batch.provider for batch in outbox.sent] == ["fake"]
    assert {row["dispatched_at"] for row in await task_rows(migrated, broken)} == {None}
    assert {row["dispatched_at"] for row in await task_rows(migrated, fine)} == {NOW}


async def test_work_of_a_workload_this_worker_does_not_have_is_left_alone(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    unknown = await seed_run(worker_db, project, 1, workload=TaskWorkload.KEYWORD_METRICS)
    outbox = Outbox()

    assert await _dispatch(worker_db, _registry(), outbox) == DispatchReport()
    assert {row["dispatched_at"] for row in await task_rows(migrated, unknown)} == {None}


async def test_the_oldest_tasks_of_a_group_go_in_its_first_batch(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    """Planned in one order, due in another: the batches follow when the tasks are due."""
    project = await make_tenant(migrated)
    run_id = await seed_run(worker_db, project, 3)
    for subject, minutes in (("keyword-0", 1), ("keyword-1", 2), ("keyword-2", 3)):
        await execute(
            migrated,
            "UPDATE ops.collection_tasks SET scheduled_for = $3 "
            "WHERE run_id = $1 AND subject_id = $2",
            run_id,
            subject,
            NOW - minutes * MINUTE,
        )
    by_subject = {row["id"]: row["subject_id"] for row in await task_rows(migrated, run_id)}
    outbox = Outbox()

    await _dispatch(worker_db, _registry(FakeProvider(size=2)), outbox)

    first, second = outbox.sent
    assert [by_subject[key.id] for key in first.tasks] == ["keyword-2", "keyword-1"]
    assert [by_subject[key.id] for key in second.tasks] == ["keyword-0"]
