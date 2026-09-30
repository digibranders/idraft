from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.config.settings import Settings
from sightline.db.engine import create_engine, create_session_factory
from tests.api.auth.support import execute
from tests.conftest import BASE_URL, PostgresServer


@pytest.fixture
async def worker_db(
    migrated: PostgresServer, redis_url: str
) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    """Sessions as `app_worker`, the role the worker connects with. The ledger is emptied
    first: claiming and reconciling look at every due task, whoever made it."""
    await execute(
        migrated,
        "TRUNCATE ops.collection_tasks, ops.provider_cost_events, ops.collection_runs, "
        "ops.schedules, ops.budgets CASCADE",
    )
    settings = Settings(
        process_role="worker",
        app_origin=BASE_URL,
        database_url=SecretStr(migrated.url("app_worker")),
        redis_url=SecretStr(redis_url),
        db_pool_size=6,
        log_level="critical",
        app_env="test",
    )
    engine = create_engine(settings)
    yield create_session_factory(engine)
    await engine.dispose()
