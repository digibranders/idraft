"""What this worker does: its jobs and its ticks.

The one place that knows every part. Each part is built from the context and registered here, so
the process in `app.py` stays the same as parts are added.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Sequence
from dataclasses import asdict
from datetime import timedelta

import httpx
import structlog
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors.dispatcher import SubmitBatch, dispatch
from sightline.collectors.fetching import FETCH_JOB, FetchTask, fetch_task, poll_ready
from sightline.collectors.ledger import database_time
from sightline.collectors.locations import LocationSyncReport, sync_locations
from sightline.collectors.planner import plan_due
from sightline.collectors.reconciler import ensure_partitions, reconcile
from sightline.collectors.registry import Registry
from sightline.collectors.submission import submit_batch
from sightline.config.settings import Settings
from sightline.providers.dataforseo.client import ALL_CALLS, FAMILY_LIMITS, DataForSeoClient
from sightline.providers.dataforseo.locations import fetch_locations
from sightline.providers.dataforseo.provider import CODE as DATAFORSEO
from sightline.providers.dataforseo.provider import DataForSeo
from sightline.worker.app import WorkerContext
from sightline.worker.limiter import RedisCallGate
from sightline.worker.pauses import RedisPauses
from sightline.worker.queues import Queues
from sightline.worker.ticks import Tick

# docs/21-scheduler-workers.md sections 3 and 4: the planner every 60 seconds, the dispatcher
# every 15, each under a lock that expires just before its next run.
PLANNER_EVERY = timedelta(seconds=60)
PLANNER_LOCK = timedelta(seconds=55)
DISPATCHER_EVERY = timedelta(seconds=15)
DISPATCHER_LOCK = timedelta(seconds=14)
# docs/06 section 3.2: what providers have finished, every 60 seconds while any task is out.
POLL_EVERY = timedelta(seconds=60)
POLL_LOCK = timedelta(seconds=55)
SUBMIT_JOB = "submit_batch"
# docs/21-scheduler-workers.md section 10.
RECONCILE_EVERY = timedelta(minutes=5)
PARTITIONS_AT = "10 0 * * *"
# docs/21-scheduler-workers.md section 10: monthly, the 2nd at 03:00 UTC.
LOCATIONS_AT = "0 3 2 * *"
_log = structlog.get_logger(__name__)


def dataforseo_client(
    settings: Settings, http: httpx.AsyncClient | None, redis: Redis
) -> DataForSeoClient | None:
    """The account's client, its calls paced by the shared limiter; None without credentials."""
    credentials = settings.dataforseo_credentials
    if credentials is None or http is None:
        return None
    login, password = credentials
    gate = RedisCallGate(redis, DATAFORSEO, all_calls=ALL_CALLS, families=FAMILY_LIMITS)
    return DataForSeoClient(http, gate, login=login, password=password)


def production_registry(context: WorkerContext) -> Registry:
    """The workloads and providers of this worker. DataForSEO is registered when its
    credentials are set; no workload is registered yet, so the worker still plans and spends
    nothing (rank collection arrives with step 5)."""
    registry = Registry()
    client = dataforseo_client(context.settings, context.http, context.redis)
    if client is not None:
        registry.add_provider(DataForSeo(client, installation=context.settings.installation_id))
    return registry


async def sync_dataforseo_locations(
    sessions: async_sessionmaker[AsyncSession], client: DataForSeoClient | None
) -> LocationSyncReport | None:
    """DataForSEO's free location list into `core.locations`. None without credentials:
    there is nothing to sync, and the list stays as it is."""
    if client is None:
        _log.info("location sync skipped", reason="no DataForSEO credentials")
        return None
    report = await sync_locations(sessions, await fetch_locations(client))
    _log.info("locations synced", **asdict(report))
    return report


class _QueueSender:
    """The dispatcher's way onto the `collect` queue."""

    def __init__(self, queues: Queues) -> None:
        self._queues = queues

    async def send(self, batch: SubmitBatch) -> bool:
        return await self._queues.enqueue(SUBMIT_JOB, batch, dedupe_key=batch.dedupe_key)


class _FetchSender:
    """The ready poll's and the sweeper's way onto the `collect` queue."""

    def __init__(self, queues: Queues) -> None:
        self._queues = queues

    async def send(self, order: FetchTask) -> bool:
        return await self._queues.enqueue(FETCH_JOB, order, dedupe_key=order.dedupe_key)


def fetch_handler(
    context: WorkerContext, parts: Registry
) -> Callable[[FetchTask], Awaitable[None]]:
    """The `fetch_task` job: one result fetched and kept."""

    async def fetch(order: FetchTask) -> None:
        if context.raw_store is None:
            # Settings refuse a provider without raw storage, so only a worker built by hand
            # gets here. Refused before the provider is asked: a result fetched and not kept
            # stops being listed as ready.
            raise RuntimeError("fetching needs raw storage, and none is configured")
        outcome = await fetch_task(context.sessions, parts, context.raw_store, order)
        _log.info("task fetched", task_id=order.task_id, outcome=outcome)

    return fetch


def assemble(context: WorkerContext, registry: Registry | None = None) -> Sequence[Tick]:
    """Register the jobs on `context.queues` and return the ticks."""
    parts = production_registry(context) if registry is None else registry
    pauses = RedisPauses(context.redis)
    sender = _QueueSender(context.queues)
    fetches = _FetchSender(context.queues)

    async def submit(batch: SubmitBatch) -> None:
        report = await submit_batch(context.sessions, parts, pauses, batch)
        _log.info("batch submitted", provider=batch.provider, **asdict(report))

    context.queues.register("collect", SUBMIT_JOB, submit)
    context.queues.register("collect", FETCH_JOB, fetch_handler(context, parts))

    async def reconcile_ledger() -> None:
        now = await database_time(context.sessions)
        report = await reconcile(
            context.sessions,
            parts,
            now=now,
            fetches=fetches,
            resolve_unknown_submissions=context.settings.resolve_unknown_submissions,
        )
        if not report.quiet:
            _log.info("ledger reconciled", **asdict(report))

    async def partitions() -> None:
        made = await ensure_partitions(context.sessions)
        if made:
            _log.info("partitions made", partitions=made)

    async def locations() -> None:
        client = dataforseo_client(context.settings, context.http, context.redis)
        await sync_dataforseo_locations(context.sessions, client)

    context.queues.register_scheduled("reconcile", reconcile_ledger, every=RECONCILE_EVERY)
    context.queues.register_scheduled("ensure_partitions", partitions, cron=PARTITIONS_AT)
    context.queues.register_scheduled("location_sync", locations, cron=LOCATIONS_AT)

    async def plan() -> None:
        now = await database_time(context.sessions)
        report = await plan_due(context.sessions, parts, now=now)
        if not report.quiet:
            _log.info("planner tick", **asdict(report))

    async def send() -> None:
        now = await database_time(context.sessions)
        report = await dispatch(context.sessions, parts, sender, pauses, now=now)
        if not report.quiet:
            _log.info("dispatcher tick", **asdict(report))

    async def poll() -> None:
        now = await database_time(context.sessions)
        report = await poll_ready(context.sessions, parts, fetches, now=now)
        if not report.quiet:
            _log.info("ready poll", **asdict(report))

    return (
        Tick(name="planner", interval=PLANNER_EVERY, action=plan, lock_ttl=PLANNER_LOCK),
        Tick(name="dispatcher", interval=DISPATCHER_EVERY, action=send, lock_ttl=DISPATCHER_LOCK),
        Tick(name="ready_poll", interval=POLL_EVERY, action=poll, lock_ttl=POLL_LOCK),
    )
