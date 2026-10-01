"""Every constraint and index of the keyword tables, read from the catalog and compared with
what migration 0011 means to create. A change to a check, a key or an index fails here first,
so it is made on purpose: tests elsewhere show what a rule does, this shows that it is there."""

from __future__ import annotations

import json
from pathlib import Path

from tests.conftest import PostgresServer
from tests.db.support import connection

EXPECTED = Path(__file__).with_name("keyword_catalog.json")
TABLES = [
    "core.urls",
    "seo.keywords",
    "seo.tracked_keywords",
    "seo.tracked_keyword_config_history",
    "seo.keyword_groups",
    "seo.keyword_group_members",
    "seo.tracked_keyword_terms",
    "seo.tracked_keyword_competitors",
    "seo.keyword_metric_snapshots",
    "seo.keyword_metrics_current",
    "seo.keyword_imports",
    "seo.keyword_import_rows",
]
# Keys and indexes migration 0011 added to tables of earlier revisions.
ALTERED = {
    ("ops.schedules", "schedules_id_workspace_id_key"),
    ("ops.schedules", "schedules_id_project_id_workspace_id_key"),
    ("ops.schedules", "schedules_project_id_workspace_id_fkey"),
    ("ops.collection_runs", "collection_runs_schedule_id_workspace_id_fkey"),
    ("ops.collection_runs", "collection_runs_project_created"),
    ("ops.collection_tasks", "collection_tasks_subject"),
}


async def catalog(pg: PostgresServer) -> dict[str, dict[str, str]]:
    """table: {constraint or index name: its definition}"""
    async with connection(pg) as db:
        constraints = await db.fetch(
            "SELECT conrelid::regclass::text AS tbl, conname AS name, "
            "pg_get_constraintdef(oid) AS definition FROM pg_constraint "
            "WHERE conrelid::regclass::text = ANY($1::text[])",
            TABLES + sorted({table for table, _ in ALTERED}),
        )
        indexes = await db.fetch(
            "SELECT schemaname || '.' || tablename AS tbl, indexname AS name, "
            "indexdef AS definition FROM pg_indexes "
            "WHERE schemaname || '.' || tablename = ANY($1::text[])",
            TABLES + sorted({table for table, _ in ALTERED}),
        )
    found: dict[str, dict[str, str]] = {}
    for row in [*constraints, *indexes]:
        table, name = row["tbl"], row["name"]
        if table in TABLES or (table, name) in ALTERED:
            found.setdefault(table, {})[name] = row["definition"]
    return found


async def test_the_keyword_tables_have_exactly_the_planned_rules(migrated: PostgresServer) -> None:
    assert await catalog(migrated) == json.loads(EXPECTED.read_text())
