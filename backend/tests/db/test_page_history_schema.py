"""Migration 0042: page history tables (docs/superpowers/specs/2026-11-27-page-history-design.md,
sections 3 and 6)."""

from __future__ import annotations

import uuid
from typing import Any

import asyncpg
import pytest

from tests.conftest import PostgresServer
from tests.db.support import Tenant, connection, scoped, seed_tenant

COLUMNS = {
    "seo.page_checks": {
        "run_id",
        "url_id",
        "workspace_id",
        "project_id",
        "main_hash",
        "full_hash",
        "declared_at",
        "declared_source",
        "snapshot_id",
    },
    "seo.page_snapshots": {
        "id",
        "workspace_id",
        "project_id",
        "url_id",
        "run_id",
        "taken_at",
        "title",
        "description",
        "headings",
        "words",
        "links_all",
        "links_editorial",
        "canonical",
        "main_hash",
        "full_hash",
    },
    "seo.page_history_runs": {
        "run_id",
        "workspace_id",
        "pages_checked",
        "pages_main_changed",
        "pages_site_wide",
        "site_wide",
        "declared_unreliable",
    },
    "seo.page_google_crawl": {
        "project_id",
        "url_id",
        "workspace_id",
        "last_crawl_time",
        "coverage_state",
        "inspected_at",
    },
}
HASH = b"\x01" * 16


async def _columns(pg: PostgresServer, table: str) -> set[str]:
    schema, name = table.split(".")
    async with connection(pg) as db:
        rows = await db.fetch(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = $1 AND table_name = $2",
            schema,
            name,
        )
    return {row["column_name"] for row in rows}


async def _page(db: asyncpg.Connection[Any], tenant: Tenant) -> tuple[uuid.UUID, int]:
    """The seeded crawl run of the tenant and its page."""
    row = await db.fetchrow(
        "SELECT run_id, url_id FROM seo.page_checks WHERE workspace_id = $1", tenant.workspace_id
    )
    assert row is not None
    return row["run_id"], row["url_id"]


async def _snapshot(
    db: asyncpg.Connection[Any], tenant: Tenant, run_id: uuid.UUID, url_id: int
) -> int:
    snapshot_id: int = await db.fetchval(
        "INSERT INTO seo.page_snapshots (workspace_id, project_id, url_id, run_id, taken_at, "
        "words, links_all, links_editorial, main_hash, full_hash) "
        "VALUES ($1, $2, $3, $4, now(), 10, 2, 1, $5, $5) RETURNING id",
        tenant.workspace_id,
        tenant.project_id,
        url_id,
        run_id,
        HASH,
    )
    return snapshot_id


@pytest.mark.parametrize("table", sorted(COLUMNS))
async def test_the_tables_have_the_documented_columns(migrated: PostgresServer, table: str) -> None:
    assert await _columns(migrated, table) == COLUMNS[table]


async def test_crawl_pages_keeps_the_sitemap_date(migrated: PostgresServer) -> None:
    assert "sitemap_lastmod" in await _columns(migrated, "seo.crawl_pages")


async def test_a_snapshot_defaults_to_no_headings(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "defaults")
    async with connection(migrated) as db:
        run_id, url_id = await _page(db, tenant)
        snapshot_id = await _snapshot(db, tenant, run_id, url_id)
        row = await db.fetchrow(
            "SELECT headings::text AS headings, title FROM seo.page_snapshots WHERE id = $1",
            snapshot_id,
        )
    assert row is not None
    assert (row["headings"], row["title"]) == ("[]", None)


async def test_a_declared_source_is_one_of_the_four(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "source")
    async with connection(migrated) as db:
        run_id, url_id = await _page(db, tenant)
        for source in ("json_ld", "meta_modified", "og_updated", "sitemap"):
            await db.execute(
                "UPDATE seo.page_checks SET declared_source = $3 WHERE run_id = $1 AND url_id = $2",
                run_id,
                url_id,
                source,
            )
        with pytest.raises(asyncpg.CheckViolationError):
            await db.execute(
                "UPDATE seo.page_checks SET declared_source = 'guess' "
                "WHERE run_id = $1 AND url_id = $2",
                run_id,
                url_id,
            )


async def test_a_check_is_one_per_run_and_page(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "unique")
    async with connection(migrated) as db:
        run_id, url_id = await _page(db, tenant)
        with pytest.raises(asyncpg.UniqueViolationError):
            await db.execute(
                "INSERT INTO seo.page_checks (run_id, url_id, workspace_id, project_id, "
                "main_hash, full_hash) VALUES ($1, $2, $3, $4, $5, $5)",
                run_id,
                url_id,
                tenant.workspace_id,
                tenant.project_id,
                HASH,
            )


async def test_a_check_names_a_snapshot_of_its_own_workspace(migrated: PostgresServer) -> None:
    first = await seed_tenant(migrated, "owner-a")
    second = await seed_tenant(migrated, "owner-b")
    async with connection(migrated) as db:
        run_id, url_id = await _page(db, first)
        foreign = await db.fetchval(
            "SELECT id FROM seo.page_snapshots WHERE workspace_id = $1", second.workspace_id
        )
        with pytest.raises(asyncpg.ForeignKeyViolationError):
            await db.execute(
                "UPDATE seo.page_checks SET snapshot_id = $3 WHERE run_id = $1 AND url_id = $2",
                run_id,
                url_id,
                foreign,
            )


async def test_a_snapshot_survives_the_deletion_of_its_run(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "survive")
    async with connection(migrated) as db:
        run_id, url_id = await _page(db, tenant)
        snapshot_id = await _snapshot(db, tenant, run_id, url_id)
        await db.execute("DELETE FROM seo.crawl_runs WHERE id = $1", run_id)
        snapshots = await db.fetchval(
            "SELECT count(*) FROM seo.page_snapshots WHERE id = $1", snapshot_id
        )
        checks = await db.fetchval("SELECT count(*) FROM seo.page_checks WHERE run_id = $1", run_id)
        summaries = await db.fetchval(
            "SELECT count(*) FROM seo.page_history_runs WHERE run_id = $1", run_id
        )
    assert snapshots == 1
    assert checks == 0
    assert summaries == 0


async def test_the_snapshot_run_has_no_key(migrated: PostgresServer) -> None:
    async with connection(migrated) as db:
        keys = await db.fetch(
            "SELECT confrelid::regclass::text AS target FROM pg_constraint "
            "WHERE conrelid = 'seo.page_snapshots'::regclass AND contype = 'f'"
        )
    assert sorted(key["target"] for key in keys) == ["core.projects", "core.urls"]


async def test_the_project_keys_cascade(migrated: PostgresServer) -> None:
    # A seeded project cannot be deleted (its schedule runs block it): read the rule instead.
    async with connection(migrated) as db:
        for table in ("page_snapshots", "page_checks", "page_google_crawl"):
            rules = await db.fetch(
                "SELECT confdeltype FROM pg_constraint "
                f"WHERE conrelid = 'seo.{table}'::regclass "
                "AND contype = 'f' AND confrelid = 'core.projects'::regclass"
            )
            assert [rule["confdeltype"] for rule in rules] == [b"c"], table


async def test_the_snapshot_index_serves_the_page_history_read(migrated: PostgresServer) -> None:
    async with connection(migrated) as db:
        definition = await db.fetchval(
            "SELECT indexdef FROM pg_indexes WHERE schemaname = 'seo' "
            "AND tablename = 'page_snapshots' "
            "AND indexdef LIKE '%(project_id, url_id, taken_at DESC)%'"
        )
    assert definition is not None


@pytest.mark.parametrize("table", sorted(COLUMNS))
async def test_each_workspace_sees_only_its_own_rows(migrated: PostgresServer, table: str) -> None:
    alpha = await seed_tenant(migrated, "rls-a")
    beta = await seed_tenant(migrated, "rls-b")
    async with scoped(migrated, "app_api") as db:
        assert await db.fetchval(f"SELECT count(*) FROM {table}") == 0
    async with scoped(migrated, "app_api", workspace_id=alpha.workspace_id) as db:
        total = await db.fetchval(f"SELECT count(*) FROM {table}")
        own = await db.fetchval(
            f"SELECT count(*) FROM {table} WHERE workspace_id = $1", alpha.workspace_id
        )
        assert total >= 1
        assert total == own
        foreign = await db.fetchval(
            f"SELECT count(*) FROM {table} WHERE workspace_id = $1", beta.workspace_id
        )
        assert foreign == 0


async def test_the_api_reads_and_the_worker_writes(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "grants")
    async with connection(migrated) as db:
        run_id, url_id = await _page(db, tenant)
    insert = (
        "INSERT INTO seo.page_snapshots (workspace_id, project_id, url_id, run_id, taken_at, "
        "words, links_all, links_editorial, main_hash, full_hash) "
        "VALUES ($1, $2, $3, $4, now(), 1, 1, 1, $5, $5)"
    )
    arguments = (tenant.workspace_id, tenant.project_id, url_id, run_id, HASH)
    async with scoped(migrated, "app_api", workspace_id=tenant.workspace_id) as db:
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await db.execute(insert, *arguments)
    async with scoped(migrated, "app_api", workspace_id=tenant.workspace_id) as db:
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await db.execute("UPDATE seo.page_google_crawl SET coverage_state = 'x'")
    async with scoped(migrated, "app_worker", workspace_id=tenant.workspace_id) as db:
        await db.execute(insert, *arguments)
        await db.execute("UPDATE seo.page_google_crawl SET coverage_state = 'Submitted'")
        await db.execute("UPDATE seo.page_history_runs SET site_wide = true")
    for forbidden in (
        "UPDATE seo.page_checks SET declared_source = NULL",
        "DELETE FROM seo.page_snapshots",
    ):
        async with scoped(migrated, "app_worker", workspace_id=tenant.workspace_id) as db:
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await db.execute(forbidden)
