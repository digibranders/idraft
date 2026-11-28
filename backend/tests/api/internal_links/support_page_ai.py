"""Seeded crawl and AI answers for testing `GET .../internal-links/pages/{url_id}/ai`."""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from typing import Any

from tests.api.ai.sources_support import (
    World,
    answer,
    derivation_of,
    page_ids,
)
from tests.api.auth.support import Workspace, execute, fetchrow
from tests.api.entities.support import Caller
from tests.api.internal_links.support import read_site
from tests.api.internal_links.support import url_id as crawl_url_id
from tests.api.keywords.support import ensure_locations
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

CITED_PATH = "/blog/a"
UNCITED_PATH = "/blog/b"
OWN_CRAWLED_PATH = "/pricing"
OWN_UNCRAWLED_PATH = "/old-never-crawled"

CITED_URL = f"https://example.com{CITED_PATH}"
OWN_CRAWLED_URL = f"https://example.com{OWN_CRAWLED_PATH}"
OWN_UNCRAWLED_URL = f"https://example.com{OWN_UNCRAWLED_PATH}"
COMPETITOR_URL = f"https://{RIVAL_HOST}/soc"
THIRD_PARTY_URL = "https://guide.example.org/soc"
OTHER_THIRD_PARTY_URL = "https://guide.example.org/other"


@dataclass(frozen=True)
class SeedCite:
    url: str
    role: str
    entity: uuid.UUID | None = None
    title: str | None = None
    flags: tuple[str, ...] = ()


@dataclass(frozen=True)
class PageAiSite:
    run_id: uuid.UUID
    url_ids: dict[str, int]
    prompt_ids: dict[str, uuid.UUID]
    world: World


# Hand-worked expected values for `CITED_PATH` (`/blog/a`) with `compare=previous_period`.
EXPECTED: dict[str, Any] = {
    "state": "ready",
    "days": 28,
    "answers": 8,
    "answers_citing": 6,
    "previous_answers": 2,
    "previous_answers_citing": 2,
    "platforms": [
        ("chatgpt_web", "ChatGPT", 4, 3, 1),
        ("gemini_web", "Gemini", 3, 3, 1),
        ("google_ai_mode", "Google AI Mode", 1, 0, 0),
    ],
    "prompts": [
        {
            "key": "p1",
            "text": "Best managed SOC providers",
            "answers": 4,
            "answers_citing": 3,
            "platforms": [
                ("chatgpt_web", 2, 2),
                ("gemini_web", 1, 1),
                ("google_ai_mode", 1, 0),
            ],
        },
        {
            "key": "p2",
            "text": "SOC pricing comparison",
            "answers": 3,
            "answers_citing": 2,
            "platforms": [
                ("chatgpt_web", 2, 1),
                ("gemini_web", 1, 1),
                ("google_ai_mode", 0, 0),
            ],
        },
        {
            "key": "p3",
            "text": "Eventus Security reviews",
            "answers": 1,
            "answers_citing": 1,
            "platforms": [
                ("chatgpt_web", 0, 0),
                ("gemini_web", 1, 1),
                ("google_ai_mode", 0, 0),
            ],
        },
    ],
    "prompts_total": 3,
    "alongside": [
        (COMPETITOR_URL, "competitor", False, 4, RIVAL_HOST, "CyberNX SOC"),
        (OWN_UNCRAWLED_URL, "own", False, 4, "example.com", "Old page"),
        (OWN_CRAWLED_URL, "own", True, 4, "example.com", "Pricing"),
        (THIRD_PARTY_URL, "third_party", False, 4, "example.org", "SOC Guide"),
    ],
    "alongside_total": 4,
}


def _days_ago_noon(days_before_today: int, *, hour: int = 12) -> float:
    """Return `days_ago` landing on `today_utc - days_before_today` at `hour`:00 UTC."""
    now = datetime.now(UTC)
    target = datetime.combine(now.date() - timedelta(days=days_before_today), time(hour, 0), UTC)
    return (now - target).total_seconds() / 86400.0


async def _resolve_url_ids(pg: PostgresServer, url: str) -> tuple[int, int]:
    """Use `support.url_id` for `example.com` so `core.urls` matches `seed_crawl` in any order."""
    if url.startswith("https://example.com/"):
        uid = await crawl_url_id(pg, url)
        row = await fetchrow(pg, "SELECT domain_id FROM core.urls WHERE id = $1", uid)
        return uid, int(row["domain_id"])
    return await page_ids(pg, url)


async def _seed_answer(
    pg: PostgresServer,
    world: World,
    prompt: Prompt,
    *,
    days_ago: float,
    engine: str = "chatgpt_web",
    cites: Sequence[SeedCite] = (),
    valid: bool = True,
    current: bool = True,
    superseded: bool = False,
) -> int:
    observation_id = await answer(
        pg,
        world,
        prompt,
        days_ago=days_ago,
        engine=engine,
        cites=(),
        valid=valid,
        current=current,
        superseded=superseded,
    )
    obs = await fetchrow(
        pg, "SELECT observed_at FROM ai.observations WHERE id = $1", observation_id
    )
    observed_at = obs["observed_at"]
    for index, cite in enumerate(cites, 1):
        uid, did = await _resolve_url_ids(pg, cite.url)
        await execute(
            pg,
            "INSERT INTO ai.citations (observation_id, observed_at, citation_index, workspace_id, "
            "project_id, engine_code, url_id, domain_id, raw_url, title, citation_kind, "
            "occurrences, domain_role, role_entity_id, flags) VALUES ($1, $2, $3, $4, $5, $6, "
            "$7, $8, $9, $10, 'source_list', 1, $11, $12, $13::text[])",
            observation_id,
            observed_at,
            index,
            world.project.workspace_id,
            world.project.id,
            engine,
            uid,
            did,
            cite.url,
            cite.title,
            cite.role,
            cite.entity,
            list(cite.flags),
        )
    return observation_id


async def _seed_aio_answer(
    pg: PostgresServer,
    world: World,
    prompt: Prompt,
    *,
    days_ago: float,
    url: str,
) -> int:
    """Seed a valid current `google_ai_overview` answer (`ENGINE_ENDPOINTS` omits keyword-level)."""
    raw = await fetchrow(
        pg,
        "INSERT INTO ops.raw_payloads (storage, object_key, sha256, bytes_raw, bytes_stored, "
        "compression, content_type, provider_code, provider_endpoint, fetched_at, "
        "retention_class, expires_at) VALUES ('r2', $1, $2, 10, 10, 'zstd', "
        "'application/json', 'dataforseo', 'serp/google/organic', now(), 'ai_raw', "
        "now() + interval '400 days') RETURNING id",
        f"ai/test/{uuid.uuid4()}",
        hashlib.sha256(uuid.uuid4().bytes).digest(),
    )
    obs = await fetchrow(
        pg,
        "INSERT INTO ai.observations (observed_at, observed_date, workspace_id, project_id, "
        "engine_code, observation_class, prompt_id, prompt_version_id, query_text, "
        "provider_code, provider_endpoint, status, answer_text, has_citations, citation_count, "
        "fanout_count, raw_payload_id, adapter_version, normalizer_version, "
        "canonicalizer_version) SELECT w.at, (w.at AT TIME ZONE 'UTC')::date, $1, $2, "
        "'google_ai_overview', e.observation_class, $3, v.id, v.text, 'dataforseo', "
        "'serp/google/organic', 'complete', 'Overview answer.', true, 1, 0, $4, 1, 1, 1 "
        "FROM ai.prompt_versions v CROSS JOIN ai.engines e "
        "CROSS JOIN (SELECT now() - make_interval(secs => $5) AS at) w "
        "WHERE v.id = $6 AND e.code = 'google_ai_overview' "
        "RETURNING id, observed_at, observed_date, observation_class",
        world.project.workspace_id,
        world.project.id,
        prompt.id,
        raw["id"],
        days_ago * 86400.0,
        prompt.version_id,
    )
    observation_id: int = obs["id"]
    await execute(
        pg,
        "INSERT INTO ai.observation_facts (observation_id, observed_at, derivation_id, "
        "workspace_id, project_id, observed_date, engine_code, observation_class, prompt_id, "
        "prompt_version_id, replicate_index, is_valid, own_mentioned, own_domain_cited, "
        "own_citation_count, total_citation_count, tracked_entities_mentioned, "
        "had_structured_list, is_current) VALUES ($1, $2, $3, $4, $5, $6, 'google_ai_overview', "
        "$7, $8, $9, 1, true, false, true, 1, 1, 0, false, true)",
        observation_id,
        obs["observed_at"],
        world.derivation_id,
        world.project.workspace_id,
        world.project.id,
        obs["observed_date"],
        obs["observation_class"],
        prompt.id,
        prompt.version_id,
    )
    uid, did = await _resolve_url_ids(pg, url)
    await execute(
        pg,
        "INSERT INTO ai.citations (observation_id, observed_at, citation_index, workspace_id, "
        "project_id, engine_code, url_id, domain_id, raw_url, title, citation_kind, "
        "occurrences, domain_role, role_entity_id, flags) VALUES ($1, $2, 1, $3, $4, "
        "'google_ai_overview', $5, $6, $7, 'Overview', 'source_list', 1, 'own', $8, '{}'::text[])",
        observation_id,
        obs["observed_at"],
        world.project.workspace_id,
        world.project.id,
        uid,
        did,
        url,
        world.own,
    )
    return observation_id


async def page_ai_site(
    pg: PostgresServer,
    workspace: Workspace,
    project_id: uuid.UUID,
    *,
    include_excluded: bool = True,
) -> PageAiSite:
    """Build a crawl (`read_site`) and AI world, then seed answers per the test table.

    Note: `/pricing` is cited alongside `/blog/a`, so `UNCITED_PATH` (`/blog/b`) serves as the
    uncited page in the crawl.
    """
    await ensure_locations(pg)
    run_id, url_ids, _ = await read_site(pg, workspace, project_id)
    project = Project(workspace.id, project_id)
    own = await _entity(pg, project, OWN_NAME, OWN_HOST, "own", primary=True)
    rival = await _entity(pg, project, RIVAL_NAME, RIVAL_HOST, "competitor")
    world = World(
        workspace=workspace,
        project=project,
        owner=Caller(workspace.id, {}),
        own=own,
        rival=rival,
        derivation_id=await derivation_of(pg, project),
    )

    p1 = await add_prompt(pg, project, "Best managed SOC providers")
    p2 = await add_prompt(pg, project, "SOC pricing comparison")
    p3 = await add_prompt(pg, project, "Eventus Security reviews", branded=True)

    cited = SeedCite(CITED_URL, "own", own, "Blog A")
    alongside = (
        SeedCite(OWN_CRAWLED_URL, "own", own, "Pricing"),
        SeedCite(OWN_UNCRAWLED_URL, "own", own, "Old page"),
        SeedCite(COMPETITOR_URL, "competitor", rival, "CyberNX SOC"),
        SeedCite(THIRD_PARTY_URL, "third_party", None, "SOC Guide"),
    )

    # 4 answers citing `/blog/a` and all 4 alongside addresses.
    await _seed_answer(
        pg, world, p1, days_ago=_days_ago_noon(2), engine="chatgpt_web", cites=(cited, *alongside)
    )
    await _seed_answer(
        pg, world, p1, days_ago=_days_ago_noon(4), engine="chatgpt_web", cites=(cited, *alongside)
    )
    await _seed_answer(
        pg, world, p1, days_ago=_days_ago_noon(6), engine="gemini_web", cites=(cited, *alongside)
    )
    await _seed_answer(
        pg, world, p2, days_ago=_days_ago_noon(10), engine="chatgpt_web", cites=(cited, *alongside)
    )

    # 2 more counted answers citing `/blog/a` in the last 20 days (6 total), plus 2 uncited ones.
    await _seed_answer(
        pg, world, p2, days_ago=_days_ago_noon(12), engine="gemini_web", cites=(cited,)
    )
    await _seed_answer(
        pg, world, p3, days_ago=_days_ago_noon(14), engine="gemini_web", cites=(cited,)
    )
    await _seed_answer(
        pg,
        world,
        p1,
        days_ago=_days_ago_noon(8),
        engine="google_ai_mode",
        cites=(SeedCite(OTHER_THIRD_PARTY_URL, "third_party", None, "Other"),),
    )
    flagged_cites = (
        (SeedCite(CITED_URL, "own", own, "Flagged", flags=("engine_internal",)),)
        if include_excluded
        else ()
    )
    await _seed_answer(
        pg, world, p2, days_ago=_days_ago_noon(13), engine="chatgpt_web", cites=flagged_cites
    )

    # 2 counted answers in the 28 days before (both placed on today - 28 days, inside the
    # 1-month-back partition on any calendar date).
    await _seed_answer(
        pg,
        world,
        p1,
        days_ago=_days_ago_noon(28, hour=10),
        engine="chatgpt_web",
        cites=(cited,),
    )
    await _seed_answer(
        pg,
        world,
        p2,
        days_ago=_days_ago_noon(28, hour=14),
        engine="gemini_web",
        cites=(cited,),
    )

    if include_excluded:
        paused = await add_prompt(pg, project, "Paused prompt", active=False)
        await _seed_answer(
            pg, world, paused, days_ago=_days_ago_noon(3), engine="chatgpt_web", cites=(cited,)
        )
        archived = await add_prompt(pg, project, "Archived prompt")
        await execute(pg, "UPDATE ai.prompts SET deleted_at = now() WHERE id = $1", archived.id)
        await _seed_answer(
            pg, world, archived, days_ago=_days_ago_noon(3), engine="chatgpt_web", cites=(cited,)
        )
        await _seed_answer(
            pg,
            world,
            p1,
            days_ago=_days_ago_noon(3),
            engine="chatgpt_web",
            cites=(cited,),
            superseded=True,
        )
        await _seed_aio_answer(pg, world, p1, days_ago=_days_ago_noon(3), url=CITED_URL)
        other_id = await make_project(pg, workspace.id, name="Other")
        other_project = Project(workspace.id, other_id)
        other_world = World(
            workspace=workspace,
            project=other_project,
            owner=world.owner,
            own=await _entity(pg, other_project, "Other Co", "other.example", "own", primary=True),
            rival=world.rival,
            derivation_id=await derivation_of(pg, other_project),
        )
        other_prompt = await add_prompt(pg, other_project, "Other project prompt")
        await _seed_answer(
            pg,
            other_world,
            other_prompt,
            days_ago=_days_ago_noon(3),
            engine="chatgpt_web",
            cites=(cited,),
        )

    uncrawled_id, _ = await _resolve_url_ids(pg, OWN_UNCRAWLED_URL)
    url_ids = {**url_ids, OWN_UNCRAWLED_PATH: uncrawled_id}
    return PageAiSite(
        run_id=run_id,
        url_ids=url_ids,
        prompt_ids={"p1": p1.id, "p2": p2.id, "p3": p3.id},
        world=world,
    )
