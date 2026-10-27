"""The rules the rank tables keep by themselves (docs/04-data-model.md sections 7.3 to 7.6, docs/09
section 4.1; migration 0013)."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import asyncpg
import pytest
from alembic import command

from idraft.db.migrate import alembic_config
from tests.conftest import PostgresServer
from tests.db.support import SEED_LOCATION, Tenant, connection, scoped, seed_tenant

type Db = asyncpg.Connection[asyncpg.Record]

PARTITIONED = (
    "seo.serp_snapshots",
    "seo.serp_features",
    "seo.domain_rank_observations",
    "seo.rank_events",
)


@asynccontextmanager
async def refused(
    db: Db, error: type[Exception], *, match: str | None = None
) -> AsyncIterator[None]:
    """The statements inside are refused with `error`, and the transaction goes on (a savepoint
    is rolled back)."""
    with pytest.raises(error, match=match):
        async with db.transaction():
            yield


@pytest.fixture
async def tenants(migrated: PostgresServer) -> tuple[Tenant, Tenant]:
    return await seed_tenant(migrated, "alpha"), await seed_tenant(migrated, "beta")


@dataclass(frozen=True)
class Seeded:
    """What seeding a tenant wrote that the tests build on."""

    tracked_id: uuid.UUID
    snapshot_id: int
    observed_at: datetime
    raw_payload_id: int


async def _seeded(db: Db, tenant: Tenant) -> Seeded:
    tracked = await db.fetchval(
        "SELECT id FROM seo.tracked_keywords WHERE workspace_id = $1", tenant.workspace_id
    )
    row = await db.fetchrow(
        "SELECT id, observed_at, raw_payload_id FROM seo.serp_snapshots WHERE workspace_id = $1",
        tenant.workspace_id,
    )
    assert row is not None
    return Seeded(tracked, row["id"], row["observed_at"], row["raw_payload_id"])


async def _insert_snapshot(
    db: Db,
    *,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    tracked_id: uuid.UUID,
    raw_payload_id: int,
    observed_at: datetime | None = None,
    task_id: int | None = None,
    urls: str = "ARRAY[]::bigint[]",
    domains: str = "ARRAY[]::integer[]",
    positions: str = "ARRAY[]::smallint[]",
) -> int:
    snapshot_id: int = await db.fetchval(
        "INSERT INTO seo.serp_snapshots (observed_at, observed_date, workspace_id, project_id, "
        "tracked_keyword_id, config_version, collection_task_id, provider_code, "
        "provider_endpoint, location_id, language_code, device, depth_requested, "
        "depth_returned, item_types, organic_url_ids, organic_domain_ids, "
        "organic_abs_positions, has_ai_overview, raw_payload_id, parser_version, "
        "canonicalizer_version) VALUES (COALESCE($1, now()), current_date, $2, $3, $4, 1, $5, "
        "'dataforseo', 'serp/google/organic/task_get/advanced', $6, 'en', 'desktop', 20, 0, "
        f"'{{}}', {urls}, {domains}, {positions}, false, $7, 1, 1) RETURNING id",
        observed_at,
        workspace_id,
        project_id,
        tracked_id,
        task_id,
        SEED_LOCATION,
        raw_payload_id,
    )
    return snapshot_id


async def test_a_task_has_one_snapshot_however_often_it_is_ingested(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with scoped(migrated, "superuser") as db:
        seeded = await _seeded(db, alpha)
        observed = datetime.now(UTC)

        async def ingest() -> int:
            return await _insert_snapshot(
                db,
                workspace_id=alpha.workspace_id,
                project_id=alpha.project_id,
                tracked_id=seeded.tracked_id,
                raw_payload_id=seeded.raw_payload_id,
                observed_at=observed,
                task_id=4242,
            )

        await ingest()
        async with refused(db, asyncpg.UniqueViolationError):
            await ingest()


async def test_a_snapshot_cannot_name_a_keyword_of_another_workspace(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, beta = tenants
    async with scoped(migrated, "superuser") as db:
        own = await _seeded(db, alpha)
        other = await _seeded(db, beta)

        async with refused(db, asyncpg.ForeignKeyViolationError):
            await _insert_snapshot(
                db,
                workspace_id=beta.workspace_id,
                project_id=beta.project_id,
                tracked_id=own.tracked_id,
                raw_payload_id=other.raw_payload_id,
            )


async def test_a_snapshot_cannot_name_a_project_the_keyword_is_not_in(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, beta = tenants
    async with scoped(migrated, "superuser") as db:
        own = await _seeded(db, alpha)

        async with refused(db, asyncpg.ForeignKeyViolationError):
            await _insert_snapshot(
                db,
                workspace_id=alpha.workspace_id,
                project_id=beta.project_id,
                tracked_id=own.tracked_id,
                raw_payload_id=own.raw_payload_id,
            )


async def test_the_arrays_of_an_organic_list_run_in_parallel(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with scoped(migrated, "superuser") as db:
        own = await _seeded(db, alpha)

        async with refused(db, asyncpg.CheckViolationError):
            await _insert_snapshot(
                db,
                workspace_id=alpha.workspace_id,
                project_id=alpha.project_id,
                tracked_id=own.tracked_id,
                raw_payload_id=own.raw_payload_id,
                urls="ARRAY[1, 2]::bigint[]",
                domains="ARRAY[1]::integer[]",
                positions="ARRAY[1, 2]::smallint[]",
            )


async def test_features_and_observations_name_a_snapshot_of_their_own_workspace(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, beta = tenants
    async with scoped(migrated, "superuser") as db:
        own = await _seeded(db, alpha)
        # An entity carries no key: it may be removed later, and the observation stays.
        entity = uuid.uuid4()

        async with refused(db, asyncpg.ForeignKeyViolationError):
            await db.execute(
                "INSERT INTO seo.serp_features (observed_at, serp_snapshot_id, workspace_id, "
                "project_id, tracked_keyword_id, feature_type, ordinal, owned_by_project, "
                "parser_version) VALUES ($1, $2, $3, $4, $5, 'images', 1, false, 1)",
                own.observed_at,
                own.snapshot_id,
                beta.workspace_id,
                beta.project_id,
                own.tracked_id,
            )
        async with refused(db, asyncpg.ForeignKeyViolationError):
            await db.execute(
                "INSERT INTO seo.domain_rank_observations (serp_snapshot_id, observed_at, "
                "observed_date, workspace_id, project_id, tracked_keyword_id, entity_id, "
                "role, depth_requested) VALUES ($1, $2, current_date, $3, $4, $5, $6, "
                "'competitor', 20)",
                own.snapshot_id,
                own.observed_at,
                beta.workspace_id,
                beta.project_id,
                own.tracked_id,
                entity,
            )


async def test_features_and_observations_name_the_project_and_keyword_of_their_snapshot(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with scoped(migrated, "superuser") as db:
        own = await _seeded(db, alpha)
        other_project = await db.fetchval(
            "INSERT INTO core.projects (workspace_id, name, slug) VALUES ($1, 'second', 'second') "
            "RETURNING id",
            alpha.workspace_id,
        )

        for project, keyword in ((other_project, own.tracked_id), (alpha.project_id, uuid.uuid4())):
            async with refused(db, asyncpg.ForeignKeyViolationError):
                await db.execute(
                    "INSERT INTO seo.serp_features (observed_at, serp_snapshot_id, workspace_id, "
                    "project_id, tracked_keyword_id, feature_type, ordinal, owned_by_project, "
                    "parser_version) VALUES ($1, $2, $3, $4, $5, 'images', 1, false, 1)",
                    own.observed_at,
                    own.snapshot_id,
                    alpha.workspace_id,
                    project,
                    keyword,
                )
            async with refused(db, asyncpg.ForeignKeyViolationError):
                await db.execute(
                    "INSERT INTO seo.domain_rank_observations (serp_snapshot_id, observed_at, "
                    "observed_date, workspace_id, project_id, tracked_keyword_id, entity_id, "
                    "role, depth_requested) VALUES ($1, $2, current_date, $3, $4, $5, $6, "
                    "'competitor', 20)",
                    own.snapshot_id,
                    own.observed_at,
                    alpha.workspace_id,
                    project,
                    keyword,
                    uuid.uuid4(),
                )


async def test_the_state_of_a_keyword_cannot_name_another_workspace(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, beta = tenants
    async with scoped(migrated, "superuser") as db:
        own = await _seeded(db, alpha)
        await db.execute(
            "DELETE FROM seo.tracked_keyword_state WHERE tracked_keyword_id = $1", own.tracked_id
        )

        async with refused(db, asyncpg.ForeignKeyViolationError):
            await db.execute(
                "INSERT INTO seo.tracked_keyword_state (tracked_keyword_id, workspace_id, "
                "project_id) VALUES ($1, $2, $3)",
                own.tracked_id,
                beta.workspace_id,
                beta.project_id,
            )


async def test_a_ranked_entity_has_a_url_and_an_unranked_one_has_none(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with scoped(migrated, "superuser") as db:
        own = await _seeded(db, alpha)

        for rank, url in ((3, None), (None, 7)):
            async with refused(db, asyncpg.CheckViolationError):
                await db.execute(
                    "INSERT INTO seo.domain_rank_observations (serp_snapshot_id, observed_at, "
                    "observed_date, workspace_id, project_id, tracked_keyword_id, entity_id, "
                    "role, organic_rank, ranking_url_id, depth_requested) VALUES ($1, $2, "
                    "current_date, $3, $4, $5, $6, 'competitor', $7, $8, 20)",
                    own.snapshot_id,
                    own.observed_at,
                    alpha.workspace_id,
                    alpha.project_id,
                    own.tracked_id,
                    uuid.uuid4(),
                    rank,
                    url,
                )


async def test_the_state_and_the_current_results_belong_to_the_keywords_workspace(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, beta = tenants
    async with scoped(migrated, "superuser") as db:
        own = await _seeded(db, alpha)
        other = await _seeded(db, beta)

        # A second state row for the keyword is refused, and so is one for a keyword of another
        # workspace.
        async with refused(db, asyncpg.UniqueViolationError):
            await db.execute(
                "INSERT INTO seo.tracked_keyword_state (tracked_keyword_id, workspace_id, "
                "project_id) VALUES ($1, $2, $3)",
                own.tracked_id,
                alpha.workspace_id,
                alpha.project_id,
            )
        async with refused(db, asyncpg.ForeignKeyViolationError):
            await db.execute(
                "INSERT INTO seo.serp_current_results (tracked_keyword_id, workspace_id, "
                "project_id, organic_rank, serp_snapshot_id, url_id, domain_id) "
                "SELECT $1, $2, $3, 2, 1, url_id, domain_id FROM seo.serp_current_results "
                "WHERE workspace_id = $2 LIMIT 1",
                other.tracked_id,
                alpha.workspace_id,
                alpha.project_id,
            )


async def test_an_event_has_a_known_type(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with scoped(migrated, "superuser") as db:
        own = await _seeded(db, alpha)

        async with refused(db, asyncpg.CheckViolationError):
            await db.execute(
                "INSERT INTO seo.rank_events (occurred_at, workspace_id, project_id, "
                "tracked_keyword_id, entity_id, event_type, serp_snapshot_id) "
                "VALUES ($1, $2, $3, $4, $5, 'rank_wobble', $6)",
                own.observed_at,
                alpha.workspace_id,
                alpha.project_id,
                own.tracked_id,
                uuid.uuid4(),
                own.snapshot_id,
            )


async def test_the_observation_tables_are_partitioned_by_month_and_registered(
    migrated: PostgresServer,
) -> None:
    async with connection(migrated) as db:
        month = datetime.now(UTC).strftime("%Y%m")
        for table in PARTITIONED:
            current = await db.fetchval("SELECT to_regclass($1)", f"{table}_p{month}")
            registered = await db.fetchval(
                "SELECT count(*) FROM ops.partitioned_tables WHERE parent = $1::regclass", table
            )
            assert current is not None, table
            assert registered == 1, table


async def test_a_snapshot_outside_the_partitions_is_refused(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with scoped(migrated, "superuser") as db:
        own = await _seeded(db, alpha)

        async with refused(db, asyncpg.CheckViolationError, match="partition"):
            await _insert_snapshot(
                db,
                workspace_id=alpha.workspace_id,
                project_id=alpha.project_id,
                tracked_id=own.tracked_id,
                raw_payload_id=own.raw_payload_id,
                observed_at=datetime.now(UTC) - timedelta(days=900),
            )


async def test_the_feature_types_and_the_serp_prices_are_seeded(migrated: PostgresServer) -> None:
    async with connection(migrated) as db:
        types = {
            row["code"]: row["ownable"]
            for row in await db.fetch("SELECT code, ownable FROM seo.serp_feature_types")
        }
        prices = await db.fetch(
            "SELECT price_unit, unit_price_usd FROM ops.provider_price_book "
            "WHERE provider_code = 'dataforseo' AND endpoint = 'serp/google/organic' "
            "ORDER BY unit_price_usd, price_unit"
        )

    # The seed; a type the provider added later (`other:<type>`) may be there from other tests.
    types = {code: ownable for code, ownable in types.items() if not code.startswith("other:")}
    assert len(types) == 16
    assert types["ai_overview"] is True
    assert types["related_searches"] is False
    assert [(row["price_unit"], row["unit_price_usd"]) for row in prices] == [
        ("page", Decimal("0.00060000")),
        ("task", Decimal("0.00060000")),
        ("page", Decimal("0.00120000")),
        ("page", Decimal("0.00200000")),
    ]


async def test_the_worker_can_add_a_feature_type_it_does_not_know(
    migrated: PostgresServer,
) -> None:
    async with scoped(migrated, "app_worker") as db:
        await db.execute(
            "INSERT INTO seo.serp_feature_types (code, label, ownable) "
            "VALUES ('other:new_thing', 'new_thing', false)"
        )
        async with refused(db, asyncpg.InsufficientPrivilegeError):
            await db.execute("DELETE FROM seo.serp_feature_types WHERE code = 'images'")


async def test_the_raw_payload_of_a_snapshot_is_read_through_its_own_workspace_only(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, beta = tenants
    async with connection(migrated) as db:
        own = await _seeded(db, alpha)
        key = await db.fetchval(
            "SELECT object_key FROM ops.raw_payloads WHERE id = $1", own.raw_payload_id
        )

    async with scoped(migrated, "app_api", workspace_id=alpha.workspace_id) as db:
        found = await db.fetch("SELECT * FROM seo.serp_snapshot_raw($1)", own.snapshot_id)
        async with refused(db, asyncpg.InsufficientPrivilegeError):
            await db.fetch("SELECT * FROM ops.raw_payloads")
    async with scoped(migrated, "app_api", workspace_id=beta.workspace_id) as db:
        other = await db.fetch("SELECT * FROM seo.serp_snapshot_raw($1)", own.snapshot_id)
    async with (
        scoped(migrated, "app_worker", workspace_id=alpha.workspace_id) as db,
        refused(db, asyncpg.InsufficientPrivilegeError),
    ):
        await db.fetch("SELECT * FROM seo.serp_snapshot_raw($1)", own.snapshot_id)

    assert [(row["object_key"], row["retention_class"]) for row in found] == [(key, "serp_raw")]
    assert other == []


def test_schedules_of_the_rank_workload_start_at_their_next_window(
    pg: PostgresServer,
) -> None:
    """Review log F72: a `seo_rank` schedule made before the workload existed has its
    `next_run_at` moved to now when the rank tables arrive, and nothing else is touched."""
    name = f"rank_{uuid.uuid4().hex[:8]}"
    asyncio.run(pg.create_database(name))
    url = pg.url("migrator", name)
    config = alembic_config(url)
    command.upgrade(config, "0012")

    async def seed() -> list[uuid.UUID]:
        db = await asyncpg.connect(url)
        try:
            workspace = await db.fetchval(
                "INSERT INTO auth.workspaces (name, slug) VALUES ('w', $1) RETURNING id", name
            )
            project = await db.fetchval(
                "INSERT INTO core.projects (workspace_id, name, slug) VALUES ($1, 'p', 'p') "
                "RETURNING id",
                workspace,
            )
            ids: list[uuid.UUID] = []
            for workload, deleted in (
                ("seo_rank", False),
                ("keyword_metrics", False),
                ("seo_rank", True),
            ):
                ids.append(
                    await db.fetchval(
                        "INSERT INTO ops.schedules (workspace_id, project_id, workload, name, "
                        "cadence, timezone, next_run_at, deleted_at) VALUES ($1, $2, $3, $4, "
                        "'daily', 'UTC', now() - interval '5 days', "
                        "CASE WHEN $5 THEN now() END) RETURNING id",
                        workspace,
                        project,
                        workload,
                        f"{workload}-{deleted}",
                        deleted,
                    )
                )
            return ids
        finally:
            await db.close()

    rank, metrics, deleted = asyncio.run(seed())
    command.upgrade(config, "0013")

    async def read() -> dict[uuid.UUID, bool]:
        db = await asyncpg.connect(url)
        try:
            rows = await db.fetch(
                "SELECT id, next_run_at > now() - interval '1 hour' AS fresh FROM ops.schedules"
            )
            return {row["id"]: row["fresh"] for row in rows}
        finally:
            await db.close()

    assert asyncio.run(read()) == {rank: True, metrics: False, deleted: False}
