"""Shared fixtures: real PostgreSQL 18 and Redis 8, one pair per test session."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
from pathlib import Path

import asyncpg
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
    "BREACHED_PASSWORD_CHECK",
    "COLLECT_CONCURRENCY",
    "DATABASE_URL",
    "DATAFORSEO_LOGIN",
    "DATAFORSEO_PASSWORD",
    "DB_POOL_SIZE",
    "DB_STATEMENT_TIMEOUT",
    "EMAIL_API_KEY",
    "EMAIL_FROM",
    "EMAIL_PROVIDER",
    "ENVIRONMENT",
    "HEARTBEAT_FILE",
    "LOG_LEVEL",
    "PROCESS_CONCURRENCY",
    "PROCESS_ROLE",
    "R2_RAW_ACCESS_KEY_ID",
    "R2_RAW_BUCKET",
    "R2_RAW_ENDPOINT",
    "R2_RAW_SECRET_ACCESS_KEY",
    "REDIS_URL",
    "REGISTRATION",
    "RELEASE_SHA",
    "RESOLVE_UNKNOWN_SUBMISSIONS",
    "SENTRY_DSN",
    "TOTP_ENCRYPTION_KEY",
)
# A fixed key for tests only: base64 of bytes 0 to 31.
TEST_TOTP_KEY = SecretStr("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=")
POSTGRES_IMAGE = "postgres:18"
INITDB_DIR = Path(__file__).parents[2] / "infra" / "compose" / "postgres" / "initdb"
ROLE_PASSWORDS = {"migrator": "migrator-pw", "app_api": "api-pw", "app_worker": "worker-pw"}
ROLE_PASSWORD_VARIABLES = {
    "migrator": "PG_MIGRATOR_PASSWORD",
    "app_api": "PG_API_PASSWORD",
    "app_worker": "PG_WORKER_PASSWORD",
}
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


@dataclass(frozen=True)
class PostgresServer:
    """The test PostgreSQL 18, initialised by the same role script as production."""

    host: str
    port: int
    database: str
    superuser: str
    superuser_password: str

    def url(self, role: str = "superuser", database: str | None = None) -> str:
        if role == "superuser":
            user, password = self.superuser, self.superuser_password
        else:
            user, password = role, ROLE_PASSWORDS[role]
        return f"postgresql://{user}:{password}@{self.host}:{self.port}/{database or self.database}"

    async def create_database(self, name: str) -> str:
        """Drop and create `name` the way the role script leaves the main database."""
        admin = await asyncpg.connect(self.url())
        try:
            await admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
            await admin.execute(f'CREATE DATABASE "{name}" OWNER migrator')
            await admin.execute(f'REVOKE ALL ON DATABASE "{name}" FROM PUBLIC')
            await admin.execute(
                f'GRANT CONNECT ON DATABASE "{name}" TO app_api, app_worker, backup'
            )
        finally:
            await admin.close()
        return name


@pytest.fixture(scope="session")
def pg() -> Iterator[PostgresServer]:
    container = PostgresContainer(POSTGRES_IMAGE, driver=None).with_volume_mapping(
        str(INITDB_DIR), "/docker-entrypoint-initdb.d", "ro"
    )
    for role, variable in ROLE_PASSWORD_VARIABLES.items():
        container = container.with_env(variable, ROLE_PASSWORDS[role])
    with container:
        yield PostgresServer(
            host=container.get_container_host_ip(),
            port=int(container.get_exposed_port(5432)),
            database=container.dbname,
            superuser=container.username,
            superuser_password=container.password,
        )


@pytest.fixture(scope="session")
def postgres_url(pg: PostgresServer) -> str:
    """The superuser, for tests about the engine itself that create scratch tables."""
    return pg.url()


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
        totp_encryption_key=TEST_TOTP_KEY,
    )


@pytest.fixture
async def engine(settings: Settings) -> AsyncIterator[AsyncEngine]:
    engine = create_engine(settings)
    yield engine
    await engine.dispose()


@pytest.fixture(scope="session")
def migrated(pg: PostgresServer) -> PostgresServer:
    """The main test database at the head revision, migrated by the non-superuser owner."""
    upgrade_to_head(pg.url("migrator"))
    return pg


@pytest.fixture
def app_settings(migrated: PostgresServer, redis_url: str) -> Settings:
    return Settings(
        app_origin=BASE_URL,
        database_url=SecretStr(migrated.url("app_api")),
        redis_url=SecretStr(redis_url),
        db_pool_size=2,
        log_level="critical",
        app_env="test",
        totp_encryption_key=TEST_TOTP_KEY,
        breached_password_check=False,
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
