"""Migration 0041: AI referral sessions per day and the versioned referrer rules (WP-69 task 1,
docs/18-first-party-integrations.md sections 7.3 and 7.4)."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

import asyncpg
import pytest

from tests.conftest import PostgresServer
from tests.db.support import Tenant, connection, scoped, seed_tenant

DAILY_COLUMNS = {
    "project_id",
    "integration_id",
    "metric_date",
    "origin",
    "classifier",
    "rules_version",
    "assistant_code",
    "landing_url_id",
    "workspace_id",
    "unit",
    "sessions",
    "engaged_sessions",
    "key_events",
    "total_revenue",
    "requests",
    "is_current",
    "computed_at",
}
RULE_COLUMNS = {
    "rule_set_version",
    "rule_id",
    "match_field",
    "match_type",
    "pattern",
    "assistant_code",
    "operator",
    "confidence",
    "notes",
}
DAY = date(2026, 11, 20)

_INSERT = (
    "INSERT INTO fp.ai_referral_daily (project_id, integration_id, metric_date, origin, "
    "classifier, rules_version, assistant_code, workspace_id, unit, sessions) "
    "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 4)"
)


async def _integration(pg: PostgresServer, tenant: Tenant) -> uuid.UUID:
    async with connection(pg) as db:
        found: uuid.UUID = await db.fetchval(
            "SELECT id FROM fp.integrations WHERE workspace_id = $1", tenant.workspace_id
        )
    return found


async def _insert_daily(
    db: asyncpg.Connection[Any],
    tenant: Tenant,
    integration_id: uuid.UUID,
    *,
    origin: str = "ga4",
    classifier: str = "own_rules",
    unit: str = "sessions",
    assistant: str = "chatgpt",
    day: date = DAY,
) -> None:
    await db.execute(
        _INSERT,
        tenant.project_id,
        integration_id,
        day,
        origin,
        classifier,
        1,
        assistant,
        tenant.workspace_id,
        unit,
    )


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


async def test_the_tables_have_the_documented_columns(migrated: PostgresServer) -> None:
    assert await _columns(migrated, "fp.ai_referral_daily") == DAILY_COLUMNS
    assert await _columns(migrated, "fp.ai_referrer_rules") == RULE_COLUMNS


async def test_a_daily_row_defaults_to_all_pages_and_the_current_series(
    migrated: PostgresServer,
) -> None:
    tenant = await seed_tenant(migrated, "defaults")
    integration_id = await _integration(migrated, tenant)
    async with connection(migrated) as db:
        await _insert_daily(db, tenant, integration_id)
        row = await db.fetchrow(
            "SELECT landing_url_id, is_current, engaged_sessions, key_events, requests "
            "FROM fp.ai_referral_daily WHERE integration_id = $1 AND metric_date = $2",
            integration_id,
            DAY,
        )
    assert row is not None
    assert row["landing_url_id"] == 0
    assert row["is_current"] is True
    assert (row["engaged_sessions"], row["key_events"], row["requests"]) == (None, None, None)


@pytest.mark.parametrize(
    ("column", "origin", "classifier", "unit"),
    [
        ("origin", "bing", "own_rules", "sessions"),
        ("classifier", "ga4", "guess", "sessions"),
        ("unit", "ga4", "own_rules", "pageviews"),
    ],
)
async def test_a_bad_origin_classifier_or_unit_is_refused(
    migrated: PostgresServer, column: str, origin: str, classifier: str, unit: str
) -> None:
    tenant = await seed_tenant(migrated, f"check-{column}")
    integration_id = await _integration(migrated, tenant)
    async with connection(migrated) as db:
        with pytest.raises(asyncpg.CheckViolationError) as raised:
            await _insert_daily(
                db, tenant, integration_id, origin=origin, classifier=classifier, unit=unit
            )
    assert column in str(raised.value)


async def test_a_row_is_one_per_key(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "unique")
    integration_id = await _integration(migrated, tenant)
    async with connection(migrated) as db:
        await _insert_daily(db, tenant, integration_id)
        with pytest.raises(asyncpg.UniqueViolationError):
            await _insert_daily(db, tenant, integration_id)
        await _insert_daily(db, tenant, integration_id, classifier="ga4_ai_assistant_channel")


async def test_a_row_names_an_integration_and_a_project_of_its_own_workspace(
    migrated: PostgresServer,
) -> None:
    first = await seed_tenant(migrated, "owner-a")
    second = await seed_tenant(migrated, "owner-b")
    async with connection(migrated) as db:
        with pytest.raises(asyncpg.ForeignKeyViolationError):
            await _insert_daily(db, second, await _integration(migrated, first))
        with pytest.raises(asyncpg.ForeignKeyViolationError):
            await db.execute(
                _INSERT,
                first.project_id,
                await _integration(migrated, second),
                DAY,
                "ga4",
                "own_rules",
                1,
                "chatgpt",
                second.workspace_id,
                "sessions",
            )


async def test_deleting_the_integration_deletes_its_daily_rows(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "cascade")
    integration_id = await _integration(migrated, tenant)
    async with connection(migrated) as db:
        await _insert_daily(db, tenant, integration_id)
        before = await db.fetchval(
            "SELECT count(*) FROM fp.ai_referral_daily WHERE integration_id = $1", integration_id
        )
        await db.execute("DELETE FROM fp.integrations WHERE id = $1", integration_id)
        after = await db.fetchval(
            "SELECT count(*) FROM fp.ai_referral_daily WHERE integration_id = $1", integration_id
        )
    assert before >= 1
    assert after == 0


async def test_the_project_key_cascades(migrated: PostgresServer) -> None:
    # A seeded project cannot be deleted (its schedule runs block it): read the rule instead.
    async with connection(migrated) as db:
        rules = await db.fetch(
            "SELECT confdeltype FROM pg_constraint "
            "WHERE conrelid = 'fp.ai_referral_daily'::regclass "
            "AND contype = 'f' AND confrelid = 'core.projects'::regclass"
        )
    assert [rule["confdeltype"] for rule in rules] == [b"c"]


async def test_each_workspace_sees_only_its_own_daily_rows(migrated: PostgresServer) -> None:
    alpha = await seed_tenant(migrated, "rls-a")
    beta = await seed_tenant(migrated, "rls-b")
    async with connection(migrated) as db:
        await _insert_daily(db, alpha, await _integration(migrated, alpha), assistant="claude")
        await _insert_daily(db, beta, await _integration(migrated, beta), assistant="gemini")
    async with scoped(migrated, "app_api") as db:
        assert await db.fetchval("SELECT count(*) FROM fp.ai_referral_daily") == 0
    async with scoped(migrated, "app_api", workspace_id=alpha.workspace_id) as db:
        seen = {
            row["assistant_code"]
            for row in await db.fetch("SELECT assistant_code FROM fp.ai_referral_daily")
        }
        assert "claude" in seen
        assert "gemini" not in seen
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await _insert_daily(db, alpha, await _integration(migrated, alpha), assistant="x")
    async with scoped(migrated, "app_worker", workspace_id=beta.workspace_id) as db:
        await _insert_daily(db, beta, await _integration(migrated, beta), assistant="mistral")
        await db.execute(
            "DELETE FROM fp.ai_referral_daily WHERE workspace_id = $1 AND assistant_code = $2",
            beta.workspace_id,
            "mistral",
        )
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await db.execute("UPDATE fp.ai_referral_daily SET sessions = 0")


async def test_the_daily_index_serves_the_project_and_date_read(migrated: PostgresServer) -> None:
    async with connection(migrated) as db:
        definition = await db.fetchval(
            "SELECT indexdef FROM pg_indexes WHERE schemaname = 'fp' "
            "AND tablename = 'ai_referral_daily' AND indexdef LIKE '%(project_id, metric_date)%'"
        )
    assert definition is not None
    assert "WHERE is_current" in definition


async def test_the_rules_are_the_twenty_seeded_rows_of_version_one(
    migrated: PostgresServer,
) -> None:
    async with connection(migrated) as db:
        rows = await db.fetch(
            "SELECT rule_set_version, rule_id, match_field, match_type, pattern, confidence "
            "FROM fp.ai_referrer_rules ORDER BY rule_id"
        )
    assert len(rows) == 20
    assert {row["rule_set_version"] for row in rows} == {1}
    assert [row["rule_id"] for row in rows] == list(range(1, 21))
    assert sum(row["match_field"] == "utm_source" for row in rows) == 3
    assert sorted(row["pattern"] for row in rows if row["confidence"] == "ambiguous") == [
        "duckduckgo.com",
        "openai.com",
        "x.ai",
    ]
    by_pattern = {(row["match_field"], row["pattern"]): row for row in rows}
    assert by_pattern[("referrer_host", "perplexity.ai")]["match_type"] == "suffix"
    assert by_pattern[("utm_source", "perplexity")]["match_type"] == "exact"


async def test_rule_patterns_are_lowercase_and_unique_per_match(migrated: PostgresServer) -> None:
    async with connection(migrated) as db:
        rows = await db.fetch("SELECT match_field, match_type, pattern FROM fp.ai_referrer_rules")
        keys = [(row["match_field"], row["match_type"], row["pattern"]) for row in rows]
        assert len(set(keys)) == len(keys)
        assert all(pattern == pattern.lower() for _, _, pattern in keys)
        with pytest.raises(asyncpg.UniqueViolationError):
            await db.execute(
                "INSERT INTO fp.ai_referrer_rules (rule_set_version, rule_id, match_field, "
                "match_type, pattern, assistant_code, operator, confidence) "
                "VALUES (1, 99, 'referrer_host', 'exact', 'chatgpt.com', 'chatgpt', 'OpenAI', "
                "'high')"
            )


async def test_google_and_microsoft_search_hosts_are_never_rules(migrated: PostgresServer) -> None:
    async with connection(migrated) as db:
        found = await db.fetch(
            "SELECT pattern FROM fp.ai_referrer_rules "
            "WHERE pattern IN ('google.com', 'bing.com', 'msn.com')"
        )
    assert found == []


async def test_a_rule_has_a_known_field_type_and_confidence(migrated: PostgresServer) -> None:
    async with connection(migrated) as db:
        for field, kind, confidence in (
            ("cookie", "exact", "high"),
            ("referrer_host", "prefix", "high"),
            ("referrer_host", "exact", "certain"),
        ):
            with pytest.raises(asyncpg.CheckViolationError):
                await db.execute(
                    "INSERT INTO fp.ai_referrer_rules (rule_set_version, rule_id, match_field, "
                    "match_type, pattern, assistant_code, operator, confidence) "
                    "VALUES (3, 1, $1, $2, 'example.com', 'x', 'X', $3)",
                    field,
                    kind,
                    confidence,
                )


@pytest.mark.parametrize("role", ["app_api", "app_worker"])
async def test_the_runtime_roles_read_the_rules_and_cannot_change_them(
    migrated: PostgresServer, role: str
) -> None:
    async with scoped(migrated, role) as db:
        assert await db.fetchval("SELECT count(*) FROM fp.ai_referrer_rules") == 20
    for statement in (
        "INSERT INTO fp.ai_referrer_rules (rule_set_version, rule_id, match_field, match_type, "
        "pattern, assistant_code, operator, confidence) "
        "VALUES (2, 1, 'referrer_host', 'exact', 'example.com', 'x', 'X', 'high')",
        "UPDATE fp.ai_referrer_rules SET pattern = 'example.com'",
        "DELETE FROM fp.ai_referrer_rules",
    ):
        async with scoped(migrated, role) as db:
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await db.execute(statement)
