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


async def test_a_task_is_planned_once_per_idempotency_key(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "ledger")
    insert = (
        "INSERT INTO ops.collection_tasks (created_at, run_id, workspace_id, project_id, workload, "
        "subject_type, subject_id, idempotency_key, request_fingerprint, provider_code, "
        "provider_endpoint, scheduled_for, status) VALUES (date_trunc('month', now()), $1, $2, $3, "
        "'seo_rank', 'tracked_keyword', '7', $4, $4, 'dataforseo', 'serp', now(), 'pending') "
        "ON CONFLICT (idempotency_key, created_at) DO NOTHING"
    )
    key = uuid.uuid4().bytes
    arguments = (tenant.run_id, tenant.workspace_id, tenant.project_id, key)
    async with scoped(migrated, "app_worker") as db:
        first = await db.execute(insert, *arguments)
        second = await db.execute(insert, *arguments)
    assert (first, second) == ("INSERT 0 1", "INSERT 0 0")


async def test_a_raw_payload_is_stored_once_per_content_hash(migrated: PostgresServer) -> None:
    insert = (
        "INSERT INTO ops.raw_payloads (storage, object_key, sha256, bytes_raw, bytes_stored, "
        "compression, content_type, provider_code, provider_endpoint, fetched_at, retention_class) "
        "VALUES ('r2', 'raw/v1/x', $1, 10, 5, 'zstd', 'application/json', 'dataforseo', 'serp', "
        "now(), 'serp_raw')"
    )
    digest = uuid.uuid4().bytes + uuid.uuid4().bytes
    async with scoped(migrated, "app_worker") as db:
        await db.execute(insert, digest)
        with pytest.raises(asyncpg.UniqueViolationError):
            await db.execute(insert, digest)


async def test_a_workspace_has_one_budget_per_scope(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "budget")  # seeds a workspace-wide 'all' budget
    insert = "INSERT INTO ops.budgets (workspace_id, workload, limit_usd) VALUES ($1, $2, 50)"
    async with scoped(migrated, "superuser") as db:
        await db.execute(insert, tenant.workspace_id, "seo_rank")
        with pytest.raises(asyncpg.UniqueViolationError):  # NULL project ids are not distinct
            await db.execute(insert, tenant.workspace_id, "all")


async def test_a_schedule_is_planned_once_per_window(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "window")
    insert = (
        "INSERT INTO ops.collection_runs (workspace_id, project_id, schedule_id, workload, "
        "window_start, window_end, trigger, status, config_snapshot) "
        "VALUES ($1, $2, $3, 'seo_rank', '2026-10-01 02:00+00', '2026-10-01 08:00+00', "
        "'schedule', 'planned', '{}')"
    )
    arguments = (tenant.workspace_id, tenant.project_id, tenant.schedule_id)
    async with scoped(migrated, "superuser") as db:
        await db.execute(insert, *arguments)
        with pytest.raises(asyncpg.UniqueViolationError):
            await db.execute(insert, *arguments)


async def test_the_provider_registry_is_seeded(migrated: PostgresServer) -> None:
    async with scoped(migrated, "app_api") as db:
        rows = await db.fetch("SELECT code, kind FROM ops.providers ORDER BY code")
    assert [(row["code"], row["kind"]) for row in rows] == [
        ("dataforseo", "collection"),
        ("internal", "internal_llm"),
    ]
