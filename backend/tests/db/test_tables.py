"""The table metadata the application queries through must match the migrated schema
(docs/26-testing-quality.md: DB-MIG-01)."""

from collections.abc import Mapping

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import Column, FetchedValue, MetaData, Table, Text, UniqueConstraint
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.schema import SchemaItem

from sightline.config.settings import to_sqlalchemy_url
from sightline.db import tables
from tests.conftest import PostgresServer
from tests.db.support import connection

DECLARED = {
    "auth.users",
    "auth.sessions",
    "auth.verification_tokens",
    "auth.totp_secrets",
    "auth.workspaces",
    "auth.memberships",
    "auth.invitations",
    "core.projects",
    "core.workspace_quotas",
    "ops.audit_logs",
    "ops.budgets",
    "ops.schedules",
    "ops.collection_runs",
    "ops.collection_tasks",
    "ops.provider_cost_events",
    "ops.raw_payloads",
}
# Alembic reports a difference as a tuple, or as a list of tuples for one column.
Difference = tuple[object, ...] | list[tuple[object, ...]]


def _differences(connection: Connection, metadata: MetaData) -> list[Difference]:
    declared = set(metadata.tables)
    schemas = {name.partition(".")[0] for name in declared}

    def include_name(name: str | None, type_: str, parents: Mapping[str, str | None]) -> bool:
        if type_ == "schema":
            return name in schemas
        if type_ == "table":
            return f"{parents['schema_name']}.{name}" in declared
        return True

    def include_object(
        item: SchemaItem, name: str | None, type_: str, reflected: bool, compare_to: object
    ) -> bool:
        # Indexes are not declared: partial-index expressions do not compare reliably.
        return type_ != "index"

    context = MigrationContext.configure(
        connection,
        opts={
            "include_schemas": True,
            "include_name": include_name,
            "include_object": include_object,
            "compare_type": True,
        },
    )
    return list(compare_metadata(context, metadata))


async def _compare(pg: PostgresServer, metadata: MetaData) -> list[Difference]:
    engine = create_async_engine(to_sqlalchemy_url(pg.url("migrator")))
    try:
        async with engine.connect() as connected:
            return await connected.run_sync(_differences, metadata)
    finally:
        await engine.dispose()


def _copy(*, without_column: tuple[str, str] | None = None) -> MetaData:
    """The declared metadata again, optionally leaving one column out."""
    copied = MetaData()
    for name, table in tables.metadata.tables.items():
        if without_column is not None and name == without_column[0]:
            kept = [
                Column(
                    column.name,
                    column.type,
                    primary_key=column.primary_key,
                    nullable=column.nullable,
                    server_default=column.server_default,
                )
                for column in table.columns
                if column.name != without_column[1]
            ]
            uniques = [
                UniqueConstraint(*(column.name for column in item.columns), name=item.name)
                for item in table.constraints
                if isinstance(item, UniqueConstraint)
            ]
            Table(table.name, copied, *kept, *uniques, schema=table.schema)
        else:
            table.to_metadata(copied)
    return copied


def test_the_metadata_declares_the_tables_the_application_uses() -> None:
    assert set(tables.metadata.tables) == DECLARED


async def test_the_metadata_matches_the_migrated_schema(migrated: PostgresServer) -> None:
    assert await _compare(migrated, tables.metadata) == []


async def test_the_only_undeclared_auth_table_is_the_deferred_one(migrated: PostgresServer) -> None:
    async with connection(migrated) as db:
        rows = await db.fetch(
            "SELECT table_schema || '.' || table_name AS name FROM information_schema.tables "
            "WHERE table_schema = 'auth' AND table_type = 'BASE TABLE'"
        )
    assert {row["name"] for row in rows} - DECLARED == {"auth.api_keys"}


async def test_primary_keys_match(migrated: PostgresServer) -> None:
    async with connection(migrated) as db:
        rows = await db.fetch(
            "SELECT c.conrelid::regclass::text AS name, "
            "array_agg(a.attname::text ORDER BY k.position) AS columns "
            "FROM pg_constraint c "
            "CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, position) "
            "JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum "
            "WHERE c.contype = 'p' AND c.conrelid::regclass::text = ANY($1) GROUP BY 1",
            sorted(DECLARED),
        )
    in_database = {row["name"]: list(row["columns"]) for row in rows}
    declared = {
        name: [column.name for column in table.primary_key.columns]
        for name, table in tables.metadata.tables.items()
    }
    assert in_database == declared


async def test_the_columns_with_a_database_default_are_the_ones_marked_as_fetched(
    migrated: PostgresServer,
) -> None:
    """An insert leaves a fetched column out. If the database had no default, it would fail."""
    async with connection(migrated) as db:
        rows = await db.fetch(
            "SELECT table_schema || '.' || table_name AS name, column_name::text AS column "
            "FROM information_schema.columns "
            "WHERE table_schema || '.' || table_name = ANY($1) "
            "AND (column_default IS NOT NULL OR is_identity = 'YES')",
            sorted(DECLARED),
        )
    in_database = {(row["name"], row["column"]) for row in rows}

    def fetched(column: Column[object]) -> bool:
        return isinstance(column.server_default, FetchedValue)

    declared = {
        (name, column.name)
        for name, table in tables.metadata.tables.items()
        for column in table.columns
        if fetched(column)
    }
    assert in_database == declared


async def test_the_comparison_notices_a_wrong_column_type(migrated: PostgresServer) -> None:
    altered = _copy()
    altered.tables["auth.sessions"].c.token_hash.type = Text()

    differences = await _compare(migrated, altered)

    assert len(differences) == 1
    (change,) = differences[0]
    assert isinstance(change, tuple)
    assert (change[0], change[2], change[3]) == ("modify_type", "sessions", "token_hash")


async def test_the_comparison_notices_a_column_the_metadata_lacks(migrated: PostgresServer) -> None:
    differences = await _compare(migrated, _copy(without_column=("auth.users", "image")))

    assert len(differences) == 1
    change = differences[0]
    assert isinstance(change, tuple)
    assert (change[0], change[2]) == ("remove_column", "users")
    column = change[3]
    assert isinstance(column, Column)
    assert column.name == "image"
