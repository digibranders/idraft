"""Tenant isolation, checked as the real roles (docs/26-testing-quality.md: DB-RLS-01 to 03)."""

import asyncpg
import pytest

from tests.conftest import PostgresServer
from tests.db.support import (
    SCHEMAS,
    TENANT_TABLES,
    Tenant,
    add_member,
    connection,
    create_user,
    scoped,
    seed_tenant,
)


@pytest.fixture
async def tenants(migrated: PostgresServer) -> tuple[Tenant, Tenant]:
    return await seed_tenant(migrated, "alpha"), await seed_tenant(migrated, "beta")


async def test_every_table_with_a_workspace_column_is_isolated(migrated: PostgresServer) -> None:
    """DB-RLS-01, read from the catalog, so a new table cannot ship without its policy."""
    async with connection(migrated) as db:
        rows = await db.fetch(
            """
            SELECT c.oid::regclass::text AS name,
                   c.relrowsecurity AS enabled,
                   EXISTS (SELECT 1 FROM pg_policy p
                           WHERE p.polrelid = c.oid
                             AND p.polname = 'tenant_isolation') AS has_policy
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = ANY($1) AND c.relkind IN ('r', 'p') AND NOT c.relispartition
              AND (c.oid = 'auth.workspaces'::regclass
                   OR EXISTS (SELECT 1 FROM pg_attribute a
                              WHERE a.attrelid = c.oid AND a.attname = 'workspace_id'
                                AND NOT a.attisdropped))
            """,
            SCHEMAS,
        )
    found = {row["name"]: (row["enabled"], row["has_policy"]) for row in rows}
    assert found == dict.fromkeys(TENANT_TABLES, (True, True))


# Keys between tenant tables that do not carry the workspace, each with the reason it is safe.
SINGLE_WORKSPACE_KEYS = {
    # A parent term is in the same vocabulary, and the vocabulary key carries the workspace.
    ("core.taxonomy_terms", "taxonomy_terms_parent_id_vocabulary_id_fkey"),
    # Only the worker writes these today; they gain the workspace before a route writes them
    # (docs/review-log.md F66). Schedules gained it with their routes (migration 0011).
    ("ops.budgets", "budgets_project_id_fkey"),
    ("ops.collection_runs", "collection_runs_blocked_by_budget_id_fkey"),
}


async def test_keys_between_tenant_tables_include_the_workspace(migrated: PostgresServer) -> None:
    """Row-level security does not apply to foreign key checks, so a key on the id alone would
    let a row point into another workspace. Read from the catalog, so new tables are covered."""
    async with connection(migrated) as db:
        rows = await db.fetch(
            """
            SELECT k.conrelid::regclass::text AS source, k.conname AS name,
                   k.confrelid::regclass::text AS target,
                   EXISTS (SELECT 1 FROM unnest(k.conkey) AS column_number
                           JOIN pg_attribute a ON a.attrelid = k.conrelid
                                              AND a.attnum = column_number
                           WHERE a.attname = 'workspace_id') AS keyed_by_workspace
            FROM pg_constraint k
            WHERE k.contype = 'f'
            """
        )
    unkeyed = {
        (row["source"], row["name"])
        for row in rows
        if row["source"] in TENANT_TABLES
        and row["target"] in TENANT_TABLES
        and row["target"] != "auth.workspaces"
        and not row["keyed_by_workspace"]
    }
    assert unkeyed == SINGLE_WORKSPACE_KEYS


@pytest.mark.parametrize("table", sorted(TENANT_TABLES))
async def test_without_a_workspace_the_api_sees_no_tenant_rows(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant], table: str
) -> None:
    async with scoped(migrated, "app_api") as db:
        assert await db.fetchval(f"SELECT count(*) FROM {table}") == 0


@pytest.mark.parametrize("table", sorted(TENANT_TABLES))
async def test_with_a_workspace_the_api_sees_only_that_workspace(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant], table: str
) -> None:
    alpha, _ = tenants
    column = TENANT_TABLES[table]
    async with scoped(migrated, "app_api", workspace_id=alpha.workspace_id) as db:
        total = await db.fetchval(f"SELECT count(*) FROM {table}")
        own = await db.fetchval(
            f"SELECT count(*) FROM {table} WHERE {column} = $1", alpha.workspace_id
        )
    assert total >= 1
    assert total == own


async def test_the_setting_does_not_leak_into_the_next_transaction(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with connection(migrated, "app_api") as db:
        async with db.transaction():
            await db.execute(
                "SELECT set_config('app.workspace_id', $1, true)", str(alpha.workspace_id)
            )
            assert await db.fetchval("SELECT count(*) FROM core.projects") >= 1
        assert await db.fetchval("SELECT count(*) FROM core.projects") == 0


async def test_the_api_cannot_write_a_row_for_another_workspace(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, beta = tenants
    async with scoped(migrated, "app_api", workspace_id=alpha.workspace_id) as db:
        with pytest.raises(asyncpg.InsufficientPrivilegeError, match="row-level security"):
            await db.execute(
                "INSERT INTO core.projects (workspace_id, name, slug) VALUES ($1, 'x', 'x')",
                beta.workspace_id,
            )


async def test_the_api_cannot_move_a_row_to_another_workspace(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, beta = tenants
    async with scoped(migrated, "app_api", workspace_id=alpha.workspace_id) as db:
        with pytest.raises(asyncpg.InsufficientPrivilegeError, match="row-level security"):
            await db.execute(
                "UPDATE core.projects SET workspace_id = $1 WHERE id = $2",
                beta.workspace_id,
                alpha.project_id,
            )


async def test_the_api_cannot_change_or_delete_another_workspaces_rows(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, beta = tenants
    async with scoped(migrated, "app_api", workspace_id=alpha.workspace_id) as db:
        updated = await db.execute(
            "UPDATE core.projects SET name = 'taken' WHERE id = $1", beta.project_id
        )
        # A table the API may delete from (schedules are soft-deleted since migration 0011).
        deleted = await db.execute(
            "DELETE FROM seo.keyword_group_members WHERE workspace_id = $1", beta.workspace_id
        )
    assert (updated, deleted) == ("UPDATE 0", "DELETE 0")
    async with connection(migrated) as db:
        survivors = await db.fetchval(
            "SELECT count(*) FROM seo.keyword_group_members WHERE workspace_id = $1",
            beta.workspace_id,
        )
    assert survivors == 1


async def test_the_api_cannot_turn_row_security_off(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    """DB-RLS-03."""
    async with scoped(migrated, "app_api") as db:
        await db.execute("SET LOCAL row_security = off")
        with pytest.raises(asyncpg.InsufficientPrivilegeError, match="row-level security"):
            await db.fetchval("SELECT count(*) FROM core.projects")


async def test_a_user_sees_their_memberships_and_workspaces_across_tenants(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, beta = tenants
    async with connection(migrated) as db:
        await add_member(db, beta.workspace_id, alpha.owner_id, "viewer")

    async with scoped(migrated, "app_api", user_id=alpha.owner_id) as db:
        memberships = await db.fetch("SELECT workspace_id, user_id FROM auth.memberships")
        workspaces = await db.fetch("SELECT id FROM auth.workspaces")
        projects = await db.fetchval("SELECT count(*) FROM core.projects")

    assert {row["user_id"] for row in memberships} == {alpha.owner_id}
    assert {row["workspace_id"] for row in memberships} == {alpha.workspace_id, beta.workspace_id}
    assert {row["id"] for row in workspaces} == {alpha.workspace_id, beta.workspace_id}
    assert projects == 0  # knowing who you are opens no tenant data without a chosen workspace


async def test_the_user_setting_does_not_let_a_user_write_memberships(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, beta = tenants
    async with scoped(migrated, "app_api", user_id=alpha.owner_id) as db:
        with pytest.raises(asyncpg.InsufficientPrivilegeError, match="row-level security"):
            await db.execute(
                "INSERT INTO auth.memberships (workspace_id, user_id, role) "
                "VALUES ($1, $2, 'owner')",
                beta.workspace_id,
                alpha.owner_id,
            )


async def test_a_workspace_and_its_first_membership_can_be_created_inside_that_workspace(
    migrated: PostgresServer,
) -> None:
    async with connection(migrated) as db:
        user_id = await create_user(db, "founder")
        workspace_id = await db.fetchval("SELECT uuidv7()")

    async with scoped(migrated, "app_api", workspace_id=workspace_id, user_id=user_id) as db:
        await db.execute(
            "INSERT INTO auth.workspaces (id, name, slug) VALUES ($1, 'New', $2)",
            workspace_id,
            f"new-{workspace_id.hex[-8:]}",
        )
        await add_member(db, workspace_id, user_id, "owner")
        assert await db.fetchval("SELECT count(*) FROM auth.memberships") == 1


async def test_an_invitation_is_found_by_its_token_before_any_workspace_is_known(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with scoped(migrated, "app_api") as db:
        hidden = await db.fetchval("SELECT count(*) FROM auth.invitations")
        found = await db.fetch(
            "SELECT workspace_id, role FROM auth.invitation_by_token($1)",
            alpha.invitation_token_hash,
        )
        missing = await db.fetch("SELECT 1 FROM auth.invitation_by_token($1)", b"\x00" * 32)
    assert hidden == 0
    assert [(row["workspace_id"], row["role"]) for row in found] == [(alpha.workspace_id, "viewer")]
    assert missing == []


async def test_the_worker_sees_every_workspace(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, beta = tenants
    async with scoped(migrated, "app_worker") as db:
        rows = await db.fetch(
            "SELECT workspace_id FROM core.projects WHERE workspace_id = ANY($1)",
            [alpha.workspace_id, beta.workspace_id],
        )
    assert {row["workspace_id"] for row in rows} == {alpha.workspace_id, beta.workspace_id}


async def test_backup_reads_everything_and_writes_nothing(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, beta = tenants
    async with scoped(migrated, "superuser") as db:
        await db.execute("SET LOCAL ROLE backup")  # backup has no password: peer auth in production
        count = await db.fetchval(
            "SELECT count(*) FROM core.projects WHERE workspace_id = ANY($1)",
            [alpha.workspace_id, beta.workspace_id],
        )
        assert count == 2
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await db.execute("UPDATE core.projects SET name = 'x'")


async def test_every_policy_says_exactly_what_was_reviewed(migrated: PostgresServer) -> None:
    """A widened policy cannot ship unnoticed: the visible and writable predicates are pinned."""
    async with connection(migrated) as db:
        rows = await db.fetch(
            "SELECT polrelid::regclass::text AS name, polcmd AS command, "
            "pg_get_expr(polqual, polrelid) AS visible, "
            "pg_get_expr(polwithcheck, polrelid) AS writable "
            "FROM pg_policy WHERE polname = 'tenant_isolation'"
        )
    found = {
        row["name"]: (row["command"], " ".join(row["visible"].split()), row["writable"])
        for row in rows
    }

    def owned(column: str) -> str:
        return f"({column} = auth.current_workspace_id())"

    expected = {
        table: (b"*", owned(column), owned(column)) for table, column in TENANT_TABLES.items()
    }
    expected["auth.memberships"] = (
        b"*",
        "((workspace_id = auth.current_workspace_id()) OR (user_id = auth.current_user_id()))",
        owned("workspace_id"),
    )
    expected["auth.workspaces"] = (
        b"*",
        "((id = auth.current_workspace_id()) OR (id IN ( SELECT m.workspace_id "
        "FROM auth.memberships m WHERE (m.user_id = auth.current_user_id()))))",
        owned("id"),
    )
    assert found == expected
