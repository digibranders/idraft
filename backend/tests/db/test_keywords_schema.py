"""The rules the keyword, group, metrics, import and URL tables keep by themselves
(docs/04-data-model.md sections 5.1, 7.1, 7.2 and 11.8)."""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Mapping
from datetime import date
from decimal import Decimal

import asyncpg
import pytest

from tests.conftest import PostgresServer
from tests.db.support import SEED_LOCATION, Tenant, connection, scoped, seed_tenant

type Db = asyncpg.Connection[asyncpg.Record]


@pytest.fixture
async def tenants(migrated: PostgresServer) -> tuple[Tenant, Tenant]:
    return await seed_tenant(migrated, "alpha"), await seed_tenant(migrated, "beta")


def _suffix() -> str:
    return uuid.uuid4().hex[:8]


async def _keyword(db: Db, tenant: Tenant, language: str = "en") -> uuid.UUID:
    text = f"keyword {_suffix()}"
    keyword_id: uuid.UUID = await db.fetchval(
        "INSERT INTO seo.keywords (workspace_id, text, normalized_text, language_code) "
        "VALUES ($1, $2, $2, $3) RETURNING id",
        tenant.workspace_id,
        text,
        language,
    )
    return keyword_id


async def _tracked(
    db: Db,
    tenant: Tenant,
    keyword_id: uuid.UUID,
    *,
    device: str = "desktop",
    columns: Mapping[str, object] | None = None,
) -> uuid.UUID:
    columns = columns or {}
    names = ", ".join(columns)
    marks = "".join(f", ${index}" for index in range(6, 6 + len(columns)))
    tracked_id: uuid.UUID = await db.fetchval(
        "INSERT INTO seo.tracked_keywords (workspace_id, project_id, keyword_id, location_id, "
        f"language_code, device{', ' + names if names else ''}) "
        f"VALUES ($1, $2, $3, $4, 'en', $5{marks}) RETURNING id",
        tenant.workspace_id,
        tenant.project_id,
        keyword_id,
        SEED_LOCATION,
        device,
        *columns.values(),
    )
    return tracked_id


async def test_the_identity_holds_deleted_rows_too(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with connection(migrated) as db:
        keyword_id = await _keyword(db, alpha)
        tracked_id = await _tracked(db, alpha, keyword_id)
        await db.execute(
            "UPDATE seo.tracked_keywords SET deleted_at = now() WHERE id = $1", tracked_id
        )
        with pytest.raises(asyncpg.UniqueViolationError, match="tracked_keyword_identity"):
            await _tracked(db, alpha, keyword_id)
        # Another device is another measurement.
        await _tracked(db, alpha, keyword_id, device="mobile")


async def test_a_tracked_keyword_takes_its_keywords_language(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with connection(migrated) as db:
        german = await _keyword(db, alpha, language="de")
        with pytest.raises(asyncpg.ForeignKeyViolationError):
            await _tracked(db, alpha, german)


@pytest.mark.parametrize(
    ("column", "value"),
    [
        ("intent", "curious"),
        ("funnel_stage", "middle"),
        ("os", "linux"),
        ("depth_profile", "huge"),
        ("priority", 6),
        ("business_value", Decimal("-1")),
        ("source", "scraped"),
    ],
)
async def test_descriptive_columns_take_only_their_documented_values(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant], column: str, value: object
) -> None:
    alpha, _ = tenants
    async with connection(migrated) as db:
        keyword_id = await _keyword(db, alpha)
        with pytest.raises(asyncpg.CheckViolationError):
            await _tracked(db, alpha, keyword_id, columns={column: value})


@pytest.mark.parametrize("text", ["", " crm", "x" * 701])
async def test_keyword_text_is_trimmed_and_at_most_700_characters(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant], text: str
) -> None:
    alpha, _ = tenants
    async with connection(migrated) as db:
        with pytest.raises(asyncpg.CheckViolationError):
            await db.execute(
                "INSERT INTO seo.keywords (workspace_id, text, normalized_text, language_code) "
                "VALUES ($1, $2, 'crm', 'en')",
                alpha.workspace_id,
                text,
            )


async def test_group_names_are_unique_among_siblings_roots_included(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants

    async def group(db: Db, name: str, parent_id: uuid.UUID | None = None) -> uuid.UUID:
        group_id: uuid.UUID = await db.fetchval(
            "INSERT INTO seo.keyword_groups (workspace_id, project_id, parent_id, name, path) "
            "VALUES ($1, $2, $3, $4, $4) RETURNING id",
            alpha.workspace_id,
            alpha.project_id,
            parent_id,
            name,
        )
        return group_id

    async with connection(migrated) as db:
        root = await group(db, "Pricing")
        with pytest.raises(asyncpg.UniqueViolationError, match="keyword_groups_sibling_name"):
            await group(db, "PRICING")
        await group(db, "Pricing", root)
        with pytest.raises(asyncpg.CheckViolationError):
            await group(db, "A/B")


async def test_a_group_member_and_its_group_are_in_one_project(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with connection(migrated) as db:
        other_project: uuid.UUID = await db.fetchval(
            "INSERT INTO core.projects (workspace_id, name, slug) "
            "VALUES ($1, 'Other', $2) RETURNING id",
            alpha.workspace_id,
            f"other-{_suffix()}",
        )
        group_id: uuid.UUID = await db.fetchval(
            "INSERT INTO seo.keyword_groups (workspace_id, project_id, name, path) "
            "VALUES ($1, $2, 'Elsewhere', 'Elsewhere') RETURNING id",
            alpha.workspace_id,
            other_project,
        )
        tracked_id = await _tracked(db, alpha, await _keyword(db, alpha))
        with pytest.raises(asyncpg.ForeignKeyViolationError):
            await db.execute(
                "INSERT INTO seo.keyword_group_members (group_id, tracked_keyword_id, project_id, "
                "workspace_id) VALUES ($1, $2, $3, $4)",
                group_id,
                tracked_id,
                alpha.project_id,
                alpha.workspace_id,
            )


async def test_a_term_of_another_workspace_cannot_be_assigned(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, beta = tenants
    async with connection(migrated) as db:
        tracked_id = await _tracked(db, alpha, await _keyword(db, alpha))
        foreign_term: uuid.UUID = await db.fetchval(
            "SELECT id FROM core.taxonomy_terms WHERE workspace_id = $1", beta.workspace_id
        )
        with pytest.raises(asyncpg.ForeignKeyViolationError):
            await db.execute(
                "INSERT INTO seo.tracked_keyword_terms (tracked_keyword_id, term_id, workspace_id) "
                "VALUES ($1, $2, $3)",
                tracked_id,
                foreign_term,
                alpha.workspace_id,
            )


async def test_one_snapshot_per_task(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with connection(migrated) as db:
        keyword_id = await _keyword(db, alpha)
        insert = (
            "INSERT INTO seo.keyword_metric_snapshots (workspace_id, keyword_id, location_id, "
            "language_code, source, fetched_at, data_month, task_id, is_material_change) "
            "VALUES ($1, $2, $3, 'en', 'dataforseo_labs', '2026-10-01T03:00:00Z', $4, $5, true)"
        )
        await db.execute(insert, alpha.workspace_id, keyword_id, SEED_LOCATION, None, 7)
        with pytest.raises(asyncpg.UniqueViolationError, match="one_per_task"):
            await db.execute(insert, alpha.workspace_id, keyword_id, SEED_LOCATION, None, 7)
        # Another task of the same call: same keyword and time, a second snapshot.
        await db.execute(insert, alpha.workspace_id, keyword_id, SEED_LOCATION, None, 8)
        with pytest.raises(asyncpg.CheckViolationError):
            await db.execute(
                insert,
                alpha.workspace_id,
                keyword_id,
                SEED_LOCATION,
                date(2026, 9, 15),  # a data month is a month's first day
                9,
            )


async def test_the_current_row_names_a_snapshot_of_its_own_key(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with connection(migrated) as db:
        keyword_id = await _keyword(db, alpha)
        other_snapshot: int = await db.fetchval(
            "SELECT id FROM seo.keyword_metric_snapshots WHERE workspace_id = $1",
            alpha.workspace_id,
        )
        with pytest.raises(asyncpg.ForeignKeyViolationError):
            await db.execute(
                "INSERT INTO seo.keyword_metrics_current (keyword_id, location_id, "
                "language_code, source, workspace_id, snapshot_id, fetched_at) "
                "VALUES ($1, $2, 'en', 'dataforseo_labs', $3, $4, now())",
                keyword_id,
                SEED_LOCATION,
                alpha.workspace_id,
                other_snapshot,
            )


async def test_a_tracked_keyword_names_a_schedule_of_its_own_project(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with connection(migrated) as db:
        other_project: uuid.UUID = await db.fetchval(
            "INSERT INTO core.projects (workspace_id, name, slug) "
            "VALUES ($1, 'Other', $2) RETURNING id",
            alpha.workspace_id,
            f"other-{_suffix()}",
        )
        sibling_schedule: uuid.UUID = await db.fetchval(
            "INSERT INTO ops.schedules (workspace_id, project_id, workload, name, cadence, "
            "timezone, next_run_at) VALUES ($1, $2, 'seo_rank', 'x', 'daily', 'UTC', now()) "
            "RETURNING id",
            alpha.workspace_id,
            other_project,
        )
        with pytest.raises(asyncpg.ForeignKeyViolationError):
            await _tracked(
                db, alpha, await _keyword(db, alpha), columns={"schedule_id": sibling_schedule}
            )
        await _tracked(
            db, alpha, await _keyword(db, alpha), columns={"schedule_id": alpha.schedule_id}
        )


async def test_import_rows_split_a_both_device_row_in_two_parts(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with connection(migrated) as db:
        import_id: uuid.UUID = await db.fetchval(
            "SELECT id FROM seo.keyword_imports WHERE workspace_id = $1", alpha.workspace_id
        )
        row = (
            "INSERT INTO seo.keyword_import_rows (import_id, row_no, part, workspace_id, raw, "
            "device, outcome, action) VALUES ($1, 2, $2, $3, '{}', $4, 'new', 'create')"
        )
        await db.execute(row, import_id, 1, alpha.workspace_id, "desktop")
        # The second part of a `both` row is the mobile one.
        with pytest.raises(asyncpg.CheckViolationError):
            await db.execute(row, import_id, 2, alpha.workspace_id, "desktop")
        await db.execute(row, import_id, 2, alpha.workspace_id, "mobile")
        with pytest.raises(asyncpg.CheckViolationError):
            await db.execute(row, import_id, 3, alpha.workspace_id, "mobile")


async def test_urls_are_global_and_the_api_adds_only_their_documented_columns(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with connection(migrated) as db:
        domain_id: int = await db.fetchval(
            "INSERT INTO core.domains (host, registrable_domain, public_suffix) "
            "VALUES ($1, $1, 'com') RETURNING id",
            f"site-{_suffix()}.com",
        )
        url_id: int = await db.fetchval(
            "INSERT INTO core.urls (url_hash, canonical_url, domain_id, path, "
            "canonicalizer_version) VALUES ($1, 'https://site.com/a', $2, '/a', 1) RETURNING id",
            hashlib.sha256(_suffix().encode()).digest(),
            domain_id,
        )
    async with scoped(migrated, "app_api", workspace_id=alpha.workspace_id) as db:
        await db.execute(
            "INSERT INTO core.urls (url_hash, canonical_url, domain_id, path, "
            "canonicalizer_version) VALUES ($1, 'https://site.com/c', $2, '/c', 1)",
            hashlib.sha256(_suffix().encode()).digest(),
            domain_id,
        )
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await db.execute(
                "INSERT INTO core.urls (url_hash, canonical_url, domain_id, path, "
                "canonicalizer_version, first_seen_at) "
                "VALUES ($1, 'https://site.com/b', $2, '/b', 1, now())",
                hashlib.sha256(b"b").digest(),
                domain_id,
            )
    async with scoped(migrated, "app_api") as db:
        # No workspace on the transaction, and the row is still visible: a global dictionary.
        assert await db.fetchval("SELECT count(*) FROM core.urls WHERE id = $1", url_id) == 1


async def test_the_labs_prices_are_in_the_price_book(migrated: PostgresServer) -> None:
    async with connection(migrated) as db:
        rows = await db.fetch(
            "SELECT price_unit, unit_price_usd FROM ops.provider_price_book "
            "WHERE provider_code = 'dataforseo' "
            "AND endpoint = 'dataforseo_labs/google/keyword_overview' ORDER BY price_unit"
        )

    assert [(row["price_unit"], row["unit_price_usd"]) for row in rows] == [
        ("item", Decimal("0.00012000")),
        ("request", Decimal("0.01200000")),
    ]


async def test_a_schedule_and_a_run_keep_to_one_workspace(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, beta = tenants
    async with connection(migrated) as db:
        with pytest.raises(asyncpg.ForeignKeyViolationError):
            await db.execute(
                "INSERT INTO ops.schedules (workspace_id, project_id, workload, name, cadence, "
                "timezone, next_run_at) VALUES ($1, $2, 'seo_rank', 'x', 'daily', 'UTC', now())",
                alpha.workspace_id,
                beta.project_id,
            )
        with pytest.raises(asyncpg.ForeignKeyViolationError):
            await db.execute(
                "INSERT INTO ops.collection_runs (workspace_id, project_id, schedule_id, "
                "workload, window_start, window_end, trigger, status, config_snapshot) "
                "VALUES ($1, $2, $3, 'seo_rank', now(), now(), 'schedule', 'planned', '{}')",
                alpha.workspace_id,
                alpha.project_id,
                beta.schedule_id,
            )
