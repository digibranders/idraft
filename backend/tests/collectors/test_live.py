"""A batch sent to a live endpoint (plan decision D6): answered in the call, kept once, and its
tasks `fetched` with their share of the cost. As `app_worker`, with a fake provider."""

from collections.abc import Sequence
from decimal import Decimal
from uuid import UUID

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors import live
from sightline.collectors.dispatcher import SubmitBatch
from sightline.collectors.submission import SubmitReport, submit_batch
from sightline.domain.retries import ProviderErrorKind
from sightline.providers.contract import (
    CanonicalRequest,
    LiveResult,
    ProviderCallError,
    ProviderError,
)
from tests.api.auth.support import fetch
from tests.collectors.support import FakeProvider, make_tenant, seed_run, task_rows
from tests.collectors.test_fetching import MemoryStore
from tests.collectors.test_submission import World
from tests.conftest import PostgresServer

Ledger = async_sessionmaker[AsyncSession]
K = ProviderErrorKind
ENDPOINT = "labs"


@pytest.fixture
def world(worker_db: Ledger) -> World:
    provider = FakeProvider(price="0.0012")
    provider.live_endpoints = {ENDPOINT}
    return World(worker_db, provider)


async def _batch(world: World, pg: PostgresServer, tasks: int = 3) -> tuple[UUID, SubmitBatch]:
    run_id = await seed_run(world.sessions, await make_tenant(pg), tasks, endpoint=ENDPOINT)
    (batch,) = await world.dispatch()
    return run_id, batch


async def _submit(world: World, batch: SubmitBatch, store: MemoryStore) -> SubmitReport:
    return await submit_batch(
        world.sessions, world.registry, world.pauses, batch, store=store, jitter=lambda: 0.0
    )


async def test_answered_tasks_are_fetched_with_one_stored_answer_and_their_cost(
    world: World, migrated: PostgresServer
) -> None:
    run_id, batch = await _batch(world, migrated)
    store = MemoryStore()

    report = await _submit(world, batch, store)

    assert report == SubmitReport(fetched=3)
    rows = await task_rows(migrated, run_id)
    assert {(row["status"], row["ready_source"], row["attempts"]) for row in rows} == {
        ("fetched", "live", 1)
    }
    # The call's answer is stored once and every task names it.
    assert len({row["raw_payload_id"] for row in rows}) == 1
    assert len(store.objects) == 1
    events = await fetch(
        migrated,
        "SELECT cost_usd, cost_source, price_unit, units FROM ops.provider_cost_events "
        "WHERE run_id = $1",
        run_id,
    )
    assert [tuple(event) for event in events] == [
        (Decimal("0.001200"), "provider_reported", "item", 1)
    ] * 3
    # Nothing is submitted to the task endpoint.
    assert world.provider.calls == []
    assert [len(requests) for _, requests in world.provider.live_calls] == [3]


async def test_a_failed_call_puts_its_tasks_back_under_the_retry_policy(
    world: World, migrated: PostgresServer
) -> None:
    async def refuse(endpoint: str, requests: Sequence[CanonicalRequest]) -> Sequence[LiveResult]:
        raise ProviderCallError(ProviderError(kind=K.TIMEOUT, message="keyword 'secret' timed out"))

    world.provider.live_answer = refuse
    run_id, batch = await _batch(world, migrated, tasks=2)

    report = await _submit(world, batch, MemoryStore())

    assert report == SubmitReport(refused=2)
    rows = await task_rows(migrated, run_id)
    # A live call leaves nothing to fetch later, so a timeout is tried again.
    assert {(row["status"], row["last_error_code"]) for row in rows} == {("pending", "timeout")}
    # The provider's words may quote another workspace's keyword: they stay in the log.
    assert all("secret" not in row["last_error_message"] for row in rows)


async def test_an_answer_that_cannot_be_stored_is_asked_for_again(
    world: World, migrated: PostgresServer
) -> None:
    run_id, batch = await _batch(world, migrated, tasks=1)
    store = MemoryStore()
    store.fails = True

    report = await _submit(world, batch, store)

    assert report == SubmitReport(refused=1)
    (row,) = await task_rows(migrated, run_id)
    assert (row["status"], row["last_error_message"]) == ("pending", live.NOT_STORED)


async def test_a_task_the_answer_leaves_out_and_a_refused_one_go_to_the_policy(
    world: World, migrated: PostgresServer
) -> None:
    async def partly(endpoint: str, requests: Sequence[CanonicalRequest]) -> Sequence[LiveResult]:
        first, second, _third = requests
        return [
            LiveResult(task_id=first.task_id, status="ready", body=b"{}", cost_usd=None),
            LiveResult(
                task_id=second.task_id,
                status="failed",
                error=ProviderError(kind=K.INVALID_REQUEST, message="not sent: too long"),
            ),
        ]

    world.provider.live_answer = partly
    run_id, batch = await _batch(world, migrated)

    report = await _submit(world, batch, MemoryStore())

    assert report == SubmitReport(fetched=1, refused=2)
    statuses = sorted(row["status"] for row in await task_rows(migrated, run_id))
    # Refused for good, asked for again, and fetched (charged its estimate, with no cost).
    assert statuses == ["failed", "fetched", "pending"]


async def test_an_account_problem_pauses_the_provider(
    world: World, migrated: PostgresServer
) -> None:
    async def unpaid(endpoint: str, requests: Sequence[CanonicalRequest]) -> Sequence[LiveResult]:
        raise ProviderCallError(ProviderError(kind=K.PAYMENT, message="balance"))

    world.provider.live_answer = unpaid
    run_id, batch = await _batch(world, migrated, tasks=1)

    await _submit(world, batch, MemoryStore())

    assert world.pauses.reasons == {"fake": "payment"}
    (row,) = await task_rows(migrated, run_id)
    # Not an attempt: the provider refuses everyone, not this task.
    assert (row["status"], row["attempts"]) == ("pending", 0)


async def test_a_live_batch_without_storage_is_refused_before_anything_is_taken(
    world: World, migrated: PostgresServer
) -> None:
    run_id, batch = await _batch(world, migrated, tasks=1)

    with pytest.raises(RuntimeError, match="raw storage"):
        await submit_batch(world.sessions, world.registry, world.pauses, batch)

    (row,) = await task_rows(migrated, run_id)
    assert row["status"] == "pending"
