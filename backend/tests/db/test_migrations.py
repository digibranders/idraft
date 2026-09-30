import asyncio
import io
import json
import os
import subprocess
import sys

import asyncpg
import pytest
from alembic.script import ScriptDirectory

from sightline.db.migrate import (
    MigrationState,
    alembic_config,
    main,
    migration_state,
    upgrade_to_head,
)

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


def _version(url: str) -> list[str]:
    return _query(url, "SELECT version_num FROM ops.alembic_version")


def test_the_history_is_linear_with_a_single_head() -> None:
    script = ScriptDirectory.from_config(alembic_config())
    state = migration_state()
    assert script.get_heads() == [state.head]
    assert len(script.get_bases()) == 1
    assert state.head in state.known


def test_upgrade_creates_schemas_extensions_and_the_version_row(postgres_url: str) -> None:
    url = _fresh_database(postgres_url, "migrate_fresh")
    upgrade_to_head(url)

    schemas = set(_query(url, "SELECT schema_name FROM information_schema.schemata"))
    extensions = set(_query(url, "SELECT extname FROM pg_extension"))

    assert schemas >= SCHEMAS
    assert extensions >= EXTENSIONS
    assert _version(url) == [migration_state().head]


def test_upgrade_is_idempotent(postgres_url: str) -> None:
    url = _fresh_database(postgres_url, "migrate_twice")
    upgrade_to_head(url)
    upgrade_to_head(url)
    assert _version(url) == [migration_state().head]


def test_concurrent_migrators_take_turns(postgres_url: str) -> None:
    """Four migrator processes against an empty database: the advisory lock makes them queue."""
    url = _fresh_database(postgres_url, "migrate_race")
    environment = {**os.environ, "DATABASE_URL": url}
    command = [sys.executable, "-m", "sightline.db.migrate"]
    processes = [
        subprocess.Popen(command, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        for _ in range(4)
    ]
    outcomes = [(process.communicate(timeout=60), process.returncode) for process in processes]

    assert [code for _, code in outcomes] == [0, 0, 0, 0], [err for (_, err), _ in outcomes]
    assert _version(url) == [migration_state().head]


def test_a_percent_sign_in_the_password_survives_the_config() -> None:
    config = alembic_config("postgresql://user:p%40ss%25@host/db")
    assert config.get_main_option("sqlalchemy.url") == "postgresql+asyncpg://user:p%40ss%25@host/db"


@pytest.mark.parametrize(
    ("database_revision", "expected"),
    [
        ("0003", True),  # at this build's head
        ("0004", True),  # a newer build migrated the database; this build still serves
        ("0002", False),  # a known older revision: behind
        ("0001", False),
        (None, False),  # never migrated
    ],
)
def test_a_schema_is_current_at_or_ahead_of_the_head(
    database_revision: str | None, expected: bool
) -> None:
    state = MigrationState(head="0003", known=frozenset({"0001", "0002", "0003"}))
    assert state.is_current(database_revision) is expected


def test_main_needs_only_a_database_url_and_logs_what_it_did(
    postgres_url: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    url = _fresh_database(postgres_url, "migrate_main")
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("RELEASE_SHA", "abc123")

    main()

    assert _version(url) == [migration_state().head]
    lines = [json.loads(raw) for raw in io.StringIO(capsys.readouterr().out)]
    (summary,) = [line for line in lines if line["msg"] == "migrations applied"]
    assert summary["service"] == "migrator"
    assert summary["version"] == "abc123"
    assert summary["from_revision"] is None
    assert summary["to_revision"] == migration_state().head
    assert all("msg" in line and "ts" in line for line in lines)
