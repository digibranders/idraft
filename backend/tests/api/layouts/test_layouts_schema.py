"""The rules `core.layouts` keeps by itself (WP-11 T1; BE-LAYOUTS-01 and 15; migration 0021).

Each rule is checked against the database with no API in front: the privacy policy, the column
grant, the unique indexes, the size and shape of a document, and the foreign keys that carry
a layout away with its member or its workspace.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

import asyncpg
import pytest

from tests.conftest import PostgresServer
from tests.db.support import add_member, connection, create_user, scoped

DOCUMENT = '{"schema": 1}'
INSERT_ROW = (
    "INSERT INTO core.layouts (workspace_id, owner_user_id, screen, document, schema_version, "
    "updated_by) VALUES ($1, $2, $3, $4::jsonb, 1, $5)"
)
LIMIT_BYTES = 16384
PADDING = 16360


@dataclass(frozen=True)
class World:
    workspace_id: uuid.UUID
    a: uuid.UUID
    b: uuid.UUID
    b_row: uuid.UUID


@pytest.fixture
async def world(migrated: PostgresServer) -> World:
    """One workspace, two members, and a personal `overview` for each plus the team default."""
    async with connection(migrated) as db:
        suffix = uuid.uuid4().hex[:8]
        workspace_id: uuid.UUID = await db.fetchval(
            "INSERT INTO auth.workspaces (name, slug) VALUES ($1, $2) RETURNING id",
            "layouts",
            f"layouts-{suffix}",
        )
        a = await create_user(db, "layouts-a")
        b = await create_user(db, "layouts-b")
        await add_member(db, workspace_id, a, "editor")
        await add_member(db, workspace_id, b, "viewer")
        await db.execute(INSERT_ROW, workspace_id, a, "overview", DOCUMENT, a)
        b_row: uuid.UUID = await db.fetchval(
            INSERT_ROW + " RETURNING id", workspace_id, b, "overview", DOCUMENT, b
        )
        await db.execute(INSERT_ROW, workspace_id, None, "overview", DOCUMENT, a)
    return World(workspace_id, a, b, b_row)


async def test_row_security_shows_a_member_their_own_rows_and_the_team_default(
    migrated: PostgresServer, world: World
) -> None:
    async with scoped(migrated, "app_api", workspace_id=world.workspace_id, user_id=world.a) as db:
        rows = await db.fetch("SELECT owner_user_id FROM core.layouts")
    assert {row["owner_user_id"] for row in rows} == {world.a, None}


async def test_without_a_user_only_the_team_default_is_visible(
    migrated: PostgresServer, world: World
) -> None:
    async with scoped(migrated, "app_api", workspace_id=world.workspace_id) as db:
        rows = await db.fetch("SELECT owner_user_id FROM core.layouts")
    assert {row["owner_user_id"] for row in rows} == {None}


async def test_row_security_refuses_writing_another_members_row(
    migrated: PostgresServer, world: World
) -> None:
    async with scoped(migrated, "app_api", workspace_id=world.workspace_id, user_id=world.a) as db:
        with pytest.raises(asyncpg.InsufficientPrivilegeError, match="row-level security"):
            await db.execute(INSERT_ROW, world.workspace_id, world.b, "rankings", DOCUMENT, world.a)


async def test_row_security_hides_another_members_row_from_changes(
    migrated: PostgresServer, world: World
) -> None:
    async with scoped(migrated, "app_api", workspace_id=world.workspace_id, user_id=world.a) as db:
        updated = await db.execute(
            'UPDATE core.layouts SET document = \'{"schema": 1, "cards": []}\' '
            "WHERE owner_user_id = $1",
            world.b,
        )
        deleted = await db.execute("DELETE FROM core.layouts WHERE owner_user_id = $1", world.b)
    async with connection(migrated) as db:
        stored = await db.fetchval(
            "SELECT document::text FROM core.layouts WHERE id = $1", world.b_row
        )
    assert (updated, deleted) == ("UPDATE 0", "DELETE 0")
    assert stored == DOCUMENT


async def test_the_api_cannot_move_a_row_to_another_owner_or_screen(
    migrated: PostgresServer, world: World
) -> None:
    moves = [
        ("UPDATE core.layouts SET owner_user_id = $1 WHERE owner_user_id = $2", (world.b, world.a)),
        ("UPDATE core.layouts SET screen = 'rankings' WHERE owner_user_id = $1", (world.a,)),
        (
            "UPDATE core.layouts SET workspace_id = gen_random_uuid() WHERE owner_user_id = $1",
            (world.a,),
        ),
    ]
    for statement, arguments in moves:
        async with scoped(
            migrated, "app_api", workspace_id=world.workspace_id, user_id=world.a
        ) as db:
            with pytest.raises(asyncpg.InsufficientPrivilegeError, match="permission denied"):
                await db.execute(statement, *arguments)


async def test_the_privacy_policy_is_exactly_what_was_reviewed(migrated: PostgresServer) -> None:
    async with connection(migrated) as db:
        rows = await db.fetch(
            "SELECT polname, polpermissive, polcmd, pg_get_expr(polqual, polrelid) AS visible, "
            "pg_get_expr(polwithcheck, polrelid) AS writable "
            "FROM pg_policy WHERE polrelid = 'core.layouts'::regclass ORDER BY polname"
        )
    found = [
        (
            row["polname"],
            row["polpermissive"],
            row["polcmd"],
            " ".join(row["visible"].split()),
            " ".join(row["writable"].split()),
        )
        for row in rows
    ]
    private = "((owner_user_id IS NULL) OR (owner_user_id = auth.current_user_id()))"
    owned = "(workspace_id = auth.current_workspace_id())"
    assert found == [
        ("layouts_owner", False, b"*", private, private),
        ("tenant_isolation", True, b"*", owned, owned),
    ]


async def test_one_team_default_per_screen(migrated: PostgresServer, world: World) -> None:
    async with connection(migrated) as db:
        with pytest.raises(asyncpg.UniqueViolationError):
            await db.execute(INSERT_ROW, world.workspace_id, None, "overview", DOCUMENT, world.a)
        await db.execute(INSERT_ROW, world.workspace_id, None, "rankings", DOCUMENT, world.a)


async def test_one_personal_layout_per_member_and_screen(
    migrated: PostgresServer, world: World
) -> None:
    async with connection(migrated) as db:
        with pytest.raises(asyncpg.UniqueViolationError):
            await db.execute(INSERT_ROW, world.workspace_id, world.a, "overview", DOCUMENT, world.a)
        await db.execute(INSERT_ROW, world.workspace_id, world.a, "rankings", DOCUMENT, world.a)


async def test_the_database_refuses_a_document_over_16_kb(
    migrated: PostgresServer, world: World
) -> None:
    pad = (
        "INSERT INTO core.layouts (workspace_id, owner_user_id, screen, document, "
        "schema_version, updated_by) SELECT $1, $2, 'prompts', "
        "jsonb_build_object('schema', 1, 'pad', repeat('a', $3::int)), 1, $2"
    )
    async with connection(migrated) as db:
        size = await db.fetchval(
            "SELECT octet_length("
            "jsonb_build_object('schema', 1, 'pad', repeat('a', $1::int))::text)",
            PADDING,
        )
        assert size == LIMIT_BYTES
        await db.execute(pad, world.workspace_id, world.a, PADDING)
        with pytest.raises(asyncpg.CheckViolationError):
            await db.execute(
                pad.replace("'prompts'", "'sources'"), world.workspace_id, world.a, PADDING + 1
            )


@pytest.mark.parametrize("document", ["[]", '"x"'])
async def test_a_document_is_an_object(
    migrated: PostgresServer, world: World, document: str
) -> None:
    async with connection(migrated) as db:
        with pytest.raises(asyncpg.CheckViolationError):
            await db.execute(INSERT_ROW, world.workspace_id, world.a, "pages", document, world.a)


async def test_a_personal_layout_needs_a_membership(migrated: PostgresServer, world: World) -> None:
    async with connection(migrated) as db:
        stranger = await create_user(db, "layouts-stranger")
        with pytest.raises(asyncpg.ForeignKeyViolationError):
            await db.execute(INSERT_ROW, world.workspace_id, stranger, "pages", DOCUMENT, stranger)


async def test_personal_layouts_go_with_the_membership_and_all_go_with_the_workspace(
    migrated: PostgresServer, world: World
) -> None:
    count = "SELECT count(*) FROM core.layouts WHERE workspace_id = $1"
    async with connection(migrated) as db:
        await db.execute(
            "DELETE FROM auth.memberships WHERE workspace_id = $1 AND user_id = $2",
            world.workspace_id,
            world.a,
        )
        left = await db.fetch(
            "SELECT owner_user_id FROM core.layouts WHERE workspace_id = $1", world.workspace_id
        )
        await db.execute("DELETE FROM auth.workspaces WHERE id = $1", world.workspace_id)
        remaining = await db.fetchval(count, world.workspace_id)
    assert {row["owner_user_id"] for row in left} == {world.b, None}
    assert len(left) == 2
    assert remaining == 0
