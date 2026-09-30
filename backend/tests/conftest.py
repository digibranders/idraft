"""Shared fixtures: real PostgreSQL 18 and Redis 8, one pair per test session."""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator

import httpx
import pytest
from asgi_lifespan import LifespanManager
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncEngine
from testcontainers.community.postgres import PostgresContainer
from testcontainers.community.redis import RedisContainer

from sightline.api.main import create_app
from sightline.config.settings import Settings
from sightline.db.engine import create_engine
from sightline.db.migrate import upgrade_to_head

BASE_URL = "https://app.example.com"

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
        app_origin=BASE_URL,
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


@pytest.fixture(scope="session")
def migrated_url(postgres_url: str) -> str:
    upgrade_to_head(postgres_url)
    return postgres_url


@pytest.fixture
def app_settings(migrated_url: str, redis_url: str) -> Settings:
    return Settings(
        app_origin=BASE_URL,
        database_url=migrated_url,
        redis_url=redis_url,
        db_pool_size=2,
        log_level="critical",
        environment="test",
    )


@pytest.fixture
async def app(app_settings: Settings) -> AsyncIterator[FastAPI]:
    application = create_app(app_settings)
    async with LifespanManager(application):
        yield application


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url=BASE_URL) as test_client:
        yield test_client
