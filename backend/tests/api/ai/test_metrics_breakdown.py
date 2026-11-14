"""One metric broken down by a dimension of the prompts (contract C8, route 5). Read from the
prompts summary over the seeded world of `test_prompts_summary` (see the docstring of its `summary`
fixture) with prompt attributes set on top. ChatGPT, default scope (the prompts `providers`,
`pricing` and `misc`; the branded prompt and the archived one are not in scope):

    providers  6 answers, 5 valid:  Mentioned 2/5, Cited 2/5, outcomes 1/5 1/5 1/5 2/5, SOV 1.5 of 3
    pricing    1 answer, valid:     Mentioned 0/1, Cited 0/1, outcome neither,           SOV none
    misc       1 answer, valid:     Mentioned 1/1, Cited 1/1, outcome mentioned+cited,   SOV 1 of 1
    Gemini: providers has one valid answer naming both brands (every rate 1/1, SOV 0.5 of 1);
    pricing and misc have none, so Gemini's cell of those prompts is 0 of 0.

A group of prompts is prompt weighted as a topic row is: each prompt with a valid answer counts
once, as its rate, and `pooled` holds the answers. The attributes set by `_attributes`:

    prompt     intent        funnel  type        language  country  persona
    providers  commercial    tofu    comparison  en        IN       Buyer
    pricing    commercial    bofu    question    en        IN       none
    misc       informational tofu    question    es        US       none
    brand      commercial    unknown question    en        US       none   (branded)

so the group of commercial prompts is the prompts of the topic Managed SOC exactly."""

from __future__ import annotations

import uuid
from typing import Any

import httpx
import pytest

from idraft.api.ai import metrics
from idraft.api.ai import metrics_repository as repository
from idraft.api.resources import Resources
from idraft.collectors.ai_prompt_ingest import ingest
from idraft.db.engine import workspace_transaction
from tests.api.ai import summary_support
from tests.api.ai.metrics_support import get_metric, metric_body
from tests.api.ai.summary_support import (
    CHATGPT,
    GEMINI,
    Summary,
    answer_in_another_project,
    new_topic,
    statements,
    summary_data,
)
from tests.api.auth.support import execute, make_workspace
from tests.api.entities.support import problem
from tests.api.keywords.test_tracked_keyword_ranks import Ledger
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import add_prompt
from tests.collectors.support import Project
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

seeded = summary_support.seeded

MENTION = "ai.mention_rate"
OUTCOMES = [
    "ai.outcome_mix.mentioned_and_cited",
    "ai.outcome_mix.mentioned_only",
    "ai.outcome_mix.cited_only",
    "ai.outcome_mix.neither",
]
# Every key the breakdown builds, the outcome mix by its parent key.
KEYS = [
    "ai.mention_rate",
    "ai.citation_rate",
    "ai.mention_and_citation_rate",
    "ai.outcome_mix",
    "ai.share_of_voice",
    "ai.citation_rate_given_citations",
    "ai.first_mention_rate",
    "ai.fanout_presence_rate",
    "ai.fanout_mean_queries",
]
DIMENSIONS = [
    "topic",
    "intent",
    "funnel_stage",
    "engine",
    "country",
    "language",
    "persona",
    "prompt_type",
]
# The dimensions a prompt has one value of (its topics are many): the rows hold each prompt once.
SINGLE_VALUED = ["intent", "funnel_stage", "country", "language", "persona", "prompt_type"]
TOPIC_NOTE = "A prompt in two topics counts in each; topic values do not add up to the total."


async def _attributes(migrated: PostgresServer, world: Summary) -> None:
    """The attributes of the table in the docstring; the persona is a term of its own vocabulary."""
    for name, intent, stage, kind, language, country in (
        ("providers", "commercial", "tofu", "comparison", "en", "IN"),
        ("pricing", "commercial", "bofu", "question", "en", "IN"),
        ("misc", "informational", "tofu", "question", "es", "US"),
        ("brand", "commercial", "unknown", "question", "en", "US"),
    ):
        await execute(
            migrated,
            "UPDATE ai.prompts SET intent = $2, funnel_stage = $3, prompt_type = $4, "
            "language_code = $5, country_iso = $6 WHERE id = $1",
            world.prompts[name].id,
            intent,
            stage,
            kind,
            language,
            country,
        )
    buyer = await new_topic(migrated, world.project, "Buyer", kind="persona")
    await execute(
        migrated,
        "UPDATE ai.prompts SET persona_term_id = $2 WHERE id = $1",
        world.prompts["providers"].id,
        buyer,
    )


@pytest.fixture
async def attributed(migrated: PostgresServer, seeded: Summary) -> Summary:
    await _attributes(migrated, seeded)
    return seeded


async def _breakdown(
    world: Summary,
    api: httpx.AsyncClient,
    dimension: str,
    key: str = MENTION,
    **params: Any,
) -> dict[str, Any]:
    return await metric_body(world, api, key, "breakdown", dimension=dimension, **params)


def _row(body: dict[str, Any], row_id: str | None) -> dict[str, Any]:
    """The row of a group by its dimension id (None: the group of prompts with no value)."""
    found = [row for row in body["data"] if row["dimension"]["id"] == row_id]
    assert len(found) == 1, (row_id, [row["dimension"] for row in body["data"]])
    row: dict[str, Any] = found[0]
    return row


def _value(row: dict[str, Any], engine: str, metric: str | None = None) -> dict[str, Any]:
    """The one value of an engine (and metric) of a row."""
    found = [
        value
        for value in row["values"]
        if value["engine_code"] == engine and (metric is None or value["metric"] == metric)
    ]
    assert len(found) == 1, (
        engine,
        metric,
        [(v["metric"], v["engine_code"]) for v in row["values"]],
    )
    value: dict[str, Any] = found[0]
    return value


def _labels(body: dict[str, Any]) -> list[tuple[str | None, str | None, int]]:
    """(id, label, prompts) of each row, in order."""
    return [(r["dimension"]["id"], r["dimension"]["label"], r["prompts"]) for r in body["data"]]


def _check(
    value: dict[str, Any],
    numerator: float,
    denominator: int,
    n_observations: int,
    pooled: tuple[int, int] | None,
) -> None:
    """The counts of a prompt weighted value, and `value` as their quotient."""
    assert value["numerator"] == pytest.approx(numerator)
    assert value["denominator"] == denominator
    assert value["n_observations"] == n_observations
    if pooled is None:
        assert "pooled" not in value
    else:
        assert (value["pooled"]["successes"], value["pooled"]["trials"]) == pooled
        assert value["n_prompts"] == denominator
    expected = None if denominator == 0 else numerator / denominator
    assert value["value"] == (None if expected is None else pytest.approx(expected))


def _same(a: dict[str, Any], b: dict[str, Any]) -> None:
    """Two values with the same counts (the floats to a rounding error)."""
    assert (a["metric"], a["engine_code"]) == (b["metric"], b["engine_code"])
    for field in ("value", "numerator"):
        assert a[field] == (None if b[field] is None else pytest.approx(b[field])), field
    for field in ("denominator", "n_observations", "n_prompts", "pooled", "aggregation"):
        assert a.get(field) == b.get(field), field


# --- topic, country, engine: the summary's own rows ------------------------------------------


async def test_the_topic_breakdown_equals_the_summary_topic_rows(
    api: httpx.AsyncClient, attributed: Summary
) -> None:
    body = await _breakdown(attributed, api, "topic")
    summary = await summary_data(attributed, api, rows="topics")

    soc = _row(body, str(attributed.topics["soc"]))
    compliance = _row(body, str(attributed.topics["compliance"]))
    # Managed SOC is providers and pricing (misc has no topic, the archived prompt is out of
    # scope): ChatGPT 0.4 + 0 over 2 prompts, answers 2 of 6 valid, 7 answers in all.
    assert (soc["dimension"]["type"], soc["dimension"]["label"], soc["prompts"]) == (
        "topic",
        "Managed SOC",
        2,
    )
    _check(_value(soc, CHATGPT), 0.4, 2, 7, (2, 6))
    # Gemini answered providers only: 1 of 1.
    _check(_value(soc, GEMINI), 1, 1, 1, (1, 1))
    # Compliance is providers alone: 2 of 5 in 6 answers.
    assert compliance["prompts"] == 1
    _check(_value(compliance, CHATGPT), 0.4, 1, 6, (2, 5))
    # The same cells the summary holds for its topic rows, row by row and engine by engine.
    for topic in summary["topics"]:
        row = _row(body, None if topic["term_id"] is None else topic["term_id"])
        assert row["prompts"] == topic["prompt_count"]
        for engine in topic["engines"]:
            cell = engine["mentioned"]
            value = _value(row, engine["engine_code"])
            assert value["numerator"] == pytest.approx(cell["numerator"])
            assert (value["denominator"], value["n_observations"], value["pooled"]) == (
                cell["denominator"],
                cell["n_observations"],
                cell["pooled"],
            )


async def test_a_prompt_in_two_topics_counts_in_each_and_the_notes_say_so(
    api: httpx.AsyncClient, attributed: Summary
) -> None:
    topics = await _breakdown(attributed, api, "topic")
    scope = await metric_body(attributed, api, "ai.prompts_in_scope")

    # providers is in Managed SOC and in Compliance: 2 + 1 + 1 (misc, no topic) over 3 prompts.
    assert sum(row["prompts"] for row in topics["data"]) == 4
    assert scope["data"][0]["value"] == 3
    assert topics["meta"]["notes"] == [TOPIC_NOTE]
    for dimension in (d for d in DIMENSIONS if d != "topic"):
        assert (await _breakdown(attributed, api, dimension))["meta"]["notes"] == [], dimension


async def test_the_prompts_without_a_topic_are_a_row_with_a_null_id(
    api: httpx.AsyncClient, attributed: Summary
) -> None:
    body = await _breakdown(attributed, api, "topic")

    # By prompts, most first; then by label, the group with no value last.
    assert _labels(body) == [
        (str(attributed.topics["soc"]), "Managed SOC", 2),
        (str(attributed.topics["compliance"]), "Compliance", 1),
        (None, None, 1),
    ]
    none = body["data"][-1]
    # misc alone: 1 of 1 on ChatGPT; Gemini has no answer to it, a null value and zero counts.
    _check(_value(none, CHATGPT), 1, 1, 1, (1, 1))
    gemini = _value(none, GEMINI)
    assert gemini["value"] is None
    _check(gemini, 0, 0, 0, (0, 0))


async def test_the_country_breakdown_has_a_row_per_market_of_the_prompts(
    api: httpx.AsyncClient, migrated: PostgresServer, attributed: Summary
) -> None:
    body = await _breakdown(attributed, api, "country")

    # providers and pricing are IN, misc is US; the label is the code.
    assert _labels(body) == [("IN", "IN", 2), ("US", "US", 1)]
    _check(_value(_row(body, "IN"), CHATGPT), 0.4, 2, 7, (2, 6))
    _check(_value(_row(body, "US"), CHATGPT), 1, 1, 1, (1, 1))
    _check(_value(_row(body, "IN"), GEMINI), 1, 1, 1, (1, 1))
    # The summary's own market rows hold the same cells.
    by_country = (await summary_data(attributed, api, rows="none", group_by="country"))[
        "by_country"
    ]
    for entry in by_country:
        for engine in entry["engines"]:
            value = _value(_row(body, entry["country_iso"]), engine["engine_code"])
            assert value["numerator"] == pytest.approx(engine["mentioned"]["numerator"])
            assert value["denominator"] == engine["mentioned"]["denominator"]
            assert value["pooled"] == engine["mentioned"]["pooled"]
    # A prompt with no market is a row of its own, last.
    await execute(
        migrated,
        "UPDATE ai.prompts SET country_iso = NULL WHERE id = $1",
        attributed.prompts["misc"].id,
    )
    after = await _breakdown(attributed, api, "country")
    assert _labels(after) == [("IN", "IN", 2), (None, None, 1)]


async def test_the_engine_breakdown_is_a_row_per_engine(
    api: httpx.AsyncClient, attributed: Summary
) -> None:
    body = await _breakdown(attributed, api, "engine")
    overview = await metric_body(attributed, api, MENTION)

    # The id is the code and the label the engine's; each row holds the prompts in scope and the
    # one value of its engine, the same as the metric route gives.
    assert _labels(body) == [(CHATGPT, "ChatGPT", 3), (GEMINI, "Gemini", 3)]
    for row, engine in zip(body["data"], overview["data"][:2], strict=True):
        assert row["dimension"]["type"] == "engine"
        assert len(row["values"]) == 1
        _same(row["values"][0], engine)
    _check(_value(body["data"][0], CHATGPT), 1.4, 3, 8, (3, 7))


# --- the attribute dimensions: groups of the summary's prompt rows ---------------------------


async def test_the_intent_breakdown_groups_by_intent_and_equals_a_hand_reduce(
    api: httpx.AsyncClient, attributed: Summary
) -> None:
    body = await _breakdown(attributed, api, "intent")

    # The id and the label are the stored value; most prompts first.
    assert _labels(body) == [("commercial", "commercial", 2), ("informational", "informational", 1)]
    commercial, informational = body["data"]
    assert commercial["dimension"]["type"] == "intent"
    # providers 2/5 = 0.4 and pricing 0/1 = 0: numerator 0.4 over 2 prompts, answers 2 of 6, in 7.
    value = _value(commercial, CHATGPT)
    _check(value, 0.4, 2, 7, (2, 6))
    assert value["value"] == pytest.approx(0.2)
    assert (value["aggregation"], value["unit"], value["method_version"]) == (
        "prompt_weighted",
        "ratio",
        1,
    )
    assert value["window"] == body["meta"]["window"]
    # Gemini answered providers alone: 1 of 1 (pricing has no valid Gemini answer, not a 0).
    _check(_value(commercial, GEMINI), 1, 1, 1, (1, 1))
    # misc alone.
    _check(_value(informational, CHATGPT), 1, 1, 1, (1, 1))
    _check(_value(informational, GEMINI), 0, 0, 0, (0, 0))
    # One value per engine, no average of the engines, in engine order.
    assert [v["engine_code"] for v in commercial["values"]] == [CHATGPT, GEMINI]
    assert not [v for row in body["data"] for v in row["values"] if "average" in v["metric"]]
    assert (body["meta"]["rows_total"], body["meta"]["truncated"]) == (2, False)
    assert body["meta"]["engine_codes"] == [CHATGPT, GEMINI]


@pytest.mark.parametrize("key", KEYS)
async def test_a_group_equals_the_topic_row_of_the_same_prompts_for_every_key(
    api: httpx.AsyncClient, attributed: Summary, key: str
) -> None:
    """The consistency guard of the reduce: the commercial prompts are the prompts of Managed SOC,
    so the group built from the prompt rows is the topic row the summary built from the counts."""
    by_intent = await _breakdown(attributed, api, "intent", key)
    by_topic = await _breakdown(attributed, api, "topic", key)

    commercial = _row(by_intent, "commercial")
    soc = _row(by_topic, str(attributed.topics["soc"]))

    assert commercial["prompts"] == soc["prompts"] == 2
    assert [(v["metric"], v["engine_code"]) for v in commercial["values"]] == [
        (v["metric"], v["engine_code"]) for v in soc["values"]
    ]
    assert commercial["values"]
    for ours, theirs in zip(commercial["values"], soc["values"], strict=True):
        _same(ours, theirs)


async def test_funnel_stage_prompt_type_and_language_group_the_same_way(
    api: httpx.AsyncClient, attributed: Summary
) -> None:
    stages = await _breakdown(attributed, api, "funnel_stage")
    kinds = await _breakdown(attributed, api, "prompt_type")
    languages = await _breakdown(attributed, api, "language")

    # tofu is providers and misc: (0.4 + 1) over 2 prompts, answers 3 of 6 valid, in 7.
    assert _labels(stages) == [("tofu", "tofu", 2), ("bofu", "bofu", 1)]
    _check(_value(_row(stages, "tofu"), CHATGPT), 1.4, 2, 7, (3, 6))
    _check(_value(_row(stages, "bofu"), CHATGPT), 0, 1, 1, (0, 1))
    # question is pricing and misc: (0 + 1) over 2, answers 1 of 2; comparison is providers.
    assert _labels(kinds) == [("question", "question", 2), ("comparison", "comparison", 1)]
    _check(_value(_row(kinds, "question"), CHATGPT), 1, 2, 2, (1, 2))
    _check(_value(_row(kinds, "comparison"), CHATGPT), 0.4, 1, 6, (2, 5))
    # en is providers and pricing, es is misc; the label is the language code.
    assert _labels(languages) == [("en", "en", 2), ("es", "es", 1)]
    _check(_value(_row(languages, "en"), CHATGPT), 0.4, 2, 7, (2, 6))
    _check(_value(_row(languages, "es"), CHATGPT), 1, 1, 1, (1, 1))
    for body, kind in ((stages, "funnel_stage"), (kinds, "prompt_type"), (languages, "language")):
        assert {row["dimension"]["type"] for row in body["data"]} == {kind}


@pytest.mark.parametrize("dimension", SINGLE_VALUED)
async def test_every_prompt_is_in_exactly_one_row_of_a_single_valued_dimension(
    api: httpx.AsyncClient, attributed: Summary, dimension: str
) -> None:
    body = await _breakdown(attributed, api, dimension)
    scope = await metric_body(attributed, api, "ai.prompts_in_scope")

    assert sum(row["prompts"] for row in body["data"]) == scope["data"][0]["value"] == 3
    # The group of the prompts with no value (the persona) is kept, not dropped.
    assert all(row["prompts"] >= 1 for row in body["data"])


async def test_the_persona_breakdown_labels_the_term_and_has_a_null_row(
    api: httpx.AsyncClient, attributed: Summary
) -> None:
    body = await _breakdown(attributed, api, "persona")

    buyer = await _persona_id(body)
    # pricing and misc have no persona: (0 + 1) over 2 prompts, answers 1 of 2; first, 2 prompts.
    assert _labels(body) == [(None, None, 2), (buyer, "Buyer", 1)]
    _check(_value(_row(body, None), CHATGPT), 1, 2, 2, (1, 2))
    _check(_value(_row(body, buyer), CHATGPT), 0.4, 1, 6, (2, 5))
    assert {row["dimension"]["type"] for row in body["data"]} == {"persona"}


async def _persona_id(body: dict[str, Any]) -> str:
    named = [row["dimension"]["id"] for row in body["data"] if row["dimension"]["id"] is not None]
    assert len(named) == 1
    return str(named[0])


# --- keys ------------------------------------------------------------------------------------


async def test_the_outcome_mix_has_four_values_per_engine_that_add_up_to_the_whole(
    api: httpx.AsyncClient, attributed: Summary
) -> None:
    body = await _breakdown(attributed, api, "intent", "ai.outcome_mix")

    commercial = _row(body, "commercial")
    assert [v["metric"] for v in commercial["values"]] == [*OUTCOMES, *OUTCOMES]
    assert [v["engine_code"] for v in commercial["values"]] == [CHATGPT] * 4 + [GEMINI] * 4
    # providers 1/5, 1/5, 1/5, 2/5 and pricing 0, 0, 0, 1/1 over 2 prompts.
    for key, numerator, pooled in zip(
        OUTCOMES, (0.2, 0.2, 0.2, 1.4), ((1, 6), (1, 6), (1, 6), (3, 6)), strict=True
    ):
        _check(_value(commercial, CHATGPT, key), numerator, 2, 7, pooled)
    chatgpt = [_value(commercial, CHATGPT, key) for key in OUTCOMES]
    assert sum(v["value"] for v in chatgpt) == pytest.approx(1)
    assert {v["denominator"] for v in chatgpt} == {2}


async def test_the_share_of_voice_is_a_sum_over_sums_with_no_prompts(
    api: httpx.AsyncClient, attributed: Summary
) -> None:
    body = await _breakdown(attributed, api, "intent", "ai.share_of_voice")

    # providers 1.5 of 3 answers that name a tracked entity, pricing 0 of 0: 1.5 of 3, in 7.
    value = _value(_row(body, "commercial"), CHATGPT)
    _check(value, 1.5, 3, 7, None)
    assert (value["value"], value["aggregation"]) == (pytest.approx(0.5), "observation_weighted")
    assert "n_prompts" not in value


async def test_the_fanout_keys_have_a_value_for_an_engine_that_exposes_fanout_only(
    api: httpx.AsyncClient, attributed: Summary
) -> None:
    by_intent = await _breakdown(attributed, api, "intent", "ai.fanout_presence_rate")
    by_engine = await _breakdown(attributed, api, "engine", "ai.fanout_mean_queries")

    # Not exposed is not 0: Gemini has no such value, in a group or as an engine row.
    for row in by_intent["data"]:
        assert [v["engine_code"] for v in row["values"]] == [CHATGPT]
    assert [(row["dimension"]["id"], len(row["values"])) for row in by_engine["data"]] == [
        (CHATGPT, 1),
        (GEMINI, 0),
    ]


@pytest.mark.parametrize(
    "key",
    [
        "ai.citation_share",
        "ai.valid_answers",
        "ai.prompts_in_scope",
        "ai.recommendation_rate",
        "ai.recommended_given_mentioned",
    ],
)
async def test_a_key_built_for_other_routes_is_501_for_a_breakdown(
    api: httpx.AsyncClient, attributed: Summary, key: str
) -> None:
    response = await get_metric(attributed, api, key, "breakdown", dimension="topic")

    assert problem(response) == (501, "not_implemented")
    assert response.json()["detail"] == f"Not built yet: {key} on breakdown."


async def test_an_unbuilt_key_is_501_and_an_unknown_key_404_before_any_read(
    api: httpx.AsyncClient, migrated: PostgresServer, attributed: Summary
) -> None:
    await execute(
        migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", attributed.project.id
    )

    unbuilt = await get_metric(attributed, api, "ai.sentiment", "breakdown", dimension="topic")
    unknown = await get_metric(attributed, api, "seo.top3_count", "breakdown", dimension="topic")
    deleted = await get_metric(attributed, api, MENTION, "breakdown", dimension="topic")

    assert problem(unbuilt) == (501, "not_implemented")
    assert unbuilt.json()["detail"] == "Not built yet: ai.sentiment."
    assert problem(unknown) == (404, "unknown_metric")
    assert problem(deleted) == (404, "not_found")


async def test_the_dimension_must_be_one_of_the_eight(
    api: httpx.AsyncClient, attributed: Summary
) -> None:
    for dimension in ("vocabulary", "Topic", "intent,topic"):
        response = await get_metric(attributed, api, MENTION, "breakdown", dimension=dimension)

        assert problem(response) == (422, "validation_failed"), dimension
    missing = await get_metric(attributed, api, MENTION, "breakdown")
    assert problem(missing) == (422, "validation_failed")


# --- the cap ---------------------------------------------------------------------------------


async def test_breakdown_rows_stop_at_the_cap_and_say_so(
    api: httpx.AsyncClient, attributed: Summary, monkeypatch: pytest.MonkeyPatch
) -> None:
    """300 rows are heavy to seed, so the cap is lowered to 2 for a world of three topic rows."""
    whole = await _breakdown(attributed, api, "topic")
    assert metrics.BREAKDOWN_MAX == 300
    assert (whole["meta"]["rows_total"], whole["meta"]["truncated"], len(whole["data"])) == (
        3,
        False,
        3,
    )

    monkeypatch.setattr(metrics, "BREAKDOWN_MAX", 2)
    cut = await _breakdown(attributed, api, "topic")
    attributes = await _breakdown(attributed, api, "intent")

    # The two rows with the most prompts stay; the count is the rows before the cap.
    assert [row["dimension"]["id"] for row in cut["data"]] == [
        row["dimension"]["id"] for row in whole["data"][:2]
    ]
    assert (cut["meta"]["rows_total"], cut["meta"]["truncated"]) == (3, True)
    # A dimension with as many rows as the cap is not cut.
    assert (attributes["meta"]["rows_total"], attributes["meta"]["truncated"]) == (2, False)
    assert len(attributes["data"]) == 2


# --- scope -----------------------------------------------------------------------------------


async def test_a_breakdown_leaves_out_branded_prompts_unless_asked(
    api: httpx.AsyncClient, attributed: Summary
) -> None:
    default = await _breakdown(attributed, api, "intent")
    asked = await _breakdown(attributed, api, "intent", include_branded="true")
    only = await _breakdown(attributed, api, "intent", branded_only="true")

    # The branded prompt `brand` is commercial and named the own brand once (1 of 1, 1 answer).
    assert _row(default, "commercial")["prompts"] == 2
    assert asked["meta"]["include_branded"] is True
    assert _row(asked, "commercial")["prompts"] == 3
    # providers 0.4 + pricing 0 + brand 1 over 3 prompts, answers 3 of 7, in 8.
    _check(_value(_row(asked, "commercial"), CHATGPT), 1.4, 3, 8, (3, 7))
    # branded_only wins over include_branded: the one prompt alone.
    assert _labels(only) == [("commercial", "commercial", 1)]
    _check(_value(_row(only, "commercial"), CHATGPT), 1, 1, 1, (1, 1))
    assert (only["meta"]["branded_only"], only["meta"]["include_branded"]) == (True, True)


async def test_a_breakdown_follows_the_term_subtree(
    api: httpx.AsyncClient, attributed: Summary
) -> None:
    compliance = str(attributed.topics["compliance"])
    soc = str(attributed.topics["soc"])

    one = await _breakdown(attributed, api, "intent", **{"filter[term]": compliance})
    two = await _breakdown(attributed, api, "intent", **{"filter[term]": soc})
    topics = await _breakdown(attributed, api, "topic", **{"filter[term]": compliance})

    # Compliance is providers alone: informational (misc) is not in scope.
    assert _labels(one) == [("commercial", "commercial", 1)]
    _check(_value(_row(one, "commercial"), CHATGPT), 0.4, 1, 6, (2, 5))
    assert _labels(two) == [("commercial", "commercial", 2)]
    _check(_value(_row(two, "commercial"), CHATGPT), 0.4, 2, 7, (2, 6))
    # Under a term filter the topic rows are the term's: no row for the prompts with no topic.
    assert _labels(topics) == [(compliance, "Compliance", 1)]


async def test_a_breakdown_follows_the_country_and_engine_filters(
    api: httpx.AsyncClient, attributed: Summary
) -> None:
    india = await _breakdown(attributed, api, "intent", **{"filter[country_iso]": "IN"})
    gemini = await _breakdown(attributed, api, "intent", **{"filter[engine_code_in]": GEMINI})
    markets = await _breakdown(attributed, api, "country", **{"filter[country_iso]": "IN"})

    # providers and pricing are IN; misc (informational) is not in scope.
    assert _labels(india) == [("commercial", "commercial", 2)]
    _check(_value(_row(india, "commercial"), CHATGPT), 0.4, 2, 7, (2, 6))
    assert _labels(markets) == [("IN", "IN", 2)]
    # One engine: its value only, and the prompts of the scope are still counted.
    assert gemini["meta"]["engine_codes"] == [GEMINI]
    assert _labels(gemini) == [
        ("commercial", "commercial", 2),
        ("informational", "informational", 1),
    ]
    for row in gemini["data"]:
        assert [v["engine_code"] for v in row["values"]] == [GEMINI]


async def test_a_breakdown_has_no_compare_and_no_previous(
    api: httpx.AsyncClient, attributed: Summary
) -> None:
    refused = await get_metric(
        attributed, api, MENTION, "breakdown", dimension="intent", compare="previous_period"
    )
    body = await _breakdown(attributed, api, "intent")

    assert problem(refused) == (422, "validation_failed")
    assert "compare_window" not in body["meta"]
    assert all("previous" not in v for row in body["data"] for v in row["values"])


async def test_a_window_without_a_prompt_has_no_rows(
    api: httpx.AsyncClient, attributed: Summary
) -> None:
    for dimension in DIMENSIONS:
        body = await _breakdown(attributed, api, dimension, **{"filter[country_iso]": "FR"})

        assert body["data"] == [], dimension
        assert (body["meta"]["rows_total"], body["meta"]["truncated"]) == (0, False), dimension


# --- other projects and workspaces -----------------------------------------------------------


async def test_another_projects_answers_are_not_counted_in_any_dimension(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    attributed: Summary,
) -> None:
    """A second project of the workspace and a second workspace each answer today, naming their
    brand and citing a page: no dimension moves."""
    scope = {"include_branded": "true"}
    before = {d: await _breakdown(attributed, api, d, **scope) for d in DIMENSIONS}
    other_workspace = await make_workspace(migrated)
    for number, workspace_id in enumerate((attributed.workspace.id, other_workspace.id)):
        await answer_in_another_project(
            migrated, worker_db, import_store, workspace_id, f"Otherco{number}", 1
        )
    await ingest(worker_db, import_store)

    for dimension in DIMENSIONS:
        after = await _breakdown(attributed, api, dimension, **scope)

        assert after == before[dimension], dimension


async def test_the_prompt_attributes_read_stays_in_the_project(
    resources: Resources, migrated: PostgresServer, attributed: Summary
) -> None:
    mine = attributed.prompts["providers"]
    other = Project(attributed.workspace.id, await make_project(migrated, attributed.workspace.id))
    theirs = await add_prompt(migrated, other, "Best managed SOC providers in Mumbai?")
    workspace_id, project_id = attributed.workspace.id, attributed.project.id

    async with workspace_transaction(resources.sessions, workspace_id) as db:
        found = await repository.prompt_attributes(
            db, workspace_id, project_id, [mine.id, theirs.id]
        )
        with statements(resources) as seen:
            nothing = await repository.prompt_attributes(db, workspace_id, project_id, [])
        unknown = await repository.prompt_attributes(db, workspace_id, project_id, [uuid.uuid4()])

    # The prompt of another project of the workspace is not returned, whatever the ids asked for.
    assert set(found) == {mine.id}
    assert found[mine.id].intent == "commercial"
    assert (found[mine.id].funnel_stage, found[mine.id].prompt_type) == ("tofu", "comparison")
    assert (found[mine.id].language_code, found[mine.id].country_iso) == ("en", "IN")
    assert found[mine.id].persona_term_id is not None
    # No id asked for, no statement; an id that is no prompt gives nothing.
    assert (nothing, seen, unknown) == ({}, [], {})
