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
    return Tenant(workspace_id, owner_id, project_id, token_hash)
