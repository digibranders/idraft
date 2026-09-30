"""The table metadata the application queries through must match the migrated schema
(docs/26-testing-quality.md: DB-MIG-01)."""

from typing import Any

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import MetaData, Text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.schema import SchemaItem

from sightline.config.settings import to_sqlalchemy_url
from sightline.db import tables
from tests.conftest import PostgresServer

DECLARED = {
    "auth.users",
    "auth.sessions",
    "auth.verification_tokens",
    "auth.totp_secrets",
    "auth.workspaces",
    "auth.memberships",
    "auth.invitations",
}


def _differences(connection: Connection, metadata: MetaData) -> list[Any]:
    declared = set(metadata.tables)
    schemas = {name.partition(".")[0] for name in declared}

    def include_name(name: str | None, type_: str, parents: Any) -> bool:
        if type_ == "schema":
            return name in schemas
        if type_ == "table":
            return f"{parents['schema_name']}.{name}" in declared
        return True

    def include_object(
        item: SchemaItem, name: str | None, type_: str, reflected: bool, compare_to: Any
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


async def _compare(pg: PostgresServer, metadata: MetaData) -> list[Any]:
    engine = create_async_engine(to_sqlalchemy_url(pg.url("migrator")))
    try:
        async with engine.connect() as connection:
            return await connection.run_sync(_differences, metadata)
    finally:
        await engine.dispose()


def test_the_metadata_declares_the_auth_tables() -> None:
    assert set(tables.metadata.tables) == DECLARED


async def test_the_metadata_matches_the_migrated_schema(migrated: PostgresServer) -> None:
    assert await _compare(migrated, tables.metadata) == []


async def test_the_comparison_notices_a_wrong_column_type(migrated: PostgresServer) -> None:
    altered = MetaData()
    for table in tables.metadata.tables.values():
        table.to_metadata(altered)
    altered.tables["auth.sessions"].c.token_hash.type = Text()

    differences = await _compare(migrated, altered)

    assert [(item[0][0], item[0][2], item[0][3]) for item in differences] == [
        ("modify_type", "sessions", "token_hash")
    ]


async def test_the_comparison_notices_a_column_the_metadata_lacks(migrated: PostgresServer) -> None:
    altered = MetaData()
    for table in tables.metadata.tables.values():
        table.to_metadata(altered)
    users = altered.tables["auth.users"]
    users._columns.remove(users.c.image)

    differences = await _compare(migrated, altered)

    assert [(item[0], item[2], item[3].name) for item in differences] == [
        ("remove_column", "users", "image")
    ]
