"""The statements of the layouts repository, alone (WP-11 T2).

The application half of the privacy rule (owner decision D-09) and of workspace scoping. The
repository runs here as `migrator`, which owns the table, so row security does not apply: only
the `WHERE` clauses of the statements stand between the caller and the other rows.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from idraft.api.layouts.repository import stored_layouts
from idraft.config.settings import to_sqlalchemy_url
from tests.api.auth.support import add_member, make_user, make_workspace
from tests.api.layouts.support import DOCUMENT, insert_layout
from tests.conftest import PostgresServer


@pytest.fixture
async def owner_db(migrated: PostgresServer) -> AsyncIterator[AsyncSession]:
    engine = create_async_engine(to_sqlalchemy_url(migrated.url("migrator")))
    try:
        async with AsyncSession(engine) as db, db.begin():
            yield db
            await db.rollback()
    finally:
        await engine.dispose()


async def test_the_read_names_the_caller_without_row_security(
    migrated: PostgresServer, owner_db: AsyncSession
) -> None:
    workspace = await make_workspace(migrated)
    a = await make_user(migrated)
    b = await make_user(migrated)
    await add_member(migrated, workspace, a, "editor")
    await add_member(migrated, workspace, b, "editor")
    # B's row goes in first: without the filter on the caller it would be the first one found.
    await insert_layout(migrated, workspace.id, b.id, "overview", DOCUMENT, b.id)
    a_row = await insert_layout(migrated, workspace.id, a.id, "overview", DOCUMENT, a.id)
    team_row = await insert_layout(migrated, workspace.id, None, "overview", DOCUMENT, a.id)

    personal, team = await stored_layouts(owner_db, workspace.id, a.id, "overview")

    assert (personal and personal.id, team and team.id) == (a_row, team_row)


async def test_the_read_names_the_workspace_without_row_security(
    migrated: PostgresServer, owner_db: AsyncSession
) -> None:
    here = await make_workspace(migrated)
    there = await make_workspace(migrated)
    a = await make_user(migrated)
    await add_member(migrated, here, a, "editor")
    await add_member(migrated, there, a, "editor")
    # The other workspace goes in first: without the filter on the workspace it would be found.
    await insert_layout(migrated, there.id, a.id, "overview", DOCUMENT, a.id)
    await insert_layout(migrated, there.id, None, "overview", DOCUMENT, a.id)
    here_personal = await insert_layout(migrated, here.id, a.id, "overview", DOCUMENT, a.id)
    here_team = await insert_layout(migrated, here.id, None, "overview", DOCUMENT, a.id)

    personal, team = await stored_layouts(owner_db, here.id, a.id, "overview")

    assert (personal and personal.id, team and team.id) == (here_personal, here_team)
