"""`recommended` and `sentiment` of an engine with `include=facts`: the recommendation rate and the
tone counts of the answers that name the own brand. The facts are set by hand on the seeded world
of `test_prompts_summary`, so the numbers are worked out from it, whatever the extractor says."""

from __future__ import annotations

from typing import Any

import httpx

from tests.api.ai import summary_support
from tests.api.ai.summary_support import (
    CHATGPT,
    GEMINI,
    Summary,
    by,
    cell,
    prompt_row,
    summary_data,
    topic_row,
)
from tests.api.auth.support import execute
from tests.conftest import PostgresServer

seeded = summary_support.seeded


def _engine(row: dict[str, Any], code: str) -> dict[str, Any]:
    engine: dict[str, Any] = by(row["engines"], "engine_code")[code]
    return engine


async def _classify(pg: PostgresServer, world: Summary) -> None:
    """Every current fact of the project recommends the brand where it names it; of the answers
    that name it, the first by id is positive and the others mixed."""
    await execute(
        pg,
        "WITH ranked AS (SELECT observation_id, observed_at, derivation_id, "
        "row_number() OVER (ORDER BY observation_id) AS n FROM ai.observation_facts "
        "WHERE project_id = $1 AND is_current AND own_mentioned) "
        "UPDATE ai.observation_facts f SET own_recommended = true, "
        "own_sentiment = CASE WHEN ranked.n = 1 THEN 'positive' ELSE 'mixed' END "
        "FROM ranked WHERE f.observation_id = ranked.observation_id "
        "AND f.observed_at = ranked.observed_at AND f.derivation_id = ranked.derivation_id",
        world.project.id,
    )
    await execute(
        pg,
        "UPDATE ai.observation_facts SET own_recommended = false WHERE project_id = $1 "
        "AND own_recommended IS NULL",
        world.project.id,
    )


async def test_a_prompt_row_counts_the_answers_that_recommend_and_their_tone(
    api: httpx.AsyncClient, seeded: Summary, migrated: PostgresServer
) -> None:
    """`providers` on ChatGPT has five valid answers and two name the own brand."""
    await _classify(migrated, seeded)

    data = await summary_data(seeded, api, include="facts")

    engine = _engine(prompt_row(data, seeded, "providers"), CHATGPT)
    assert cell(engine["recommended"])[:2] == (2, 5)
    assert engine["recommended"]["numerator"] <= engine["mentioned"]["numerator"]
    tones = engine["sentiment"]
    assert sum(tones.values()) == 2
    assert set(tones) == {"positive", "neutral", "negative", "mixed"}
    assert tones["neutral"] == tones["negative"] == 0


async def test_topic_total_and_country_rows_sum_the_tones_and_weight_the_rate(
    api: httpx.AsyncClient, seeded: Summary, migrated: PostgresServer
) -> None:
    await _classify(migrated, seeded)

    data = await summary_data(seeded, api, include="facts,total", group_by="country")

    for row in (topic_row(data, "Managed SOC"), data["total"]):
        engine = _engine(row, CHATGPT)
        pooled = engine["recommended"]["pooled"]
        assert pooled["successes"] <= engine["mentioned"]["pooled"]["successes"]
        assert pooled["trials"] == engine["mentioned"]["pooled"]["trials"]
        assert sum(engine["sentiment"].values()) >= 2
    assert data["by_country"]


async def test_rows_not_yet_classified_have_a_null_rate_and_null_tones(
    api: httpx.AsyncClient, seeded: Summary, migrated: PostgresServer
) -> None:
    """Answers of the earlier extractor carry neither: null, never a rate of 0."""
    await execute(
        migrated,
        "UPDATE ai.observation_facts SET own_recommended = NULL, own_sentiment = NULL "
        "WHERE project_id = $1",
        seeded.project.id,
    )

    data = await summary_data(seeded, api, include="facts,total")

    for engine in (
        _engine(prompt_row(data, seeded, "providers"), CHATGPT),
        _engine(topic_row(data, "Managed SOC"), CHATGPT),
        _engine(data["total"], CHATGPT),
    ):
        assert engine["recommended"] is None
        assert engine["sentiment"] is None


async def test_an_engine_without_an_answer_has_null_cells(
    api: httpx.AsyncClient, seeded: Summary, migrated: PostgresServer
) -> None:
    await _classify(migrated, seeded)

    data = await summary_data(seeded, api, include="facts")

    engine = _engine(prompt_row(data, seeded, "pricing"), GEMINI)
    assert engine["recommended"] is None
    assert engine["sentiment"] is None


async def test_the_cells_are_left_out_unless_facts_are_asked_for(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    data = await summary_data(seeded, api)

    engine = _engine(prompt_row(data, seeded, "providers"), CHATGPT)
    assert "recommended" not in engine
    assert "sentiment" not in engine


async def test_fact_counts_have_the_counts_of_every_row_and_none_of_the_lists(
    api: httpx.AsyncClient, seeded: Summary, migrated: PostgresServer
) -> None:
    await _classify(migrated, seeded)

    data = await summary_data(seeded, api, include="fact_counts,total")

    engine = _engine(prompt_row(data, seeded, "providers"), CHATGPT)
    assert cell(engine["recommended"])[:2] == (2, 5)
    assert sum(engine["sentiment"].values()) == 2
    assert engine["position"]["answers"] == 5
    for key in ("other_brands", "top_links", "latest"):
        assert key not in engine
    assert "linked_keyword" not in prompt_row(data, seeded, "providers")
    assert _engine(data["total"], CHATGPT)["recommended"] is not None


async def test_facts_without_prompt_rows_read_no_row_lists(
    api: httpx.AsyncClient, seeded: Summary, migrated: PostgresServer
) -> None:
    await _classify(migrated, seeded)

    data = await summary_data(seeded, api, include="facts,total", rows="topics")

    engine = _engine(data["total"], CHATGPT)
    assert engine["recommended"] is not None
    assert engine["position"]["answers"] > 0
    assert data["prompts"] == []
