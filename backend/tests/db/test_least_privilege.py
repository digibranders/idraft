"""Each attack an independent review ran against the role model, kept as a test.

The threat: arbitrary SQL as a runtime role (an injection bug in the API, a compromised worker).
Row-level security scopes the API to the workspace the application chose; these grants bound what
is still reachable when the attacker chooses the SQL.
"""

import uuid

import asyncpg
import pytest

from tests.conftest import PostgresServer
from tests.db.support import Tenant, connection, create_user, scoped, seed_tenant


@pytest.fixture
async def tenants(migrated: PostgresServer) -> tuple[Tenant, Tenant]:
    return await seed_tenant(migrated, "alpha"), await seed_tenant(migrated, "beta")


async def _session(migrated: PostgresServer, user_id: uuid.UUID) -> uuid.UUID:
    async with connection(migrated) as db:
        session_id: uuid.UUID = await db.fetchval(
            "INSERT INTO auth.sessions (token_hash, user_id, idle_expires_at, absolute_expires_at) "
            "VALUES ($1, $2, now() + interval '1 day', now() + interval '30 days') RETURNING id",
            uuid.uuid4().bytes,
            user_id,
        )
    return session_id


# ---------------------------------------------------------------------------------------------
# The API role


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE auth.users SET is_platform_operator = true",
        "INSERT INTO auth.users (email, name, password_hash, is_platform_operator) "
        "VALUES ('op@example.com', 'op', 'h', true)",
        "UPDATE auth.users SET email = 'taken@example.com'",
        "UPDATE auth.users SET disabled_at = now()",
        "DELETE FROM auth.users",
        "UPDATE auth.sessions SET user_id = gen_random_uuid()",
        "UPDATE auth.sessions SET token_hash = '\\x00'",
        "UPDATE auth.sessions SET absolute_expires_at = now() + interval '10 years'",
        "DELETE FROM auth.sessions",
        "UPDATE auth.verification_tokens SET token_hash = '\\x00'",
        "UPDATE auth.verification_tokens SET user_id = gen_random_uuid()",
        "DELETE FROM auth.verification_tokens",
        "UPDATE auth.totp_secrets SET user_id = gen_random_uuid()",
        "UPDATE auth.memberships SET user_id = gen_random_uuid()",
        "UPDATE auth.memberships SET workspace_id = gen_random_uuid()",
        "DELETE FROM auth.workspaces",
        "DELETE FROM core.projects",
        "SELECT object_key FROM ops.raw_payloads",
        "SELECT * FROM ops.partitioned_tables",
        "INSERT INTO ops.audit_logs (id, actor_type, actor_id, action, target_type, target_id) "
        "OVERRIDING SYSTEM VALUE VALUES (1, 'user', 'u', 'a', 't', 'i')",
        "INSERT INTO ops.audit_logs (occurred_at, actor_type, actor_id, action, target_type, "
        "target_id) VALUES ('2020-01-01', 'user', 'u', 'a', 't', 'i')",
        "UPDATE ops.collection_runs SET workspace_id = gen_random_uuid()",
        "UPDATE ops.collection_runs SET actual_cost_usd = 0",
    ],
)
async def test_the_api_role_cannot(migrated: PostgresServer, statement: str) -> None:
    async with scoped(migrated, "app_api") as db:
        with pytest.raises(asyncpg.InsufficientPrivilegeError, match="permission denied"):
            await db.execute(statement)


async def test_the_api_role_can_do_what_the_auth_routes_need(migrated: PostgresServer) -> None:
    address = f"new-{uuid.uuid4().hex[:8]}@example.com"
    async with scoped(migrated, "app_api") as db:
        user_id = await db.fetchval(
            "INSERT INTO auth.users (email, name, password_hash) VALUES ($1, 'New', 'h1') "
            "RETURNING id",
            address,
        )
        session_id = await db.fetchval(
            "INSERT INTO auth.sessions (token_hash, user_id, idle_expires_at, absolute_expires_at) "
            "VALUES ($1, $2, now(), now()) RETURNING id",
            uuid.uuid4().bytes,
            user_id,
        )
        token_id = await db.fetchval(
            "INSERT INTO auth.verification_tokens (user_id, purpose, token_hash, expires_at) "
            "VALUES ($1, 'email_verification', $2, now()) RETURNING id",
            user_id,
            uuid.uuid4().bytes,
        )
        await db.execute(
            "INSERT INTO auth.totp_secrets (user_id, secret_encrypted) VALUES ($1, '\\x01')",
            user_id,
        )
        results = [
            await db.execute(
                "UPDATE auth.users SET email_verified_at = now(), password_hash = 'h2', "
                "name = 'Renamed', updated_at = now() WHERE id = $1",
                user_id,
            ),
            await db.execute(
                "UPDATE auth.verification_tokens SET consumed_at = now() WHERE id = $1", token_id
            ),
            await db.execute(
                "UPDATE auth.sessions SET revoked_at = now(), last_seen_at = now() WHERE id = $1",
                session_id,
            ),
            await db.execute(
                "UPDATE auth.totp_secrets SET confirmed_at = now(), last_used_step = 1 "
                "WHERE user_id = $1",
                user_id,
            ),
            await db.execute("DELETE FROM auth.totp_secrets WHERE user_id = $1", user_id),
        ]
    assert results == ["UPDATE 1", "UPDATE 1", "UPDATE 1", "UPDATE 1", "DELETE 1"]


async def test_the_api_cannot_reach_a_partition_directly(migrated: PostgresServer) -> None:
    async with connection(migrated) as db:
        child = await db.fetchval(
            "SELECT inhrelid::regclass::text FROM pg_inherits "
            "WHERE inhparent = 'ops.collection_tasks'::regclass LIMIT 1"
        )
    for role in ("app_api", "app_worker"):
        async with scoped(migrated, role) as db:
            with pytest.raises(asyncpg.InsufficientPrivilegeError, match="permission denied"):
                await db.fetchval(f"SELECT count(*) FROM {child}")


async def test_rows_without_a_workspace_are_invisible_and_cannot_be_written_by_the_api(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, beta = tenants
    insert = (
        "INSERT INTO ops.audit_logs (workspace_id, actor_type, actor_id, action, target_type, "
        "target_id) VALUES ($1, 'user', 'u', 'forged', 't', 'i')"
    )
    async with connection(migrated) as db:
        await db.execute(insert.replace("'forged'", "'platform.note'"), None)

    async with scoped(migrated, "app_api", workspace_id=alpha.workspace_id) as db:
        assert (
            await db.fetchval("SELECT count(*) FROM ops.audit_logs WHERE workspace_id IS NULL") == 0
        )
        assert await db.execute(insert, alpha.workspace_id) == "INSERT 0 1"
    for forged in (None, beta.workspace_id):
        async with scoped(migrated, "app_api", workspace_id=alpha.workspace_id) as db:
            with pytest.raises(asyncpg.InsufficientPrivilegeError, match="row-level security"):
                await db.execute(insert, forged)


async def test_an_audit_entry_is_timed_and_numbered_by_the_database(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with scoped(migrated, "app_api", workspace_id=alpha.workspace_id) as db:
        row = await db.fetchrow(
            "INSERT INTO ops.audit_logs (workspace_id, actor_type, actor_id, action, target_type, "
            "target_id) VALUES ($1, 'user', 'u1', 'project.update', 'project', 'p1') "
            "RETURNING id, occurred_at = transaction_timestamp() AS timed_now",
            alpha.workspace_id,
        )
    assert row is not None
    assert isinstance(row["id"], int)
    assert row["timed_now"] is True


async def test_an_invitation_lookup_returns_the_row_whatever_its_status(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    """The contract the API relies on to answer "expired" instead of "unknown"."""
    alpha, _ = tenants
    async with connection(migrated) as db:
        await db.execute(
            "UPDATE auth.invitations SET status = 'cancelled', "
            "expires_at = now() - interval '1 day' WHERE token_hash = $1",
            alpha.invitation_token_hash,
        )
    async with scoped(migrated, "app_api") as db:
        rows = await db.fetch(
            "SELECT status, expires_at < now() AS expired FROM auth.invitation_by_token($1)",
            alpha.invitation_token_hash,
        )
    assert [(row["status"], row["expired"]) for row in rows] == [("cancelled", True)]


# ---------------------------------------------------------------------------------------------
# The worker role bypasses row-level security, so its grants are the boundary.


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE core.projects SET workspace_id = gen_random_uuid()",
        "UPDATE core.projects SET name = 'taken'",
        "UPDATE ops.schedules SET workspace_id = gen_random_uuid()",
        "UPDATE ops.schedules SET project_id = gen_random_uuid()",
        "UPDATE ops.collection_runs SET workspace_id = gen_random_uuid()",
        "UPDATE ops.collection_tasks SET workspace_id = gen_random_uuid()",
        "UPDATE ops.collection_tasks SET idempotency_key = '\\x00'",
        "UPDATE ops.raw_payloads SET object_key = 'raw/v1/elsewhere'",
        "UPDATE ops.raw_payloads SET inline_body = '\\x00'",
        "UPDATE ops.cost_daily SET workspace_id = gen_random_uuid()",
        "DELETE FROM ops.collection_tasks",
        "DELETE FROM ops.provider_cost_events",
        "UPDATE ops.provider_cost_events SET cost_usd = 0",
        "INSERT INTO ops.budgets (workspace_id, limit_usd) VALUES (gen_random_uuid(), 1)",
        "SELECT password_hash FROM auth.users",
        "SELECT is_platform_operator FROM auth.users",
        "SELECT * FROM auth.users",
        "SELECT token_hash FROM auth.sessions",
        "SELECT secret_encrypted FROM auth.totp_secrets",
        "SELECT token_hash FROM auth.verification_tokens",
        "SELECT key_hash FROM auth.api_keys",
        "UPDATE auth.memberships SET role = 'owner'",
        "DELETE FROM auth.users",
    ],
)
async def test_the_worker_role_cannot(migrated: PostgresServer, statement: str) -> None:
    async with scoped(migrated, "app_worker") as db:
        with pytest.raises(asyncpg.InsufficientPrivilegeError, match="permission denied"):
            await db.execute(statement)


async def test_the_worker_role_can_do_what_collection_needs(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with scoped(migrated, "app_worker") as db:
        results = [
            await db.execute(
                "UPDATE ops.schedules SET next_run_at = now() + interval '1 day', last_run_id = $2 "
                "WHERE id = $1",
                alpha.schedule_id,
                alpha.run_id,
            ),
            await db.execute(
                "UPDATE ops.collection_runs SET status = 'running', tasks_total = 1 WHERE id = $1",
                alpha.run_id,
            ),
            await db.execute(
                "UPDATE ops.collection_tasks SET status = 'submitted', provider_task_id = 'abc', "
                "attempts = attempts + 1, submitted_at = now() WHERE run_id = $1",
                alpha.run_id,
            ),
            await db.execute(
                "UPDATE core.projects SET data_version = data_version + 1 WHERE id = $1",
                alpha.project_id,
            ),
            await db.execute(
                "INSERT INTO ops.cost_daily AS d (cost_date, workspace_id, project_id, "
                "provider_code, endpoint, workload, request_count, cost_usd, subjects) "
                "VALUES (current_date, $1, $2, 'dataforseo', 'serp_google_organic', 'seo_rank', "
                "1, 0.0006, 1) ON CONFLICT (cost_date, workspace_id, project_id, provider_code, "
                "endpoint, workload, engine_code) DO UPDATE SET "
                "request_count = d.request_count + 1, cost_usd = d.cost_usd + 0.0006",
                alpha.workspace_id,
                alpha.project_id,
            ),
            await db.execute(
                "INSERT INTO ops.audit_logs (actor_type, actor_id, action, target_type, target_id) "
                "VALUES ('system', 'planner', 'run.plan', 'run', $1)",
                str(alpha.run_id),
            ),
        ]
        recipient = await db.fetchrow(
            "SELECT email, name FROM auth.users WHERE id = $1", alpha.owner_id
        )
    assert results == ["UPDATE 1", "UPDATE 1", "UPDATE 1", "UPDATE 1", "INSERT 0 1", "INSERT 0 1"]
    assert recipient is not None


async def test_a_new_user_is_never_a_platform_operator(migrated: PostgresServer) -> None:
    async with scoped(migrated, "superuser") as db:
        user_id = await create_user(db, "plain")
        assert (
            await db.fetchval("SELECT is_platform_operator FROM auth.users WHERE id = $1", user_id)
            is False
        )


async def test_a_session_cannot_be_moved_to_another_user(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, beta = tenants
    session_id = await _session(migrated, alpha.owner_id)
    async with scoped(migrated, "app_api") as db:
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await db.execute(
                "UPDATE auth.sessions SET user_id = $1 WHERE id = $2", beta.owner_id, session_id
            )
