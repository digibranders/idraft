"""What a worker process reports about itself and about collection (the full health report)."""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import SecretStr
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.config.settings import Settings
from idraft.db.engine import create_engine, create_session_factory
from idraft.worker.status import STATUS_TTL, WorkerStatus, collect, publish, status_key
from tests.api.auth.support import Workspace, execute, fetch, make_workspace
from tests.api.keywords.support import keyword_project
from tests.collectors.support import empty_ledger
from tests.conftest import BASE_URL, PostgresServer

Ledger = async_sessionmaker[AsyncSession]
STARTED = datetime(2026, 11, 4, 6, 0, tzinfo=UTC)


@pytest.fixture
async def worker_db(migrated: PostgresServer, redis_url: str) -> AsyncIterator[Ledger]:
    """Sessions as `app_worker`, the role the worker connects with, on an empty ledger."""
    await empty_ledger(migrated)
    settings = Settings(
        process_role="worker",
        app_origin=BASE_URL,
        database_url=SecretStr(migrated.url("app_worker")),
        redis_url=SecretStr(redis_url),
        db_pool_size=2,
        log_level="critical",
        app_env="test",
    )
    engine = create_engine(settings)
    yield create_session_factory(engine)
    await engine.dispose()


async def _task(
    pg: PostgresServer,
    workspace: Workspace,
    project: uuid.UUID,
    status: str,
    *,
    due_ago: str = "interval '0'",
    completed_ago: str | None = None,
) -> None:
    run = await fetch(
        pg,
        "INSERT INTO ops.collection_runs (workspace_id, project_id, workload, window_start, "
        "window_end, trigger, status, created_by_type, config_snapshot) VALUES "
        "($1, $2, 'seo_rank', now(), now(), 'manual', 'running', 'user', '{}') RETURNING id",
        workspace.id,
        project,
    )
    completed = "NULL" if completed_ago is None else f"now() - interval '{completed_ago}'"
    await execute(
        pg,
        "INSERT INTO ops.collection_tasks (run_id, workspace_id, project_id, workload, "
        "subject_type, subject_id, location_id, idempotency_key, request_fingerprint, "
        "provider_code, provider_endpoint, scheduled_for, status, completed_at) VALUES "
        "($1, $2, $3, 'seo_rank', 'tracked_keyword', $4, 2840, $5, $5, 'dataforseo', "
        f"'serp/google/organic', now() - {due_ago}, $6, {completed})",
        run[0]["id"],
        workspace.id,
        project,
        f"{uuid.uuid4()}:20",
        uuid.uuid4().bytes,
        status,
    )


async def test_collection_is_counted_across_every_workspace(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    first, second = await make_workspace(migrated), await make_workspace(migrated)
    one, two = await keyword_project(migrated, first), await keyword_project(migrated, second)
    # Three open tasks in two workspaces: the oldest due two hours ago; one is not due for three
    # hours, which is not late
    await _task(migrated, first, one, "pending", due_ago="interval '2 hours'")
    await _task(migrated, first, one, "submitted", due_ago="interval '10 minutes'")
    await _task(migrated, second, two, "fetched", due_ago="interval '-3 hours'")
    # Two failures in the last day count, one from last week does not; one ingested an hour ago
    await _task(migrated, first, one, "failed", completed_ago="2 hours")
    await _task(migrated, second, two, "dead", completed_ago="23 hours")
    await _task(migrated, second, two, "failed", completed_ago="8 days")
    await _task(migrated, first, one, "ingested", completed_ago="1 hour")

    status = await collect(worker_db, instance="prod", started_at=STARTED, provider_registered=True)

    assert status.open_tasks == 3
    assert status.failed_24h == 2
    assert status.oldest_due_age_s is not None
    assert 2 * 3600 - 5 <= status.oldest_due_age_s <= 2 * 3600 + 60
    assert status.last_ingested_at is not None
    ingested = datetime.fromisoformat(status.last_ingested_at)
    assert timedelta(minutes=55) <= datetime.now(UTC) - ingested <= timedelta(minutes=65)
    assert (status.instance, status.provider_registered) == ("prod", True)
    assert status.started_at == STARTED.isoformat()


async def test_an_empty_ledger_reports_nothing_open_and_nothing_late(
    worker_db: Ledger,
) -> None:
    status = await collect(
        worker_db, instance="prod", started_at=STARTED, provider_registered=False
    )

    assert (status.open_tasks, status.failed_24h) == (0, 0)
    assert (status.oldest_due_age_s, status.last_ingested_at) == (None, None)


async def test_a_report_is_kept_in_redis_for_a_short_while_under_the_process_name(
    redis_url: str,
) -> None:
    redis = Redis.from_url(redis_url)
    status = WorkerStatus(
        instance="prod",
        pid=777,
        started_at=STARTED.isoformat(),
        reported_at=datetime.now(UTC).isoformat(),
        open_tasks=1,
        oldest_due_age_s=None,
        failed_24h=0,
        last_ingested_at=None,
        provider_registered=True,
    )
    try:
        await publish(redis, status)

        raw = await redis.get(status_key("prod", 777))
        assert raw is not None
        kept = json.loads(raw)
        ttl = await redis.pttl(status_key("prod", 777))

        assert (kept["pid"], kept["open_tasks"]) == (777, 1)
        assert 0 < ttl <= STATUS_TTL.total_seconds() * 1000
    finally:
        await redis.delete(status_key("prod", 777))
        await redis.aclose()
