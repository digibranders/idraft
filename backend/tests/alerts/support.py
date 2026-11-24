"""A project with answers written directly, so alert evaluation is tested without a worker."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

import asyncpg

from tests.api.auth.support import execute, fetch, fetchrow
from tests.api.keywords.support import LOCATION
from tests.collectors.ai_support import AiWorld, Prompt, add_prompt, make_ai_world
from tests.collectors.support import Project
from tests.conftest import PostgresServer

CHATGPT = "chatgpt_web"
GEMINI = "gemini_web"


@dataclass(frozen=True)
class World:
    ai: AiWorld
    prompt: Prompt
    derivation_id: int
    raw_payload_id: int

    @property
    def project(self) -> Project:
        return self.ai.project


async def make_world(pg: PostgresServer) -> World:
    ai = await make_ai_world(pg)
    prompt = await add_prompt(pg, ai.project, "best event security companies in Chicago")
    derivation = await fetchrow(
        pg,
        "INSERT INTO ai.derivations (workspace_id, project_id, extractor_version, "
        "entity_config_version, recommendation_version, sentiment_version) "
        "VALUES ($1, $2, 1, 1, 1, 1) RETURNING id",
        ai.project.workspace_id,
        ai.project.id,
    )
    raw = await fetchrow(
        pg,
        "INSERT INTO ops.raw_payloads (storage, object_key, sha256, bytes_raw, bytes_stored, "
        "compression, content_type, provider_code, provider_endpoint, fetched_at, "
        "retention_class, expires_at) VALUES ('r2', $1, $2, 10, 10, 'zstd', "
        "'application/json', 'dataforseo', 'x', now(), 'ai_raw', now() + interval '400 days') "
        "RETURNING id",
        f"alerts/{uuid.uuid4().hex}",
        uuid.uuid4().bytes * 2,
    )
    return World(ai, prompt, derivation["id"], raw["id"])


async def make_run(
    pg: PostgresServer,
    project: Project,
    *,
    hours_ago: float,
    status: str = "completed",
    workload: str = "ai_prompt",
) -> tuple[uuid.UUID, datetime]:
    """A run that completed `hours_ago` hours ago, started an hour before that."""
    row = await fetchrow(
        pg,
        "INSERT INTO ops.collection_runs (workspace_id, project_id, workload, window_start, "
        "window_end, trigger, status, config_snapshot, created_at, completed_at) "
        "VALUES ($1, $2, $3, now() - make_interval(hours => $4 + 1), now(), 'manual', $5, '{}', "
        "now() - make_interval(hours => $4 + 1), now() - make_interval(hours => $4)) "
        "RETURNING id, completed_at",
        project.workspace_id,
        project.id,
        workload,
        hours_ago,
        status,
    )
    return row["id"], row["completed_at"]


async def add_answer(
    pg: PostgresServer,
    world: World,
    run_id: uuid.UUID,
    completed_at: datetime,
    *,
    engine: str = CHATGPT,
    mentioned: bool = False,
    valid: bool = True,
    rivals: Sequence[uuid.UUID] = (),
    prompt: Prompt | None = None,
) -> None:
    """One answer of the run, 30 minutes before it completed, with its current facts."""
    target = prompt or world.prompt
    project = world.project
    observed_at = completed_at - timedelta(minutes=30)
    observation = await fetchrow(
        pg,
        "INSERT INTO ai.observations (observed_at, observed_date, workspace_id, project_id, "
        "engine_code, observation_class, prompt_id, prompt_version_id, query_text, "
        "collection_run_id, provider_code, provider_endpoint, status, has_citations, "
        "raw_payload_id, adapter_version, normalizer_version, canonicalizer_version) "
        "SELECT $1::timestamptz, $1::timestamptz::date, $2, $3, $4, "
        "(SELECT observation_class FROM ai.engines WHERE code = $4), $5, v.id, v.text, $6, "
        "'dataforseo', 'x', 'complete', false, $7, "
        "1, 1, 1 FROM ai.prompt_versions v WHERE v.id = $8 RETURNING id",
        observed_at,
        project.workspace_id,
        project.id,
        engine,
        target.id,
        run_id,
        world.raw_payload_id,
        target.version_id,
    )
    await execute(
        pg,
        "INSERT INTO ai.observation_facts (observation_id, observed_at, derivation_id, "
        "workspace_id, project_id, observed_date, engine_code, observation_class, prompt_id, "
        "prompt_version_id, replicate_index, is_valid, own_mentioned, own_domain_cited, "
        "own_citation_count, total_citation_count, tracked_entities_mentioned, "
        "competitor_mentions, had_structured_list) "
        "SELECT $1, $2::timestamptz, $3, $4, $5, $2::timestamptz::date, $6, o.observation_class, "
        "$7, $8, 1, $9, $10, "
        "false, 0, 0, 0, $11::uuid[], false FROM ai.observations o "
        "WHERE o.id = $1 AND o.observed_at = $2",
        observation["id"],
        observed_at,
        world.derivation_id,
        project.workspace_id,
        project.id,
        engine,
        target.id,
        target.version_id,
        valid,
        mentioned,
        list(rivals),
    )


async def make_rule(
    pg: PostgresServer,
    project: Project,
    rule_type: str,
    *,
    name: str = "A rule",
    scope: str = "{}",
    params: str = "{}",
    active: bool = True,
    created_days_ago: int = 10,
) -> uuid.UUID:
    row = await fetchrow(
        pg,
        "INSERT INTO ops.alert_rules (workspace_id, project_id, name, rule_type, scope, params, "
        "is_active, created_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, "
        "now() - make_interval(days => $8)) RETURNING id",
        project.workspace_id,
        project.id,
        name,
        rule_type,
        scope,
        params,
        active,
        created_days_ago,
    )
    rule_id: uuid.UUID = row["id"]
    return rule_id


async def set_cursor(pg: PostgresServer, project: Project, *, hours_ago: float) -> None:
    await execute(
        pg,
        "INSERT INTO ops.alert_cursors (project_id, workspace_id, last_completed_at) "
        "VALUES ($1, $2, now() - make_interval(hours => $3)) "
        "ON CONFLICT (project_id) DO UPDATE SET last_completed_at = excluded.last_completed_at",
        project.id,
        project.workspace_id,
        hours_ago,
    )


async def alerts(pg: PostgresServer, project: Project) -> list[asyncpg.Record]:
    return await fetch(
        pg,
        "SELECT * FROM ops.alert_events WHERE project_id = $1 ORDER BY id",
        project.id,
    )


async def add_tracked_keyword(pg: PostgresServer, project: Project, text: str) -> uuid.UUID:
    row = await fetchrow(
        pg,
        "WITH k AS (INSERT INTO seo.keywords (workspace_id, text, normalized_text, "
        "language_code) VALUES ($1, $3, $3, 'en') RETURNING id) "
        "INSERT INTO seo.tracked_keywords (workspace_id, project_id, keyword_id, location_id, "
        "language_code, device) SELECT $1, $2, k.id, $4, 'en', 'desktop' FROM k "
        "RETURNING id",
        project.workspace_id,
        project.id,
        text,
        LOCATION,
    )
    tracked_id: uuid.UUID = row["id"]
    return tracked_id


async def add_rank_event(
    pg: PostgresServer,
    world: World,
    tracked_id: uuid.UUID,
    from_rank: int | None,
    to_rank: int | None,
    *,
    event_type: str = "rank_drop",
) -> int:
    row = await fetchrow(
        pg,
        "INSERT INTO seo.rank_events (occurred_at, workspace_id, project_id, tracked_keyword_id, "
        "entity_id, event_type, from_rank, to_rank, serp_snapshot_id) "
        "VALUES (now(), $1, $2, $3, $4, $5, $6, $7, 1) RETURNING id",
        world.project.workspace_id,
        world.project.id,
        tracked_id,
        world.ai.own,
        event_type,
        from_rank,
        to_rank,
    )
    event_id: int = row["id"]
    return event_id
