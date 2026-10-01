from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.config.settings import Settings
from sightline.db.engine import create_engine, create_session_factory
from tests.conftest import BASE_URL, PostgresServer


@pytest.fixture(params=["app_api", "app_worker"])
async def sessions(
    request: pytest.FixtureRequest, migrated: PostgresServer, redis_url: str
) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    """Sessions as each role that writes tracked keywords: the API, and the worker (imports)."""
    role: str = request.param
    settings = Settings(
        # Only the database role matters here; the worker's settings need nothing else.
        process_role="worker",
        app_origin=BASE_URL,
        database_url=SecretStr(migrated.url(role)),
        redis_url=SecretStr(redis_url),
        db_pool_size=2,
        log_level="critical",
        app_env="test",
    )
    engine = create_engine(settings)
    yield create_session_factory(engine)
    await engine.dispose()
