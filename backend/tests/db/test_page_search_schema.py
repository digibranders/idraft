"""Migration 0042: position per page and day, address forms, page fetches, breakdowns and tracked
pages (page search detail and Monitoring, plan 01 task 2)."""

from __future__ import annotations

import uuid

import asyncpg
import pytest

from tests.conftest import PostgresServer
from tests.db.support import connection, scoped, seed_tenant


async def _integration(pg: PostgresServer, workspace_id: uuid.UUID) -> uuid.UUID:
    async with connection(pg) as db:
        found: uuid.UUID = await db.fetchval(
            "SELECT id FROM fp.integrations WHERE workspace_id = $1", workspace_id
        )
    return found


async def test_a_page_total_stored_before_the_revision_has_no_position(
    migrated: PostgresServer,
) -> None:
    tenant = await seed_tenant(migrated, "position")
    async with connection(migrated) as db:
        position = await db.fetchval(
            "SELECT position_sum FROM fp.gsc_page_daily WHERE workspace_id = $1",
            tenant.workspace_id,
        )
    assert position is None


@pytest.mark.parametrize(
    ("table", "column", "value"),
    [
        ("fp.gsc_page_fetches", "kind", "country_group"),
        ("fp.gsc_page_breakdown", "dimension", "page"),
    ],
)
async def test_a_marker_or_breakdown_kind_outside_the_list_is_refused(
    migrated: PostgresServer, table: str, column: str, value: str
) -> None:
    tenant = await seed_tenant(migrated, "kind")
    async with connection(migrated) as db:
        with pytest.raises(asyncpg.CheckViolationError):
            await db.execute(
                f"UPDATE {table} SET {column} = $1 WHERE workspace_id = $2",
                value,
                tenant.workspace_id,
            )


@pytest.mark.parametrize(
    "statement",
    [
        "DELETE FROM core.tracked_pages",
        "UPDATE fp.gsc_page_fetches SET row_count = 0",
        "DELETE FROM fp.gsc_page_forms",
    ],
)
async def test_the_worker_may_not_change_tracked_pages_markers_or_forms_beyond_its_grants(
    migrated: PostgresServer, statement: str
) -> None:
    tenant = await seed_tenant(migrated, "grants")
    async with scoped(migrated, "app_worker", workspace_id=tenant.workspace_id) as db:
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await db.execute(statement)


async def test_the_worker_prunes_a_breakdown(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "prune")
    integration = await _integration(migrated, tenant.workspace_id)
    async with scoped(migrated, "app_worker", workspace_id=tenant.workspace_id) as db:
        pruned = await db.execute(
            "DELETE FROM fp.gsc_page_breakdown WHERE integration_id = $1", integration
        )
    assert pruned == "DELETE 1"


async def test_deleting_a_project_removes_its_tracked_pages(migrated: PostgresServer) -> None:
    async with connection(migrated) as db:
        rules = await db.fetch(
            "SELECT confdeltype FROM pg_constraint "
            "WHERE conrelid = 'core.tracked_pages'::regclass "
            "AND contype = 'f' AND confrelid = 'core.projects'::regclass"
        )
    assert [rule["confdeltype"] for rule in rules] == [b"c"]
