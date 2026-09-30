"""Uniqueness and value rules of the Phase 1 tables (docs/26-testing-quality.md: DB-CON-01)."""

import uuid

import asyncpg
import pytest

from tests.conftest import PostgresServer
from tests.db.support import add_member, connection, create_user, scoped, seed_tenant


async def test_ids_are_uuid_version_7_and_sort_by_creation(migrated: PostgresServer) -> None:
    async with scoped(migrated, "superuser") as db:
        ids = [await create_user(db, f"order-{index}") for index in range(5)]
    assert all(value.version == 7 for value in ids)
    assert ids == sorted(ids)


async def test_an_email_belongs_to_one_user_whatever_its_case(migrated: PostgresServer) -> None:
    address = f"case-{uuid.uuid4().hex[:8]}@example.com"
    insert = "INSERT INTO auth.users (email, name, password_hash) VALUES ($1, 'x', 'h')"
    async with scoped(migrated, "superuser") as db:
        await db.execute(insert, address)
        with pytest.raises(asyncpg.UniqueViolationError):
            await db.execute(insert, address.upper())


async def test_a_workspace_slug_is_unique(migrated: PostgresServer) -> None:
    slug = f"slug-{uuid.uuid4().hex[:8]}"
    insert = "INSERT INTO auth.workspaces (name, slug) VALUES ('x', $1)"
    async with scoped(migrated, "superuser") as db:
        await db.execute(insert, slug)
        with pytest.raises(asyncpg.UniqueViolationError):
            await db.execute(insert, slug.upper())


async def test_a_user_has_one_membership_per_workspace(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "members")
    async with scoped(migrated, "superuser") as db:
        with pytest.raises(asyncpg.UniqueViolationError):
            await add_member(db, tenant.workspace_id, tenant.owner_id, "viewer")


@pytest.mark.parametrize("role", ["superadmin", "", "OWNER"])
async def test_a_membership_role_must_be_one_of_the_six(
    migrated: PostgresServer, role: str
) -> None:
    tenant = await seed_tenant(migrated, "roles")
    async with scoped(migrated, "superuser") as db:
        user_id = await create_user(db, "candidate")
        with pytest.raises(asyncpg.CheckViolationError):
            await add_member(db, tenant.workspace_id, user_id, role)


async def test_an_email_has_one_pending_invitation_per_workspace(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "invites")
    insert = (
        "INSERT INTO auth.invitations (workspace_id, email, role, token_hash, invited_by, "
        "expires_at, status) VALUES ($1, 'again@example.com', 'viewer', $2, $3, now(), $4)"
    )
    async with scoped(migrated, "superuser") as db:
        await db.execute(
            insert, tenant.workspace_id, uuid.uuid4().bytes, tenant.owner_id, "pending"
        )
        # an answered invitation does not block a new one
        await db.execute(
            insert, tenant.workspace_id, uuid.uuid4().bytes, tenant.owner_id, "declined"
        )
        with pytest.raises(asyncpg.UniqueViolationError):
            await db.execute(
                insert, tenant.workspace_id, uuid.uuid4().bytes, tenant.owner_id, "pending"
            )


async def test_a_project_slug_is_unique_within_a_workspace_only(migrated: PostgresServer) -> None:
    first = await seed_tenant(migrated, "slug-one")
    second = await seed_tenant(migrated, "slug-two")  # both already have a project 'main'
    assert first.project_id != second.project_id
    async with scoped(migrated, "superuser") as db:
        with pytest.raises(asyncpg.UniqueViolationError):
            await db.execute(
                "INSERT INTO core.projects (workspace_id, name, slug) VALUES ($1, 'x', 'MAIN')",
                first.workspace_id,
            )


async def test_deleting_a_workspace_with_projects_is_refused(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "guarded")
    async with scoped(migrated, "superuser") as db:
        with pytest.raises(asyncpg.RestrictViolationError):
            await db.execute("DELETE FROM auth.workspaces WHERE id = $1", tenant.workspace_id)


async def test_deleting_a_user_removes_their_sessions_and_memberships(
    migrated: PostgresServer,
) -> None:
    tenant = await seed_tenant(migrated, "leaver")
    async with connection(migrated) as db, db.transaction():
        user_id = await create_user(db, "leaver")
        await add_member(db, tenant.workspace_id, user_id, "viewer")
        await db.execute(
            "INSERT INTO auth.sessions (token_hash, user_id, idle_expires_at, absolute_expires_at) "
            "VALUES ($1, $2, now(), now())",
            uuid.uuid4().bytes,
            user_id,
        )
        await db.execute("DELETE FROM auth.users WHERE id = $1", user_id)
        left = await db.fetchval(
            "SELECT (SELECT count(*) FROM auth.sessions WHERE user_id = $1) + "
            "(SELECT count(*) FROM auth.memberships WHERE user_id = $1)",
            user_id,
        )
    assert left == 0
