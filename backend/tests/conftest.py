"""Shared fixtures: real PostgreSQL 18 and Redis 8, one pair per test session."""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine
from testcontainers.community.postgres import PostgresContainer
from testcontainers.community.redis import RedisContainer

from sightline.config.settings import Settings
from sightline.db.engine import create_engine

POSTGRES_IMAGE = "postgres:18"
REDIS_IMAGE = "redis:8"


@pytest.fixture(scope="session")
def postgres_url() -> Iterator[str]:
    with PostgresContainer(POSTGRES_IMAGE, driver=None) as container:
        yield container.get_connection_url()


@pytest.fixture(scope="session")
def redis_url() -> Iterator[str]:
    with RedisContainer(REDIS_IMAGE) as container:
        host = container.get_container_host_ip()
        yield f"redis://{host}:{container.get_exposed_port(6379)}/0"


@pytest.fixture
def settings(postgres_url: str, redis_url: str) -> Settings:
    """One pooled connection, so consecutive transactions reuse the same server session."""
    return Settings(
        app_origin="https://app.example.com",
        database_url=postgres_url,
        redis_url=redis_url,
        db_pool_size=1,
        environment="test",
    )


@pytest.fixture
async def engine(settings: Settings) -> AsyncIterator[AsyncEngine]:
    engine = create_engine(settings)
    yield engine
    await engine.dispose()
