"""Alembic environment: async engine, version table in the ops schema, SQL-first revisions."""

from __future__ import annotations

import asyncio
import os

from alembic import context
from sqlalchemy import pool, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from idraft.config.settings import to_sqlalchemy_url
from idraft.db.migrate import ADVISORY_LOCK_KEY, VERSION_SCHEMA

config = context.config

if not config.get_main_option("sqlalchemy.url"):
    # Developer CLI (`uv run alembic ...`): the URL comes from the environment.
    config.set_main_option(
        "sqlalchemy.url", to_sqlalchemy_url(os.environ["DATABASE_URL"]).replace("%", "%%")
    )


def _run(connection: Connection) -> None:
    # A session lock: a second migrator waits here until the first one disconnects.
    connection.execute(text("SELECT pg_advisory_lock(:key)"), {"key": ADVISORY_LOCK_KEY})
    connection.execute(text(f"CREATE SCHEMA IF NOT EXISTS {VERSION_SCHEMA}"))
    connection.commit()
    context.configure(
        connection=connection,
        target_metadata=None,
        version_table="alembic_version",
        version_table_schema=VERSION_SCHEMA,
        transaction_per_migration=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def _run_async() -> None:
    engine = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    try:
        async with engine.connect() as connection:
            await connection.run_sync(_run)
    finally:
        await engine.dispose()


if context.is_offline_mode():
    raise SystemExit("Offline mode is not supported: migrations run against a database.")

asyncio.run(_run_async())
