"""The weekly points of a series carry AI visibility always, and the recommendation rate, the tones
and the places of the own brand with `include=fact_counts`. One prompt over four weeks (W-3 empty,
W-2 one answer, W-1 one answer, W two answers): a prompt row pools the trailing four weeks, so
every number is the sum of the weeks up to the point, worked by hand."""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.ai.summary_support import Summary, cell, prompt_row, summary_data
from tests.api.ai.test_summary_pooling import _base_week, _project, _series, _span, _wednesday
from tests.api.auth.support import execute, fetchrow
from tests.conftest import PostgresServer


@dataclass(frozen=True)
class Answer:
    """One valid ChatGPT answer of prompt `a`: when, whether it names the own brand and cites its
    domain, the place of the own brand among the tracked brands, the recommendation and the tone."""

    at: datetime
    mentioned: bool
    cited: bool
    order: int | None = None
    recommended: bool | None = None
    tone: str | None = None


async def _write(migrated: PostgresServer, world: Summary, answers: list[Answer]) -> None:
    raw = await fetchrow(
        migrated,
        "INSERT INTO ops.raw_payloads (storage, object_key, sha256, bytes_raw, bytes_stored, "
        "compression, content_type, provider_code, provider_endpoint, fetched_at, "
        "retention_class, expires_at) VALUES ('r2', $1, $2, 10, 10, 'zstd', "
        "'application/json', 'dataforseo', 'ai_optimization/chat_gpt/llm_scraper', now(), "
        "'ai_raw', now() + interval '400 days') RETURNING id",
        f"ai/weekly/{uuid.uuid4()}",
        hashlib.sha256(uuid.uuid4().bytes).digest(),
    )
    derivation = await fetchrow(
        migrated,
        "INSERT INTO ai.derivations (workspace_id, project_id, extractor_version, "
        "entity_config_version, recommendation_version, sentiment_version) "
        "VALUES ($1, $2, 1, 1, 1, 1) ON CONFLICT ON CONSTRAINT derivations_identity "
        "DO UPDATE SET extractor_version = 1 RETURNING id",
        world.workspace.id,
        world.project.id,
    )
    marks = [str(index) for index in range(len(answers))]
    await execute(
        migrated,
        "INSERT INTO ai.observations (observed_at, observed_date, workspace_id, project_id, "
        "engine_code, observation_class, prompt_id, prompt_version_id, query_text, "
        "provider_code, provider_endpoint, status, has_citations, raw_payload_id, "
        "adapter_version, normalizer_version, canonicalizer_version) "
        "SELECT a.at, (a.at AT TIME ZONE 'UTC')::date, p.workspace_id, p.project_id, e.code, "
        "e.observation_class, p.id, p.current_version_id, a.mark, 'dataforseo', "
        "'ai_optimization/chat_gpt/llm_scraper', 'complete', false, $4, 1, 1, 1 "
        "FROM unnest($1::text[], $2::timestamptz[]) AS a(mark, at) "
        "JOIN ai.prompts p ON p.id = $3 JOIN ai.engines e ON e.code = 'chatgpt_web'",
        marks,
        [answer.at for answer in answers],
        world.prompts["a"].id,
        raw["id"],
    )
    await execute(
        migrated,
        "INSERT INTO ai.observation_facts (observation_id, observed_at, derivation_id, "
        "workspace_id, project_id, observed_date, engine_code, observation_class, prompt_id, "
        "prompt_version_id, replicate_index, is_valid, own_mentioned, own_domain_cited, "
        "own_citation_count, total_citation_count, tracked_entities_mentioned, "
        "had_structured_list, own_mention_order, own_recommended, own_sentiment) "
        "SELECT o.id, o.observed_at, $2, o.workspace_id, o.project_id, o.observed_date, "
        "o.engine_code, o.observation_class, o.prompt_id, o.prompt_version_id, 1, true, "
        "m.mentioned, m.cited, 0, 0, CASE WHEN m.mentioned THEN 1 ELSE 0 END, false, "
        "m.ord, m.rec, m.tone FROM ai.observations o JOIN unnest($3::text[], $4::bool[], "
        "$5::bool[], $6::int[], $7::bool[], $8::text[]) AS m(mark, mentioned, cited, ord, rec, "
        "tone) ON m.mark = o.query_text WHERE o.project_id = $1",
        world.project.id,
        derivation["id"],
        marks,
        [answer.mentioned for answer in answers],
        [answer.cited for answer in answers],
        [answer.order for answer in answers],
        [answer.recommended for answer in answers],
        [answer.tone for answer in answers],
    )


@pytest.fixture
async def world(resources: Resources, migrated: PostgresServer) -> tuple[Summary, str, str]:
    world = await _project(resources, migrated, ["a"])
    week = _base_week()
    await _write(
        migrated,
        world,
        [
            # W-2: named first, cited, recommended, positive.
            Answer(_wednesday(week, -2), True, True, 1, True, "positive"),
            # W-1: neither names nor cites the brand; the week holds one answer (below the floor).
            Answer(_wednesday(week, -1), False, False),
            # W: one cites only; one names the brand second, not recommended, neutral.
            Answer(_wednesday(week, 0), False, True),
            Answer(_wednesday(week, 0), True, False, 2, False, "neutral"),
        ],
    )
    span = _span(week - timedelta(weeks=3), week + timedelta(days=6))
    return world, span["from"], span["to"]


async def test_the_weekly_visibility_is_the_answers_that_are_not_neither(
    api: httpx.AsyncClient, world: tuple[Summary, str, str]
) -> None:
    summary, first, last = world

    data = await summary_data(summary, api, include="series", **{"from": first, "to": last})

    points = _series(prompt_row(data, summary, "a"))
    assert [cell(point["visibility"]) for point in points] == [
        (0, 0, 0),
        (1, 1, 1),
        (1, 2, 2),
        (3, 4, 4),
    ]
    assert points[0]["visibility"]["value"] is None
    # Without the facts the weekly points carry no recommendation, tone or place.
    for name in ("recommended", "sentiment", "position"):
        assert name not in points[0]


async def test_the_weekly_recommendation_tone_and_place_add_up_over_the_pooled_weeks(
    api: httpx.AsyncClient, world: tuple[Summary, str, str]
) -> None:
    summary, first, last = world

    data = await summary_data(
        summary, api, include="series,fact_counts", **{"from": first, "to": last}
    )

    points = _series(prompt_row(data, summary, "a"))
    # The empty week: nothing is classified, so no rate and no tone, and no place (zeros).
    assert points[0]["recommended"] is None
    assert points[0]["sentiment"] is None
    assert points[0]["position"] == {
        "rank_sum": 0,
        "ordered_answers": 0,
        "mentions": 0,
        "answers": 0,
    }
    assert cell(points[1]["recommended"]) == (1, 1, 1)
    assert points[1]["sentiment"] == {"positive": 1, "neutral": 0, "negative": 0, "mixed": 0}
    assert points[1]["position"] == {
        "rank_sum": 1,
        "ordered_answers": 1,
        "mentions": 1,
        "answers": 1,
    }
    # The thin week keeps its counts: one of two answers recommends, the place is unchanged.
    assert cell(points[2]["recommended"]) == (1, 2, 2)
    assert points[2]["position"]["answers"] == 2
    # The last point pools W-2 to W: places 1 and 2 over four answers, one recommendation.
    assert cell(points[3]["recommended"]) == (1, 4, 4)
    assert points[3]["sentiment"] == {"positive": 1, "neutral": 1, "negative": 0, "mixed": 0}
    assert points[3]["position"] == {
        "rank_sum": 3,
        "ordered_answers": 2,
        "mentions": 2,
        "answers": 4,
    }
