"""What this worker does: its jobs and its ticks.

The one place that knows every part. Each part is built from the context and registered here, so
the process in `app.py` stays the same as parts are added.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Sequence
from dataclasses import asdict
from datetime import UTC, datetime, timedelta

import httpx
import structlog
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors.costs import DAILY_DAYS, HOURLY_DAYS, roll_up_costs
from sightline.collectors.dispatcher import SubmitBatch, dispatch
from sightline.collectors.fetching import FETCH_JOB, FetchTask, fetch_task, poll_ready
from sightline.collectors.import_writer import write_next
from sightline.collectors.imports import expire_imports, parse_next
from sightline.collectors.keyword_metrics import (
    WORKLOAD as KEYWORD_METRICS,
)
from sightline.collectors.keyword_metrics import (
    KeywordMetricsWorkload,
    ingest,
    queue_new_keywords,
)
from sightline.collectors.ledger import database_time
from sightline.collectors.locations import LocationSyncReport, sync_locations
from sightline.collectors.planner import plan_due, plan_manual_runs
from sightline.collectors.provider_accounts import AccountSource, check_balance, reconcile_costs
from sightline.collectors.reconciler import ensure_partitions, reconcile
from sightline.collectors.registry import Registry
from sightline.collectors.seo_rank import WORKLOAD as SEO_RANK
from sightline.collectors.seo_rank import SeoRankWorkload
from sightline.collectors.seo_rank import queue_new_keywords as queue_new_rank_keywords
from sightline.collectors.seo_rank_health import refresh_health
from sightline.collectors.seo_rank_ingest import ingest as ingest_ranks
from sightline.collectors.submission import submit_batch
from sightline.config.settings import Settings
from sightline.providers.dataforseo.client import ALL_CALLS, FAMILY_LIMITS, DataForSeoClient
from sightline.providers.dataforseo.locations import fetch_locations
from sightline.providers.dataforseo.provider import CODE as DATAFORSEO
from sightline.providers.dataforseo.provider import DataForSeo
from sightline.providers.pauses import RedisPauses
from sightline.worker.app import WorkerContext
from sightline.worker.limiter import RedisCallGate
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
# Fetched keyword metrics read into snapshots (plan decision D7), every 30 seconds.
INGEST_EVERY = timedelta(seconds=30)
INGEST_LOCK = timedelta(seconds=28)
# Keyword imports (plan decision D11): previews of uploaded imports, every 5 seconds.
IMPORTS_EVERY = timedelta(seconds=5)
IMPORTS_LOCK = timedelta(seconds=4)
# docs/21-scheduler-workers.md section 10.
RECONCILE_EVERY = timedelta(minutes=5)
PARTITIONS_AT = "10 0 * * *"
# docs/21-scheduler-workers.md section 10: monthly, the 2nd at 03:00 UTC.
LOCATIONS_AT = "0 3 2 * *"
# Plan decision D14: today's and yesterday's costs every hour, and the last 35 days once a day
# so a day missed while the worker was down is counted.
COSTS_AT = "7 * * * *"
COSTS_REBUILT_AT = "37 1 * * *"
# docs/21-scheduler-workers.md section 10: the provider's balance every 15 minutes, and its
# spend for the day before against our cost events at 00:45 UTC.
BALANCE_CHECK_AT = "*/15 * * * *"
# Failed rank checks and stale keywords into the keyword state (docs/21 section 9).
RANK_HEALTH_EVERY = timedelta(minutes=10)
COST_RECONCILE_AT = "45 0 * * *"
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
    credentials are set, and keyword metrics with it; without them the worker plans and
    spends nothing. Rank checks are registered only where their answers can be kept and read
    (raw storage), so a worker never pays for a check it could not ingest."""
    registry = Registry()
    client = dataforseo_client(context.settings, context.http, context.redis)
    if client is not None:
        registry.add_provider(DataForSeo(client, installation=context.settings.installation_id))
        registry.add_workload(KeywordMetricsWorkload())
        if context.raw_store is not None:
            registry.add_workload(SeoRankWorkload())
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


def account_source(parts: Registry) -> AccountSource | None:
    """The provider's account, where one is registered that can say what it holds."""
    try:
        provider = parts.provider(DATAFORSEO)
    except KeyError:
        return None
    return provider if isinstance(provider, DataForSeo) else None


async def run_balance_check(context: WorkerContext, parts: Registry) -> None:
    """The `balance_check` job: read the account and keep what it says."""
    source = account_source(parts)
    if source is None:
        return
    now = await database_time(context.sessions)
    report = await check_balance(
        context.sessions, context.redis, source, provider_code=DATAFORSEO, now=now
    )
    _log.info(
        "provider balance read",
        balance_usd=str(report.balance_usd),
        days_remaining=None if report.days_remaining is None else str(report.days_remaining),
        severity=report.severity,
    )


async def run_cost_reconcile(context: WorkerContext, parts: Registry) -> None:
    """The `cost_reconcile` job: yesterday's spend by the provider against our cost events."""
    if account_source(parts) is None:
        return
    now = await database_time(context.sessions)
    yesterday = now.astimezone(UTC).date() - timedelta(days=1)
    await reconcile_costs(context.sessions, context.redis, provider_code=DATAFORSEO, day=yesterday)


def assemble(context: WorkerContext, registry: Registry | None = None) -> Sequence[Tick]:
    """Register the jobs on `context.queues` and return the ticks."""
    parts = production_registry(context) if registry is None else registry
    pauses = RedisPauses(context.redis)
    sender = _QueueSender(context.queues)
    fetches = _FetchSender(context.queues)

    async def submit(batch: SubmitBatch) -> None:
        report = await submit_batch(context.sessions, parts, pauses, batch, store=context.raw_store)
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

    async def cost_rollup() -> None:
        now = await database_time(context.sessions)
        written = await roll_up_costs(context.sessions, now=now, days=HOURLY_DAYS)
        _log.info("costs rolled up", rows=written, days=HOURLY_DAYS)

    async def cost_rebuild() -> None:
        now = await database_time(context.sessions)
        written = await roll_up_costs(context.sessions, now=now, days=DAILY_DAYS)
        _log.info("costs rolled up", rows=written, days=DAILY_DAYS)

    context.queues.register_scheduled("cost_rollup", cost_rollup, cron=COSTS_AT)
    context.queues.register_scheduled("cost_rebuild", cost_rebuild, cron=COSTS_REBUILT_AT)

    async def balance_check() -> None:
        await run_balance_check(context, parts)

    async def cost_reconcile() -> None:
        await run_cost_reconcile(context, parts)

    async def rank_health() -> None:
        """Failed checks and stale keywords into the state (docs/21 section 9)."""
        if SEO_RANK not in parts.workloads:
            return
        now = await database_time(context.sessions)
        report = await refresh_health(context.sessions, now=now)
        if not report.quiet:
            _log.info("rank health refreshed", **asdict(report))

    context.queues.register_scheduled("rank_health", rank_health, every=RANK_HEALTH_EVERY)
    context.queues.register_scheduled("balance_check", balance_check, cron=BALANCE_CHECK_AT)
    context.queues.register_scheduled("cost_reconcile", cost_reconcile, cron=COST_RECONCILE_AT)

    async def queue_new(now: datetime) -> None:
        if KEYWORD_METRICS not in parts.workloads:
            return
        queued = await queue_new_keywords(context.sessions, now=now)
        if queued:
            _log.info("new keywords queued", runs=queued)

    async def queue_new_ranks(now: datetime) -> None:
        if SEO_RANK not in parts.workloads:
            return
        queued = await queue_new_rank_keywords(context.sessions, now=now)
        if queued:
            _log.info("new keywords queued for a first rank check", runs=queued)

    async def plan_manual(now: datetime) -> None:
        manual = await plan_manual_runs(context.sessions, parts, now=now)
        if not manual.quiet:
            _log.info("manual runs planned", **asdict(manual))

    async def plan_schedules(now: datetime) -> None:
        report = await plan_due(context.sessions, parts, now=now)
        if not report.quiet:
            _log.info("planner tick", **asdict(report))

    async def plan() -> None:
        """New keywords first, so their run is planned on this tick, then manual runs, then due
        schedules. A step that fails is logged and the others still run; the tick then fails
        with the first error."""
        now = await database_time(context.sessions)
        first: Exception | None = None
        for step in (queue_new, queue_new_ranks, plan_manual, plan_schedules):
            try:
                await step(now)
            except Exception as error:
                _log.exception("planner step failed", step=step.__name__)
                first = first or error
        if first is not None:
            raise first

    async def ingest_metrics() -> None:
        if context.raw_store is None:
            return
        report = await ingest(context.sessions, context.raw_store)
        if not report.quiet:
            _log.info("keyword metrics ingested", **asdict(report))

    async def ingest_rank_checks() -> None:
        if context.raw_store is None:
            return
        report = await ingest_ranks(context.sessions, context.raw_store)
        if not report.quiet:
            _log.info("rank checks ingested", **asdict(report))

    async def keyword_imports() -> None:
        """Previews of uploaded imports, and the end of those nobody confirmed."""
        if context.raw_store is None:
            return
        now = await database_time(context.sessions)
        expired = await expire_imports(context.sessions, now=now)
        if expired:
            _log.info("keyword imports expired", imports=expired)
        parsed = await parse_next(context.sessions, context.raw_store)
        if not parsed.quiet:
            _log.info("keyword imports parsed", **asdict(parsed))

    async def keyword_import_writes() -> None:
        """Confirmed imports, written in batches. Apart from the reading tick, so a long write
        never holds up a preview; it needs no bucket."""
        written = await write_next(context.sessions)
        if not written.quiet:
            _log.info("keyword imports written", **asdict(written))

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
        Tick(
            name="keyword_metrics_ingest",
            interval=INGEST_EVERY,
            action=ingest_metrics,
            lock_ttl=INGEST_LOCK,
        ),
        Tick(
            name="rank_ingest",
            interval=INGEST_EVERY,
            action=ingest_rank_checks,
            lock_ttl=INGEST_LOCK,
        ),
        Tick(
            name="keyword_imports",
            interval=IMPORTS_EVERY,
            action=keyword_imports,
            lock_ttl=IMPORTS_LOCK,
        ),
        Tick(
            name="keyword_import_writes",
            interval=IMPORTS_EVERY,
            action=keyword_import_writes,
            lock_ttl=IMPORTS_LOCK,
        ),
    )
