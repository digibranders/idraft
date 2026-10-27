"""The four database roles of ADR-022, as the init script creates them."""

import asyncio

import asyncpg
import pytest

from idraft.db.migrate import migration_state, upgrade_to_head
from tests.conftest import PostgresServer

# role: (superuser, bypassrls, createdb, createrole, login)
ATTRIBUTES = {
    "migrator": (False, False, False, False, True),
    "app_api": (False, False, False, False, True),
    "app_worker": (False, True, False, False, True),
    "backup": (False, True, False, False, True),
}
SETTINGS = {
    "migrator": {"lock_timeout=2s", "statement_timeout=15min"},
    "app_api": {"statement_timeout=15s"},
    "app_worker": {"statement_timeout=120s"},
    "backup": set(),
}


async def _fetch(url: str, sql: str, *args: object) -> list[asyncpg.Record]:
    connection = await asyncpg.connect(url)
    try:
        return await connection.fetch(sql, *args)
    finally:
        await connection.close()


async def test_roles_have_exactly_the_attributes_of_adr_022(pg: PostgresServer) -> None:
    rows = await _fetch(
        pg.url(),
        "SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin "
        "FROM pg_roles WHERE rolname = ANY($1)",
        list(ATTRIBUTES),
    )
    assert {row["rolname"]: tuple(row)[1:] for row in rows} == ATTRIBUTES


async def test_role_level_timeouts(pg: PostgresServer) -> None:
    rows = await _fetch(
        pg.url(), "SELECT rolname, rolconfig FROM pg_roles WHERE rolname = ANY($1)", list(SETTINGS)
    )
    assert {row["rolname"]: set(row["rolconfig"] or []) for row in rows} == SETTINGS


async def test_role_memberships(pg: PostgresServer) -> None:
    rows = await _fetch(
        pg.url(),
        "SELECT member.rolname AS member, granted.rolname AS granted "
        "FROM pg_auth_members m "
        "JOIN pg_roles member ON member.oid = m.member "
        "JOIN pg_roles granted ON granted.oid = m.roleid "
        "WHERE member.rolname = ANY($1)",
        list(ATTRIBUTES),
    )
    assert {(row["member"], row["granted"]) for row in rows} == {
        ("app_worker", "pg_read_all_stats"),
        ("backup", "pg_read_all_data"),
    }


async def test_the_database_belongs_to_migrator_and_is_closed_to_everyone_else(
    pg: PostgresServer,
) -> None:
    (row,) = await _fetch(
        pg.url(),
        "SELECT pg_get_userbyid(datdba) AS owner, "
        "has_database_privilege('public', datname, 'CONNECT') AS public_connect, "
        "has_database_privilege('app_api', datname, 'CONNECT') AS api_connect, "
        "has_database_privilege('app_api', datname, 'CREATE') AS api_create, "
        "has_database_privilege('app_worker', datname, 'CREATE') AS worker_create "
        "FROM pg_database WHERE datname = current_database()",
    )
    assert dict(row) == {
        "owner": "migrator",
        "public_connect": False,
        "api_connect": True,
        "api_create": False,
        "worker_create": False,
    }


async def test_the_statistics_extension_exists(pg: PostgresServer) -> None:
    rows = await _fetch(pg.url(), "SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'")
    assert len(rows) == 1


def test_migrations_run_as_the_non_superuser_owner(pg: PostgresServer) -> None:
    asyncio.run(pg.create_database("roles_migrate"))
    upgrade_to_head(pg.url("migrator", "roles_migrate"))

    rows = asyncio.run(
        _fetch(
            pg.url("migrator", "roles_migrate"),
            "SELECT nspname, pg_get_userbyid(nspowner) AS owner FROM pg_namespace "
            "WHERE nspname = ANY($1)",
            ["auth", "core", "seo", "ai", "fp", "ops"],
        )
    )
    assert {row["owner"] for row in rows} == {"migrator"}
    assert len(rows) == 6
    version = asyncio.run(
        _fetch(pg.url("migrator", "roles_migrate"), "SELECT version_num FROM ops.alembic_version")
    )
    assert [row["version_num"] for row in version] == [migration_state().head]


@pytest.mark.parametrize("role", ["app_api", "app_worker", "migrator"])
async def test_a_role_cannot_log_in_with_another_roles_password(
    pg: PostgresServer, role: str
) -> None:
    wrong = f"postgresql://{role}:not-the-password@{pg.host}:{pg.port}/{pg.database}"
    with pytest.raises(asyncpg.InvalidPasswordError):
        await asyncpg.connect(wrong)


def test_migrating_a_database_without_the_roles_fails_with_a_clear_message(
    pg: PostgresServer,
) -> None:
    """A cluster that skipped the init script is reported, not half-migrated."""

    async def prepare() -> str:
        admin = await asyncpg.connect(pg.url())
        try:
            await admin.execute("DROP DATABASE IF EXISTS roles_missing WITH (FORCE)")
            await admin.execute("DROP ROLE IF EXISTS lone_owner")
            await admin.execute("CREATE ROLE lone_owner LOGIN PASSWORD 'lone-pw'")
            await admin.execute("CREATE DATABASE roles_missing OWNER lone_owner")
            await admin.execute("ALTER ROLE backup RENAME TO backup_hidden")
        finally:
            await admin.close()
        return f"postgresql://lone_owner:lone-pw@{pg.host}:{pg.port}/roles_missing"

    async def restore() -> None:
        admin = await asyncpg.connect(pg.url())
        try:
            await admin.execute("ALTER ROLE backup_hidden RENAME TO backup")
        finally:
            await admin.close()

    url = asyncio.run(prepare())
    try:
        with pytest.raises(Exception, match="database roles are missing: backup"):
            upgrade_to_head(url)
    finally:
        asyncio.run(restore())
