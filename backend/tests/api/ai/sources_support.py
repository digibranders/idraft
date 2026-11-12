"""A world for the source and fan-out route tests (plan D2): a project that owns Eventus Security
and competes with CyberNX, prompts, and answers written straight into the tables with their fact
rows and citations, so every expected count can be worked out by hand."""

from __future__ import annotations

import base64
import hashlib
import json
import uuid
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import event

from idraft.api.resources import Resources
from idraft.providers.dataforseo import ai
from tests.api.auth.support import Workspace, execute, fetchrow, make_workspace
from tests.api.entities.support import Caller, member
from tests.api.keywords.support import ensure_locations, project_url
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import (
    OWN_HOST,
    OWN_NAME,
    RIVAL_HOST,
    RIVAL_NAME,
    Prompt,
    add_prompt,
)
from tests.collectors.rank_support import _entity
from tests.collectors.support import Project
from tests.conftest import PostgresServer

OWN = f"https://{OWN_HOST}/soc"
OWN_BLOG = f"https://www.{OWN_HOST}/blog"
RIVAL = f"https://{RIVAL_HOST}/soc"
GUIDE = "https://guide.example.org/soc"
GUIDE_TOP = "https://www.example.org/top"
WIKI = "https://en.wikipedia.org/wiki/SOC"


AT = "2026-01-01T00:00:00+00:00"


def _payload(cursor: str) -> dict[str, Any]:
    payload: dict[str, Any] = json.loads(
        base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
    )
    return payload


def cursor_key(cursor: str) -> list[Any]:
    key: list[Any] = _payload(cursor)["k"]
    return key


def forged_cursor(cursor: str, key: Any) -> str:
    """A cursor with a real cursor's scope hash and any key: the hash is not a signature, so a
    client can make one."""
    payload = _payload(cursor)
    payload["k"] = key
    text = json.dumps(payload, separators=(",", ":"))
    return base64.urlsafe_b64encode(text.encode()).decode().rstrip("=")


@dataclass(frozen=True)
class Cite:
    url: str
    role: str = "third_party"
    entity: uuid.UUID | None = None
    title: str | None = None
    occurrences: int = 1


@dataclass(frozen=True)
class World:
    workspace: Workspace
    project: Project
    owner: Caller
    own: uuid.UUID
    rival: uuid.UUID
    derivation_id: int

    def url(self, *parts: object) -> str:
        return project_url(self.workspace, self.project.id, *parts)

    def own_cite(self, url: str = OWN, **changes: Any) -> Cite:
        return Cite(url, "own", self.own, **changes)

    def rival_cite(self, url: str = RIVAL) -> Cite:
        return Cite(url, "competitor", self.rival)


async def derivation_of(pg: PostgresServer, project: Project) -> int:
    row = await fetchrow(
        pg,
        "INSERT INTO ai.derivations (workspace_id, project_id, extractor_version, "
        "entity_config_version, recommendation_version, sentiment_version) "
        "VALUES ($1, $2, 1, 1, 1, 1) RETURNING id",
        project.workspace_id,
        project.id,
    )
    derivation_id: int = row["id"]
    return derivation_id


async def make_world(resources: Resources, pg: PostgresServer) -> World:
    """A project in its own workspace, with an owner, the own brand, a competitor and a
    derivation for the fact rows. No engine is turned on: the source reads do not need one."""
    await ensure_locations(pg)
    workspace = await make_workspace(pg)
    owner = await member(resources, pg, workspace, "owner")
    project = Project(workspace.id, await make_project(pg, workspace.id))
    own = await _entity(pg, project, OWN_NAME, OWN_HOST, "own", primary=True)
    rival = await _entity(pg, project, RIVAL_NAME, RIVAL_HOST, "competitor")
    return World(workspace, project, owner, own, rival, await derivation_of(pg, project))


async def page_ids(pg: PostgresServer, url: str) -> tuple[int, int]:
    """The `core.urls` and `core.domains` ids of a canonical URL, made when missing. The
    registrable domain is the host's last two labels, right for every host these tests use."""
    parts = urlsplit(url)
    host = parts.hostname
    assert host is not None
    labels = host.split(".")
    domain = await fetchrow(
        pg,
        "INSERT INTO core.domains (host, registrable_domain, public_suffix) VALUES ($1, $2, $3) "
        "ON CONFLICT (host) DO UPDATE SET host = excluded.host RETURNING id",
        host,
        ".".join(labels[-2:]),
        labels[-1],
    )
    row = await fetchrow(
        pg,
        "INSERT INTO core.urls (url_hash, canonical_url, domain_id, path, canonicalizer_version) "
        "VALUES ($1, $2, $3, $4, 1) ON CONFLICT (url_hash) DO UPDATE "
        "SET canonical_url = excluded.canonical_url RETURNING id",
        hashlib.sha256(url.encode()).digest(),
        url,
        domain["id"],
        parts.path or "/",
    )
    return row["id"], domain["id"]


async def answer(
    pg: PostgresServer,
    world: World,
    prompt: Prompt,
    *,
    days_ago: float,
    engine: str = "chatgpt_web",
    cites: Sequence[Cite] = (),
    valid: bool = True,
    current: bool = True,
    superseded: bool = False,
    fan_out: Sequence[str] | None = None,
    extras: dict[str, Any] | None = None,
    fanout_count: int | None = None,
) -> int:
    """One answer to the prompt `days_ago` days before now, with its fact row (valid or not,
    current or not) and its citations in order. The stored extras are `extras`, or the `fan_out`
    queries as the parser stores them; `fanout_count` defaults to their number. Returns the
    observation's id."""
    endpoint = ai.ENGINE_ENDPOINTS[engine]
    raw = await fetchrow(
        pg,
        "INSERT INTO ops.raw_payloads (storage, object_key, sha256, bytes_raw, bytes_stored, "
        "compression, content_type, provider_code, provider_endpoint, fetched_at, "
        "retention_class, expires_at) VALUES ('r2', $1, $2, 10, 10, 'zstd', "
        "'application/json', 'dataforseo', $3, now(), 'ai_raw', now() + interval '400 days') "
        "RETURNING id",
        f"ai/test/{uuid.uuid4()}",
        hashlib.sha256(uuid.uuid4().bytes).digest(),
        endpoint,
    )
    if extras is None and fan_out is not None:
        extras = {"fan_out_queries": list(fan_out), "search_results": 0}
    issued = fanout_count if fanout_count is not None else len(fan_out or ())
    observation = await fetchrow(
        pg,
        "INSERT INTO ai.observations (observed_at, observed_date, workspace_id, project_id, "
        "engine_code, observation_class, prompt_id, prompt_version_id, query_text, "
        "provider_code, provider_endpoint, status, answer_text, has_citations, citation_count, "
        "fanout_count, provider_extras, raw_payload_id, adapter_version, normalizer_version, "
        "canonicalizer_version) SELECT w.at, (w.at AT TIME ZONE 'UTC')::date, $1, $2, $3::text, "
        "e.observation_class, $4, v.id, v.text, 'dataforseo', $5, $6, "
        "'An answer about managed SOC providers.', $7, $8, $9, $10::jsonb, $11, 1, 1, 1 "
        "FROM ai.prompt_versions v CROSS JOIN ai.engines e "
        "CROSS JOIN (SELECT now() - make_interval(secs => $12) AS at) w "
        "WHERE v.id = $13 AND e.code = $3::text "
        "RETURNING id, observed_at, observed_date, observation_class",
        world.project.workspace_id,
        world.project.id,
        engine,
        prompt.id,
        endpoint,
        "complete" if valid else "refused",
        bool(cites),
        len(cites),
        issued,
        None if extras is None else json.dumps(extras, ensure_ascii=False),
        raw["id"],
        days_ago * 86400.0,
        prompt.version_id,
    )
    observation_id: int = observation["id"]
    observed_at = observation["observed_at"]
    await execute(
        pg,
        "INSERT INTO ai.observation_facts (observation_id, observed_at, derivation_id, "
        "workspace_id, project_id, observed_date, engine_code, observation_class, prompt_id, "
        "prompt_version_id, replicate_index, is_valid, own_mentioned, own_domain_cited, "
        "own_citation_count, total_citation_count, tracked_entities_mentioned, "
        "had_structured_list, is_current) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, "
        "$11, false, $12, $13, $14, 0, false, $15)",
        observation_id,
        observed_at,
        world.derivation_id,
        world.project.workspace_id,
        world.project.id,
        observation["observed_date"],
        engine,
        observation["observation_class"],
        prompt.id,
        prompt.version_id,
        valid,
        any(cite.role == "own" for cite in cites),
        sum(cite.role == "own" for cite in cites),
        len(cites),
        current,
    )
    for index, cite in enumerate(cites, 1):
        url_id, domain_id = await page_ids(pg, cite.url)
        await execute(
            pg,
            "INSERT INTO ai.citations (observation_id, observed_at, citation_index, workspace_id, "
            "project_id, engine_code, url_id, domain_id, raw_url, title, citation_kind, "
            "occurrences, domain_role, role_entity_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, "
            "$9, $10, 'source_list', $11, $12, $13)",
            observation_id,
            observed_at,
            index,
            world.project.workspace_id,
            world.project.id,
            engine,
            url_id,
            domain_id,
            cite.url,
            cite.title,
            cite.occurrences,
            cite.role,
            cite.entity,
        )
    if superseded:
        await execute(
            pg, "UPDATE ai.observations SET superseded_by = id WHERE id = $1", observation_id
        )
    return observation_id


async def topic_of(pg: PostgresServer, world: World, name: str) -> uuid.UUID:
    """A term of a new `topic` vocabulary of the project."""
    vocabulary = await fetchrow(
        pg,
        "INSERT INTO core.taxonomy_vocabularies (workspace_id, project_id, kind, name) "
        "VALUES ($1, $2, 'topic', $3) RETURNING id",
        world.project.workspace_id,
        world.project.id,
        f"Topics {uuid.uuid4().hex[:6]}",
    )
    term = await fetchrow(
        pg,
        "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, name, slug, path) "
        "VALUES ($1, $2, $3::text, $4::text, $4::text) RETURNING id",
        world.project.workspace_id,
        vocabulary["id"],
        name,
        name.lower().replace(" ", "-"),
    )
    term_id: uuid.UUID = term["id"]
    return term_id


async def tag(pg: PostgresServer, world: World, prompt: Prompt, term_id: uuid.UUID) -> None:
    await execute(
        pg,
        "INSERT INTO ai.prompt_terms (prompt_id, term_id, workspace_id) VALUES ($1, $2, $3)",
        prompt.id,
        term_id,
        world.project.workspace_id,
    )


@contextmanager
def statements(resources: Resources) -> Iterator[list[str]]:
    """The SQL statements the API sends while the block runs."""
    seen: list[str] = []

    def record(*args: Any) -> None:
        seen.append(args[2])

    engine = resources.engine.sync_engine
    event.listen(engine, "before_cursor_execute", record)
    try:
        yield seen
    finally:
        event.remove(engine, "before_cursor_execute", record)


FULL_SUPERSEDED = 300
FULL_ANSWERS = 3600 - FULL_SUPERSEDED


async def full_project(
    resources: Resources, pg: PostgresServer, *, citations: int = 10, fan_out: bool = False
) -> World:
    """The base plan at capacity: 150 prompts, three engines, eight answers each over the last 22
    days (3,600), each citing `citations` of 50 pages on 20 registrable domains, written straight
    into the tables. The oldest answer of `FULL_SUPERSEDED` prompt and engine pairs has been
    replaced by the next newer one (`superseded_by` set), so `FULL_ANSWERS` count. With `fan_out`,
    every ChatGPT answer stored three queries."""
    world = await make_world(resources, pg)
    for number in range(150):
        await add_prompt(pg, world.project, f"Question {number} about SOC services?")
    pages = [(await page_ids(pg, f"https://www.site{n % 20}.net/page{n}"))[0] for n in range(50)]
    raw = await fetchrow(
        pg,
        "INSERT INTO ops.raw_payloads (storage, object_key, sha256, bytes_raw, bytes_stored, "
        "compression, content_type, provider_code, provider_endpoint, fetched_at, "
        "retention_class, expires_at) VALUES ('r2', $1, $2, 10, 10, 'zstd', "
        "'application/json', 'dataforseo', 'ai_optimization/chat_gpt/llm_scraper', now(), "
        "'ai_raw', now() + interval '400 days') RETURNING id",
        f"ai/full/{uuid.uuid4()}",
        hashlib.sha256(uuid.uuid4().bytes).digest(),
    )
    extras = json.dumps({"fan_out_queries": ["soc providers", "soc pricing", "mssp list"]})
    await execute(
        pg,
        "INSERT INTO ai.observations (observed_at, observed_date, workspace_id, project_id, "
        "engine_code, observation_class, prompt_id, prompt_version_id, query_text, "
        "provider_code, provider_endpoint, status, has_citations, fanout_count, provider_extras, "
        "raw_payload_id, adapter_version, normalizer_version, canonicalizer_version) "
        "SELECT now() - make_interval(days => 3 * n), "
        "((now() - make_interval(days => 3 * n)) AT TIME ZONE 'UTC')::date, p.workspace_id, "
        "p.project_id, e.code, e.observation_class, p.id, p.current_version_id, 'q', "
        "'dataforseo', 'ai_optimization/chat_gpt/llm_scraper', 'complete', true, "
        "CASE WHEN $3 AND e.code = 'chatgpt_web' THEN 3 ELSE 0 END, "
        "CASE WHEN $3 AND e.code = 'chatgpt_web' THEN $4::jsonb END, $2, 1, 1, 1 "
        "FROM ai.prompts p CROSS JOIN ai.engines e CROSS JOIN generate_series(0, 7) n "
        "WHERE p.project_id = $1",
        world.project.id,
        raw["id"],
        fan_out,
        extras,
    )
    await execute(
        pg,
        "INSERT INTO ai.observation_facts (observation_id, observed_at, derivation_id, "
        "workspace_id, project_id, observed_date, engine_code, observation_class, prompt_id, "
        "prompt_version_id, replicate_index, is_valid, own_mentioned, own_domain_cited, "
        "own_citation_count, total_citation_count, tracked_entities_mentioned, "
        "had_structured_list) SELECT o.id, o.observed_at, $2, o.workspace_id, o.project_id, "
        "o.observed_date, o.engine_code, o.observation_class, o.prompt_id, o.prompt_version_id, "
        "1, true, false, false, 0, $3, 0, false FROM ai.observations o WHERE o.project_id = $1",
        world.project.id,
        world.derivation_id,
        citations,
    )
    await execute(
        pg,
        "INSERT INTO ai.citations (observation_id, observed_at, citation_index, workspace_id, "
        "project_id, engine_code, url_id, domain_id, raw_url, citation_kind, domain_role) "
        "SELECT o.id, o.observed_at, i, o.workspace_id, o.project_id, o.engine_code, u.id, "
        "u.domain_id, u.canonical_url, 'source_list', 'third_party' "
        "FROM ai.observations o CROSS JOIN generate_series(1, $2::int) AS i "
        "JOIN core.urls u ON u.id = ($3::bigint[])[1 + ((o.id + i) % 50)::int] "
        "WHERE o.project_id = $1",
        world.project.id,
        citations,
        pages,
    )
    # Within each (prompt, engine) the answers are 3 days apart: rank 8 is the oldest and rank 7
    # the answer that replaced it.
    await execute(
        pg,
        "WITH ranked AS (SELECT id, observed_at, "
        "lag(id) OVER pair AS newer, row_number() OVER pair AS rank FROM ai.observations "
        "WHERE project_id = $1 WINDOW pair AS (PARTITION BY prompt_id, engine_code "
        "ORDER BY observed_at DESC)), "
        "oldest AS (SELECT id, observed_at, newer FROM ranked WHERE rank = 8 ORDER BY id LIMIT $2) "
        "UPDATE ai.observations o SET superseded_by = r.newer FROM oldest r "
        "WHERE o.id = r.id AND o.observed_at = r.observed_at",
        world.project.id,
        FULL_SUPERSEDED,
    )
    # No ANALYZE: a first read of bulk loaded rows has no statistics, and must still be fast.
    return world
