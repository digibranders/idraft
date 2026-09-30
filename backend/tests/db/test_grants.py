"""What each runtime role may do to each table (docs/26-testing-quality.md: DB-GRANT-01)."""

import asyncpg
import pytest

from tests.conftest import PostgresServer
from tests.db.support import SCHEMAS, connection, scoped

READ = {"SELECT"}
CRUD = {"SELECT", "INSERT", "UPDATE", "DELETE"}

# table: (app_api, app_worker). Every table in the six schemas must appear here.
MATRIX: dict[str, tuple[set[str], set[str]]] = {
    "auth.users": (CRUD, READ),
    "auth.sessions": (CRUD, READ),
    "auth.verification_tokens": (CRUD, READ),
    "auth.totp_secrets": (CRUD, READ),
    "auth.workspaces": (CRUD, READ),
    "auth.memberships": (CRUD, READ),
    "auth.invitations": (CRUD, READ),
    "auth.api_keys": (CRUD, READ),
    "core.projects": (CRUD, {"SELECT", "UPDATE"}),
    "core.workspace_quotas": ({"SELECT", "INSERT", "UPDATE"}, READ),
    "ops.alembic_version": (READ, READ),
}


async def test_the_grant_matrix_is_exactly_what_the_catalog_holds(migrated: PostgresServer) -> None:
    async with connection(migrated) as db:
        tables = await db.fetch(
            "SELECT c.oid::regclass::text AS name FROM pg_class c "
            "JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = ANY($1) AND c.relkind IN ('r', 'p') AND NOT c.relispartition",
            SCHEMAS,
        )
        grants = await db.fetch(
            "SELECT table_schema || '.' || table_name AS name, grantee, privilege_type "
            "FROM information_schema.role_table_grants "
            "WHERE grantee IN ('app_api', 'app_worker') AND table_schema = ANY($1)",
            SCHEMAS,
        )

    found: dict[str, tuple[set[str], set[str]]] = {row["name"]: (set(), set()) for row in tables}
    for row in grants:
        if row["name"] in found:  # partitions inherit access through their parent
            found[row["name"]][row["grantee"] == "app_worker"].add(row["privilege_type"])
    assert found == MATRIX


@pytest.mark.parametrize("role", ["app_api", "app_worker"])
@pytest.mark.parametrize(
    "statement",
    [
        "CREATE TABLE core.intruder (id int)",
        "CREATE SCHEMA intruder",
        "ALTER TABLE core.projects ADD COLUMN intruder int",
        "DROP TABLE core.projects",
        "TRUNCATE core.projects",
        "ALTER TABLE core.projects DISABLE ROW LEVEL SECURITY",
        "DROP POLICY tenant_isolation ON core.projects",
        "CREATE EXTENSION hstore",
    ],
)
async def test_no_runtime_role_can_run_ddl(
    migrated: PostgresServer, role: str, statement: str
) -> None:
    async with scoped(migrated, role) as db:
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await db.execute(statement)


@pytest.mark.parametrize("role", ["app_api", "app_worker"])
async def test_runtime_roles_cannot_use_the_public_schema(
    migrated: PostgresServer, role: str
) -> None:
    async with scoped(migrated, role) as db:
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await db.execute("CREATE TABLE public.intruder (id int)")
