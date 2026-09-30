import uuid
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, AsyncSession, async_sessionmaker

from sightline.config.settings import Settings
from sightline.db.engine import create_engine, create_session_factory, workspace_transaction

WORKSPACE = "SELECT NULLIF(current_setting('app.workspace_id', true), '')"


async def _scalar(executor: AsyncConnection | AsyncSession, sql: str) -> Any:
    return (await executor.execute(text(sql))).scalar_one()


async def test_engine_connects_to_postgres_18(engine: AsyncEngine) -> None:
    async with engine.connect() as connection:
        version = await _scalar(connection, "SHOW server_version_num")
    assert int(version) // 10000 == 18


async def test_statement_timeout_and_application_name_are_set(engine: AsyncEngine) -> None:
    async with engine.connect() as connection:
        timeout = await _scalar(connection, "SHOW statement_timeout")
        name = await _scalar(connection, "SHOW application_name")
    assert timeout == "15s"
    assert name == "sightline-api"


async def test_statement_timeout_cancels_slow_queries(settings: Settings) -> None:
    fast = create_engine(settings.model_copy(update={"db_statement_timeout": "50ms"}))
    try:
        async with fast.connect() as connection:
            with pytest.raises(DBAPIError, match="statement timeout"):
                await connection.execute(text("SELECT pg_sleep(1)"))
    finally:
        await fast.dispose()


async def test_workspace_transaction_sets_the_tenant_for_its_transaction_only(
    engine: AsyncEngine,
) -> None:
    sessions = create_session_factory(engine)
    workspace_id = uuid.uuid4()

    async with workspace_transaction(sessions, workspace_id) as session:
        inside = await _scalar(session, WORKSPACE)
    assert inside == str(workspace_id)

    # The pool holds one connection, so this transaction runs on the same server session.
    async with sessions() as session, session.begin():
        after = await _scalar(session, WORKSPACE)
    assert after is None


async def test_the_setting_is_an_empty_string_not_null_after_a_tenant_transaction(
    engine: AsyncEngine,
) -> None:
    """Why policies use NULLIF: PostgreSQL keeps the custom setting as '' on a reused session."""
    sessions = create_session_factory(engine)
    async with workspace_transaction(sessions, uuid.uuid4()):
        pass
    async with sessions() as session, session.begin():
        raw = await _scalar(session, "SELECT current_setting('app.workspace_id', true)")
    assert raw == ""


async def _insert_then_fail(sessions: async_sessionmaker[AsyncSession]) -> None:
    async with workspace_transaction(sessions, uuid.uuid4()) as session:
        await session.execute(text("INSERT INTO t_rollback VALUES (1)"))
        raise RuntimeError("abort")


async def test_workspace_transaction_rolls_back_on_error(engine: AsyncEngine) -> None:
    sessions = create_session_factory(engine)
    async with engine.begin() as connection:
        await connection.execute(text("CREATE TABLE IF NOT EXISTS t_rollback (id int)"))
        await connection.execute(text("TRUNCATE t_rollback"))

    with pytest.raises(RuntimeError, match="abort"):
        await _insert_then_fail(sessions)

    async with engine.connect() as connection:
        count = await _scalar(connection, "SELECT count(*) FROM t_rollback")
    assert count == 0
