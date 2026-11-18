"""Migration 0027: crawl changes, alerts, mentions, decisions and Search Console page totals
(plan 04 Task 1)."""

from __future__ import annotations

import uuid

import asyncpg
import pytest

from tests.conftest import PostgresServer
from tests.db.support import connection, seed_tenant

NEW_TABLES = (
    "seo.crawl_link_changes",
    "seo.crawl_page_changes",
    "seo.crawl_alerts",
    "seo.crawl_mentions",
    "core.link_opportunity_decisions",
    "core.tier_suggestion_dismissals",
    "fp.gsc_page_daily",
)


async def test_every_new_table_has_row_level_security(migrated: PostgresServer) -> None:
    async with connection(migrated) as db:
        for table in NEW_TABLES:
            schema, name = table.split(".")
            row = await db.fetchrow(
                "SELECT c.relrowsecurity FROM pg_class c "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = $1 AND c.relname = $2",
                schema,
                name,
            )
            assert row is not None, table
            assert row["relrowsecurity"], table


async def test_new_run_columns_start_pending_and_zero(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "enrich")
    async with connection(migrated) as db:
        row = await db.fetchrow(
            "SELECT enrich_state, enrich_phase, enrich_failures, enrich_offset, previous_run_id "
            "FROM seo.crawl_runs WHERE workspace_id = $1 LIMIT 1",
            tenant.workspace_id,
        )
    assert row is not None
    assert (row["enrich_state"], row["enrich_failures"], row["enrich_offset"]) == ("pending", 0, 0)
    assert row["enrich_phase"] is None
    assert row["previous_run_id"] is None


async def test_a_change_is_lost_or_added_in_the_editorial_or_the_all_scope(
    migrated: PostgresServer,
) -> None:
    tenant = await seed_tenant(migrated, "changes")
    async with connection(migrated) as db:
        run = await db.fetchval(
            "SELECT id FROM seo.crawl_runs WHERE workspace_id = $1 LIMIT 1", tenant.workspace_id
        )
        for change, scope in (("moved", "editorial"), ("lost", "template")):
            with pytest.raises(asyncpg.CheckViolationError):
                await db.execute(
                    "INSERT INTO seo.crawl_link_changes (run_id, workspace_id, change, scope, "
                    "source_url_id, target_url_id, placement) VALUES ($1, $2, $3, $4, 1, 2, "
                    "'content')",
                    run,
                    tenant.workspace_id,
                    change,
                    scope,
                )


async def test_a_decision_is_accepted_or_dismissed_and_one_per_pair(
    migrated: PostgresServer,
) -> None:
    tenant = await seed_tenant(migrated, "decide")
    async with connection(migrated) as db:
        with pytest.raises(asyncpg.CheckViolationError):
            await db.execute(
                "INSERT INTO core.link_opportunity_decisions (project_id, workspace_id, "
                "source_url_id, target_url_id, status) VALUES ($1, $2, 1, 2, 'open')",
                tenant.project_id,
                tenant.workspace_id,
            )
        await db.execute(
            "INSERT INTO core.link_opportunity_decisions (project_id, workspace_id, "
            "source_url_id, target_url_id, status) VALUES ($1, $2, 1, 2, 'accepted')",
            tenant.project_id,
            tenant.workspace_id,
        )
        with pytest.raises(asyncpg.UniqueViolationError):
            await db.execute(
                "INSERT INTO core.link_opportunity_decisions (project_id, workspace_id, "
                "source_url_id, target_url_id, status) VALUES ($1, $2, 1, 2, 'dismissed')",
                tenant.project_id,
                tenant.workspace_id,
            )


async def test_an_alert_names_a_run_of_its_own_workspace(migrated: PostgresServer) -> None:
    first = await seed_tenant(migrated, "alert-a")
    second = await seed_tenant(migrated, "alert-b")
    async with connection(migrated) as db:
        # A new run of the first workspace (the seeded one already has its alert).
        run = await db.fetchval(
            "INSERT INTO seo.crawl_runs (workspace_id, project_id, trigger, state, target_host, "
            "settings, ceiling) VALUES ($1, $2, 'manual', 'failed', 'example.com', '{}', 2000) "
            "RETURNING id",
            first.workspace_id,
            first.project_id,
        )
        with pytest.raises(asyncpg.ForeignKeyViolationError):
            await db.execute(
                "INSERT INTO seo.crawl_alerts (run_id, workspace_id, project_id, lost_links, "
                "max_position, threshold, channel, delivery_state) "
                "VALUES ($1, $2, $3, 1, 2, 1, 'app', 'shown_in_app')",
                run,
                second.workspace_id,
                second.project_id,
            )
    assert isinstance(run, uuid.UUID)
