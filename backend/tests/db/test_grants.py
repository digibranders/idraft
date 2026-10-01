"""What each runtime role may do to each table (docs/26-testing-quality.md: DB-GRANT-01).

Table, column, sequence, function and schema privileges are read back from the catalog, for our
roles and for PUBLIC, so a revision cannot widen a grant without this file changing with it.
"""

from dataclasses import dataclass, field

import asyncpg
import pytest

from tests.conftest import PostgresServer
from tests.db.support import SCHEMAS, connection, scoped


@dataclass(frozen=True)
class Access:
    """Table-wide privileges, and privileges granted on named columns only."""

    table: frozenset[str] = frozenset()
    columns: dict[str, frozenset[str]] = field(default_factory=dict)


def access(table: str = "", **columns: tuple[str, ...]) -> Access:
    return Access(
        frozenset(filter(None, table.split(", "))),
        {privilege: frozenset(names) for privilege, names in columns.items()},
    )


NONE = access()
READ = access("SELECT")
CRUD = access("SELECT, INSERT, UPDATE, DELETE")
AUDIT_COLUMNS = (
    "workspace_id",
    "actor_type",
    "actor_id",
    "action",
    "target_type",
    "target_id",
    "before",
    "after",
    "ip",
    "user_agent",
    "request_id",
)

# table or view: (app_api, app_worker). Every one in the six schemas must appear here.
MATRIX: dict[str, tuple[Access, Access]] = {
    "auth.users": (
        access(
            "SELECT",
            INSERT=("email", "name", "image", "password_hash"),
            UPDATE=("name", "image", "password_hash", "email_verified_at", "updated_at"),
        ),
        access(SELECT=("id", "email", "name", "disabled_at")),
    ),
    "auth.sessions": (
        access(
            "SELECT, INSERT",
            UPDATE=("state", "fresh_until", "idle_expires_at", "revoked_at", "last_seen_at"),
        ),
        NONE,
    ),
    "auth.verification_tokens": (access("SELECT, INSERT", UPDATE=("consumed_at",)), NONE),
    "auth.totp_secrets": (
        access(
            "SELECT, INSERT, DELETE",
            UPDATE=("secret_encrypted", "confirmed_at", "last_used_step", "recovery_code_hashes"),
        ),
        NONE,
    ),
    "auth.workspaces": (access("SELECT, INSERT, UPDATE"), READ),
    "auth.memberships": (access("SELECT, INSERT, DELETE", UPDATE=("role", "project_ids")), READ),
    "auth.invitations": (
        access("SELECT, INSERT", UPDATE=("status", "responded_at", "token_hash", "expires_at")),
        access(
            SELECT=(
                "id",
                "workspace_id",
                "email",
                "role",
                "project_ids",
                "status",
                "invited_by",
                "expires_at",
                "responded_at",
                "created_at",
            )
        ),
    ),
    "auth.api_keys": (READ, NONE),
    "core.projects": (access("SELECT, INSERT, UPDATE"), access("SELECT", UPDATE=("data_version",))),
    "core.workspace_quotas": (access("SELECT, INSERT, UPDATE"), READ),
    # Global dictionaries: the API adds a host's row when an entity or project names it, but
    # never its classification; the worker keeps the locations.
    "core.domain_categories": (READ, NONE),
    "core.domains": (
        access("SELECT", INSERT=("host", "registrable_domain", "public_suffix", "is_ip")),
        NONE,
    ),
    "core.locations": (READ, access("SELECT, INSERT, UPDATE")),
    "core.provider_location_map": (READ, access("SELECT, INSERT, UPDATE")),
    "core.entities": (CRUD, NONE),
    "core.entity_aliases": (CRUD, NONE),
    "core.entity_domains": (access("SELECT, INSERT, DELETE"), NONE),
    "core.project_entities": (access("SELECT, INSERT, UPDATE"), NONE),
    "core.taxonomy_vocabularies": (CRUD, NONE),
    "core.taxonomy_terms": (CRUD, NONE),
    # A view read with the reader's rights (see the view test below).
    "core.project_domain_roles": (READ, NONE),
    "ops.alembic_version": (READ, READ),
    "ops.budgets": (CRUD, READ),
    "ops.providers": (READ, READ),
    "ops.provider_price_book": (READ, access("SELECT, INSERT, UPDATE")),
    "ops.component_versions": (READ, READ),
    "ops.partitioned_tables": (NONE, NONE),
    "ops.schedules": (CRUD, access("SELECT", UPDATE=("next_run_at", "last_run_id"))),
    "ops.collection_runs": (
        access(
            "SELECT",
            INSERT=(
                "workspace_id",
                "project_id",
                "schedule_id",
                "workload",
                "window_start",
                "window_end",
                "trigger",
                "status",
                "created_by_type",
                "created_by_id",
                "origin_request_id",
                "estimated_cost_usd",
                "config_snapshot",
            ),
            UPDATE=("status", "status_reason", "completed_at"),
        ),
        access(
            "SELECT, INSERT",
            UPDATE=(
                "status",
                "status_reason",
                "blocked_by_budget_id",
                "tasks_total",
                "tasks_succeeded",
                "tasks_failed",
                "estimated_cost_usd",
                "actual_cost_usd",
                "completed_at",
            ),
        ),
    ),
    "ops.collection_tasks": (
        READ,
        access(
            "SELECT, INSERT",
            UPDATE=(
                "provider_task_id",
                "scheduled_for",
                "status",
                "dispatched_at",
                "attempts",
                "next_attempt_at",
                "submitted_at",
                "ready_at",
                "completed_at",
                "raw_payload_id",
                "ready_source",
                "result_meta",
                "cost_usd",
                "last_error_code",
                "last_error_message",
            ),
        ),
    ),
    "ops.raw_payloads": (NONE, access("SELECT, INSERT", UPDATE=("expires_at",))),
    "ops.provider_cost_events": (READ, access("SELECT, INSERT")),
    "ops.cost_daily": (
        READ,
        access("SELECT, INSERT", UPDATE=("request_count", "cost_usd", "subjects")),
    ),
    "ops.audit_logs": (
        access("SELECT", INSERT=AUDIT_COLUMNS),
        access("SELECT", INSERT=AUDIT_COLUMNS),
    ),
}

_TABLES = """
    SELECT c.oid::regclass::text AS name FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ANY($1) AND c.relkind IN ('r', 'p', 'v', 'm') AND NOT c.relispartition
"""
_TABLE_GRANTS = """
    SELECT c.oid::regclass::text AS name, pg_get_userbyid(acl.grantee) AS grantee,
           acl.privilege_type AS privilege
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace,
         LATERAL aclexplode(c.relacl) AS acl
    WHERE n.nspname = ANY($1) AND c.relkind IN ('r', 'p', 'v', 'm') AND NOT c.relispartition
"""
_COLUMN_GRANTS = """
    SELECT c.oid::regclass::text AS name, a.attname AS column_name,
           pg_get_userbyid(acl.grantee) AS grantee, acl.privilege_type AS privilege
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped,
         LATERAL aclexplode(a.attacl) AS acl
    WHERE n.nspname = ANY($1) AND c.relkind IN ('r', 'p', 'v', 'm') AND NOT c.relispartition
"""
ROLES = ("app_api", "app_worker")


async def test_the_grant_matrix_is_exactly_what_the_catalog_holds(migrated: PostgresServer) -> None:
    async with connection(migrated) as db:
        tables = [row["name"] for row in await db.fetch(_TABLES, SCHEMAS)]
        table_grants = await db.fetch(_TABLE_GRANTS, SCHEMAS)
        column_grants = await db.fetch(_COLUMN_GRANTS, SCHEMAS)

    table_level: dict[tuple[str, str], set[str]] = {}
    for row in table_grants:
        table_level.setdefault((row["name"], row["grantee"]), set()).add(row["privilege"])
    column_level: dict[tuple[str, str], dict[str, set[str]]] = {}
    for row in column_grants:
        by_privilege = column_level.setdefault((row["name"], row["grantee"]), {})
        by_privilege.setdefault(row["privilege"], set()).add(row["column_name"])

    def found(table: str, role: str) -> Access:
        return Access(
            frozenset(table_level.get((table, role), set())),
            {p: frozenset(c) for p, c in column_level.get((table, role), {}).items()},
        )

    assert {table: tuple(found(table, role) for role in ROLES) for table in tables} == MATRIX


async def test_no_table_or_column_is_granted_to_public_or_to_a_role_that_is_not_ours(
    migrated: PostgresServer,
) -> None:
    """PUBLIC shows up here as a grantee that is not one of the three names."""
    async with connection(migrated) as db:
        tables = await db.fetch(_TABLE_GRANTS, SCHEMAS)
        columns = await db.fetch(_COLUMN_GRANTS, SCHEMAS)
    assert {row["grantee"] for row in tables} <= {"migrator", "app_api", "app_worker"}
    assert {row["grantee"] for row in columns} <= {"app_api", "app_worker"}


async def test_views_a_runtime_role_reads_apply_the_readers_policies(
    migrated: PostgresServer,
) -> None:
    """A view runs with its owner's rights unless it says otherwise, and the owner is not
    subject to row-level security; a materialized view cannot have row-level security at all.
    Either, readable by a runtime role, would show it every workspace's rows."""
    async with connection(migrated) as db:
        rows = await db.fetch(
            "SELECT c.oid::regclass::text AS name, c.relkind AS kind, "
            "coalesce('security_invoker=true' = ANY(c.reloptions), false) AS invoker, "
            "has_table_privilege('app_api', c.oid, 'SELECT') AS api, "
            "has_table_privilege('app_worker', c.oid, 'SELECT') AS worker "
            "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = ANY($1) AND c.relkind IN ('v', 'm')",
            SCHEMAS,
        )
    readable = [row for row in rows if row["api"] or row["worker"]]
    assert [row["name"] for row in readable if row["kind"] == "m"] == []
    assert [row["name"] for row in readable if not row["invoker"]] == []
    assert "core.project_domain_roles" in {row["name"] for row in readable}


async def test_partitions_and_sequences_carry_no_grants(migrated: PostgresServer) -> None:
    """Rows are reached through the parent table; identity values come from the column default.

    A grant on a partition, table-wide or on a column, would be a way around the parent's policy:
    row-level security is not enabled on the partitions themselves.
    """
    async with connection(migrated) as db:
        granted = await db.fetch(
            "SELECT c.oid::regclass::text AS name FROM pg_class c "
            "JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = ANY($1) AND (c.relispartition OR c.relkind = 'S') "
            "AND (c.relacl IS NOT NULL OR EXISTS ("
            "SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attacl IS NOT NULL))",
            SCHEMAS,
        )
        sequences = await db.fetchval(
            "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = ANY($1) AND c.relkind = 'S'",
            SCHEMAS,
        )
    assert [row["name"] for row in granted] == []
    assert sequences > 0, "the check must have something to look at"


# function: the runtime roles that may call it, whether through their own grant or through PUBLIC.
FUNCTIONS: dict[str, frozenset[str]] = {
    "auth.current_workspace_id()": frozenset(ROLES),
    "auth.current_user_id()": frozenset(ROLES),
    "auth.invitation_by_token(bytea)": frozenset({"app_api"}),
    "ops.maintain_partitions()": frozenset({"app_worker"}),
    "ops.ensure_monthly_partitions(regclass,integer,integer,boolean)": frozenset(),
    "ops.record_auth_event(text,uuid,text,text,inet,text,text,jsonb)": frozenset({"app_api"}),
}
# Only the two functions that read a setting are open to everyone.
PUBLIC_FUNCTIONS = {"auth.current_workspace_id()", "auth.current_user_id()"}


async def test_each_function_can_be_called_by_exactly_the_roles_that_need_it(
    migrated: PostgresServer,
) -> None:
    async with connection(migrated) as db:
        rows = await db.fetch(
            "SELECT p.oid::regprocedure::text AS name, "
            "has_function_privilege('app_api', p.oid, 'EXECUTE') AS app_api, "
            "has_function_privilege('app_worker', p.oid, 'EXECUTE') AS app_worker, "
            "has_function_privilege('public', p.oid, 'EXECUTE') AS public "
            "FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
            "WHERE n.nspname = ANY($1)",
            SCHEMAS,
        )
    callers = {row["name"]: frozenset(role for role in ROLES if row[role]) for row in rows}
    assert callers == FUNCTIONS
    assert {row["name"] for row in rows if row["public"]} == PUBLIC_FUNCTIONS


async def test_runtime_roles_may_use_the_schemas_and_create_nothing_in_them(
    migrated: PostgresServer,
) -> None:
    async with connection(migrated) as db:
        rows = await db.fetch(
            "SELECT n.nspname AS schema, r.rolname AS role, "
            "has_schema_privilege(r.rolname, n.oid, 'USAGE') AS usage, "
            "has_schema_privilege(r.rolname, n.oid, 'CREATE') AS creates "
            "FROM pg_namespace n CROSS JOIN pg_roles r "
            "WHERE n.nspname = ANY($1 || ARRAY['public']) AND r.rolname = ANY($2)",
            SCHEMAS,
            list(ROLES),
        )
    assert len(rows) == (len(SCHEMAS) + 1) * len(ROLES)
    assert {(row["schema"], row["role"]) for row in rows if row["creates"]} == set()
    assert {row["schema"] for row in rows if row["usage"]} >= set(SCHEMAS)


async def test_no_runtime_role_holds_truncate_references_or_trigger(
    migrated: PostgresServer,
) -> None:
    async with connection(migrated) as db:
        rows = await db.fetch(_TABLE_GRANTS, SCHEMAS)
    dangerous = {
        (row["name"], row["grantee"], row["privilege"])
        for row in rows
        if row["grantee"] in ROLES and row["privilege"] in ("TRUNCATE", "REFERENCES", "TRIGGER")
    }
    assert dangerous == set()


@pytest.mark.parametrize("role", ROLES)
@pytest.mark.parametrize(
    "statement",
    [
        "CREATE TABLE core.intruder (id int)",
        "CREATE SCHEMA intruder",
        "CREATE TEMP TABLE intruder (id int)",
        "ALTER TABLE core.projects ADD COLUMN intruder int",
        "DROP TABLE core.projects",
        "TRUNCATE core.projects",
        "ALTER TABLE core.projects DISABLE ROW LEVEL SECURITY",
        "DROP POLICY tenant_isolation ON core.projects",
        "CREATE EXTENSION hstore",
        "CREATE FUNCTION core.intruder() RETURNS int LANGUAGE sql RETURN 1",
        "CREATE TABLE public.intruder (id int)",
        "SET ROLE migrator",
        "SET SESSION AUTHORIZATION migrator",
    ],
)
async def test_no_runtime_role_can_change_the_schema_or_become_another_role(
    migrated: PostgresServer, role: str, statement: str
) -> None:
    """DB-GRANT-01."""
    async with scoped(migrated, role) as db:
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await db.execute(statement)
