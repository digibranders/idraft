"""The worker as one process, end to end (docs/21-scheduler-workers.md principle 1: nothing lives
only in Redis, and nothing is paid for twice).

The real process loop with a fake workload and a fake provider, on real PostgreSQL and Redis.
Its intervals are shortened so a test takes seconds, not minutes.
"""

import asyncio
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from functools import partial
from uuid import UUID

import pytest
from redis.asyncio import Redis

from sightline.collectors import reconciler
from sightline.collectors.registry import Registry
from sightline.config.settings import Settings
from sightline.db.engine import create_engine, create_session_factory
from sightline.providers.contract import CanonicalRequest, SubmitResult
from sightline.worker import assembly
from sightline.worker.app import WorkerContext, run_worker
from sightline.worker.queues import Queues
from tests.api.auth.support import fetch
from tests.collectors.support import (
    FakeProvider,
    FakeWorkload,
    empty_ledger,
    make_schedule,
    make_tenant,
)
from tests.conftest import PostgresServer
from tests.worker.conftest import eventually


@pytest.fixture(autouse=True)
def quick(monkeypatch: pytest.MonkeyPatch) -> None:
    """Seconds where production has minutes."""
    monkeypatch.setattr(assembly, "PLANNER_EVERY", timedelta(seconds=1))
    monkeypatch.setattr(assembly, "PLANNER_LOCK", timedelta(milliseconds=900))
    monkeypatch.setattr(assembly, "DISPATCHER_EVERY", timedelta(milliseconds=500))
    monkeypatch.setattr(assembly, "DISPATCHER_LOCK", timedelta(milliseconds=400))
    monkeypatch.setattr(assembly, "RECONCILE_EVERY", timedelta(seconds=1))
    monkeypatch.setattr(reconciler, "STALE_DISPATCH", timedelta(seconds=2))


class World:
    def __init__(self, subjects: int, batch_size: int) -> None:
        self.workload = FakeWorkload(subjects=subjects)
        self.provider = FakeProvider(size=batch_size)
        self.registry = Registry()
        self.registry.add_workload(self.workload)
        self.registry.add_provider(self.provider)

    @property
    def sent(self) -> list[str]:
        """Every task id the provider was sent, as often as it was sent."""
        return [request.task_id for _, requests in self.provider.calls for request in requests]


async def _due_schedule(pg: PostgresServer) -> UUID:
    """A daily schedule whose one-hour window began two hours ago: all its tasks are due."""
    await empty_ledger(pg)
    began = (datetime.now(UTC) - timedelta(hours=2)).replace(second=0, microsecond=0)
    return await make_schedule(
        pg,
        await make_tenant(pg),
        next_run_at=began,
        window_start_local=began.strftime("%H:%M"),
        window_hours=1,
    )


async def _statuses(pg: PostgresServer, schedule_id: UUID) -> list[str]:
    rows = await fetch(
        pg,
        "SELECT t.status FROM ops.collection_tasks t "
        "JOIN ops.collection_runs r ON r.id = t.run_id WHERE r.schedule_id = $1",
        schedule_id,
    )
    return sorted(row["status"] for row in rows)


async def _all_submitted(pg: PostgresServer, schedule_id: UUID, count: int) -> bool:
    return await _statuses(pg, schedule_id) == ["submitted"] * count


async def _cost_events(pg: PostgresServer) -> int:
    (row,) = await fetch(pg, "SELECT count(*) AS events FROM ops.provider_cost_events")
    return int(row["events"])


def _worker(settings: Settings, world: World, stop: asyncio.Event) -> asyncio.Task[bool]:
    return asyncio.create_task(
        run_worker(settings, partial(assembly.assemble, registry=world.registry), stop)
    )


async def test_a_schedule_becomes_submitted_tasks(
    worker_settings: Settings, redis: Redis, migrated: PostgresServer
) -> None:
    schedule_id = await _due_schedule(migrated)
    world = World(subjects=5, batch_size=2)
    stop = asyncio.Event()

    worker = _worker(worker_settings, world, stop)
    try:
        await eventually(lambda: _all_submitted(migrated, schedule_id, 5), within=30)
    finally:
        stop.set()
        assert await asyncio.wait_for(worker, timeout=30) is True

    # Three calls of at most two, and each task sent and paid for once.
    assert sorted(len(requests) for _, requests in world.provider.calls) == [1, 2, 2]
    assert len(world.sent) == len(set(world.sent)) == 5
    assert await _cost_events(migrated) == 5


async def test_work_lost_with_redis_comes_back_and_is_not_paid_for_twice(
    worker_settings: Settings, redis: Redis, migrated: PostgresServer
) -> None:
    """The dispatcher sent the batches, then Redis was wiped before any worker read them. The
    ledger still says the tasks are on their way; the reconciler sees they never arrived."""
    schedule_id = await _due_schedule(migrated)
    world = World(subjects=4, batch_size=2)
    # Plan and dispatch by hand, with nobody reading the queue.
    engine = create_engine(worker_settings)
    context = WorkerContext(
        settings=worker_settings,
        engine=engine,
        sessions=create_session_factory(engine),
        redis=redis,
        queues=Queues(worker_settings.redis_url.get_secret_value(), redis),
    )
    ticks = {tick.name: tick for tick in assembly.assemble(context, world.registry)}
    await ticks["planner"].action()
    await ticks["dispatcher"].action()
    await context.queues.shutdown()
    await engine.dispose()
    assert await redis.xlen("collect") == 2

    await redis.flushdb()
    stop = asyncio.Event()
    worker = _worker(worker_settings, world, stop)
    try:
        await eventually(lambda: _all_submitted(migrated, schedule_id, 4), within=30)
        # A few more passes of everything: nothing is sent again.
        await asyncio.sleep(3)
    finally:
        stop.set()
        assert await asyncio.wait_for(worker, timeout=30) is True

    assert len(world.sent) == len(set(world.sent)) == 4
    assert await _cost_events(migrated) == 4


async def test_a_worker_stopped_mid_run_leaves_the_rest_to_the_next_one(
    worker_settings: Settings, redis: Redis, migrated: PostgresServer
) -> None:
    schedule_id = await _due_schedule(migrated)
    world = World(subjects=6, batch_size=1)
    first_call = asyncio.Event()
    accept = world.provider.accept_all

    async def slow(endpoint: str, requests: Sequence[CanonicalRequest]) -> SubmitResult:
        first_call.set()
        await asyncio.sleep(0.5)
        return await accept(endpoint, requests)

    world.provider.answer = slow
    stop = asyncio.Event()
    worker = _worker(worker_settings.model_copy(update={"collect_concurrency": 1}), world, stop)
    await asyncio.wait_for(first_call.wait(), timeout=30)
    # A deploy: the call in flight is let finish, and nothing more is taken.
    stop.set()
    assert await asyncio.wait_for(worker, timeout=30) is True
    done_by_first = len(world.sent)
    assert 1 <= done_by_first < 6

    stop = asyncio.Event()
    worker = _worker(worker_settings, world, stop)
    try:
        await eventually(lambda: _all_submitted(migrated, schedule_id, 6), within=30)
    finally:
        stop.set()
        assert await asyncio.wait_for(worker, timeout=30) is True

    assert len(world.sent) == len(set(world.sent)) == 6
    assert await _cost_events(migrated) == 6
