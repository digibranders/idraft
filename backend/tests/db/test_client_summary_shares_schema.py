"""Migration 0029: shareable client summary links (plan 06 Task 3)."""

from __future__ import annotations

import hashlib
from datetime import timedelta

import asyncpg
import pytest

from tests.conftest import PostgresServer
from tests.db.support import connection, scoped, seed_tenant

_INSERT = (
    "INSERT INTO core.client_summary_shares (workspace_id, project_id, token_hash, created_by, "
    "expires_at) VALUES ($1, $2, $3, $4, now() + $5)"
)


def _hash(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


async def test_a_token_hash_is_32_bytes_unique_and_the_expiry_is_after_the_creation(
    migrated: PostgresServer,
) -> None:
    tenant = await seed_tenant(migrated, "share-checks")
    args = (tenant.workspace_id, tenant.project_id)
    async with connection(migrated) as db:
        with pytest.raises(asyncpg.CheckViolationError):
            await db.execute(_INSERT, *args, b"short", tenant.owner_id, timedelta(days=30))
        with pytest.raises(asyncpg.CheckViolationError):
            await db.execute(_INSERT, *args, _hash("a"), tenant.owner_id, timedelta(days=-1))
        await db.execute(_INSERT, *args, _hash("a"), tenant.owner_id, timedelta(days=30))
        with pytest.raises(asyncpg.UniqueViolationError):
            await db.execute(_INSERT, *args, _hash("a"), tenant.owner_id, timedelta(days=7))


async def test_a_share_is_found_by_its_token_hash_with_no_workspace_known(
    migrated: PostgresServer,
) -> None:
    tenant = await seed_tenant(migrated, "share-lookup")
    other = await seed_tenant(migrated, "share-other")
    async with connection(migrated) as db:
        await db.execute(
            _INSERT,
            tenant.workspace_id,
            tenant.project_id,
            _hash("t"),
            tenant.owner_id,
            timedelta(days=7),
        )
    async with scoped(migrated, "app_api") as db:
        hidden = await db.fetchval("SELECT count(*) FROM core.client_summary_shares")
        found = await db.fetch(
            "SELECT workspace_id, project_id FROM core.client_summary_share_by_token($1)",
            _hash("t"),
        )
        missing = await db.fetch(
            "SELECT 1 FROM core.client_summary_share_by_token($1)", _hash("nope")
        )
    assert hidden == 0  # no workspace chosen: the table shows nothing
    assert [(row["workspace_id"], row["project_id"]) for row in found] == [
        (tenant.workspace_id, tenant.project_id)
    ]
    assert missing == []
    # Another workspace's session sees no row of it in the table either.
    async with scoped(migrated, "app_api", workspace_id=other.workspace_id) as db:
        rows = await db.fetch("SELECT workspace_id FROM core.client_summary_shares")
    assert {row["workspace_id"] for row in rows} == {other.workspace_id}


async def test_the_api_may_revoke_but_not_change_the_token_or_the_expiry(
    migrated: PostgresServer,
) -> None:
    tenant = await seed_tenant(migrated, "share-revoke")
    async with connection(migrated) as db:
        await db.execute(
            _INSERT,
            tenant.workspace_id,
            tenant.project_id,
            _hash("r"),
            tenant.owner_id,
            timedelta(days=7),
        )
    async with scoped(migrated, "app_api", workspace_id=tenant.workspace_id) as db:
        await db.execute(
            "UPDATE core.client_summary_shares SET revoked_at = now(), revoked_by = $1",
            tenant.owner_id,
        )
    for statement, args in (
        ("UPDATE core.client_summary_shares SET token_hash = $1", (_hash("x"),)),
        ("UPDATE core.client_summary_shares SET expires_at = now() + interval '1 year'", ()),
    ):
        async with scoped(migrated, "app_api", workspace_id=tenant.workspace_id) as db:
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await db.execute(statement, *args)
