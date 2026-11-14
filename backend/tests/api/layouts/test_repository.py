"""The statements of the layouts repository, alone (WP-11 T2).

The application half of the privacy rule (owner decision D-09) and of workspace scoping. The
repository runs here as `migrator`, which owns the table, so row security does not apply: only
the `WHERE` clauses of the statements stand between the caller and the other rows.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from idraft.api.layouts.repository import delete_layout, stored_layouts, update_layout
from idraft.config.settings import to_sqlalchemy_url
from idraft.db.tables import layouts
from tests.api.auth.support import add_member, make_user, make_workspace
from tests.api.layouts.support import DOCUMENT, OTHER, insert_layout
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


async def test_the_read_names_the_screen_without_row_security(
    migrated: PostgresServer, owner_db: AsyncSession
) -> None:
    workspace = await make_workspace(migrated)
    a = await make_user(migrated)
    await add_member(migrated, workspace, a, "editor")
    # The `rankings` rows go in first: without the filter on the screen they would be found.
    await insert_layout(migrated, workspace.id, a.id, "rankings", DOCUMENT, a.id)
    await insert_layout(migrated, workspace.id, None, "rankings", DOCUMENT, a.id)
    overview_personal = await insert_layout(
        migrated, workspace.id, a.id, "overview", DOCUMENT, a.id
    )
    overview_team = await insert_layout(migrated, workspace.id, None, "overview", DOCUMENT, a.id)

    personal, team = await stored_layouts(owner_db, workspace.id, a.id, "overview")

    assert (personal and personal.id, team and team.id) == (overview_personal, overview_team)


async def test_a_delete_reaches_only_the_callers_row_without_row_security(
    migrated: PostgresServer, owner_db: AsyncSession
) -> None:
    here = await make_workspace(migrated)
    there = await make_workspace(migrated)
    a = await make_user(migrated)
    b = await make_user(migrated)
    for workspace in (here, there):
        await add_member(migrated, workspace, a, "editor")
        await add_member(migrated, workspace, b, "editor")
    a_row = await insert_layout(migrated, here.id, a.id, "overview", DOCUMENT, a.id)
    kept = [
        await insert_layout(migrated, here.id, b.id, "overview", DOCUMENT, b.id),
        await insert_layout(migrated, here.id, None, "overview", DOCUMENT, a.id),
        await insert_layout(migrated, here.id, a.id, "rankings", DOCUMENT, a.id),
        await insert_layout(migrated, there.id, a.id, "overview", DOCUMENT, a.id),
    ]

    removed = await delete_layout(owner_db, here.id, a.id, "overview")
    again = await delete_layout(owner_db, here.id, a.id, "overview")

    assert removed is not None
    assert removed[0] == a_row
    assert again is None
    left = await owner_db.execute(
        select(layouts.c.id).where(layouts.c.workspace_id.in_([here.id, there.id]))
    )
    assert sorted(left.scalars().all()) == sorted(kept)


async def test_an_update_reaches_only_its_own_row_without_row_security(
    migrated: PostgresServer, owner_db: AsyncSession
) -> None:
    here = await make_workspace(migrated)
    there = await make_workspace(migrated)
    a = await make_user(migrated)
    b = await make_user(migrated)
    for workspace in (here, there):
        await add_member(migrated, workspace, a, "editor")
        await add_member(migrated, workspace, b, "editor")
    target = await insert_layout(migrated, here.id, a.id, "overview", DOCUMENT, a.id)
    others = [
        await insert_layout(migrated, here.id, b.id, "overview", DOCUMENT, b.id),
        await insert_layout(migrated, here.id, None, "overview", DOCUMENT, a.id),
        await insert_layout(migrated, here.id, a.id, "rankings", DOCUMENT, a.id),
    ]
    elsewhere = await insert_layout(migrated, there.id, a.id, "overview", DOCUMENT, a.id)

    # The id of a row of the other workspace, named with this workspace: nothing is updated.
    await update_layout(owner_db, here.id, elsewhere, OTHER, b.id)
    await update_layout(owner_db, here.id, target, OTHER, b.id)

    rows = (
        await owner_db.execute(
            select(layouts.c.id, layouts.c.document, layouts.c.updated_by).where(
                layouts.c.workspace_id.in_([here.id, there.id])
            )
        )
    ).all()
    assert {row.id for row in rows if row.document == OTHER} == {target}
    assert {row.id for row in rows if row.document == DOCUMENT} == {*others, elsewhere}
    assert {row.updated_by for row in rows if row.id == target} == {b.id}


async def test_a_delete_of_the_team_default_leaves_personal_rows(
    migrated: PostgresServer, owner_db: AsyncSession
) -> None:
    workspace = await make_workspace(migrated)
    a = await make_user(migrated)
    await add_member(migrated, workspace, a, "editor")
    personal = await insert_layout(migrated, workspace.id, a.id, "overview", DOCUMENT, a.id)
    team_row = await insert_layout(migrated, workspace.id, None, "overview", DOCUMENT, a.id)

    removed = await delete_layout(owner_db, workspace.id, None, "overview")

    assert removed is not None
    assert removed[0] == team_row
    left = await owner_db.execute(
        select(layouts.c.id).where(layouts.c.workspace_id == workspace.id)
    )
    assert left.scalars().all() == [personal]


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
