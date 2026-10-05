"""The parts the worker is assembled from (docs/21-scheduler-workers.md sections 3 and 4)."""

import asyncio
import json
from collections.abc import AsyncIterator
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import httpx
import pytest
from pydantic import SecretStr
from redis.asyncio import Redis

from sightline.collectors.fetching import FETCH_JOB, FetchTask
from sightline.collectors.provider_accounts import (
    balance_key,
    reconciliation_key,
    spend_key,
)
from sightline.collectors.registry import Registry
from sightline.config.settings import Settings
from sightline.db.engine import create_engine, create_session_factory
from sightline.domain.workloads import TaskWorkload
from sightline.providers.dataforseo.client import DataForSeoClient
from sightline.providers.dataforseo.provider import DataForSeo
from sightline.worker import assembly
from sightline.worker.app import WorkerContext
from sightline.worker.assembly import (
    assemble,
    fetch_handler,
    production_registry,
    run_balance_check,
    run_cost_reconcile,
)
from sightline.worker.queues import Queues
from sightline.worker.ticks import Tick
from tests.api.auth.support import execute, fetch
from tests.collectors.support import (
    FakeProvider,
    FakeWorkload,
    empty_ledger,
    make_schedule,
    make_tenant,
)
from tests.collectors.test_fetching import MemoryStore
from tests.collectors.test_imports import _csv, _import, _project, _row
from tests.conftest import PostgresServer
from tests.providers.dataforseo.support import LOGIN, ORIGIN, PASSWORD, Api, FakeGate, fixture
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
    assert (ticks["keyword_imports"].interval, ticks["keyword_imports"].lock_ttl) == (
        timedelta(seconds=5),
        timedelta(seconds=4),
    )
    assert (
        ticks["keyword_import_writes"].interval,
        ticks["keyword_import_writes"].lock_ttl,
    ) == (timedelta(seconds=5), timedelta(seconds=4))
    # With nothing registered both run and do nothing.
    await ticks["planner"].action()
    await ticks["dispatcher"].action()
    # And without a bucket there is nothing to read an import from.
    await ticks["keyword_imports"].action()


async def test_the_import_tick_parses_uploaded_imports_and_expires_old_ones(
    context: WorkerContext, migrated: PostgresServer
) -> None:
    await execute(migrated, "TRUNCATE seo.keyword_imports CASCADE")
    store = MemoryStore()
    project = await _project(migrated)
    fresh = await _import(migrated, store, project, _csv("keyword\ncrm\n"))
    old = await _import(migrated, store, project, _csv("keyword\nerp\n"))
    await execute(
        migrated,
        "UPDATE seo.keyword_imports SET expires_at = now() - interval '1 minute' WHERE id = $1",
        old,
    )
    ticks = ticks_of(replace(context, raw_store=store), Registry())

    await ticks["keyword_imports"].action()

    assert (await _row(migrated, fresh))["status"] == "preview_ready"
    assert (await _row(migrated, old))["status"] == "expired"


async def test_the_write_tick_writes_a_confirmed_import(
    context: WorkerContext, migrated: PostgresServer
) -> None:
    await execute(migrated, "TRUNCATE seo.keyword_imports CASCADE")
    store = MemoryStore()
    project = await _project(migrated)
    imported = await _import(migrated, store, project, _csv("keyword\ncrm\nerp\n"))
    ticks = ticks_of(replace(context, raw_store=store), Registry())
    await ticks["keyword_imports"].action()
    # What confirming does.
    await execute(
        migrated, "UPDATE seo.keyword_imports SET status = 'writing' WHERE id = $1", imported
    )

    await ticks["keyword_import_writes"].action()

    assert (await _row(migrated, imported))["status"] == "completed"
    keywords = await fetch(
        migrated, "SELECT id FROM seo.tracked_keywords WHERE project_id = $1", project.id
    )
    assert len(keywords) == 2


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
    # Hourly, the costs of today and yesterday, and daily the last 35 days (plan decision D14).
    assert schedules["cost_rollup"].cron == "7 * * * *"
    assert schedules["cost_rebuild"].cron == "37 1 * * *"
    # The provider's balance every 15 minutes, and its spend against ours at 00:45 UTC (R11).
    assert schedules["balance_check"].cron == "*/15 * * * *"
    assert schedules["cost_reconcile"].cron == "45 0 * * *"


async def test_rank_checks_are_registered_only_where_their_answers_can_be_kept(
    context: WorkerContext,
) -> None:
    settings = context.settings.model_copy(
        update={
            "dataforseo_login": SecretStr("owner@example.com"),
            "dataforseo_password": SecretStr("password"),
            "installation_id": "test",
        }
    )
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(500))
    ) as http:
        without_storage = replace(context, settings=settings, http=http, raw_store=None)
        with_storage = replace(context, settings=settings, http=http, raw_store=MemoryStore())

        assert production_registry(without_storage).workloads == frozenset(
            {TaskWorkload.KEYWORD_METRICS}
        )
        registry = production_registry(with_storage)
        assert registry.workloads == frozenset(
            {TaskWorkload.KEYWORD_METRICS, TaskWorkload.SEO_RANK}
        )
        ticks = ticks_of(with_storage, registry)

    assert (ticks["rank_ingest"].interval, ticks["rank_ingest"].lock_ttl) == (
        ticks["keyword_metrics_ingest"].interval,
        ticks["keyword_metrics_ingest"].lock_ttl,
    )


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


async def test_the_account_jobs_read_the_provider_and_do_nothing_without_one(
    context: WorkerContext,
) -> None:
    api = Api([])
    api.answer("GET", "/v3/appendix/user_data", fixture("user_data"))
    today = datetime.now(UTC).date()
    yesterday = today - timedelta(days=1)

    await run_balance_check(context, Registry())
    await run_cost_reconcile(context, Registry())
    assert await context.redis.keys("provider:*") == []

    async with httpx.AsyncClient(transport=httpx.MockTransport(api)) as http:
        client = DataForSeoClient(http, FakeGate([]), login=LOGIN, password=PASSWORD, origin=ORIGIN)
        registry = Registry()
        registry.add_provider(DataForSeo(client, installation="test"))
        await run_balance_check(context, registry)
        await context.redis.set(
            spend_key("dataforseo", yesterday),
            json.dumps({"spent_usd": "2.00", "read_at": datetime.now(UTC).isoformat()}),
        )
        await run_cost_reconcile(context, registry)

    balance = json.loads(await context.redis.get(balance_key("dataforseo")) or "{}")
    assert Decimal(balance["balance_usd"]) == Decimal("87.4521")
    reading = json.loads(await context.redis.get(spend_key("dataforseo", today)) or "{}")
    assert Decimal(reading["spent_usd"]) == Decimal("1.2345")
    report = json.loads(
        await context.redis.get(reconciliation_key("dataforseo", yesterday)) or "{}"
    )
    assert Decimal(report["provider_spend_usd"]) == Decimal("2.00")
