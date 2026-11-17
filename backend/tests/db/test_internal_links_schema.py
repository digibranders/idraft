"""Migration 0025: tiers, tier rules, pages, tags and crawls (plan 02 Task 1)."""

from __future__ import annotations

import asyncio
import uuid

import asyncpg
import pytest
from alembic import command

from idraft.db.migrate import alembic_config
from tests.conftest import PostgresServer
from tests.db.support import connection, scoped, seed_tenant


def test_a_workspace_that_existed_gets_the_four_default_tiers(pg: PostgresServer) -> None:
    # A workspace made after the migration gets them from the service (Task 3).
    name = f"tiers_{uuid.uuid4().hex[:8]}"
    asyncio.run(pg.create_database(name))
    url = pg.url("migrator", name)
    config = alembic_config(url)
    command.upgrade(config, "0024")

    async def seed() -> uuid.UUID:
        db = await asyncpg.connect(url)
        try:
            created: uuid.UUID = await db.fetchval(
                "INSERT INTO auth.workspaces (name, slug) VALUES ('w', $1) RETURNING id", name
            )
            return created
        finally:
            await db.close()

    workspace = asyncio.run(seed())
    command.upgrade(config, "0025")

    async def read() -> list[tuple[int, str]]:
        db = await asyncpg.connect(url)
        try:
            rows = await db.fetch(
                "SELECT position, name FROM core.page_tier_levels WHERE workspace_id = $1 "
                "ORDER BY position",
                workspace,
            )
            return [(row["position"], row["name"]) for row in rows]
        finally:
            await db.close()

    assert asyncio.run(read()) == [
        (1, "Money pages"),
        (2, "Supporting pages"),
        (3, "Content pages"),
        (4, "Utility pages"),
    ]


async def test_positions_are_one_to_eight_and_unique_per_workspace(
    migrated: PostgresServer,
) -> None:
    tenant = await seed_tenant(migrated, "tiers")
    async with connection(migrated) as db:
        with pytest.raises(asyncpg.CheckViolationError):
            await db.execute(
                "INSERT INTO core.page_tier_levels (workspace_id, position, name) "
                "VALUES ($1, 9, 'Nine')",
                tenant.workspace_id,
            )
        with pytest.raises(asyncpg.UniqueViolationError):
            await db.execute(
                "INSERT INTO core.page_tier_levels (workspace_id, position, name) "
                "SELECT workspace_id, position, 'Again' FROM core.page_tier_levels "
                "WHERE workspace_id = $1 LIMIT 1",
                tenant.workspace_id,
            )


async def test_positions_close_up_in_one_statement(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "closeup")
    async with connection(migrated) as db:
        await db.execute(
            "INSERT INTO core.page_tier_levels (workspace_id, position, name) "
            "SELECT $1, p, 'Tier ' || p FROM generate_series(2, 4) AS p",
            tenant.workspace_id,
        )
        await db.execute(
            "DELETE FROM core.page_tier_levels WHERE workspace_id = $1 AND position = 2",
            tenant.workspace_id,
        )
        # Deferrable unique key: the shift down passes through no duplicate.
        await db.execute(
            "UPDATE core.page_tier_levels SET position = position - 1 "
            "WHERE workspace_id = $1 AND position > 2",
            tenant.workspace_id,
        )
        positions = await db.fetch(
            "SELECT position FROM core.page_tier_levels WHERE workspace_id = $1 ORDER BY 1",
            tenant.workspace_id,
        )
    assert [row["position"] for row in positions] == [1, 2, 3]


async def test_a_rule_tier_needs_its_rule_and_a_manual_row_names_none(
    migrated: PostgresServer,
) -> None:
    tenant = await seed_tenant(migrated, "sources")
    async with connection(migrated) as db:
        url_id = await db.fetchval(
            "SELECT url_id FROM core.project_pages WHERE project_id = $1", tenant.project_id
        )
        with pytest.raises(asyncpg.CheckViolationError):
            await db.execute(
                "UPDATE core.project_pages SET tier_source = 'rule', rule_id = NULL "
                "WHERE project_id = $1 AND url_id = $2",
                tenant.project_id,
                url_id,
            )


async def test_one_crawl_at_a_time_per_project(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "active")
    insert = (
        "INSERT INTO seo.crawl_runs (workspace_id, project_id, trigger, state, target_host, "
        "settings, ceiling) VALUES ($1, $2, 'manual', $3, 'example.com', '{}', 2000)"
    )
    async with connection(migrated) as db:
        await db.execute(insert, tenant.workspace_id, tenant.project_id, "queued")
        with pytest.raises(asyncpg.UniqueViolationError):
            await db.execute(insert, tenant.workspace_id, tenant.project_id, "crawling")
        # Finished crawls do not count.
        await db.execute(insert, tenant.workspace_id, tenant.project_id, "failed")


async def test_links_land_in_the_partition_of_their_run(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "parts")
    async with connection(migrated) as db:
        run_id = await db.fetchval(
            "INSERT INTO seo.crawl_runs (workspace_id, project_id, trigger, state, "
            "target_host, settings, ceiling) VALUES ($1, $2, 'manual', 'processing', "
            "'example.com', '{}', 2000) RETURNING id",
            tenant.workspace_id,
            tenant.project_id,
        )
        with pytest.raises(asyncpg.PostgresError):
            # No partition yet: the row has nowhere to go.
            await _link(db, tenant.workspace_id, run_id)
    async with scoped(migrated, "app_worker") as db:
        await db.execute("SELECT seo.add_crawl_links_partition($1)", run_id)
        await db.execute("SELECT seo.add_crawl_links_partition($1)", run_id)  # idempotent
        await _link(db, tenant.workspace_id, run_id)
        part = await db.fetchval(
            "SELECT tableoid::regclass::text FROM seo.crawl_links WHERE run_id = $1", run_id
        )
        assert part == f"seo.crawl_links_{run_id.hex}"
        assert await db.fetchval("SELECT seo.drop_crawl_links_partition($1)", run_id)
        assert not await db.fetchval("SELECT seo.drop_crawl_links_partition($1)", run_id)


async def test_partition_functions_refuse_what_is_not_a_run(migrated: PostgresServer) -> None:
    async with scoped(migrated, "app_worker") as db:
        with pytest.raises(asyncpg.RaiseError):
            await db.execute("SELECT seo.add_crawl_links_partition($1)", uuid.uuid4())
    async with scoped(migrated, "app_worker") as db:
        assert not await db.fetchval("SELECT seo.drop_crawl_links_partition($1)", uuid.uuid4())


async def test_the_api_cannot_make_or_drop_partitions(migrated: PostgresServer) -> None:
    async with scoped(migrated, "app_api") as db:
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await db.execute("SELECT seo.add_crawl_links_partition($1)", uuid.uuid4())


async def test_the_crawl_price_is_in_the_price_book(migrated: PostgresServer) -> None:
    async with connection(migrated) as db:
        rows = await db.fetch(
            "SELECT unit_price_usd::text AS price, conditions->>'javascript' AS js "
            "FROM ops.provider_price_book WHERE endpoint = 'on_page/task_post' "
            "AND price_unit = 'page' ORDER BY 2"
        )
    assert [(row["js"], row["price"]) for row in rows] == [
        ("false", "0.00015000"),
        ("true", "0.00150000"),
    ]


async def _link(
    db: asyncpg.Connection[asyncpg.Record], workspace_id: uuid.UUID, run_id: uuid.UUID
) -> None:
    await db.execute(
        "INSERT INTO seo.crawl_links (run_id, workspace_id, source_url_id, target_url_id, "
        "kind, placement, scope, is_followed) VALUES ($1, $2, 1, 2, 'text', 'content', "
        "'editorial', true)",
        run_id,
        workspace_id,
    )
