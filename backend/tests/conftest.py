"""Shared fixtures: real PostgreSQL 18 and Redis 8, one pair per test session."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Iterator

import httpx
import pytest
from asgi_lifespan import LifespanManager
from fastapi import FastAPI
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncEngine
from testcontainers.community.postgres import PostgresContainer
from testcontainers.community.redis import RedisContainer

from sightline.api.main import create_app
from sightline.config.logging import reset_logging
from sightline.config.settings import Settings
from sightline.db.engine import create_engine
from sightline.db.migrate import upgrade_to_head

BASE_URL = "https://app.example.com"

SETTINGS_VARIABLES = (
    "APP_ENV",
    "APP_ORIGIN",
    "DATABASE_URL",
    "DB_POOL_SIZE",
    "DB_STATEMENT_TIMEOUT",
    "ENVIRONMENT",
    "LOG_LEVEL",
    "PROCESS_ROLE",
    "REDIS_URL",
    "RELEASE_SHA",
    "SENTRY_DSN",
)
POSTGRES_IMAGE = "postgres:18"
REDIS_IMAGE = "redis:8"


@pytest.fixture(autouse=True)
def _hermetic_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """Settings read the environment; no test may depend on what the shell exports."""
    for name in SETTINGS_VARIABLES:
        monkeypatch.delenv(name, raising=False)


@pytest.fixture(autouse=True)
def _restore_logging() -> Iterator[None]:
    """Logging configuration is process-wide; leave it as the next test expects to find it."""
    yield
    reset_logging()


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
        database_url=SecretStr(postgres_url),
        redis_url=SecretStr(redis_url),
        db_pool_size=1,
        app_env="test",
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
        database_url=SecretStr(migrated_url),
        redis_url=SecretStr(redis_url),
        db_pool_size=2,
        log_level="critical",
        app_env="test",
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


@pytest.fixture
async def black_hole() -> AsyncIterator[str]:
    """host:port of a server that accepts connections and never answers: a frozen dependency."""
    release = asyncio.Event()

    async def hold(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        await release.wait()
        writer.close()

    server = await asyncio.start_server(hold, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        yield f"127.0.0.1:{port}"
    finally:
        release.set()
        server.close()
        await server.wait_closed()
