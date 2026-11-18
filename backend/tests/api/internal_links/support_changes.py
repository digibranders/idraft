"""Two crawls of one project, the second after changes, for the tests of the change store,
the Changes reads, extras and opportunities (plan 04)."""

from __future__ import annotations

import json
import uuid
from datetime import date, timedelta

from idraft.domain.gsc_pull import PullState
from tests.api.auth.support import Workspace, execute, fetchrow
from tests.api.internal_links.support import SeedLink, seed_crawl, seed_tiers, set_counts
from tests.conftest import PostgresServer
from tests.db.support import connection, insert_prompt

PAGES = [("/", 200), ("/pricing", 200), ("/blog", 200), ("/blog/a", 200), ("/blog/b", 200)]
BEFORE = [
    SeedLink("/", "/pricing", "navigation", "Pricing"),
    SeedLink("/blog", "/pricing", "content", "See plans"),
    SeedLink("/blog/a", "/pricing", "content", "Plans"),
]
AFTER = [
    SeedLink("/", "/pricing", "navigation", "Pricing"),
    SeedLink("/blog/a", "/pricing", "navigation", "Plans"),
    SeedLink("/blog", "/blog/b", "content", "Click here"),
    SeedLink("/blog/a", "/blog/b", "content", "SOC pricing"),
]


async def two_crawls(
    pg: PostgresServer, workspace: Workspace, project_id: uuid.UUID
) -> tuple[uuid.UUID, uuid.UUID, dict[str, int], list[uuid.UUID]]:
    """(older run, newer run, url ids by path, tier ids). /pricing is a manual T1 and /blog/b a
    manual T3. Between the crawls /blog stopped linking to /pricing by a link in the text, and
    /blog/a kept a menu link to it; /blog/b gained two links in the text."""
    tiers = await seed_tiers(pg, workspace)
    older, ids = await seed_crawl(pg, workspace, project_id, PAGES, BEFORE)
    newer, _ = await seed_crawl(pg, workspace, project_id, PAGES, AFTER)
    for run in (older, newer):
        await set_counts(pg, run)
    for path, tier in (("/pricing", tiers[0]), ("/blog/b", tiers[2])):
        await execute(
            pg,
            "INSERT INTO core.project_pages (project_id, url_id, workspace_id, tier_id, "
            "tier_source) VALUES ($1, $2, $3, $4, 'manual')",
            project_id,
            ids[path],
            workspace.id,
            tier,
        )
    return older, newer, ids, tiers


async def track_keyword(
    pg: PostgresServer,
    workspace: Workspace,
    project_id: uuid.UUID,
    text: str,
    target_url_id: int | None,
    *,
    rank: int | None,
    change: int | None,
    volume: int | None,
) -> None:
    """A tracked keyword of a page with its current rank and change, and its search volume as
    the keyword list reads it (`seo.keyword_metrics_current`, source `dataforseo_labs`, which
    needs a snapshot row)."""
    row = await fetchrow(
        pg,
        "WITH k AS (INSERT INTO seo.keywords (workspace_id, text, normalized_text, "
        "language_code) VALUES ($1, $4, $4, 'en') RETURNING id), "
        "t AS (INSERT INTO seo.tracked_keywords (workspace_id, project_id, keyword_id, "
        "location_id, language_code, device, target_url_id) SELECT $1, $2, k.id, "
        "(SELECT default_location_id FROM core.projects WHERE id = $2), 'en', 'desktop', $3 "
        "FROM k RETURNING id, keyword_id, location_id), "
        "s AS (INSERT INTO seo.tracked_keyword_state (tracked_keyword_id, workspace_id, "
        "project_id, current_rank, rank_change) SELECT t.id, $1, $2, $5, $6 FROM t "
        "RETURNING tracked_keyword_id) "
        "SELECT t.keyword_id, t.location_id FROM t",
        workspace.id,
        project_id,
        target_url_id,
        text,
        rank,
        change,
    )
    if volume is None:
        return
    await execute(
        pg,
        "WITH snap AS (INSERT INTO seo.keyword_metric_snapshots (workspace_id, keyword_id, "
        "location_id, language_code, source, fetched_at, search_volume, is_material_change) "
        "VALUES ($1, $2, $3, 'en', 'dataforseo_labs', now(), $4, false) RETURNING id) "
        "INSERT INTO seo.keyword_metrics_current (keyword_id, location_id, language_code, "
        "source, workspace_id, snapshot_id, search_volume, fetched_at) "
        "SELECT $2, $3, 'en', 'dataforseo_labs', $1, snap.id, $4, now() FROM snap",
        workspace.id,
        row["keyword_id"],
        row["location_id"],
        volume,
    )


async def gsc_property(pg: PostgresServer, workspace: Workspace, project: uuid.UUID) -> uuid.UUID:
    """An active property whose pull has a window, as a project connected before page numbers
    existed or a pass that stopped on its budget leaves it: no page day is stored yet."""
    secret = await fetchrow(
        pg,
        "INSERT INTO ops.secrets (workspace_id, kind, ciphertext, dek_wrapped, kek_version, "
        "fingerprint) VALUES ($1, 'oauth_refresh_token', '\\x00', '\\x00', 1, 'abcd') RETURNING id",
        workspace.id,
    )
    connection = await fetchrow(
        pg,
        "INSERT INTO fp.connections (workspace_id, product, auth_method, subject_id, "
        "credential_ref, scopes, status) VALUES ($1, 'google', 'oauth', $2, $3, '{}', 'active') "
        "RETURNING id",
        workspace.id,
        uuid.uuid4().hex,
        secret["id"],
    )
    state = PullState(recent_done=True, window_end=date.today() - timedelta(days=3))
    row = await fetchrow(
        pg,
        "INSERT INTO fp.integrations (workspace_id, project_id, kind, external_property, "
        "connection_id, scopes, status, backfill_state) "
        "VALUES ($1, $2, 'gsc', 'sc-domain:example.com', $3, '{}', 'active', $4::jsonb) "
        "RETURNING id",
        workspace.id,
        project,
        connection["id"],
        json.dumps(state.write({})),
    )
    integration: uuid.UUID = row["id"]
    return integration


async def insert_citation(
    pg: PostgresServer,
    workspace: Workspace,
    project: uuid.UUID,
    url_id: int,
    engine: str,
    days_ago: int,
) -> None:
    """One answer of `engine`, `days_ago` days old, that cites the page as the project's own
    domain. The statements are those of `seed_ai` in `tests/db/support.py`."""
    observation_class = "serp_ai" if engine == "google_ai_mode" else "consumer_ui"
    async with connection(pg) as db:
        prompt_id, version_id = await insert_prompt(
            db, workspace.id, project, f"Which tool is best {uuid.uuid4().hex}?"
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
        observed_at = await db.fetchval("SELECT now() - make_interval(days => $1)", days_ago)
        observation_id: int = await db.fetchval(
            "INSERT INTO ai.observations (observed_at, observed_date, workspace_id, project_id, "
            "engine_code, observation_class, prompt_id, prompt_version_id, query_text, "
            "location_id, language_code, provider_code, provider_endpoint, status, answer_text, "
            "answer_char_count, has_citations, citation_count, raw_payload_id, adapter_version, "
            "normalizer_version, canonicalizer_version) VALUES ($1::timestamptz, "
            "($1::timestamptz)::date, $2, $3, $4, $5, $6, $7, 'Which tool is best?', "
            "(SELECT default_location_id FROM core.projects WHERE id = $3), 'en', 'dataforseo', "
            "'ai_optimization/chat_gpt/llm_scraper', "
            "'complete', 'Acme.', 5, true, 1, $8, 1, 1, 1) RETURNING id",
            observed_at,
            workspace.id,
            project,
            engine,
            observation_class,
            prompt_id,
            version_id,
            raw_payload_id,
        )
        await db.execute(
            "INSERT INTO ai.citations (observation_id, observed_at, citation_index, "
            "workspace_id, project_id, engine_code, url_id, domain_id, raw_url, citation_kind, "
            "domain_role) SELECT $1, $2, 1, $3, $4, $5, u.id, u.domain_id, u.canonical_url, "
            "'source_list', 'own' FROM core.urls u WHERE u.id = $6",
            observation_id,
            observed_at,
            workspace.id,
            project,
            engine,
            url_id,
        )


async def start_at(pg: PostgresServer, run: uuid.UUID, url_id: int) -> None:
    """Say which page the crawl started from (ingest records it; a seeded crawl has none)."""
    await execute(pg, "UPDATE seo.crawl_runs SET start_url_id = $2 WHERE id = $1", run, url_id)
