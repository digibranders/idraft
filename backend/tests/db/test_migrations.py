import asyncio

import asyncpg
import pytest
from sqlalchemy.ext.asyncio import create_async_engine

from sightline.config.settings import to_sqlalchemy_url
from sightline.db.migrate import current_revision, head_revision, main, upgrade_to_head

SCHEMAS = {"auth", "core", "seo", "ai", "fp", "ops"}
EXTENSIONS = {"citext", "pg_trgm", "pgcrypto", "btree_gist"}


def _fresh_database(postgres_url: str, name: str) -> str:
    async def create() -> None:
        connection = await asyncpg.connect(postgres_url)
        try:
            await connection.execute(f'DROP DATABASE IF EXISTS "{name}"')
            await connection.execute(f'CREATE DATABASE "{name}"')
        finally:
            await connection.close()

    asyncio.run(create())
    return postgres_url.rsplit("/", 1)[0] + f"/{name}"


def _query(url: str, sql: str) -> list[str]:
    async def run() -> list[str]:
        connection = await asyncpg.connect(url)
        try:
            return [str(row[0]) for row in await connection.fetch(sql)]
        finally:
            await connection.close()

    return asyncio.run(run())


def test_there_is_exactly_one_head() -> None:
    assert head_revision() == "0001"


def test_upgrade_creates_schemas_extensions_and_the_version_row(postgres_url: str) -> None:
    url = _fresh_database(postgres_url, "migrate_fresh")
    upgrade_to_head(url)

    schemas = set(_query(url, "SELECT schema_name FROM information_schema.schemata"))
    extensions = set(_query(url, "SELECT extname FROM pg_extension"))
    version = _query(url, "SELECT version_num FROM ops.alembic_version")

    assert schemas >= SCHEMAS
    assert extensions >= EXTENSIONS
    assert version == [head_revision()]


def test_upgrade_is_idempotent(postgres_url: str) -> None:
    url = _fresh_database(postgres_url, "migrate_twice")
    upgrade_to_head(url)
    upgrade_to_head(url)
    assert _query(url, "SELECT version_num FROM ops.alembic_version") == [head_revision()]


def _current(url: str) -> str | None:
    async def run() -> str | None:
        engine = create_async_engine(to_sqlalchemy_url(url))
        try:
            async with engine.connect() as connection:
                return await current_revision(connection)
        finally:
            await engine.dispose()

    return asyncio.run(run())


def test_current_revision_is_none_before_the_first_migration(postgres_url: str) -> None:
    assert _current(_fresh_database(postgres_url, "migrate_never")) is None


def test_main_migrates_the_database_named_in_the_environment(
    postgres_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    url = _fresh_database(postgres_url, "migrate_main")
    monkeypatch.setenv("APP_ORIGIN", "https://app.example.com")
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("REDIS_URL", "redis://127.0.0.1:6379/0")

    main()

    assert _current(url) == head_revision()
