"""The parts the worker is assembled from (docs/21-scheduler-workers.md sections 3 and 4)."""

import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from redis.asyncio import Redis

from sightline.collectors.registry import Registry
from sightline.config.settings import Settings
from sightline.db.engine import create_engine, create_session_factory
from sightline.worker.app import WorkerContext
from sightline.worker.assembly import assemble, production_registry
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


@pytest.fixture
async def context(
    worker_settings: Settings, redis: Redis, migrated: PostgresServer
) -> AsyncIterator[WorkerContext]:
    await empty_ledger(migrated)
    engine = create_engine(worker_settings)
    queues = Queues(worker_settings.redis_url.get_secret_value(), redis)
    yield WorkerContext(
        settings=worker_settings,
        engine=engine,
        sessions=create_session_factory(engine),
        redis=redis,
        queues=queues,
    )
    await queues.shutdown()
    await engine.dispose()


async def test_a_schedule_goes_from_the_planner_through_the_queue_to_the_provider(
    context: WorkerContext, migrated: PostgresServer
) -> None:
    registry = Registry()
    registry.add_workload(FakeWorkload(subjects=3))
    provider = FakeProvider()
    registry.add_provider(provider)
    project = await make_tenant(migrated)
    # A one-hour window that began two hours ago: every task in it is due now.
    began = (datetime.now(UTC) - timedelta(hours=2)).replace(second=0, microsecond=0)
    schedule_id = await make_schedule(
        migrated,
        project,
        next_run_at=began,
        window_start_local=began.strftime("%H:%M"),
        window_hours=1,
    )
    ticks = {tick.name: tick for tick in assemble(context, registry)}

    await ticks["planner"].action()
    await ticks["dispatcher"].action()
    await context.queues.startup()
    finish = asyncio.Event()
    receiving = asyncio.create_task(context.queues.receive("collect", concurrency=2, finish=finish))
    try:
        await eventually(lambda: _submitted(migrated, schedule_id, 3), within=10)
    finally:
        finish.set()
        await receiving

    # One call for the three tasks, and every one of them paid for once.
    assert len(provider.calls) == 1
    (costs,) = await fetch(migrated, "SELECT count(*) AS events FROM ops.provider_cost_events")
    assert costs["events"] == 3


async def _submitted(pg: PostgresServer, schedule_id: object, expected: int) -> bool:
    (row,) = await fetch(
        pg,
        "SELECT count(*) AS tasks FROM ops.collection_tasks t "
        "JOIN ops.collection_runs r ON r.id = t.run_id "
        "WHERE r.schedule_id = $1 AND t.status = 'submitted'",
        schedule_id,
    )
    return bool(row["tasks"] == expected)


async def test_the_ticks_run_on_their_intervals_one_worker_at_a_time(
    context: WorkerContext,
) -> None:
    ticks = {tick.name: tick for tick in assemble(context)}

    assert (ticks["planner"].interval, ticks["planner"].lock_ttl) == (
        timedelta(seconds=60),
        timedelta(seconds=55),
    )
    assert (ticks["dispatcher"].interval, ticks["dispatcher"].lock_ttl) == (
        timedelta(seconds=15),
        timedelta(seconds=14),
    )
    # With nothing registered both run and do nothing.
    await ticks["planner"].action()
    await ticks["dispatcher"].action()


async def test_the_reconciler_and_the_partition_job_are_on_the_schedulers_list(
    context: WorkerContext,
) -> None:
    assemble(context)
    source = context.queues.schedule_source()

    await source.startup()
    schedules = {task.task_name: task for task in await source.get_schedules()}

    # Every five minutes, and at ten past midnight UTC (docs/21 section 10).
    assert (schedules["reconcile"].interval, schedules["reconcile"].cron) == (300, None)
    assert schedules["ensure_partitions"].cron == "10 0 * * *"


def test_nothing_is_registered_yet_so_the_deployed_worker_plans_and_spends_nothing() -> None:
    registry = production_registry()
    assert (registry.workloads, registry.providers) == (frozenset(), frozenset())
