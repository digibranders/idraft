import uuid
from collections.abc import AsyncIterator
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, AsyncSession, async_sessionmaker

from idraft.config.settings import Settings
from idraft.db.engine import (
    create_engine,
    create_session_factory,
    user_transaction,
    workspace_transaction,
)

WORKSPACE = "SELECT NULLIF(current_setting('app.workspace_id', true), '')"
USER = "SELECT NULLIF(current_setting('app.user_id', true), '')"


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
    assert name == "idraft-api"


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


@pytest.fixture
async def scratch_table(engine: AsyncEngine) -> AsyncIterator[str]:
    """A throwaway table, removed afterwards so the shared database stays as migrations left it."""
    name = f"t_scratch_{uuid.uuid4().hex[:12]}"
    async with engine.begin() as connection:
        await connection.execute(text(f"CREATE TABLE {name} (id int PRIMARY KEY, note text)"))
    yield name
    async with engine.begin() as connection:
        await connection.execute(text(f"DROP TABLE {name}"))


async def _count(engine: AsyncEngine, table: str) -> int:
    async with engine.connect() as connection:
        return int(await _scalar(connection, f"SELECT count(*) FROM {table}"))


async def test_workspace_transaction_commits_on_success(
    engine: AsyncEngine, scratch_table: str
) -> None:
    sessions = create_session_factory(engine)
    async with workspace_transaction(sessions, uuid.uuid4()) as session:
        await session.execute(text(f"INSERT INTO {scratch_table} VALUES (1, 'kept')"))
    assert await _count(engine, scratch_table) == 1


async def _insert_then_fail(sessions: async_sessionmaker[AsyncSession], table: str) -> None:
    async with workspace_transaction(sessions, uuid.uuid4()) as session:
        await session.execute(text(f"INSERT INTO {table} VALUES (1, 'lost')"))
        raise RuntimeError("abort")


async def test_workspace_transaction_rolls_back_on_error(
    engine: AsyncEngine, scratch_table: str
) -> None:
    sessions = create_session_factory(engine)
    with pytest.raises(RuntimeError, match="abort"):
        await _insert_then_fail(sessions, scratch_table)
    assert await _count(engine, scratch_table) == 0


async def test_database_errors_never_carry_the_bound_values(
    engine: AsyncEngine, scratch_table: str
) -> None:
    insert = text(f"INSERT INTO {scratch_table} VALUES (:id, :note)")
    async with engine.begin() as connection:
        await connection.execute(insert, {"id": 1, "note": "first"})

    with pytest.raises(IntegrityError) as error:
        async with engine.begin() as connection:
            await connection.execute(insert, {"id": 1, "note": "jane@client.example"})

    assert "jane@client.example" not in str(error.value)
    assert "jane@client.example" not in repr(error.value)


async def test_waiting_for_a_pooled_connection_is_bounded(engine: AsyncEngine) -> None:
    assert engine.pool.timeout() == 5.0  # type: ignore[attr-defined]


async def test_a_workspace_transaction_can_also_carry_the_user(engine: AsyncEngine) -> None:
    sessions = create_session_factory(engine)
    workspace_id, user_id = uuid.uuid4(), uuid.uuid4()

    async with workspace_transaction(sessions, workspace_id, user_id=user_id) as session:
        inside = (await _scalar(session, WORKSPACE), await _scalar(session, USER))
    async with sessions() as session, session.begin():
        after = (await _scalar(session, WORKSPACE), await _scalar(session, USER))

    assert inside == (str(workspace_id), str(user_id))
    assert after == (None, None)


async def test_a_user_transaction_sets_the_user_and_no_workspace(engine: AsyncEngine) -> None:
    sessions = create_session_factory(engine)
    user_id = uuid.uuid4()

    async with user_transaction(sessions, user_id) as session:
        inside = (await _scalar(session, WORKSPACE), await _scalar(session, USER))
    async with sessions() as session, session.begin():
        after = await _scalar(session, USER)

    assert inside == (None, str(user_id))
    assert after is None


async def test_a_setting_left_on_the_connection_cannot_widen_a_scoped_transaction(
    engine: AsyncEngine,
) -> None:
    """A session-level setting survives on a pooled connection; scoped transactions override it."""
    sessions = create_session_factory(engine)
    stale, workspace_id, user_id = str(uuid.uuid4()), uuid.uuid4(), uuid.uuid4()
    leave_behind = text(
        "SELECT set_config('app.workspace_id', :stale, false), "
        "set_config('app.user_id', :stale, false)"
    )
    async with sessions() as session, session.begin():
        await session.execute(leave_behind, {"stale": stale})
    try:
        async with sessions() as session, session.begin():
            unscoped = await _scalar(session, WORKSPACE)
        async with user_transaction(sessions, user_id) as session:
            as_user = (await _scalar(session, WORKSPACE), await _scalar(session, USER))
        async with workspace_transaction(sessions, workspace_id) as session:
            as_workspace = (await _scalar(session, WORKSPACE), await _scalar(session, USER))
    finally:
        async with engine.begin() as connection:
            await connection.execute(text("RESET app.workspace_id"))
            await connection.execute(text("RESET app.user_id"))

    assert unscoped == stale, "the test must run on the connection that carries the stale value"
    assert as_user == (None, str(user_id))
    assert as_workspace == (str(workspace_id), None)
