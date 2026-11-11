"""The rules the AI tables keep by themselves (docs/04-data-model.md section 8; migration 0018)."""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import asyncpg
import pytest
from alembic import command

from idraft.db.migrate import alembic_config
from idraft.domain.ai_engines import BASE_PLAN, ENGINES
from tests.conftest import PostgresServer
from tests.db.support import Tenant, connection, insert_prompt, scoped, seed_tenant
from tests.db.test_rank_schema import refused

type Db = asyncpg.Connection[asyncpg.Record]

PARTITIONED = ("ai.observations", "ai.citations", "ai.entity_mentions", "ai.observation_facts")


@pytest.fixture
async def tenants(migrated: PostgresServer) -> tuple[Tenant, Tenant]:
    return await seed_tenant(migrated, "alpha"), await seed_tenant(migrated, "beta")


async def _answer(
    db: Db, tenant: Tenant, *, observed_at: datetime | None = None, task_id: int | None = None
) -> int:
    """Another answer to the tenant's seeded prompt, on its seeded raw payload."""
    answer_id: int = await db.fetchval(
        "INSERT INTO ai.observations (observed_at, observed_date, workspace_id, project_id, "
        "engine_code, observation_class, prompt_id, prompt_version_id, collection_task_id, "
        "query_text, provider_code, provider_endpoint, status, has_citations, raw_payload_id, "
        "adapter_version, normalizer_version, canonicalizer_version) "
        "SELECT COALESCE($1::timestamptz, now()), current_date, p.workspace_id, p.project_id, "
        "'chatgpt_web', 'consumer_ui', p.id, p.current_version_id, $2::bigint, 'best crm', "
        "'dataforseo', 'ai_optimization/chat_gpt/llm_scraper', 'complete', false, "
        "(SELECT raw_payload_id FROM ai.observations WHERE workspace_id = $3 LIMIT 1), 1, 1, 1 "
        "FROM ai.prompts p WHERE p.workspace_id = $3 LIMIT 1 RETURNING id",
        observed_at,
        task_id,
        tenant.workspace_id,
    )
    return answer_id


async def test_the_answer_tables_are_partitioned_by_month_and_registered(
    migrated: PostgresServer,
) -> None:
    month = datetime.now(UTC).strftime("%Y%m")
    async with connection(migrated) as db:
        for table in PARTITIONED:
            current = await db.fetchval("SELECT to_regclass($1)", f"{table}_p{month}")
            registered = await db.fetchval(
                "SELECT count(*) FROM ops.partitioned_tables WHERE parent = $1::regclass", table
            )
            assert current is not None, table
            assert registered == 1, table


async def test_the_engines_are_seeded_as_the_code_knows_them(migrated: PostgresServer) -> None:
    async with connection(migrated) as db:
        rows = await db.fetch(
            "SELECT code, label, observation_class, vendor, exposes_citations, exposes_fanout, "
            "is_active FROM ai.engines"
        )
    assert {row["code"]: tuple(row)[1:] for row in rows} == {
        engine.code.value: (
            engine.label,
            engine.observation_class.value,
            engine.vendor,
            engine.exposes_citations,
            engine.exposes_fanout,
            True,
        )
        for engine in ENGINES.values()
    }


async def test_each_engine_has_a_task_price_on_both_queues(migrated: PostgresServer) -> None:
    endpoints = [engine.endpoint for engine in ENGINES.values()]
    async with connection(migrated) as db:
        rows = await db.fetch(
            "SELECT endpoint, price_unit, unit_price_usd, conditions->>'queue' AS queue "
            "FROM ops.provider_price_book WHERE provider_code = 'dataforseo' "
            "AND endpoint = ANY($1)",
            endpoints,
        )
    assert {
        (row["endpoint"], row["queue"]): (row["price_unit"], row["unit_price_usd"]) for row in rows
    } == {
        (endpoint, queue): ("task", price)
        for endpoint in endpoints
        for queue, price in (("standard", Decimal("0.0012")), ("priority", Decimal("0.0024")))
    }


async def test_a_new_workspace_gets_the_base_plans_prompt_limit(
    migrated: PostgresServer,
) -> None:
    async with connection(migrated) as db:
        workspace = await db.fetchval(
            "INSERT INTO auth.workspaces (name, slug) VALUES ('q', $1) RETURNING id",
            f"q-{uuid.uuid4().hex[:8]}",
        )
        await db.execute("INSERT INTO core.workspace_quotas (workspace_id) VALUES ($1)", workspace)
        limit = await db.fetchval(
            "SELECT max_active_prompts FROM core.workspace_quotas WHERE workspace_id = $1",
            workspace,
        )
    assert limit == BASE_PLAN.max_prompts == 150


def test_quotas_at_the_old_default_move_to_the_base_plan(pg: PostgresServer) -> None:
    """A quota still at the old default of 1,000 becomes 150; one a person set stays."""
    name = f"ai_{uuid.uuid4().hex[:8]}"
    asyncio.run(pg.create_database(name))
    url = pg.url("migrator", name)
    config = alembic_config(url)
    command.upgrade(config, "0017")

    async def seed() -> dict[uuid.UUID, int]:
        db = await asyncpg.connect(url)
        try:
            limits: dict[uuid.UUID, int] = {}
            for label, limit in (("old", 1000), ("set", 500)):
                workspace: uuid.UUID = await db.fetchval(
                    "INSERT INTO auth.workspaces (name, slug) "
                    "VALUES ($1::text, $1::text) RETURNING id",
                    label,
                )
                await db.execute(
                    "INSERT INTO core.workspace_quotas (workspace_id, max_active_prompts) "
                    "VALUES ($1, $2)",
                    workspace,
                    limit,
                )
                limits[workspace] = limit
            return limits
        finally:
            await db.close()

    before = asyncio.run(seed())
    command.upgrade(config, "0018")

    async def read() -> dict[uuid.UUID, int]:
        db = await asyncpg.connect(url)
        try:
            rows = await db.fetch(
                "SELECT workspace_id, max_active_prompts FROM core.workspace_quotas"
            )
            return {row["workspace_id"]: row["max_active_prompts"] for row in rows}
        finally:
            await db.close()

    old, kept = before
    assert asyncio.run(read()) == {old: 150, kept: 500}


async def test_a_prompts_current_version_is_one_of_its_own(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with scoped(migrated, "superuser") as db:
        prompt_id, _ = await insert_prompt(db, alpha.workspace_id, alpha.project_id, "first?")
        _, other_version = await insert_prompt(db, alpha.workspace_id, alpha.project_id, "second?")
        # The key is checked at commit; this transaction never commits, so check it now.
        await db.execute("SET CONSTRAINTS ALL IMMEDIATE")

        async with refused(db, asyncpg.ForeignKeyViolationError):
            await db.execute(
                "UPDATE ai.prompts SET current_version_id = $1 WHERE id = $2",
                other_version,
                prompt_id,
            )


async def test_a_prompt_names_a_term_of_its_own_workspace(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, beta = tenants
    async with scoped(migrated, "superuser") as db:
        prompt_id = await db.fetchval(
            "SELECT id FROM ai.prompts WHERE workspace_id = $1 LIMIT 1", alpha.workspace_id
        )
        foreign_term = await db.fetchval(
            "SELECT id FROM core.taxonomy_terms WHERE workspace_id = $1 LIMIT 1",
            beta.workspace_id,
        )

        async with refused(db, asyncpg.ForeignKeyViolationError):
            await db.execute(
                "INSERT INTO ai.prompt_terms (prompt_id, term_id, workspace_id) "
                "VALUES ($1, $2, $3)",
                prompt_id,
                foreign_term,
                alpha.workspace_id,
            )


async def test_what_was_found_in_an_answer_stays_in_its_workspace(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, beta = tenants
    async with scoped(migrated, "superuser") as db:
        answer = await db.fetchrow(
            "SELECT id, observed_at FROM ai.observations WHERE workspace_id = $1",
            alpha.workspace_id,
        )
        assert answer is not None
        foreign_derivation = await db.fetchval(
            "SELECT id FROM ai.derivations WHERE workspace_id = $1", beta.workspace_id
        )
        url = await db.fetchrow("SELECT id, domain_id FROM core.urls ORDER BY id LIMIT 1")
        assert url is not None

        async with refused(db, asyncpg.ForeignKeyViolationError):
            await db.execute(
                "INSERT INTO ai.citations (observation_id, observed_at, citation_index, "
                "workspace_id, project_id, engine_code, url_id, domain_id, raw_url, "
                "citation_kind, domain_role) VALUES ($1, $2, 9, $3, $4, 'chatgpt_web', $5, $6, "
                "'https://example.com/', 'source_list', 'third_party')",
                answer["id"],
                answer["observed_at"],
                beta.workspace_id,
                beta.project_id,
                url["id"],
                url["domain_id"],
            )
        async with refused(db, asyncpg.ForeignKeyViolationError):
            await db.execute(
                "INSERT INTO ai.entity_mentions (observation_id, observed_at, entity_id, "
                "derivation_id, workspace_id, project_id, engine_code, role, mention_count, "
                "first_char_offset, mention_order, prominence, match_method, confidence, "
                "evidence_spans) VALUES ($1, $2, $3, $4, $5, $6, 'chatgpt_web', 'competitor', 1, "
                "0, 2, 1, 'alias_word', 1, ARRAY['[0,4)'::int4range])",
                answer["id"],
                answer["observed_at"],
                uuid.uuid4(),
                foreign_derivation,
                alpha.workspace_id,
                alpha.project_id,
            )


async def test_a_task_has_one_answer_however_often_it_is_ingested(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    observed = datetime.now(UTC)
    async with scoped(migrated, "superuser") as db:
        await _answer(db, alpha, observed_at=observed, task_id=4242)

        async with refused(db, asyncpg.UniqueViolationError):
            await _answer(db, alpha, observed_at=observed, task_id=4242)


async def test_an_answer_outside_the_partitions_is_refused(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, _ = tenants
    async with (
        scoped(migrated, "superuser") as db,
        refused(db, asyncpg.CheckViolationError, match="partition"),
    ):
        await _answer(db, alpha, observed_at=datetime.now(UTC) - timedelta(days=900))


_UNORDERED_MENTION = (
    "INSERT INTO ai.entity_mentions (observation_id, observed_at, entity_id, derivation_id, "
    "workspace_id, project_id, engine_code, role, mention_count, first_char_offset, "
    "mention_order, prominence, match_method, mention_status, confidence, evidence_spans) "
    "VALUES ($1, $2, $3, $4, $5, $6, 'chatgpt_web', 'competitor', 1, 0, NULL, 1, "
    "'alias_word', 'uncertain', 0.5, ARRAY['[0,4)'::int4range])"
)


async def test_a_mention_without_an_order_is_kept(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    """Uncertain mentions, watch entities and products have no place in the order (migration
    0019); the answer tables still refuse a row outside their partitions."""
    alpha, _ = tenants
    async with scoped(migrated, "superuser") as db:
        answer = await db.fetchrow(
            "SELECT observation_id, observed_at, derivation_id FROM ai.observation_facts "
            "WHERE workspace_id = $1",
            alpha.workspace_id,
        )
        assert answer is not None
        await db.execute(
            _UNORDERED_MENTION,
            answer["observation_id"],
            answer["observed_at"],
            uuid.uuid4(),
            answer["derivation_id"],
            alpha.workspace_id,
            alpha.project_id,
        )
        order = await db.fetchval(
            "SELECT mention_order FROM ai.entity_mentions WHERE observation_id = $1 "
            "AND mention_status = 'uncertain'",
            answer["observation_id"],
        )
        assert order is None

        async with refused(db, asyncpg.CheckViolationError, match="partition"):
            await db.execute(
                _UNORDERED_MENTION,
                answer["observation_id"],
                datetime.now(UTC) - timedelta(days=900),
                uuid.uuid4(),
                answer["derivation_id"],
                alpha.workspace_id,
                alpha.project_id,
            )


async def test_the_raw_payload_of_an_answer_is_read_through_its_own_workspace_only(
    migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    alpha, beta = tenants
    async with connection(migrated) as db:
        own = await db.fetchval(
            "SELECT id FROM ai.observations WHERE workspace_id = $1", alpha.workspace_id
        )
        key = await db.fetchval(
            "SELECT r.object_key FROM ai.observations o "
            "JOIN ops.raw_payloads r ON r.id = o.raw_payload_id WHERE o.id = $1",
            own,
        )
    async with scoped(migrated, "app_api", workspace_id=alpha.workspace_id) as db:
        found = await db.fetch(
            "SELECT object_key, retention_class FROM ai.observation_raw($1)", own
        )
    async with scoped(migrated, "app_api", workspace_id=beta.workspace_id) as db:
        other = await db.fetch("SELECT * FROM ai.observation_raw($1)", own)

    assert [(row["object_key"], row["retention_class"]) for row in found] == [(key, "ai_raw")]
    assert other == []
