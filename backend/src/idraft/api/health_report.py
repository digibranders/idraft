"""The full health report (`GET /api/internal/health`, docs/19 section 3.12).

`/api/healthz` and `/api/readyz` stay public and say almost nothing. This report is for the people
who run the system: the stores, the schema, the worker processes, the provider and how collection
stands. It is read from what the API can see itself (PostgreSQL, Redis) and from what the worker
keeps in Redis (`idraft.worker.status`), since the API's database role cannot read the task
ledger across workspaces. A part the report cannot see is `null`, never a guess.

Three states: `down` when the API cannot serve (PostgreSQL, Redis or the schema), `degraded` when
it serves but something that matters is wrong (no worker, the provider paused or about to run out,
collection falling behind), `ok` otherwise.
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import UTC, datetime
from typing import Any, Final, Literal

import structlog
from pydantic import BaseModel
from redis.asyncio import Redis

from idraft.api.resources import Resources
from idraft.collectors.provider_accounts import balance_key
from idraft.db.probe import probe_database
from idraft.extraction.urls import CANONICALIZER_VERSION
from idraft.providers.dataforseo.provider import CODE as DATAFORSEO
from idraft.providers.dataforseo.serp_parse import PARSER_VERSION
from idraft.providers.pauses import RedisPauses
from idraft.worker.status import STATUS_PREFIX

CHECK_TIMEOUT_SECONDS: Final = 2.0
# A worker reports every 30 seconds and its report lives 90: older is a worker that stopped.
WORKER_FRESH_SECONDS: Final = 90
# A task due this long ago and not finished: collection is falling behind.
BACKLOG_ALERT_SECONDS: Final = 3600
_log = structlog.get_logger(__name__)

Status = Literal["ok", "degraded", "down"]


class Versions(BaseModel):
    release: str
    installation: str
    environment: str
    parser_version: int
    canonicalizer_version: int


class PostgresCheck(BaseModel):
    ok: bool
    latency_ms: int | None


class MigrationsCheck(BaseModel):
    ok: bool
    current: str | None
    expected: str


class RedisCheck(BaseModel):
    ok: bool
    latency_ms: int | None


class WorkerProcess(BaseModel):
    instance: str
    pid: int
    started_at: str
    reported_age_s: int


class WorkerCheck(BaseModel):
    ok: bool
    processes: list[WorkerProcess]


class ProviderCheck(BaseModel):
    ok: bool
    provider: str
    registered: bool
    paused: bool
    balance_usd: str | None
    days_remaining: str | None
    severity: str | None
    balance_checked_at: str | None


class CollectionCheck(BaseModel):
    # None: no worker has reported, so there is nothing to say.
    ok: bool | None
    open_tasks: int | None
    oldest_due_age_s: int | None
    failed_24h: int | None
    last_ingested_at: str | None


class Checks(BaseModel):
    postgres: PostgresCheck
    migrations: MigrationsCheck
    redis: RedisCheck
    worker: WorkerCheck
    provider: ProviderCheck
    collection: CollectionCheck


class FullHealth(BaseModel):
    status: Status
    checked_at: str
    took_ms: int
    versions: Versions
    checks: Checks


def _milliseconds(started: float) -> int:
    return round((time.perf_counter() - started) * 1000)


async def _redis_check(redis: Redis) -> RedisCheck:
    started = time.perf_counter()
    try:
        async with asyncio.timeout(CHECK_TIMEOUT_SECONDS):
            await redis.ping()
    except Exception as error:
        _log.warning("redis probe failed", error_kind=type(error).__name__)
        return RedisCheck(ok=False, latency_ms=None)
    return RedisCheck(ok=True, latency_ms=_milliseconds(started))


def _json(raw: object) -> dict[str, Any] | None:
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", "replace")
    if not isinstance(raw, str):
        return None
    try:
        value = json.loads(raw)
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


async def _worker_reports(redis: Redis) -> list[dict[str, Any]]:
    """The reports the workers keep in Redis; one that cannot be read is left out."""
    try:
        async with asyncio.timeout(CHECK_TIMEOUT_SECONDS):
            keys = [key async for key in redis.scan_iter(match=f"{STATUS_PREFIX}*", count=100)]
            raws = await redis.mget(keys) if keys else []
    except Exception as error:
        _log.warning("worker reports not read", error_kind=type(error).__name__)
        return []
    return [report for raw in raws if (report := _json(raw)) is not None]


def _age_seconds(iso: object, now: datetime) -> int | None:
    if not isinstance(iso, str):
        return None
    try:
        then = datetime.fromisoformat(iso)
    except ValueError:
        return None
    return max(0, round((now - then).total_seconds()))


def _int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _text(value: object) -> str | None:
    return value if isinstance(value, str) else None


def worker_check(
    reports: list[dict[str, Any]], now: datetime
) -> tuple[WorkerCheck, dict[str, Any] | None]:
    """The worker processes that reported lately, and the freshest report (collection is the same
    ledger for all of them)."""
    processes: list[tuple[int, WorkerProcess, dict[str, Any]]] = []
    for report in reports:
        age = _age_seconds(report.get("reported_at"), now)
        pid, instance = _int(report.get("pid")), _text(report.get("instance"))
        if age is None or pid is None or instance is None or age > WORKER_FRESH_SECONDS:
            continue
        process = WorkerProcess(
            instance=instance,
            pid=pid,
            started_at=_text(report.get("started_at")) or "",
            reported_age_s=age,
        )
        processes.append((age, process, report))
    processes.sort(key=lambda found: found[0])
    freshest = processes[0][2] if processes else None
    return WorkerCheck(ok=bool(processes), processes=[found[1] for found in processes]), freshest


def collection_check(freshest: dict[str, Any] | None) -> CollectionCheck:
    if freshest is None:
        return CollectionCheck(
            ok=None, open_tasks=None, oldest_due_age_s=None, failed_24h=None, last_ingested_at=None
        )
    oldest = _int(freshest.get("oldest_due_age_s"))
    return CollectionCheck(
        ok=oldest is None or oldest <= BACKLOG_ALERT_SECONDS,
        open_tasks=_int(freshest.get("open_tasks")),
        oldest_due_age_s=oldest,
        failed_24h=_int(freshest.get("failed_24h")),
        last_ingested_at=_text(freshest.get("last_ingested_at")),
    )


async def _provider_check(redis: Redis, freshest: dict[str, Any] | None) -> ProviderCheck:
    registered = bool(freshest and freshest.get("provider_registered") is True)
    try:
        async with asyncio.timeout(CHECK_TIMEOUT_SECONDS):
            paused = DATAFORSEO in await RedisPauses(redis).paused([DATAFORSEO])
            balance = _json(await redis.get(balance_key(DATAFORSEO)))
    except Exception as error:
        _log.warning("provider state not read", error_kind=type(error).__name__)
        paused, balance = False, None
    severity = _text(balance.get("severity")) if balance else None
    # Not registered means nothing is sent to it, so there is nothing to be wrong with.
    healthy = not registered or (not paused and severity != "critical")
    return ProviderCheck(
        ok=healthy,
        provider=DATAFORSEO,
        registered=registered,
        paused=paused,
        balance_usd=_text(balance.get("balance_usd")) if balance else None,
        days_remaining=_text(balance.get("days_remaining")) if balance else None,
        severity=severity,
        balance_checked_at=_text(balance.get("checked_at")) if balance else None,
    )


def overall(checks: Checks) -> Status:
    if not (checks.postgres.ok and checks.redis.ok and checks.migrations.ok):
        return "down"
    if not (checks.worker.ok and checks.provider.ok and checks.collection.ok is not False):
        return "degraded"
    return "ok"


async def build(resources: Resources) -> FullHealth:
    started = time.perf_counter()
    now = datetime.now(UTC)
    settings = resources.settings
    database_started = time.perf_counter()
    database, redis = await asyncio.gather(
        probe_database(settings.asyncpg_dsn, within_seconds=CHECK_TIMEOUT_SECONDS),
        _redis_check(resources.redis),
    )
    reports = await _worker_reports(resources.redis) if redis.ok else []
    workers, freshest = worker_check(reports, now)
    checks = Checks(
        postgres=PostgresCheck(
            ok=database.reachable,
            latency_ms=_milliseconds(database_started) if database.reachable else None,
        ),
        migrations=MigrationsCheck(
            ok=database.reachable and resources.migrations.is_current(database.revision),
            current=database.revision,
            expected=resources.migrations.head,
        ),
        redis=redis,
        worker=workers,
        provider=await _provider_check(resources.redis, freshest)
        if redis.ok
        else ProviderCheck(
            ok=True,
            provider=DATAFORSEO,
            registered=False,
            paused=False,
            balance_usd=None,
            days_remaining=None,
            severity=None,
            balance_checked_at=None,
        ),
        collection=collection_check(freshest),
    )
    return FullHealth(
        status=overall(checks),
        checked_at=now.isoformat(),
        took_ms=_milliseconds(started),
        versions=Versions(
            release=settings.release_sha,
            installation=settings.installation_id,
            environment=settings.app_env,
            parser_version=PARSER_VERSION,
            canonicalizer_version=CANONICALIZER_VERSION,
        ),
        checks=checks,
    )
