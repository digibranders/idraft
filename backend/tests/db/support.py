"""Helpers for tests that talk to PostgreSQL as a specific role."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

import asyncpg

from tests.conftest import PostgresServer

SCHEMAS = ["auth", "core", "seo", "ai", "fp", "ops"]

# table -> the column that names its workspace. Kept in step with the catalog by test_rls.py.
TENANT_TABLES: dict[str, str] = {
    "auth.workspaces": "id",
    "auth.memberships": "workspace_id",
    "auth.invitations": "workspace_id",
    "auth.api_keys": "workspace_id",
    "core.projects": "workspace_id",
    "core.workspace_quotas": "workspace_id",
    "core.entities": "workspace_id",
    "core.entity_aliases": "workspace_id",
    "core.entity_domains": "workspace_id",
    "core.project_entities": "workspace_id",
    "core.taxonomy_vocabularies": "workspace_id",
    "core.taxonomy_terms": "workspace_id",
    "ops.budgets": "workspace_id",
    "ops.schedules": "workspace_id",
    "ops.collection_runs": "workspace_id",
    "ops.collection_tasks": "workspace_id",
    "ops.provider_cost_events": "workspace_id",
    "ops.cost_daily": "workspace_id",
    "ops.audit_logs": "workspace_id",
}


@asynccontextmanager
async def connection(
    pg: PostgresServer, role: str = "superuser"
) -> AsyncIterator[asyncpg.Connection[asyncpg.Record]]:
    connected = await asyncpg.connect(pg.url(role))
    try:
        yield connected
    finally:
        await connected.close()


@asynccontextmanager
async def scoped(
    pg: PostgresServer,
    role: str,
    *,
    workspace_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
) -> AsyncIterator[asyncpg.Connection[asyncpg.Record]]:
    """A transaction as `role` with the tenant settings the API would set. Always rolled back."""
    async with connection(pg, role) as connected:
        transaction = connected.transaction()
        await transaction.start()
        try:
            if workspace_id is not None:
                await connected.execute(
                    "SELECT set_config('app.workspace_id', $1, true)", str(workspace_id)
                )
            if user_id is not None:
                await connected.execute("SELECT set_config('app.user_id', $1, true)", str(user_id))
            yield connected
        finally:
            await transaction.rollback()


@dataclass(frozen=True)
class Tenant:
    workspace_id: uuid.UUID
    owner_id: uuid.UUID
    project_id: uuid.UUID
    invitation_token_hash: bytes
    schedule_id: uuid.UUID
    run_id: uuid.UUID


async def create_user(connected: asyncpg.Connection[Any], label: str) -> uuid.UUID:
    user_id: uuid.UUID = await connected.fetchval(
        "INSERT INTO auth.users (email, name, password_hash) VALUES ($1, $2, 'argon2id$test') "
        "RETURNING id",
        f"{label}-{uuid.uuid4().hex[:8]}@example.com",
        label,
    )
    return user_id


async def add_member(
    connected: asyncpg.Connection[Any], workspace_id: uuid.UUID, user_id: uuid.UUID, role: str
) -> None:
    await connected.execute(
        "INSERT INTO auth.memberships (workspace_id, user_id, role) VALUES ($1, $2, $3)",
        workspace_id,
        user_id,
        role,
    )


async def seed_tenant(pg: PostgresServer, label: str) -> Tenant:
    """One workspace with one row in every tenant table, written by the superuser."""
    suffix = uuid.uuid4().hex[:8]
    token_hash = uuid.uuid4().bytes + uuid.uuid4().bytes
    async with connection(pg) as db:
        owner_id = await create_user(db, f"{label}-owner")
        workspace_id: uuid.UUID = await db.fetchval(
            "INSERT INTO auth.workspaces (name, slug) VALUES ($1, $2) RETURNING id",
            label,
            f"{label}-{suffix}",
        )
        await add_member(db, workspace_id, owner_id, "owner")
        await db.execute(
            "INSERT INTO auth.invitations (workspace_id, email, role, token_hash, invited_by, "
            "expires_at) VALUES ($1, $2, 'viewer', $3, $4, now() + interval '7 days')",
            workspace_id,
            f"invitee-{suffix}@example.com",
            token_hash,
            owner_id,
        )
        await db.execute(
            "INSERT INTO auth.api_keys (workspace_id, name, prefix, key_hash, scopes, created_by) "
            "VALUES ($1, 'ci', $2, $3, '{}', $4)",
            workspace_id,
            suffix,
            token_hash,
            owner_id,
        )
        project_id: uuid.UUID = await db.fetchval(
            "INSERT INTO core.projects (workspace_id, name, slug, created_by) "
            "VALUES ($1, $2, 'main', $3) RETURNING id",
            workspace_id,
            f"{label} project",
            owner_id,
        )
        await db.execute(
            "INSERT INTO core.workspace_quotas (workspace_id) VALUES ($1)", workspace_id
        )
        await seed_vocabulary(db, workspace_id, project_id, label)
        schedule_id, run_id = await seed_operations(db, workspace_id, project_id)
    return Tenant(workspace_id, owner_id, project_id, token_hash, schedule_id, run_id)


async def seed_vocabulary(
    db: asyncpg.Connection[Any], workspace_id: uuid.UUID, project_id: uuid.UUID, label: str
) -> None:
    """One row in every entity and taxonomy table: an own brand with an alias and a domain,
    and a topic with one term."""
    entity_id: uuid.UUID = await db.fetchval(
        "INSERT INTO core.entities (workspace_id, entity_type, canonical_name) "
        "VALUES ($1, 'brand', $2) RETURNING id",
        workspace_id,
        f"{label} brand",
    )
    await db.execute(
        "INSERT INTO core.entity_aliases (workspace_id, entity_id, alias) VALUES ($1, $2, $3)",
        workspace_id,
        entity_id,
        label,
    )
    domain_id: int = await db.fetchval(
        "INSERT INTO core.domains (host, registrable_domain, public_suffix) "
        "VALUES ($1, $1, 'com') ON CONFLICT (host) DO UPDATE SET host = excluded.host "
        "RETURNING id",
        f"{label}-{uuid.uuid4().hex[:8]}.com",
    )
    await db.execute(
        "INSERT INTO core.entity_domains (entity_id, workspace_id, domain_id) VALUES ($1, $2, $3)",
        entity_id,
        workspace_id,
        domain_id,
    )
    await db.execute(
        "INSERT INTO core.project_entities (project_id, entity_id, workspace_id, role, is_primary) "
        "VALUES ($1, $2, $3, 'own', true)",
        project_id,
        entity_id,
        workspace_id,
    )
    vocabulary_id: uuid.UUID = await db.fetchval(
        "INSERT INTO core.taxonomy_vocabularies (workspace_id, kind, name) "
        "VALUES ($1, 'topic', 'Topics') RETURNING id",
        workspace_id,
    )
    await db.execute(
        "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, name, slug, path) "
        "VALUES ($1, $2, 'CRM', 'crm', 'crm')",
        workspace_id,
        vocabulary_id,
    )


async def seed_operations(
    db: asyncpg.Connection[Any], workspace_id: uuid.UUID, project_id: uuid.UUID
) -> tuple[uuid.UUID, uuid.UUID]:
    """One row in every tenant table of the ops schema."""
    await db.execute(
        "INSERT INTO ops.budgets (workspace_id, workload, limit_usd) VALUES ($1, 'all', 100)",
        workspace_id,
    )
    schedule_id: uuid.UUID = await db.fetchval(
        "INSERT INTO ops.schedules (workspace_id, project_id, workload, name, cadence, timezone, "
        "next_run_at) VALUES ($1, $2, 'seo_rank', 'Daily ranks', 'daily', 'UTC', now()) "
        "RETURNING id",
        workspace_id,
        project_id,
    )
    run_id: uuid.UUID = await db.fetchval(
        "INSERT INTO ops.collection_runs (workspace_id, project_id, schedule_id, workload, "
        "window_start, window_end, trigger, status, config_snapshot) "
        "VALUES ($1, $2, $3, 'seo_rank', now(), now() + interval '6 hours', 'schedule', "
        "'planned', '{}') RETURNING id",
        workspace_id,
        project_id,
        schedule_id,
    )
    await db.execute(
        "INSERT INTO ops.collection_tasks (run_id, workspace_id, project_id, workload, "
        "subject_type, subject_id, idempotency_key, request_fingerprint, provider_code, "
        "provider_endpoint, scheduled_for, status) VALUES ($1, $2, $3, 'seo_rank', "
        "'tracked_keyword', '1', $4, $4, 'dataforseo', 'serp_google_organic', now(), 'pending')",
        run_id,
        workspace_id,
        project_id,
        uuid.uuid4().bytes,
    )
    await db.execute(
        "INSERT INTO ops.provider_cost_events (occurred_at, workspace_id, project_id, "
        "provider_code, endpoint, workload, channel, cost_usd, cost_source, billing_period) "
        "VALUES (now(), $1, $2, 'dataforseo', 'serp_google_organic', 'seo_rank', 'seo', 0.0006, "
        "'provider_reported', date_trunc('month', now())::date)",
        workspace_id,
        project_id,
    )
    await db.execute(
        "INSERT INTO ops.cost_daily (cost_date, workspace_id, project_id, provider_code, "
        "endpoint, workload, request_count, cost_usd, subjects) "
        "VALUES (current_date, $1, $2, 'dataforseo', 'serp_google_organic', 'seo_rank', 1, "
        "0.0006, 1)",
        workspace_id,
        project_id,
    )
    await db.execute(
        "INSERT INTO ops.audit_logs (workspace_id, actor_type, actor_id, action, target_type, "
        "target_id) VALUES ($1, 'system', 'seed', 'project.create', 'project', $2)",
        workspace_id,
        str(project_id),
    )
    return schedule_id, run_id
