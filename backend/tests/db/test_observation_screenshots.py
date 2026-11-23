"""The table of stored screenshots: one per AI observation, private to its workspace (0033)."""

from __future__ import annotations

import asyncpg
import pytest

from tests.conftest import PostgresServer
from tests.db.support import connection, scoped, seed_tenant

_INSERT = (
    "INSERT INTO ai.observation_screenshots (observation_id, observed_at, workspace_id, "
    "project_id, storage_key, width, height, byte_size, truncated, cost_usd, provider_task_id) "
    "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, 0.004, 'task')"
)


async def test_the_table_exists_with_its_columns(migrated: PostgresServer) -> None:
    async with connection(migrated) as db:
        rows = await db.fetch(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = 'ai' AND table_name = 'observation_screenshots'"
        )
    assert {
        "observation_id",
        "observed_at",
        "workspace_id",
        "project_id",
        "storage_key",
        "width",
        "height",
        "byte_size",
        "truncated",
        "cost_usd",
        "captured_at",
        "captured_by",
        "provider_task_id",
    } == {row["column_name"] for row in rows}


async def test_an_observation_has_one_screenshot_and_a_size_of_zero_is_refused(
    migrated: PostgresServer,
) -> None:
    tenant = await seed_tenant(migrated, "shot-checks")
    async with connection(migrated) as db:
        observation = await db.fetchrow(
            "SELECT id, observed_at FROM ai.observations WHERE workspace_id = $1",
            tenant.workspace_id,
        )
        assert observation is not None
        args = (observation["id"], observation["observed_at"], tenant.workspace_id)
        with pytest.raises(asyncpg.CheckViolationError):
            await db.execute(_INSERT, *args, tenant.project_id, "k", 0, 0, 0)
        # The seeded tenant already holds one screenshot for this observation.
        with pytest.raises(asyncpg.UniqueViolationError):
            await db.execute(_INSERT, *args, tenant.project_id, "k2", 1920, 4700, 100)


async def test_the_api_reads_and_adds_screenshots_of_its_own_workspace_only(
    migrated: PostgresServer,
) -> None:
    tenant = await seed_tenant(migrated, "shot-own")
    other = await seed_tenant(migrated, "shot-other")
    async with scoped(migrated, "app_api", workspace_id=other.workspace_id) as db:
        rows = await db.fetch("SELECT workspace_id FROM ai.observation_screenshots")
        assert {row["workspace_id"] for row in rows} == {other.workspace_id}
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await db.execute("DELETE FROM ai.observation_screenshots")
    async with scoped(migrated, "app_api", workspace_id=tenant.workspace_id) as db:
        observation = await db.fetchrow("SELECT id, observed_at FROM ai.observations")
        assert observation is not None
        with pytest.raises(asyncpg.InsufficientPrivilegeError, match="row-level security"):
            await db.execute(
                _INSERT,
                observation["id"],
                observation["observed_at"],
                other.workspace_id,
                other.project_id,
                "k",
                1,
                1,
                1,
            )
