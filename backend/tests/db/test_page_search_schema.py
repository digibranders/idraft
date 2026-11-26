"""Migration 0042: position per page and day, address forms, page fetches, breakdowns and tracked
pages (page search detail and Monitoring, plan 01 task 2)."""

from __future__ import annotations

import uuid

import asyncpg
import pytest
from alembic import command

from idraft.db.migrate import alembic_config, upgrade_to_head
from tests.conftest import PostgresServer
from tests.db.support import connection, scoped, seed_tenant
from tests.db.test_migrations import _fresh_database, _query

ALL_PRIVILEGES = {"SELECT", "INSERT", "UPDATE", "DELETE"}


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
        "UPDATE core.tracked_pages SET added_by = NULL",
        "DELETE FROM fp.gsc_page_forms",
    ],
)
async def test_the_worker_may_not_change_tracked_pages_or_forms_beyond_its_grants(
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


async def _marker(
    pg: PostgresServer, label: str, kind: str, query_count: int | None, *, capped: str = "DEFAULT"
) -> None:
    """Insert one `fp.gsc_page_fetches` row as the migration owner, so a constraint answers."""
    tenant = await seed_tenant(pg, label)
    integration = await _integration(pg, tenant.workspace_id)
    async with connection(pg) as db:
        await db.execute(
            "INSERT INTO fp.gsc_page_fetches (integration_id, url_id, kind, date_from, date_to, "
            "workspace_id, project_id, row_count, query_count, query_count_capped) "
            f"VALUES ($1, 1, $2, date '2020-01-01', date '2020-01-28', $3, $4, 0, $5, {capped})",
            integration,
            kind,
            tenant.workspace_id,
            tenant.project_id,
            query_count,
        )


@pytest.mark.parametrize(("kind", "query_count"), [("query", None), ("country", 5), ("device", 0)])
async def test_a_marker_whose_count_does_not_fit_its_kind_is_refused(
    migrated: PostgresServer, kind: str, query_count: int | None
) -> None:
    with pytest.raises(asyncpg.CheckViolationError):
        await _marker(migrated, "countkind", kind, query_count)


@pytest.mark.parametrize(
    ("kind", "query_count"), [("query", 0), ("history", None), ("device", None)]
)
async def test_a_marker_whose_count_fits_its_kind_is_accepted(
    migrated: PostgresServer, kind: str, query_count: int | None
) -> None:
    await _marker(migrated, "countok", kind, query_count)


async def test_a_negative_query_count_is_refused(migrated: PostgresServer) -> None:
    with pytest.raises(asyncpg.CheckViolationError):
        await _marker(migrated, "negcount", "query", -1)


async def test_the_capped_flag_defaults_to_false_and_is_never_null(
    migrated: PostgresServer,
) -> None:
    await _marker(migrated, "capdefault", "query", 3)
    async with connection(migrated) as db:
        capped = await db.fetchval(
            "SELECT query_count_capped FROM fp.gsc_page_fetches "
            "WHERE query_count = 3 AND date_from = date '2020-01-01' "
            "AND workspace_id IN (SELECT id FROM auth.workspaces WHERE slug LIKE 'capdefault-%')"
        )
    assert capped is False
    with pytest.raises(asyncpg.NotNullViolationError):
        await _marker(migrated, "capnull", "query", 3, capped="NULL")


@pytest.mark.parametrize(
    "assignment",
    [
        "fp.gsc_page_fetches SET row_count = -1",
        "fp.gsc_page_fetches SET date_from = date_to + 1",
        "fp.gsc_page_breakdown SET clicks = -1",
        "fp.gsc_page_breakdown SET impressions = -1",
        "fp.gsc_page_breakdown SET date_from = date_to + 1",
    ],
)
async def test_a_count_below_zero_or_a_period_ending_before_it_starts_is_refused(
    migrated: PostgresServer, assignment: str
) -> None:
    tenant = await seed_tenant(migrated, "checks")
    table = assignment.split(" SET ")[0]
    async with connection(migrated) as db:
        with pytest.raises(asyncpg.CheckViolationError):
            await db.execute(f"UPDATE {assignment} WHERE workspace_id = $1", tenant.workspace_id)
        accepted = await db.execute(
            f"UPDATE {table} SET date_from = date_to WHERE workspace_id = $1", tenant.workspace_id
        )
    assert accepted == "UPDATE 1"


async def test_zero_counts_are_accepted(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "zeros")
    async with connection(migrated) as db:
        marker = await db.execute(
            "UPDATE fp.gsc_page_fetches SET row_count = 0 WHERE workspace_id = $1",
            tenant.workspace_id,
        )
        breakdown = await db.execute(
            "UPDATE fp.gsc_page_breakdown SET clicks = 0, impressions = 0 WHERE workspace_id = $1",
            tenant.workspace_id,
        )
    assert (marker, breakdown) == ("UPDATE 1", "UPDATE 1")


def _privileges(url: str, role: str, table: str) -> set[str]:
    held = _query(
        url,
        "SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS p "
        f"WHERE has_table_privilege('{role}', '{table}', p)",
    )
    return set(held)


def test_walking_down_to_0041_removes_the_tables_and_the_grants_and_walking_up_restores_them(
    pg: PostgresServer,
) -> None:
    url = _fresh_database(pg, "page_search_walk")
    upgrade_to_head(url)

    command.downgrade(alembic_config(url), "0041")
    assert (
        _query(
            url,
            "SELECT schemaname || '.' || tablename FROM pg_tables WHERE tablename IN "
            "('gsc_page_forms', 'gsc_page_fetches', 'gsc_page_breakdown', 'tracked_pages')",
        )
        == []
    )
    assert (
        _query(
            url,
            "SELECT column_name FROM information_schema.columns WHERE table_schema = 'fp' "
            "AND table_name = 'gsc_page_daily' AND column_name = 'position_sum'",
        )
        == []
    )
    assert _privileges(url, "app_api", "fp.gsc_page_daily") == {"SELECT"}
    assert _privileges(url, "app_worker", "fp.gsc_page_daily") == {"SELECT", "INSERT", "DELETE"}

    upgrade_to_head(url)
    assert _privileges(url, "app_api", "fp.gsc_page_daily") == {"SELECT", "INSERT", "UPDATE"}
    assert _privileges(url, "app_worker", "fp.gsc_page_daily") == ALL_PRIVILEGES
    for table in ("fp.gsc_page_fetches", "fp.gsc_page_breakdown"):
        assert _privileges(url, "app_api", table) == ALL_PRIVILEGES
        assert _privileges(url, "app_worker", table) == ALL_PRIVILEGES
    assert _query(
        url,
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'fp' "
        "AND table_name = 'gsc_page_daily' AND column_name = 'position_sum'",
    ) == ["position_sum"]
