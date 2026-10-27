"""Finding finished tasks, fetching them and resolving submissions of unknown outcome
(docs/06-dataforseo-seo-integration.md sections 4.2 and 4.3, docs/21-scheduler-workers.md
sections 6 and 8). As `app_worker`, with a fake provider and payloads kept in memory."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors import ledger, reconciler
from idraft.collectors.fetching import RETENTION_CLASS, FetchTask, fetch_task, poll_ready
from idraft.collectors.ledger import TaskRef, database_time
from idraft.collectors.reconciler import reconcile
from idraft.domain.retries import ProviderErrorKind as K
from idraft.domain.retries import RetryDecision
from idraft.domain.workloads import TaskWorkload
from idraft.providers.contract import (
    Echo,
    FetchResult,
    ProviderCallError,
    ProviderError,
    ReadyTask,
    SubmittedTask,
)
from idraft.storage.raw import RawStorageError
from tests.api.auth.support import execute, fetch
from tests.collectors.support import FakeProvider, task_rows
from tests.collectors.test_submission import World, _one_batch
from tests.conftest import PostgresServer

Ledger = async_sessionmaker[AsyncSession]


class Fetches:
    """The way onto the queue for fetches, kept in memory."""

    def __init__(self) -> None:
        self.sent: list[FetchTask] = []
        self.fails = False

    async def send(self, order: FetchTask) -> bool:
        if self.fails:
            raise ConnectionError("redis is down")
        self.sent.append(order)
        return True


class MemoryStore:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.fails = False

    async def put(self, key: str, data: bytes) -> None:
        if self.fails:
            raise RawStorageError("storing a payload failed: InternalError")
        self.objects[key] = data

    async def get(self, key: str) -> bytes:
        return self.objects[key]


@pytest.fixture
def world(worker_db: Ledger) -> World:
    return World(worker_db)


async def _submitted(world: World, pg: PostgresServer, tasks: int = 3) -> tuple[UUID, list[Any]]:
    run_id, batch = await _one_batch(world, pg, tasks)
    await world.submit(batch)
    return run_id, await task_rows(pg, run_id)


def _listed(row: dict[str, Any], **changes: Any) -> ReadyTask:
    echo = {"task_id": str(row["id"]), "run_id": row["run_id"], "attempt": row["attempts"]}
    echo.update(changes)
    return ReadyTask(provider_task_id=row["provider_task_id"], echo=Echo(**echo))


async def _poll(world: World, fetches: Fetches) -> Any:
    now = await database_time(world.sessions)
    return await poll_ready(world.sessions, world.registry, fetches, now=now)


async def _fetch_all(world: World, store: MemoryStore, orders: list[FetchTask]) -> list[str]:
    return [
        await fetch_task(world.sessions, world.registry, store, order, jitter=lambda: 0.0)
        for order in orders
    ]


async def _clock(pg: PostgresServer) -> Any:
    (row,) = await fetch(pg, "SELECT now() AS now")
    return row["now"]


# Polling


async def test_tasks_listed_as_ready_are_marked_and_fetched_once_each(
    world: World, migrated: PostgresServer
) -> None:
    run_id, rows = await _submitted(world, migrated)
    world.provider.ready = [_listed(row) for row in rows]
    fetches = Fetches()

    report = await _poll(world, fetches)

    assert report.ready == 3
    after = await task_rows(migrated, run_id)
    assert {(row["status"], row["ready_source"]) for row in after} == {("ready", "poll")}
    assert all(row["ready_at"] is not None for row in after)
    assert sorted(order.task_id for order in fetches.sent) == sorted(row["id"] for row in rows)
    assert {order.provider_task_id for order in fetches.sent} == {
        row["provider_task_id"] for row in rows
    }
    # Listed again: nothing more to send.
    again = await _poll(world, fetches)
    assert again.ready == 0
    assert len(fetches.sent) == 3


async def test_a_listing_that_does_not_name_the_task_for_certain_is_passed_over(
    world: World, migrated: PostgresServer
) -> None:
    run_id, (row,) = await _submitted(world, migrated, tasks=1)
    world.provider.ready = [
        # Another installation's task: its tag says nothing to this one.
        ReadyTask(provider_task_id=row["provider_task_id"], echo=Echo()),
        _listed(row, attempt=row["attempts"] + 1),
        _listed(row, run_id=uuid4()),
        ReadyTask(provider_task_id="p-another", echo=_listed(row).echo),
    ]
    fetches = Fetches()

    report = await _poll(world, fetches)

    assert report.ready == 0
    assert fetches.sent == []
    assert [task["status"] for task in await task_rows(migrated, run_id)] == ["submitted"]


async def test_only_endpoints_with_submitted_tasks_are_asked(
    world: World, migrated: PostgresServer
) -> None:
    await _poll(world, Fetches())
    assert world.provider.listed == []

    await _submitted(world, migrated, tasks=1)
    await _poll(world, Fetches())

    assert world.provider.listed == ["serp"]


async def test_a_provider_that_cannot_list_is_passed_over(
    world: World, migrated: PostgresServer
) -> None:
    run_id, _ = await _submitted(world, migrated, tasks=1)
    world.provider.reading_fails = ProviderCallError(
        ProviderError(kind=K.PROVIDER_ERROR, message="down")
    )

    report = await _poll(world, Fetches())

    assert report.failed == ("fake/serp",)
    assert [task["status"] for task in await task_rows(migrated, run_id)] == ["submitted"]


async def test_a_fetch_that_cannot_be_sent_leaves_the_task_to_the_sweeper(
    world: World, migrated: PostgresServer
) -> None:
    run_id, (row,) = await _submitted(world, migrated, tasks=1)
    world.provider.ready = [_listed(row)]
    fetches = Fetches()
    fetches.fails = True

    report = await _poll(world, fetches)

    assert report.ready == 1
    (after,) = await task_rows(migrated, run_id)
    assert after["status"] == "submitted"
    assert after["next_attempt_at"] <= await _clock(migrated)


# Fetching


async def test_a_result_is_stored_once_and_the_task_fetched(
    world: World, migrated: PostgresServer
) -> None:
    run_id, rows = await _submitted(world, migrated)
    world.provider.ready = [_listed(row) for row in rows]
    fetches = Fetches()
    await _poll(world, fetches)
    store = MemoryStore()

    outcomes = await _fetch_all(world, store, fetches.sent)

    assert outcomes == ["fetched"] * 3
    after = await task_rows(migrated, run_id)
    assert {row["status"] for row in after} == {"fetched"}
    payloads = await fetch(
        migrated, "SELECT id, provider_endpoint, retention_class, object_key FROM ops.raw_payloads"
    )
    assert {row["id"] for row in payloads} == {row["raw_payload_id"] for row in after}
    assert {(row["provider_endpoint"], row["retention_class"]) for row in payloads} == {
        ("serp", "serp_raw")
    }
    assert all(row["object_key"].startswith("raw/v1/serp_raw/fake/fake_serp/") for row in payloads)
    assert len(store.objects) == 3
    # The same message delivered again asks the provider nothing.
    assert await _fetch_all(world, store, fetches.sent) == ["skipped"] * 3
    assert len(world.provider.fetched) == 3


async def test_a_result_not_ready_yet_is_asked_for_again_later(
    world: World, migrated: PostgresServer
) -> None:
    run_id, (row,) = await _submitted(world, migrated, tasks=1)
    world.provider.ready = [_listed(row)]
    world.provider.results[row["provider_task_id"]] = FetchResult(
        provider_task_id=row["provider_task_id"], status="pending"
    )
    fetches = Fetches()
    await _poll(world, fetches)

    assert await _fetch_all(world, MemoryStore(), fetches.sent) == ["not_ready"]

    (after,) = await task_rows(migrated, run_id)
    assert (after["status"], after["attempts"], after["ready_at"]) == ("submitted", 1, None)
    wait = after["next_attempt_at"] - await _clock(migrated)
    assert timedelta(minutes=29) < wait <= timedelta(minutes=30)


async def test_a_result_the_provider_dropped_is_submitted_again(
    world: World, migrated: PostgresServer
) -> None:
    run_id, (row,) = await _submitted(world, migrated, tasks=1)
    world.provider.ready = [_listed(row)]
    world.provider.results[row["provider_task_id"]] = FetchResult(
        provider_task_id=row["provider_task_id"],
        status="expired",
        error=ProviderError(kind=K.NOT_FOUND_EXPIRED, message="Results expired."),
    )
    fetches = Fetches()
    await _poll(world, fetches)

    assert await _fetch_all(world, MemoryStore(), fetches.sent) == ["failed"]

    (after,) = await task_rows(migrated, run_id)
    assert (after["status"], after["last_error_code"], after["submitted_at"]) == (
        "pending",
        "not_found_expired",
        None,
    )


@pytest.mark.parametrize(
    "failure",
    [
        FetchResult(
            provider_task_id="set-below",
            status="failed",
            error=ProviderError(kind=K.PROVIDER_ERROR, message="Internal error."),
        ),
        ProviderCallError(ProviderError(kind=K.NOT_SENT, message="no turn")),
        RuntimeError("adapter bug"),
    ],
)
async def test_a_fetch_that_may_work_next_time_is_tried_again_and_is_not_an_attempt(
    world: World, migrated: PostgresServer, failure: FetchResult | Exception
) -> None:
    run_id, (row,) = await _submitted(world, migrated, tasks=1)
    world.provider.ready = [_listed(row)]
    fetches = Fetches()
    await _poll(world, fetches)
    if isinstance(failure, FetchResult):
        world.provider.results[row["provider_task_id"]] = failure.model_copy(
            update={"provider_task_id": row["provider_task_id"]}
        )
    else:
        world.provider.reading_fails = failure

    assert await _fetch_all(world, MemoryStore(), fetches.sent) == ["retry"]

    (after,) = await task_rows(migrated, run_id)
    assert (after["status"], after["attempts"]) == ("submitted", 1)
    assert after["last_error_code"] is not None
    wait = after["next_attempt_at"] - await _clock(migrated)
    assert timedelta(minutes=4) < wait <= timedelta(minutes=5)


async def test_a_fetch_refused_for_good_fails_the_task(
    world: World, migrated: PostgresServer
) -> None:
    run_id, (row,) = await _submitted(world, migrated, tasks=1)
    world.provider.ready = [_listed(row)]
    world.provider.results[row["provider_task_id"]] = FetchResult(
        provider_task_id=row["provider_task_id"],
        status="failed",
        error=ProviderError(kind=K.INVALID_REQUEST, message="Invalid Field."),
    )
    fetches = Fetches()
    await _poll(world, fetches)

    assert await _fetch_all(world, MemoryStore(), fetches.sent) == ["failed"]

    (after,) = await task_rows(migrated, run_id)
    assert (after["status"], after["last_error_code"]) == ("failed", "invalid_request")
    assert after["completed_at"] is not None


async def test_a_result_that_cannot_be_stored_is_fetched_again_and_nothing_registered(
    world: World, migrated: PostgresServer
) -> None:
    run_id, (row,) = await _submitted(world, migrated, tasks=1)
    world.provider.ready = [_listed(row)]
    fetches = Fetches()
    await _poll(world, fetches)
    store = MemoryStore()
    store.fails = True

    assert await _fetch_all(world, store, fetches.sent) == ["retry"]

    (after,) = await task_rows(migrated, run_id)
    assert (after["status"], after["last_error_code"]) == ("submitted", "storage_failed")
    assert await fetch(migrated, "SELECT id FROM ops.raw_payloads") == []


# The reconciler: the sweeper, lost fetches, unknown submissions


async def _reconcile(world: World, fetches: Fetches | None = None, **options: Any) -> Any:
    now = await database_time(world.sessions)
    return await reconcile(world.sessions, world.registry, now=now, fetches=fetches, **options)


async def test_a_task_not_listed_as_ready_for_two_hours_is_fetched_directly(
    world: World, migrated: PostgresServer
) -> None:
    run_id, rows = await _submitted(world, migrated)
    old, waiting, young = rows
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET submitted_at = now() - interval '3 hours' "
        "WHERE id = ANY($1)",
        [old["id"], waiting["id"]],
    )
    # Asked already, and not due again yet.
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET next_attempt_at = now() + interval '10 minutes' "
        "WHERE id = $1",
        waiting["id"],
    )
    fetches = Fetches()

    report = await _reconcile(world, fetches)

    assert report.swept == 1
    assert [order.task_id for order in fetches.sent] == [old["id"]]
    after = {row["id"]: row for row in await task_rows(migrated, run_id)}
    assert (after[old["id"]]["status"], after[old["id"]]["ready_source"]) == ("ready", "sweeper")
    assert after[waiting["id"]]["status"] == after[young["id"]]["status"] == "submitted"


async def test_a_task_whose_fetch_was_lost_is_fetched_again(
    world: World, migrated: PostgresServer
) -> None:
    run_id, (row,) = await _submitted(world, migrated, tasks=1)
    world.provider.ready = [_listed(row)]
    await _poll(world, Fetches())
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET ready_at = now() - interval '20 minutes' WHERE id = $1",
        row["id"],
    )
    fetches = Fetches()

    report = await _reconcile(world, fetches)

    assert (report.stale_ready, report.swept) == (1, 1)
    assert [order.task_id for order in fetches.sent] == [row["id"]]
    (after,) = await task_rows(migrated, run_id)
    assert (after["status"], after["ready_source"]) == ("ready", "sweeper")


async def _unknown(world: World, pg: PostgresServer, *, age: str = "20 minutes") -> list[Any]:
    world.provider.lists_submissions = True
    world.provider.fail_with(K.TIMEOUT, "no answer")
    run_id, batch = await _one_batch(world, pg, 3)
    await world.submit(batch)
    await execute(
        pg,
        f"UPDATE ops.collection_tasks SET submitted_at = now() - interval '{age}' "
        "WHERE run_id = $1",
        run_id,
    )
    return await task_rows(pg, run_id)


def _posted(row: dict[str, Any], provider_task_id: str) -> SubmittedTask:
    return SubmittedTask(
        provider_task_id=provider_task_id,
        echo=Echo(task_id=str(row["id"]), run_id=row["run_id"], attempt=row["attempts"]),
        cost_usd=Decimal("0.0006"),
    )


async def test_an_unknown_submission_found_by_its_tag_is_submitted_and_one_not_found_is_sent_again(
    world: World, migrated: PostgresServer
) -> None:
    found, lost, also_lost = await _unknown(world, migrated)
    world.provider.posted = [_posted(found, "p-found")]

    report = await _reconcile(world, resolve_unknown_submissions=True)

    assert (report.resolved, report.resubmitted) == (1, 2)
    after = {row["id"]: row for row in await task_rows(migrated, found["run_id"])}
    assert (after[found["id"]]["status"], after[found["id"]]["provider_task_id"]) == (
        "submitted",
        "p-found",
    )
    for task in (lost, also_lost):
        assert (after[task["id"]]["status"], after[task["id"]]["attempts"]) == ("pending", 1)
        assert after[task["id"]]["last_error_code"] == "submission_not_found"
        # Sent again after the wait for a call that timed out, not at once.
        wait = after[task["id"]]["next_attempt_at"] - await _clock(migrated)
        assert timedelta(seconds=55) < wait <= timedelta(seconds=72)
    # Paid for once, as the provider says, in the month it was sent.
    costs = await fetch(
        migrated, "SELECT task_id, cost_usd, occurred_at FROM ops.provider_cost_events"
    )
    assert [(row["task_id"], row["cost_usd"]) for row in costs] == [
        (found["id"], Decimal("0.000600"))
    ]
    assert costs[0]["occurred_at"] == after[found["id"]]["submitted_at"]
    # One look: from a minute before the submission to the end of its grace.
    ((endpoint, since, until),) = world.provider.looked
    submitted_at = after[found["id"]]["submitted_at"]
    assert endpoint == "serp"
    assert (since, until) == (
        submitted_at - timedelta(minutes=1),
        submitted_at + timedelta(minutes=15),
    )


async def test_a_listing_of_another_attempt_is_not_this_one(
    world: World, migrated: PostgresServer
) -> None:
    rows = await _unknown(world, migrated)
    world.provider.posted = [
        _posted({**row, "attempts": row["attempts"] + 1}, f"p-{row['id']}") for row in rows
    ]

    report = await _reconcile(world, resolve_unknown_submissions=True)

    assert (report.resolved, report.resubmitted) == (0, 3)


async def test_an_untagged_listing_stops_anything_being_sent_again(
    world: World, migrated: PostgresServer
) -> None:
    """A task listed without a tag may be ours: its absence proves nothing."""
    found, *others = await _unknown(world, migrated)
    world.provider.posted = [
        _posted(found, "p-found"),
        SubmittedTask(provider_task_id="p-untagged", tagged=False),
    ]

    report = await _reconcile(world, resolve_unknown_submissions=True)

    assert (report.resolved, report.resubmitted) == (1, 0)
    assert "resolved" in report.failed
    after = {row["id"]: row["status"] for row in await task_rows(migrated, found["run_id"])}
    assert [after[row["id"]] for row in others] == ["submit_unknown", "submit_unknown"]


async def test_a_submission_not_found_for_the_last_time_ends_the_task(
    world: World, migrated: PostgresServer
) -> None:
    rows = await _unknown(world, migrated)
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET attempts = 4 WHERE run_id = $1",
        rows[0]["run_id"],
    )

    report = await _reconcile(world, resolve_unknown_submissions=True)

    assert report.resubmitted == 3
    after = await task_rows(migrated, rows[0]["run_id"])
    assert {(row["status"], row["last_error_code"]) for row in after} == {
        ("dead", "submission_not_found")
    }
    # Never had by the provider: nothing is charged.
    assert await fetch(migrated, "SELECT id FROM ops.provider_cost_events") == []


async def test_submissions_made_together_are_looked_for_together(
    world: World, migrated: PostgresServer
) -> None:
    rows = await _unknown(world, migrated)
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET submitted_at = submitted_at + interval '30 seconds' "
        "WHERE id = $1",
        rows[0]["id"],
    )

    await _reconcile(world, resolve_unknown_submissions=True)

    ((_, since, until),) = world.provider.looked
    assert until - since == timedelta(minutes=16, seconds=30)


async def test_an_answer_for_another_attempt_changes_nothing(
    world: World, migrated: PostgresServer
) -> None:
    (row, *_) = await _unknown(world, migrated)
    decision = RetryDecision(status="pending")

    async with world.sessions() as db, db.begin():
        changed = await ledger.submit_again(
            db,
            TaskRef(id=row["id"], created_at=row["created_at"]),
            attempt=row["attempts"] + 1,
            decision=decision,
            now=await ledger.transaction_time(db),
        )

    assert changed is False


# Guards on each step


async def test_a_fetch_for_an_older_provider_task_asks_nothing(
    world: World, migrated: PostgresServer
) -> None:
    """The task was sent again since: the message names the old provider task."""
    _, (row,) = await _submitted(world, migrated, tasks=1)
    world.provider.ready = [_listed(row)]
    fetches = Fetches()
    await _poll(world, fetches)
    stale = fetches.sent[0].model_copy(update={"provider_task_id": "p-old"})

    assert await _fetch_all(world, MemoryStore(), [stale]) == ["skipped"]
    assert world.provider.fetched == []


async def test_a_listing_under_another_provider_matches_nothing(
    world: World, migrated: PostgresServer
) -> None:
    _, (row,) = await _submitted(world, migrated, tasks=1)
    match = ledger.ReadyMatch(
        task_id=row["id"],
        run_id=row["run_id"],
        attempt=row["attempts"],
        provider_task_id=row["provider_task_id"],
    )

    async with world.sessions() as db, db.begin():
        now = await ledger.transaction_time(db)
        assert await ledger.mark_ready(db, "another", [match], now=now) == []
        assert len(await ledger.mark_ready(db, "fake", [match], now=now)) == 1


async def test_only_a_fetch_lost_for_long_is_released(
    world: World, migrated: PostgresServer
) -> None:
    run_id, rows = await _submitted(world, migrated, tasks=2)
    world.provider.ready = [_listed(row) for row in rows]
    await _poll(world, Fetches())
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET ready_at = now() - interval '20 minutes' WHERE id = $1",
        rows[0]["id"],
    )

    report = await _reconcile(world)

    assert report.stale_ready == 1
    after = {row["id"]: row["status"] for row in await task_rows(migrated, run_id)}
    assert (after[rows[0]["id"]], after[rows[1]["id"]]) == ("submitted", "ready")


async def test_the_sweeper_takes_no_more_than_its_limit_a_pass(
    world: World, migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(reconciler, "SWEEP_LIMIT", 1)
    run_id, _ = await _submitted(world, migrated, tasks=2)
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET submitted_at = now() - interval '3 hours' "
        "WHERE run_id = $1",
        run_id,
    )
    fetches = Fetches()

    assert (await _reconcile(world, fetches)).swept == 1
    assert len(fetches.sent) == 1


async def test_a_wait_the_provider_names_is_kept(world: World, migrated: PostgresServer) -> None:
    run_id, (row,) = await _submitted(world, migrated, tasks=1)
    world.provider.ready = [_listed(row)]
    fetches = Fetches()
    await _poll(world, fetches)
    world.provider.reading_fails = ProviderCallError(
        ProviderError(kind=K.RATE_LIMITED, message="slow", retry_after=timedelta(minutes=20))
    )

    await _fetch_all(world, MemoryStore(), fetches.sent)

    (after,) = await task_rows(migrated, run_id)
    wait = after["next_attempt_at"] - await _clock(migrated)
    assert timedelta(minutes=19) < wait <= timedelta(minutes=20)


async def test_a_result_that_does_not_parse_fails_the_task(
    world: World, migrated: PostgresServer
) -> None:
    run_id, (row,) = await _submitted(world, migrated, tasks=1)
    world.provider.ready = [_listed(row)]
    world.provider.results[row["provider_task_id"]] = FetchResult(
        provider_task_id=row["provider_task_id"],
        status="failed",
        error=ProviderError(kind=K.SCHEMA_MISMATCH, message="unreadable"),
    )
    fetches = Fetches()
    await _poll(world, fetches)

    assert await _fetch_all(world, MemoryStore(), fetches.sent) == ["failed"]
    (after,) = await task_rows(migrated, run_id)
    assert after["status"] == "failed"


def test_each_workload_keeps_its_raw_results_as_long_as_its_class_says() -> None:
    assert dict(RETENTION_CLASS) == {
        TaskWorkload.SEO_RANK: "serp_raw",
        TaskWorkload.KEYWORD_METRICS: "serp_raw",
        TaskWorkload.DISCOVERY: "serp_raw",
        TaskWorkload.AI_PROMPT: "ai_raw",
        TaskWorkload.AI_MODE_KEYWORD: "ai_raw",
        TaskWorkload.AI_BENCHMARK: "ai_raw",
        TaskWorkload.GSC_SYNC: "first_party_raw",
        TaskWorkload.BING_SYNC: "first_party_raw",
        TaskWorkload.GA4_SYNC: "first_party_raw",
        TaskWorkload.CLOUDFLARE_SYNC: "first_party_raw",
    }


async def test_a_task_asked_about_again_waits_longer_the_older_it_is(
    world: World, migrated: PostgresServer
) -> None:
    """Not every few minutes for three days: an eighth of its age, up to six hours."""
    run_id, (row,) = await _submitted(world, migrated, tasks=1)
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET submitted_at = now() - interval '16 hours' WHERE id = $1",
        row["id"],
    )
    world.provider.ready = [_listed(row)]
    fetches = Fetches()
    await _poll(world, fetches)
    world.provider.reading_fails = ProviderCallError(
        ProviderError(kind=K.PROVIDER_ERROR, message="down")
    )

    await _fetch_all(world, MemoryStore(), fetches.sent)

    (after,) = await task_rows(migrated, run_id)
    wait = after["next_attempt_at"] - await _clock(migrated)
    assert timedelta(hours=1, minutes=59) < wait <= timedelta(hours=2)


async def test_a_result_not_stored_is_kept_for_as_long_as_the_provider_keeps_it(
    world: World, migrated: PostgresServer
) -> None:
    run_id, (row,) = await _submitted(world, migrated, tasks=1)
    world.provider.ready = [_listed(row)]
    fetches = Fetches()
    await _poll(world, fetches)
    store = MemoryStore()
    store.fails = True
    await _fetch_all(world, store, fetches.sent)
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET submitted_at = now() - interval '4 days', "
        "next_attempt_at = now() + interval '1 hour' WHERE id = $1",
        row["id"],
    )

    assert (await _reconcile(world)).dead == 0

    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET submitted_at = now() - interval '31 days' WHERE id = $1",
        row["id"],
    )
    assert (await _reconcile(world)).dead == 1
    (after,) = await task_rows(migrated, run_id)
    assert (after["status"], after["last_error_code"]) == ("dead", "result_not_stored")


async def test_unknown_submissions_are_left_alone_unless_the_resolver_is_on(
    world: World, migrated: PostgresServer
) -> None:
    rows = await _unknown(world, migrated)

    await _reconcile(world)

    assert world.provider.looked == []
    after = await task_rows(migrated, rows[0]["run_id"])
    assert {row["status"] for row in after} == {"submit_unknown"}


async def test_a_submission_too_recent_to_judge_is_not_looked_for(
    world: World, migrated: PostgresServer
) -> None:
    rows = await _unknown(world, migrated, age="5 minutes")

    report = await _reconcile(world, resolve_unknown_submissions=True)

    assert (report.resolved, report.resubmitted) == (0, 0)
    assert world.provider.looked == []
    assert {row["status"] for row in await task_rows(migrated, rows[0]["run_id"])} == {
        "submit_unknown"
    }


async def test_a_provider_that_cannot_be_asked_leaves_the_submissions_unknown(
    world: World, migrated: PostgresServer
) -> None:
    rows = await _unknown(world, migrated)
    world.provider.reading_fails = ProviderCallError(
        ProviderError(kind=K.PROVIDER_ERROR, message="the list could not be read")
    )

    report = await _reconcile(world, resolve_unknown_submissions=True)

    assert (report.resolved, report.resubmitted) == (0, 0)
    assert {row["status"] for row in await task_rows(migrated, rows[0]["run_id"])} == {
        "submit_unknown"
    }


async def test_a_provider_that_cannot_list_its_tasks_is_not_asked(
    world: World, migrated: PostgresServer
) -> None:
    rows = await _unknown(world, migrated)
    world.provider.lists_submissions = False

    await _reconcile(world, resolve_unknown_submissions=True)

    assert world.provider.looked == []
    assert {row["status"] for row in await task_rows(migrated, rows[0]["run_id"])} == {
        "submit_unknown"
    }


# Across the steps (the whole-branch review)


async def test_the_poll_waits_out_the_wait_a_failed_fetch_named(
    world: World, migrated: PostgresServer
) -> None:
    """The provider lists a task until it is fetched: asking every minute would ignore it."""
    run_id, (row,) = await _submitted(world, migrated, tasks=1)
    world.provider.ready = [_listed(row)]
    fetches = Fetches()
    await _poll(world, fetches)
    world.provider.reading_fails = ProviderCallError(
        ProviderError(kind=K.RATE_LIMITED, message="slow", retry_after=timedelta(minutes=10))
    )
    await _fetch_all(world, MemoryStore(), fetches.sent)
    world.provider.reading_fails = None

    again = await _poll(world, fetches)

    assert again.ready == 0
    assert len(fetches.sent) == 1
    (after,) = await task_rows(migrated, run_id)
    assert after["status"] == "submitted"


async def test_a_task_the_provider_failed_is_sent_again_under_the_retry_policy(
    world: World, migrated: PostgresServer
) -> None:
    """It will never have a result: fetching it again for three days would not help."""
    run_id, (row,) = await _submitted(world, migrated, tasks=1)
    world.provider.ready = [_listed(row)]
    world.provider.results[row["provider_task_id"]] = FetchResult(
        provider_task_id=row["provider_task_id"],
        status="failed",
        error=ProviderError(kind=K.UPSTREAM_UNAVAILABLE, message="Source unavailable."),
    )
    fetches = Fetches()
    await _poll(world, fetches)

    assert await _fetch_all(world, MemoryStore(), fetches.sent) == ["failed"]

    (after,) = await task_rows(migrated, run_id)
    assert (after["status"], after["attempts"], after["last_error_code"]) == (
        "pending",
        1,
        "upstream_unavailable",
    )


async def test_a_later_failure_does_not_undo_the_time_kept_for_a_result_not_stored(
    world: World, migrated: PostgresServer
) -> None:
    run_id, (row,) = await _submitted(world, migrated, tasks=1)
    world.provider.ready = [_listed(row)]
    fetches = Fetches()
    await _poll(world, fetches)
    store = MemoryStore()
    store.fails = True
    await _fetch_all(world, store, fetches.sent)
    # Swept again, and this time the provider fails.
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET status = 'ready', ready_at = now() WHERE id = $1",
        row["id"],
    )
    world.provider.reading_fails = ProviderCallError(
        ProviderError(kind=K.PROVIDER_ERROR, message="down")
    )
    await _fetch_all(world, store, fetches.sent)

    (after,) = await task_rows(migrated, run_id)
    assert after["last_error_code"] == "storage_failed"
    assert after["last_error_message"] == "down"


async def test_a_task_accepted_without_a_cost_is_charged_its_estimate_once_fetched(
    world: World, migrated: PostgresServer
) -> None:
    world.provider.price = None
    run_id, (row,) = await _submitted(world, migrated, tasks=1)
    await execute(
        migrated,
        "UPDATE ops.collection_runs SET estimated_cost_usd = 0.003 WHERE id = $1",
        run_id,
    )
    world.provider.ready = [_listed(row)]
    fetches = Fetches()
    await _poll(world, fetches)

    assert await _fetch_all(world, MemoryStore(), fetches.sent) == ["fetched"]

    costs = await fetch(
        migrated, "SELECT task_id, cost_usd, cost_source FROM ops.provider_cost_events"
    )
    assert [(c["task_id"], c["cost_usd"], c["cost_source"]) for c in costs] == [
        (row["id"], Decimal("0.003000"), "price_book_estimate")
    ]


async def test_a_task_of_a_provider_this_worker_does_not_have_is_left_for_later(
    world: World, migrated: PostgresServer
) -> None:
    run_id, (row,) = await _submitted(world, migrated, tasks=1)
    world.provider.ready = [_listed(row)]
    fetches = Fetches()
    await _poll(world, fetches)
    without = World(world.sessions, provider=FakeProvider(code="another"))

    assert await _fetch_all(without, MemoryStore(), fetches.sent) == ["retry"]

    (after,) = await task_rows(migrated, run_id)
    assert (after["status"], after["last_error_code"]) == ("submitted", "provider_not_registered")
    # And the sweeper, which only sweeps providers it has, leaves it alone.
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET next_attempt_at = now() - interval '1 minute' "
        "WHERE id = $1",
        row["id"],
    )
    assert (await _reconcile(without, Fetches())).swept == 0
