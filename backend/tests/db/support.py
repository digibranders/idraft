"""Helpers for tests that talk to PostgreSQL as a specific role."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

import asyncpg

from tests.conftest import PostgresServer

SCHEMAS = ["auth", "core", "seo", "ai", "fp", "ops"]

# table -> the column that names its workspace. Kept in step with the catalog by test_rls.py.
TENANT_TABLES: dict[str, str] = {
    "auth.workspaces": "id",
    "auth.memberships": "workspace_id",
    "auth.invitations": "workspace_id",
    "auth.api_keys": "workspace_id",
    "core.projects": "workspace_id",
    "core.workspace_quotas": "workspace_id",
    "core.entities": "workspace_id",
    "core.entity_aliases": "workspace_id",
    "core.entity_domains": "workspace_id",
    "core.project_entities": "workspace_id",
    "core.taxonomy_vocabularies": "workspace_id",
    "core.taxonomy_terms": "workspace_id",
    "ops.budgets": "workspace_id",
    "ops.schedules": "workspace_id",
    "ops.collection_runs": "workspace_id",
    "ops.collection_tasks": "workspace_id",
    "ops.provider_cost_events": "workspace_id",
    "ops.cost_daily": "workspace_id",
    "ops.audit_logs": "workspace_id",
    "seo.keywords": "workspace_id",
    "seo.tracked_keywords": "workspace_id",
    "seo.tracked_keyword_config_history": "workspace_id",
    "seo.keyword_groups": "workspace_id",
    "seo.keyword_group_members": "workspace_id",
    "seo.tracked_keyword_terms": "workspace_id",
    "seo.tracked_keyword_competitors": "workspace_id",
    "seo.keyword_metric_snapshots": "workspace_id",
    "seo.keyword_metrics_current": "workspace_id",
    "seo.keyword_imports": "workspace_id",
    "seo.keyword_import_rows": "workspace_id",
    "seo.serp_snapshots": "workspace_id",
    "seo.serp_features": "workspace_id",
    "seo.domain_rank_observations": "workspace_id",
    "seo.tracked_keyword_state": "workspace_id",
    "seo.serp_current_results": "workspace_id",
    "seo.rank_events": "workspace_id",
    "ops.secrets": "workspace_id",
    "fp.connections": "workspace_id",
    "fp.integrations": "workspace_id",
    "fp.gsc_queries": "workspace_id",
    "fp.gsc_search_analytics": "workspace_id",
    "ai.project_engines": "workspace_id",
    "ai.prompts": "workspace_id",
    "ai.prompt_versions": "workspace_id",
    "ai.prompt_terms": "workspace_id",
    "ai.derivations": "workspace_id",
    "ai.observations": "workspace_id",
    "ai.citations": "workspace_id",
    "ai.entity_mentions": "workspace_id",
    "ai.observation_facts": "workspace_id",
}


@asynccontextmanager
async def connection(
    pg: PostgresServer, role: str = "superuser"
) -> AsyncIterator[asyncpg.Connection[asyncpg.Record]]:
    connected = await asyncpg.connect(pg.url(role))
    try:
        yield connected
    finally:
        await connected.close()


@asynccontextmanager
async def scoped(
    pg: PostgresServer,
    role: str,
    *,
    workspace_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
) -> AsyncIterator[asyncpg.Connection[asyncpg.Record]]:
    """A transaction as `role` with the tenant settings the API would set. Always rolled back."""
    async with connection(pg, role) as connected:
        transaction = connected.transaction()
        await transaction.start()
        try:
            if workspace_id is not None:
                await connected.execute(
                    "SELECT set_config('app.workspace_id', $1, true)", str(workspace_id)
                )
            if user_id is not None:
                await connected.execute("SELECT set_config('app.user_id', $1, true)", str(user_id))
            yield connected
        finally:
            await transaction.rollback()


@dataclass(frozen=True)
class Tenant:
    workspace_id: uuid.UUID
    owner_id: uuid.UUID
    project_id: uuid.UUID
    invitation_token_hash: bytes
    schedule_id: uuid.UUID
    run_id: uuid.UUID


async def create_user(connected: asyncpg.Connection[Any], label: str) -> uuid.UUID:
    user_id: uuid.UUID = await connected.fetchval(
        "INSERT INTO auth.users (email, name, password_hash) VALUES ($1, $2, 'argon2id$test') "
        "RETURNING id",
        f"{label}-{uuid.uuid4().hex[:8]}@example.com",
        label,
    )
    return user_id


async def add_member(
    connected: asyncpg.Connection[Any], workspace_id: uuid.UUID, user_id: uuid.UUID, role: str
) -> None:
    await connected.execute(
        "INSERT INTO auth.memberships (workspace_id, user_id, role) VALUES ($1, $2, $3)",
        workspace_id,
        user_id,
        role,
    )


async def seed_tenant(pg: PostgresServer, label: str) -> Tenant:
    """One workspace with one row in every tenant table, written by the superuser."""
    suffix = uuid.uuid4().hex[:8]
    token_hash = uuid.uuid4().bytes + uuid.uuid4().bytes
    async with connection(pg) as db:
        owner_id = await create_user(db, f"{label}-owner")
        workspace_id: uuid.UUID = await db.fetchval(
            "INSERT INTO auth.workspaces (name, slug) VALUES ($1, $2) RETURNING id",
            label,
            f"{label}-{suffix}",
        )
        await add_member(db, workspace_id, owner_id, "owner")
        await db.execute(
            "INSERT INTO auth.invitations (workspace_id, email, role, token_hash, invited_by, "
            "expires_at) VALUES ($1, $2, 'viewer', $3, $4, now() + interval '7 days')",
            workspace_id,
            f"invitee-{suffix}@example.com",
            token_hash,
            owner_id,
        )
        await db.execute(
            "INSERT INTO auth.api_keys (workspace_id, name, prefix, key_hash, scopes, created_by) "
            "VALUES ($1, 'ci', $2, $3, '{}', $4)",
            workspace_id,
            suffix,
            token_hash,
            owner_id,
        )
        project_id: uuid.UUID = await db.fetchval(
            "INSERT INTO core.projects (workspace_id, name, slug, created_by) "
            "VALUES ($1, $2, 'main', $3) RETURNING id",
            workspace_id,
            f"{label} project",
            owner_id,
        )
        await db.execute(
            "INSERT INTO core.workspace_quotas (workspace_id) VALUES ($1)", workspace_id
        )
        entity_id, term_id = await seed_vocabulary(db, workspace_id, project_id, label)
        schedule_id, run_id = await seed_operations(db, workspace_id, project_id)
        await seed_keywords(db, workspace_id, project_id, owner_id, entity_id, term_id)
        await seed_search_console(db, workspace_id, project_id, owner_id)
        await seed_ai(db, workspace_id, project_id, owner_id, entity_id, term_id)
    return Tenant(workspace_id, owner_id, project_id, token_hash, schedule_id, run_id)


async def seed_vocabulary(
    db: asyncpg.Connection[Any], workspace_id: uuid.UUID, project_id: uuid.UUID, label: str
) -> tuple[uuid.UUID, uuid.UUID]:
    """One row in every entity and taxonomy table: an own brand with an alias and a domain,
    and a topic with one term. Returns the entity and the term."""
    entity_id: uuid.UUID = await db.fetchval(
        "INSERT INTO core.entities (workspace_id, entity_type, canonical_name) "
        "VALUES ($1, 'brand', $2) RETURNING id",
        workspace_id,
        f"{label} brand",
    )
    await db.execute(
        "INSERT INTO core.entity_aliases (workspace_id, entity_id, alias) VALUES ($1, $2, $3)",
        workspace_id,
        entity_id,
        label,
    )
    domain_id: int = await db.fetchval(
        "INSERT INTO core.domains (host, registrable_domain, public_suffix) "
        "VALUES ($1, $1, 'com') ON CONFLICT (host) DO UPDATE SET host = excluded.host "
        "RETURNING id",
        f"{label}-{uuid.uuid4().hex[:8]}.com",
    )
    await db.execute(
        "INSERT INTO core.entity_domains (entity_id, workspace_id, domain_id) VALUES ($1, $2, $3)",
        entity_id,
        workspace_id,
        domain_id,
    )
    await db.execute(
        "INSERT INTO core.project_entities (project_id, entity_id, workspace_id, role, is_primary) "
        "VALUES ($1, $2, $3, 'own', true)",
        project_id,
        entity_id,
        workspace_id,
    )
    vocabulary_id: uuid.UUID = await db.fetchval(
        "INSERT INTO core.taxonomy_vocabularies (workspace_id, kind, name) "
        "VALUES ($1, 'topic', 'Topics') RETURNING id",
        workspace_id,
    )
    term_id: uuid.UUID = await db.fetchval(
        "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, name, slug, path) "
        "VALUES ($1, $2, 'CRM', 'crm', 'crm') RETURNING id",
        workspace_id,
        vocabulary_id,
    )
    return entity_id, term_id


SEED_LOCATION = 2840


async def seed_keywords(
    db: asyncpg.Connection[Any],
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    owner_id: uuid.UUID,
    entity_id: uuid.UUID,
    term_id: uuid.UUID,
) -> None:
    """One row in every keyword table: a tracked keyword in a group, with a term, a competitor
    override, its config history and a metrics snapshot, and an import with one row."""
    await db.execute(
        "INSERT INTO core.locations (id, name, country_iso, location_type) "
        "VALUES ($1, 'United States', 'US', 'Country') ON CONFLICT (id) DO NOTHING",
        SEED_LOCATION,
    )
    keyword_id: uuid.UUID = await db.fetchval(
        "INSERT INTO seo.keywords (workspace_id, text, normalized_text, language_code) "
        "VALUES ($1, 'CRM Software', 'crm software', 'en') RETURNING id",
        workspace_id,
    )
    tracked_id: uuid.UUID = await db.fetchval(
        "INSERT INTO seo.tracked_keywords (workspace_id, project_id, keyword_id, location_id, "
        "language_code, device, created_by) VALUES ($1, $2, $3, $4, 'en', 'desktop', $5) "
        "RETURNING id",
        workspace_id,
        project_id,
        keyword_id,
        SEED_LOCATION,
        owner_id,
    )
    await db.execute(
        "INSERT INTO seo.tracked_keyword_config_history (tracked_keyword_id, workspace_id, "
        "config_version, depth_profile, valid_from) VALUES ($1, $2, 1, 'standard', now())",
        tracked_id,
        workspace_id,
    )
    group_id: uuid.UUID = await db.fetchval(
        "INSERT INTO seo.keyword_groups (workspace_id, project_id, name, path) "
        "VALUES ($1, $2, 'Product', 'Product') RETURNING id",
        workspace_id,
        project_id,
    )
    await db.execute(
        "INSERT INTO seo.keyword_group_members (group_id, tracked_keyword_id, project_id, "
        "workspace_id) VALUES ($1, $2, $3, $4)",
        group_id,
        tracked_id,
        project_id,
        workspace_id,
    )
    await db.execute(
        "INSERT INTO seo.tracked_keyword_terms (tracked_keyword_id, term_id, workspace_id) "
        "VALUES ($1, $2, $3)",
        tracked_id,
        term_id,
        workspace_id,
    )
    await db.execute(
        "INSERT INTO seo.tracked_keyword_competitors (tracked_keyword_id, entity_id, "
        "workspace_id, mode) VALUES ($1, $2, $3, 'exclude')",
        tracked_id,
        entity_id,
        workspace_id,
    )
    snapshot_id: int = await db.fetchval(
        "INSERT INTO seo.keyword_metric_snapshots (workspace_id, keyword_id, location_id, "
        "language_code, source, fetched_at, search_volume, is_material_change) "
        "VALUES ($1, $2, $3, 'en', 'dataforseo_labs', now(), 1900, true) RETURNING id",
        workspace_id,
        keyword_id,
        SEED_LOCATION,
    )
    await db.execute(
        "INSERT INTO seo.keyword_metrics_current (keyword_id, location_id, language_code, "
        "source, workspace_id, snapshot_id, search_volume, fetched_at) "
        "VALUES ($1, $2, 'en', 'dataforseo_labs', $3, $4, 1900, now())",
        keyword_id,
        SEED_LOCATION,
        workspace_id,
        snapshot_id,
    )
    import_id: uuid.UUID = await db.fetchval(
        "INSERT INTO seo.keyword_imports (workspace_id, project_id, source, status, created_by, "
        "expires_at) VALUES ($1, $2, 'paste', 'preview_ready', $3, now() + interval '7 days') "
        "RETURNING id",
        workspace_id,
        project_id,
        owner_id,
    )
    await db.execute(
        "INSERT INTO seo.keyword_import_rows (import_id, row_no, workspace_id, raw, outcome, "
        "action) VALUES ($1, 1, $2, '{\"keyword\": \"crm\"}', 'new', 'create')",
        import_id,
        workspace_id,
    )
    await seed_rank(db, workspace_id, project_id, tracked_id, entity_id)


async def seed_rank(
    db: asyncpg.Connection[Any],
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    tracked_id: uuid.UUID,
    entity_id: uuid.UUID,
) -> int:
    """One row in every rank table: a snapshot of the keyword's SERP with a feature, the own
    entity's observation, the keyword's state, a current result and an event. Returns the
    snapshot's id."""
    raw_payload_id: int = await db.fetchval(
        "INSERT INTO ops.raw_payloads (storage, object_key, sha256, bytes_raw, bytes_stored, "
        "compression, content_type, provider_code, provider_endpoint, fetched_at, "
        "retention_class, expires_at) VALUES ('r2', $1, $2, 10, 10, 'zstd', "
        "'application/json', 'dataforseo', 'serp/google/organic/task_get/advanced', now(), "
        "'serp_raw', now() + interval '400 days') RETURNING id",
        f"serp_raw/{uuid.uuid4().hex}",
        uuid.uuid4().bytes + uuid.uuid4().bytes,
    )
    domain_id: int = await db.fetchval("SELECT id FROM core.domains ORDER BY id LIMIT 1")
    url_id: int = await db.fetchval(
        "INSERT INTO core.urls (url_hash, canonical_url, domain_id, path, canonicalizer_version) "
        "VALUES ($1, 'https://example.com/crm', $2, '/crm', 1) RETURNING id",
        uuid.uuid4().bytes + uuid.uuid4().bytes,
        domain_id,
    )
    observed_at = await db.fetchval("SELECT now()")
    snapshot_id: int = await db.fetchval(
        "INSERT INTO seo.serp_snapshots (observed_at, observed_date, workspace_id, project_id, "
        "tracked_keyword_id, config_version, provider_code, provider_endpoint, location_id, "
        "language_code, device, depth_requested, depth_returned, item_types, organic_url_ids, "
        "organic_domain_ids, organic_abs_positions, has_ai_overview, ai_overview_state, "
        "raw_payload_id, parser_version, canonicalizer_version) VALUES ($1, current_date, $2, $3, "
        "$4, 1, 'dataforseo', 'serp/google/organic/task_get/advanced', $5, 'en', 'desktop', 20, "
        "1, '{organic,featured_snippet}', ARRAY[$6::bigint], ARRAY[$7::integer], "
        "ARRAY[1::smallint], false, 'absent', $8, 1, 1) RETURNING id",
        observed_at,
        workspace_id,
        project_id,
        tracked_id,
        SEED_LOCATION,
        url_id,
        domain_id,
        raw_payload_id,
    )
    await db.execute(
        "INSERT INTO seo.serp_features (observed_at, serp_snapshot_id, workspace_id, project_id, "
        "tracked_keyword_id, feature_type, ordinal, owned_by_project, parser_version) "
        "VALUES ($1, $2, $3, $4, $5, 'featured_snippet', 1, false, 1)",
        observed_at,
        snapshot_id,
        workspace_id,
        project_id,
        tracked_id,
    )
    await db.execute(
        "INSERT INTO seo.domain_rank_observations (serp_snapshot_id, observed_at, observed_date, "
        "workspace_id, project_id, tracked_keyword_id, entity_id, role, depth_requested) "
        "VALUES ($1, $2, current_date, $3, $4, $5, $6, 'own', 20)",
        snapshot_id,
        observed_at,
        workspace_id,
        project_id,
        tracked_id,
        entity_id,
    )
    await db.execute(
        "INSERT INTO seo.tracked_keyword_state (tracked_keyword_id, workspace_id, project_id, "
        "last_snapshot_id, last_observed_at) VALUES ($1, $2, $3, $4, $5)",
        tracked_id,
        workspace_id,
        project_id,
        snapshot_id,
        observed_at,
    )
    await db.execute(
        "INSERT INTO seo.serp_current_results (tracked_keyword_id, workspace_id, project_id, "
        "organic_rank, serp_snapshot_id, url_id, domain_id) VALUES ($1, $2, $3, 1, $4, $5, $6)",
        tracked_id,
        workspace_id,
        project_id,
        snapshot_id,
        url_id,
        domain_id,
    )
    await db.execute(
        "INSERT INTO seo.rank_events (occurred_at, workspace_id, project_id, tracked_keyword_id, "
        "entity_id, event_type, serp_snapshot_id) VALUES ($1, $2, $3, $4, $5, 'new_ranking', $6)",
        observed_at,
        workspace_id,
        project_id,
        tracked_id,
        entity_id,
        snapshot_id,
    )
    return snapshot_id


async def seed_search_console(
    db: asyncpg.Connection[Any],
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    owner_id: uuid.UUID,
) -> uuid.UUID:
    """One row in every Search Console table: a secret, the connection that holds it, a property
    linked to the project, a query and one day of numbers. Returns the integration's id."""
    secret_id: uuid.UUID = await db.fetchval(
        "INSERT INTO ops.secrets (workspace_id, kind, ciphertext, dek_wrapped, kek_version, "
        "fingerprint) VALUES ($1, 'oauth_refresh_token', $2, $3, 1, 'abcd') RETURNING id",
        workspace_id,
        b"ciphertext",
        b"wrapped",
    )
    connection_id: uuid.UUID = await db.fetchval(
        "INSERT INTO fp.connections (workspace_id, product, auth_method, subject_id, "
        "subject_label, credential_ref, scopes, connected_by) "
        "VALUES ($1, 'google', 'oauth', $2, 'person@example.com', $3, '{openid}', $4) RETURNING id",
        workspace_id,
        uuid.uuid4().hex,
        secret_id,
        owner_id,
    )
    integration_id: uuid.UUID = await db.fetchval(
        "INSERT INTO fp.integrations (workspace_id, project_id, kind, external_account, "
        "external_property, connection_id, scopes) "
        "VALUES ($1, $2, 'gsc', 'person@example.com', 'sc-domain:example.com', $3, '{openid}') "
        "RETURNING id",
        workspace_id,
        project_id,
        connection_id,
    )
    query_hash = uuid.uuid4().bytes + uuid.uuid4().bytes
    await db.execute(
        "INSERT INTO fp.gsc_queries (workspace_id, query_hash, query_text, normalized_text) "
        "VALUES ($1, $2, 'CRM Software', 'crm software')",
        workspace_id,
        query_hash,
    )
    await db.execute(
        "INSERT INTO fp.gsc_search_analytics (integration_id, metric_date, search_type, "
        "query_hash, url_id, country_iso3, device, workspace_id, project_id, clicks, "
        "impressions, position_sum, data_state) "
        "VALUES ($1, current_date, 'web', $2, 1, 'USA', 'DESKTOP', $3, $4, 3, 40, 120.5, 'final')",
        integration_id,
        query_hash,
        workspace_id,
        project_id,
    )
    return integration_id


async def seed_operations(
    db: asyncpg.Connection[Any], workspace_id: uuid.UUID, project_id: uuid.UUID
) -> tuple[uuid.UUID, uuid.UUID]:
    """One row in every tenant table of the ops schema."""
    await db.execute(
        "INSERT INTO ops.budgets (workspace_id, workload, limit_usd) VALUES ($1, 'all', 100)",
        workspace_id,
    )
    schedule_id: uuid.UUID = await db.fetchval(
        "INSERT INTO ops.schedules (workspace_id, project_id, workload, name, cadence, timezone, "
        "next_run_at) VALUES ($1, $2, 'seo_rank', 'Daily ranks', 'daily', 'UTC', now()) "
        "RETURNING id",
        workspace_id,
        project_id,
    )
    run_id: uuid.UUID = await db.fetchval(
        "INSERT INTO ops.collection_runs (workspace_id, project_id, schedule_id, workload, "
        "window_start, window_end, trigger, status, config_snapshot) "
        "VALUES ($1, $2, $3, 'seo_rank', now(), now() + interval '6 hours', 'schedule', "
        "'planned', '{}') RETURNING id",
        workspace_id,
        project_id,
        schedule_id,
    )
    await db.execute(
        "INSERT INTO ops.collection_tasks (run_id, workspace_id, project_id, workload, "
        "subject_type, subject_id, idempotency_key, request_fingerprint, provider_code, "
        "provider_endpoint, scheduled_for, status) VALUES ($1, $2, $3, 'seo_rank', "
        "'tracked_keyword', '1', $4, $4, 'dataforseo', 'serp_google_organic', now(), 'pending')",
        run_id,
        workspace_id,
        project_id,
        uuid.uuid4().bytes,
    )
    await db.execute(
        "INSERT INTO ops.provider_cost_events (occurred_at, workspace_id, project_id, "
        "provider_code, endpoint, workload, channel, cost_usd, cost_source, billing_period) "
        "VALUES (now(), $1, $2, 'dataforseo', 'serp_google_organic', 'seo_rank', 'seo', 0.0006, "
        "'provider_reported', date_trunc('month', now())::date)",
        workspace_id,
        project_id,
    )
    await db.execute(
        "INSERT INTO ops.cost_daily (cost_date, workspace_id, project_id, provider_code, "
        "endpoint, workload, request_count, cost_usd, subjects) "
        "VALUES (current_date, $1, $2, 'dataforseo', 'serp_google_organic', 'seo_rank', 1, "
        "0.0006, 1)",
        workspace_id,
        project_id,
    )
    await db.execute(
        "INSERT INTO ops.audit_logs (workspace_id, actor_type, actor_id, action, target_type, "
        "target_id) VALUES ($1, 'system', 'seed', 'project.create', 'project', $2)",
        workspace_id,
        str(project_id),
    )
    return schedule_id, run_id


async def insert_prompt(
    db: asyncpg.Connection[Any],
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    text: str,
    *,
    language_code: str = "en",
    country_iso: str = "US",
    is_active: bool = True,
    created_by: uuid.UUID | None = None,
) -> tuple[uuid.UUID, uuid.UUID]:
    """A prompt with its first version, as the API writes one: the version's key is checked
    at commit, so both rows go in one transaction (a savepoint inside an open one). `text`
    must already be trimmed and composed: its hash is taken as given. Returns the prompt's id
    and its version's."""
    ids = await db.fetchrow("SELECT uuidv7() AS prompt_id, uuidv7() AS version_id")
    assert ids is not None
    async with db.transaction():
        await db.execute(
            "INSERT INTO ai.prompts (id, workspace_id, project_id, current_version_id, "
            "language_code, country_iso, is_active, created_by) "
            "VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            ids["prompt_id"],
            workspace_id,
            project_id,
            ids["version_id"],
            language_code,
            country_iso,
            is_active,
            created_by,
        )
        await db.execute(
            "INSERT INTO ai.prompt_versions (id, workspace_id, prompt_id, version_no, text, "
            "text_hash, created_by, change_kind) "
            "VALUES ($1, $2, $3, 1, $4::text, sha256(convert_to($4::text, 'UTF8')), $5, "
            "'initial')",
            ids["version_id"],
            workspace_id,
            ids["prompt_id"],
            text,
            created_by,
        )
    prompt_id: uuid.UUID = ids["prompt_id"]
    version_id: uuid.UUID = ids["version_id"]
    return prompt_id, version_id


async def seed_ai(
    db: asyncpg.Connection[Any],
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    owner_id: uuid.UUID,
    entity_id: uuid.UUID,
    term_id: uuid.UUID,
) -> None:
    """One row in every AI table: ChatGPT on in the seeded country, a prompt with its first
    version and a term, and one answer with a citation, a mention of the own brand and its
    facts under a derivation."""
    await db.execute(
        "INSERT INTO ai.project_engines (project_id, engine_code, workspace_id, location_ids, "
        "provider_code) VALUES ($1, 'chatgpt_web', $2, ARRAY[$3::integer], 'dataforseo')",
        project_id,
        workspace_id,
        SEED_LOCATION,
    )
    prompt_id, version_id = await insert_prompt(
        db, workspace_id, project_id, "Which CRM suits a startup?", created_by=owner_id
    )
    await db.execute(
        "INSERT INTO ai.prompt_terms (prompt_id, term_id, workspace_id) VALUES ($1, $2, $3)",
        prompt_id,
        term_id,
        workspace_id,
    )
    derivation_id: int = await db.fetchval(
        "INSERT INTO ai.derivations (workspace_id, project_id, extractor_version, "
        "entity_config_version, recommendation_version, sentiment_version) "
        "VALUES ($1, $2, 1, 1, 1, 1) RETURNING id",
        workspace_id,
        project_id,
    )
    raw_payload_id: int = await db.fetchval(
        "INSERT INTO ops.raw_payloads (storage, object_key, sha256, bytes_raw, bytes_stored, "
        "compression, content_type, provider_code, provider_endpoint, fetched_at, "
        "retention_class) VALUES ('r2', $1, $2, 10, 10, 'zstd', 'application/json', "
        "'dataforseo', 'ai_optimization/chat_gpt/llm_scraper/task_get/advanced', now(), "
        "'ai_raw') RETURNING id",
        f"ai_raw/{uuid.uuid4().hex}",
        uuid.uuid4().bytes + uuid.uuid4().bytes,
    )
    observed_at = await db.fetchval("SELECT now()")
    observation_id: int = await db.fetchval(
        "INSERT INTO ai.observations (observed_at, observed_date, workspace_id, project_id, "
        "engine_code, observation_class, prompt_id, prompt_version_id, query_text, location_id, "
        "language_code, provider_code, provider_endpoint, status, answer_text, "
        "answer_char_count, has_citations, citation_count, raw_payload_id, adapter_version, "
        "normalizer_version, canonicalizer_version) VALUES ($1, current_date, $2, $3, "
        "'chatgpt_web', 'consumer_ui', $4, $5, 'Which CRM suits a startup?', $6, 'en', "
        "'dataforseo', 'ai_optimization/chat_gpt/llm_scraper', 'complete', 'Acme suits one.', "
        "15, true, 1, $7, 1, 1, 1) RETURNING id",
        observed_at,
        workspace_id,
        project_id,
        prompt_id,
        version_id,
        SEED_LOCATION,
        raw_payload_id,
    )
    url = await db.fetchrow("SELECT id, domain_id FROM core.urls ORDER BY id LIMIT 1")
    assert url is not None
    await db.execute(
        "INSERT INTO ai.citations (observation_id, observed_at, citation_index, workspace_id, "
        "project_id, engine_code, url_id, domain_id, raw_url, citation_kind, domain_role, "
        "role_entity_id) VALUES ($1, $2, 1, $3, $4, 'chatgpt_web', $5, $6, "
        "'https://example.com/crm', 'source_list', 'own', $7)",
        observation_id,
        observed_at,
        workspace_id,
        project_id,
        url["id"],
        url["domain_id"],
        entity_id,
    )
    await db.execute(
        "INSERT INTO ai.entity_mentions (observation_id, observed_at, entity_id, derivation_id, "
        "workspace_id, project_id, engine_code, role, mention_count, first_char_offset, "
        "mention_order, prominence, match_method, confidence, evidence_spans) "
        "VALUES ($1, $2, $3, $4, $5, $6, 'chatgpt_web', 'own', 1, 0, 1, 1, 'alias_word', 1, "
        "ARRAY['[0,4)'::int4range])",
        observation_id,
        observed_at,
        entity_id,
        derivation_id,
        workspace_id,
        project_id,
    )
    await db.execute(
        "INSERT INTO ai.observation_facts (observation_id, observed_at, derivation_id, "
        "workspace_id, project_id, observed_date, engine_code, observation_class, prompt_id, "
        "prompt_version_id, replicate_index, location_id, is_valid, own_mentioned, "
        "own_domain_cited, own_citation_count, total_citation_count, "
        "tracked_entities_mentioned, had_structured_list) VALUES ($1, $2, $3, $4, $5, "
        "current_date, 'chatgpt_web', 'consumer_ui', $6, $7, 1, $8, true, true, true, 1, 1, 1, "
        "false)",
        observation_id,
        observed_at,
        derivation_id,
        workspace_id,
        project_id,
        prompt_id,
        version_id,
        SEED_LOCATION,
    )
