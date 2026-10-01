"""The parts the worker is assembled from (docs/21-scheduler-workers.md sections 3 and 4)."""

import asyncio
from collections.abc import AsyncIterator
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from pydantic import SecretStr
from redis.asyncio import Redis

from sightline.collectors.fetching import FETCH_JOB, FetchTask
from sightline.collectors.registry import Registry
from sightline.config.settings import Settings
from sightline.db.engine import create_engine, create_session_factory
from sightline.domain.workloads import TaskWorkload
from sightline.worker import assembly
from sightline.worker.app import WorkerContext
from sightline.worker.assembly import assemble, fetch_handler, production_registry
from sightline.worker.queues import Queues
from sightline.worker.ticks import Tick
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


async def test_a_failed_planner_step_does_not_hold_up_the_due_schedules(
    context: WorkerContext, migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    registry = Registry()
    registry.add_workload(FakeWorkload(subjects=2))
    registry.add_provider(FakeProvider())
    project = await make_tenant(migrated)
    began = (datetime.now(UTC) - timedelta(hours=2)).replace(second=0, microsecond=0)
    schedule_id = await make_schedule(
        migrated,
        project,
        next_run_at=began,
        window_start_local=began.strftime("%H:%M"),
        window_hours=1,
    )

    async def broken(*args: object, **kwargs: object) -> object:
        raise RuntimeError("manual runs could not be read")

    monkeypatch.setattr(assembly, "plan_manual_runs", broken)
    ticks = ticks_of(context, registry)

    # The tick fails, so its failure is seen; the schedule is planned all the same.
    with pytest.raises(RuntimeError, match="manual runs"):
        await ticks["planner"].action()
    runs = await fetch(
        migrated, "SELECT status FROM ops.collection_runs WHERE schedule_id = $1", schedule_id
    )
    assert [row["status"] for row in runs] == ["running"]


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

    # Every five minutes, at ten past midnight UTC, and monthly on the 2nd (docs/21 section 10).
    assert (schedules["reconcile"].interval, schedules["reconcile"].cron) == (300, None)
    assert schedules["ensure_partitions"].cron == "10 0 * * *"
    assert schedules["location_sync"].cron == "0 3 2 * *"


def test_without_credentials_nothing_is_registered_so_the_worker_spends_nothing(
    context: WorkerContext,
) -> None:
    registry = production_registry(context)
    assert (registry.workloads, registry.providers) == (frozenset(), frozenset())


async def test_dataforseo_is_registered_with_its_credentials_and_keyword_metrics_with_it(
    context: WorkerContext,
) -> None:
    settings = context.settings.model_copy(
        update={
            "dataforseo_login": SecretStr("owner@example.com"),
            "dataforseo_password": SecretStr("password"),
            "installation_id": "test",
        }
    )
    asked: list[httpx.Request] = []

    def nothing_may_be_asked(request: httpx.Request) -> httpx.Response:
        asked.append(request)
        return httpx.Response(500)

    async with httpx.AsyncClient(transport=httpx.MockTransport(nothing_may_be_asked)) as http:
        with_credentials = replace(context, settings=settings, http=http)
        registry = production_registry(with_credentials)
        assert (registry.workloads, registry.providers) == (
            frozenset({TaskWorkload.KEYWORD_METRICS}),
            frozenset({"dataforseo"}),
        )
        # Registered, and with no work in flight nothing is asked of it.
        ticks = ticks_of(with_credentials, registry)
        await ticks["ready_poll"].action()
        await ticks["dispatcher"].action()

    assert asked == []
    # Without the process's HTTP client there is nothing to call it with.
    assert production_registry(replace(context, settings=settings)).providers == frozenset()


async def test_a_fetch_without_raw_storage_is_refused_before_the_provider_is_asked(
    context: WorkerContext,
) -> None:
    provider = FakeProvider()
    registry = Registry()
    registry.add_provider(provider)
    order = FetchTask(
        task_id=1,
        created_at=datetime.now(UTC),
        provider="fake",
        endpoint="serp",
        provider_task_id="p-1",
    )

    with pytest.raises(RuntimeError, match="raw storage"):
        await fetch_handler(context, registry)(order)
    assert provider.fetched == []


def ticks_of(context: WorkerContext, registry: Registry) -> dict[str, Tick]:
    return {tick.name: tick for tick in assemble(context, registry)}


async def test_what_providers_have_finished_is_polled_every_minute_by_one_worker(
    context: WorkerContext,
) -> None:
    ticks = ticks_of(context, Registry())

    assert (ticks["ready_poll"].interval, ticks["ready_poll"].lock_ttl) == (
        timedelta(seconds=60),
        timedelta(seconds=55),
    )
    await ticks["ready_poll"].action()


async def test_a_fetch_goes_on_the_collect_queue(context: WorkerContext) -> None:
    assemble(context, Registry())
    order = FetchTask(
        task_id=1,
        created_at=datetime.now(UTC),
        provider="fake",
        endpoint="serp",
        provider_task_id="p-1",
    )

    assert await context.queues.enqueue(FETCH_JOB, order, dedupe_key=order.dedupe_key)
    assert not await context.queues.enqueue(FETCH_JOB, order, dedupe_key=order.dedupe_key)
