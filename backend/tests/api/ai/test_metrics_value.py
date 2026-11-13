"""One metric (contract C8, route 3): one value per engine, per listed entity with `entity_ids`,
the averages of the engines, four values per engine for the outcome mix, `previous` with compare,
and the three answers to a key that is not built (404, 501, 200 suppressed). Read from the prompts
summary and the sources lane over the seeded world of `test_prompts_summary` (see the docstring of
its `summary` fixture). The expected numbers are worked out by hand from that world: ChatGPT,
default scope (the prompts `providers`, `pricing` and `misc`; the branded prompt and the archived
one are not in scope):

    providers  6 answers, 5 valid:  Mentioned 2/5, Cited 2/5, outcomes 1/5 1/5 1/5 2/5, SOV 3/2
    pricing    1 answer, valid:     Mentioned 0/1, Cited 0/1, outcome neither,           SOV none
    misc       1 answer, valid:     Mentioned 1/1, Cited 1/1, outcome mentioned+cited,   SOV 1
    prompt weighted over the 3 prompts: Mentioned (2/5 + 0 + 1) = 1.4 of 3, answers 3 of 7, in 8
    The rival is named in providers (answers 1 and 4) and in nothing else: Mentioned 2/5 of one
    prompt = 0.4 of 3 prompts, answers 2 of 7; Share of voice 1/2 + 1 = 1.5 of 4 answers.
    Gemini: one answer naming both brands and citing the own page: every rate 1 of 1, each
    brand 1/2 of the share of voice."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest

from idraft.api.resources import Resources
from idraft.collectors.ai_prompt_ingest import ingest
from tests.api.ai import summary_support
from tests.api.ai.metrics_support import engine_tiles, get_metric, metric_body, overview_data
from tests.api.ai.summary_support import (
    CHATGPT,
    GEMINI,
    OWN_ONLY,
    OWN_PAGE,
    Answer,
    Summary,
    answer_in_another_project,
    day,
    ingested,
    summary_data,
)
from tests.api.ai.test_metrics_overview import _two_versions as two_versions
from tests.api.auth.support import execute, fetchrow, make_workspace
from tests.api.entities.support import entities_url, member, problem
from tests.api.keywords.support import project_url
from tests.api.keywords.test_tracked_keyword_ranks import Ledger
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import enable_engine
from tests.collectors.rank_support import _entity
from tests.collectors.support import Project
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

seeded = summary_support.seeded

OUTCOMES = [
    "ai.outcome_mix.mentioned_and_cited",
    "ai.outcome_mix.mentioned_only",
    "ai.outcome_mix.cited_only",
    "ai.outcome_mix.neither",
]
AI_MODE = "google_ai_mode"


def _counts(value: dict[str, Any]) -> tuple[Any, Any, Any]:
    """(numerator, denominator, n_observations) of a value."""
    return value["numerator"], value["denominator"], value["n_observations"]


def _cell_counts(cell: dict[str, Any]) -> tuple[Any, Any, Any]:
    return cell["numerator"], cell["denominator"], cell["n_observations"]


def _of(body: dict[str, Any], engine: str, metric: str | None = None) -> dict[str, Any]:
    """The one value of an engine (and metric) of a body."""
    found = [
        value
        for value in body["data"]
        if value.get("engine_code") == engine and (metric is None or value["metric"] == metric)
    ]
    assert len(found) == 1, (engine, metric, [value["metric"] for value in body["data"]])
    value: dict[str, Any] = found[0]
    return value


def _codes(response: httpx.Response) -> set[tuple[str, str]]:
    return {(item["path"], item["code"]) for item in response.json()["errors"]}


async def test_a_key_gives_one_value_per_engine_and_an_average_with_two(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    body = await metric_body(seeded, api, "ai.mention_rate")

    # Engines by code, then the average of the engines.
    assert [(v["metric"], v.get("engine_code")) for v in body["data"]] == [
        ("ai.mention_rate", CHATGPT),
        ("ai.mention_rate", GEMINI),
        ("ai.mention_rate.engine_average", None),
    ]
    chatgpt, gemini, average = body["data"]
    # Providers 2/5 + pricing 0/1 + misc 1/1 = 1.4 over 3 prompts; 3 of 7 valid answers; 8 answers.
    assert _counts(chatgpt) == (pytest.approx(1.4), 3, 8)
    assert chatgpt["value"] == pytest.approx(1.4 / 3)
    assert (chatgpt["n_prompts"], chatgpt["pooled"]) == (3, {"successes": 3, "trials": 7})
    assert (chatgpt["aggregation"], chatgpt["unit"]) == ("prompt_weighted", "ratio")
    assert _counts(gemini) == (1, 1, 1)
    # The mean of the two rates, not of the 9 answers.
    assert average["numerator"] == pytest.approx(1.4 / 3 + 1)
    assert average["denominator"] == 2
    assert average["value"] == pytest.approx((1.4 / 3 + 1) / 2)
    assert (average["engines"], average["n_observations"]) == ([CHATGPT, GEMINI], 9)
    assert "pooled" not in average
    assert "engine_code" not in average
    assert body["meta"]["engine_codes"] == [CHATGPT, GEMINI]
    assert body["meta"]["notes"] == []
    for value in body["data"]:
        assert value["window"] == body["meta"]["window"]
        assert (value["is_estimate"], value["method_version"]) == (False, 1)
        assert "ci" not in value
        assert "previous" not in value


async def test_the_average_needs_two_engines_with_a_value(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    only = await metric_body(seeded, api, "ai.mention_rate", **{"filter[engine_code_in]": GEMINI})
    await enable_engine(migrated, seeded.project, AI_MODE)
    third = await metric_body(seeded, api, "ai.mention_rate")

    # One engine is no average: the list is that engine's value alone.
    assert [v["metric"] for v in only["data"]] == ["ai.mention_rate"]
    # An engine that has no answer has a null value and zero counts, and is left out of the mean.
    assert [v.get("engine_code") for v in third["data"]] == [CHATGPT, GEMINI, AI_MODE, None]
    empty = third["data"][2]
    assert (empty["value"], _counts(empty)) == (None, (0, 0, 0))
    assert third["data"][3]["engines"] == [CHATGPT, GEMINI]
    assert third["data"][3]["denominator"] == 2


async def test_the_keys_with_an_average_are_the_five_of_the_overview(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    averaged = {
        "ai.mention_rate",
        "ai.citation_rate",
        "ai.mention_and_citation_rate",
        "ai.share_of_voice",
        "ai.citation_share",
    }
    for key in [*averaged, "ai.valid_answers", "ai.first_mention_rate", "ai.outcome_mix.neither"]:
        body = await metric_body(seeded, api, key)

        has = any(v["metric"].endswith(".engine_average") for v in body["data"])
        assert has == (key in averaged), key


async def test_the_outcome_mix_has_four_values_per_engine_that_add_up_to_the_whole(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    body = await metric_body(seeded, api, "ai.outcome_mix")

    # Engines by code, the four outcomes in the order of the note for each.
    assert [(v["metric"], v["engine_code"]) for v in body["data"]] == [
        (key, code) for code in (CHATGPT, GEMINI) for key in OUTCOMES
    ]
    chatgpt, gemini = body["data"][:4], body["data"][4:]
    # 1.2 + 0.2 + 0.2 + 1.4 = 3 prompts, each of the four over the same 3 prompts and 8 answers.
    assert [v["numerator"] for v in chatgpt] == pytest.approx([1.2, 0.2, 0.2, 1.4])
    assert {v["denominator"] for v in chatgpt} == {3}
    assert {v["n_observations"] for v in chatgpt} == {8}
    assert sum(v["value"] for v in chatgpt) == pytest.approx(1.0)
    assert sum(v["numerator"] for v in chatgpt) == chatgpt[0]["denominator"]
    # Gemini's one answer names the brand and cites the page.
    assert [v["numerator"] for v in gemini] == [1, 0, 0, 0]
    assert {v["denominator"] for v in gemini} == {1}
    assert sum(v["value"] for v in gemini) == pytest.approx(1.0)


async def test_a_sub_key_of_the_outcome_mix_gives_its_one_value(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    body = await metric_body(seeded, api, "ai.outcome_mix.neither")

    assert [(v["metric"], v["engine_code"]) for v in body["data"]] == [
        ("ai.outcome_mix.neither", CHATGPT),
        ("ai.outcome_mix.neither", GEMINI),
    ]
    assert _counts(body["data"][0]) == (pytest.approx(1.4), 3, 8)
    assert _counts(body["data"][1]) == (0, 1, 1)
    both = await metric_body(seeded, api, "ai.mention_and_citation_rate")
    assert _counts(both["data"][0]) == (pytest.approx(1.2), 3, 8)


async def test_the_cells_of_the_summary_are_the_values_of_their_keys(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    total = (await summary_data(seeded, api, include="total", rows="none"))["total"]

    for engine in total["engines"]:
        code = engine["engine_code"]
        same = {
            "ai.mention_rate": engine["mentioned"],
            "ai.citation_rate": engine["cited"],
            "ai.mention_and_citation_rate": engine["outcomes"]["mentioned_and_cited"],
            "ai.share_of_voice": engine["share_of_voice"],
            "ai.outcome_mix.neither": engine["outcomes"]["neither"],
        }
        for key, cell in same.items():
            value = _of(await metric_body(seeded, api, key), code, key)
            assert (value["value"], *_counts(value)) == (
                cell["value"],
                *_cell_counts(cell),
            ), (code, key)
            assert value.get("pooled") == cell["pooled"], (code, key)


async def test_share_of_voice_has_no_pooled_counts_and_one_answer_one_weight(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    body = await metric_body(seeded, api, "ai.share_of_voice")

    chatgpt = _of(body, CHATGPT)
    # Providers: 3 answers name a tracked entity (1/2 + 1 + 0), misc 1.
    assert _counts(chatgpt) == (2.5, 4, 8)
    assert chatgpt["aggregation"] == "observation_weighted"
    assert "pooled" not in chatgpt
    assert "n_prompts" not in chatgpt
    assert _counts(_of(body, GEMINI)) == (0.5, 1, 1)


async def test_the_two_new_keys_answer(api: httpx.AsyncClient, seeded: Summary) -> None:
    prompts = await metric_body(seeded, api, "ai.prompts_in_scope")
    valid = await metric_body(seeded, api, "ai.valid_answers")

    # Each prompt once, whatever its engines: no engine and no denominator.
    assert [v["metric"] for v in prompts["data"]] == ["ai.prompts_in_scope"]
    only = prompts["data"][0]
    assert (only["value"], only["numerator"], only["denominator"], only["unit"]) == (
        3,
        3,
        None,
        "count",
    )
    assert only["n_observations"] == 9
    for member_ in ("engine_code", "observation_class", "aggregation"):
        assert member_ not in only
    # ChatGPT: 8 answers, one of them a refusal: 7 valid. Gemini: its one answer.
    assert [(v["engine_code"], v["value"], v["n_observations"]) for v in valid["data"]] == [
        (CHATGPT, 7, 8),
        (GEMINI, 1, 1),
    ]
    assert {v["denominator"] for v in valid["data"]} == {None}
    assert {v["unit"] for v in valid["data"]} == {"count"}
    assert "aggregation" not in valid["data"][0]


async def test_recommendation_is_200_and_suppressed(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    for key in ("ai.recommendation_rate", "ai.recommended_given_mentioned"):
        body = await metric_body(seeded, api, key)

        assert [(v["engine_code"], v["n_observations"]) for v in body["data"]] == [
            (CHATGPT, 7),
            (GEMINI, 1),
        ]
        for value in body["data"]:
            assert (value["value"], value["numerator"], value["denominator"]) == (None, None, None)
            assert value["suppressed_reason"] == "not_classified"
        # A value nobody has is no average.
        assert all("engines" not in value for value in body["data"])


async def test_the_detail_keys_equal_the_summary_detail_cells(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    total = (await summary_data(seeded, api, include="total,cells", rows="none"))["total"]
    keys = {
        "ai.citation_rate_given_citations": "cited_given_citations",
        "ai.first_mention_rate": "first_mention",
        "ai.fanout_presence_rate": "fanout_presence",
        "ai.fanout_mean_queries": "fanout_mean",
    }

    for key, name in keys.items():
        body = await metric_body(seeded, api, key)

        for engine in total["engines"]:
            cell = engine["detail"][name]
            code = engine["engine_code"]
            if cell is None:
                # Not exposed by the engine: no value at all, never a value of 0.
                assert all(v.get("engine_code") != code for v in body["data"]), (key, code)
                continue
            value = _of(body, code)
            assert (value["value"], *_counts(value)) == (cell["value"], *_cell_counts(cell)), key
            assert value.get("pooled") == cell["pooled"], (code, key)


async def test_fanout_keys_leave_out_an_engine_without_fanout(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    for key in ("ai.fanout_presence_rate", "ai.fanout_mean_queries"):
        body = await metric_body(seeded, api, key)

        # ChatGPT exposes its fan-out and Gemini does not: one value, and no average of one.
        assert [v["engine_code"] for v in body["data"]] == [CHATGPT], key
    mean = (await metric_body(seeded, api, "ai.fanout_mean_queries"))["data"][0]
    assert (mean["unit"], mean["aggregation"]) == ("count", "observation_weighted")
    assert (await metric_body(seeded, api, "ai.fanout_presence_rate"))["data"][0][
        "aggregation"
    ] == "prompt_weighted"


async def test_citation_share_key_equals_the_overview_tile(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    body = await metric_body(seeded, api, "ai.citation_share")
    data = await overview_data(seeded, api)

    for code in (CHATGPT, GEMINI):
        tile = engine_tiles(data, code)["ai.citation_share"]
        value = _of(body, code)
        assert (value["value"], *_counts(value)) == (tile["value"], *_counts(tile)), code
    # Own 3, competitor 2 and third party 2 of the 7 valid answers of ChatGPT.
    assert _counts(_of(body, CHATGPT)) == (3, 7, 7)
    assert _of(body, CHATGPT)["value"] == pytest.approx(3 / 7)
    assert [v["metric"] for v in body["data"]][-1] == "ai.citation_share.engine_average"


async def test_branded_prompts_are_left_out_by_default_and_counted_when_asked(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    """The branded prompt has two answers that name the own brand, one of them citing the own
    page: the default scope must not see them, in the rates or in the citation share."""
    await ingested(
        seeded, migrated, worker_db, import_store, [Answer("brand", OWN_ONLY, (OWN_PAGE,), 1)]
    )

    default = await metric_body(seeded, api, "ai.mention_rate")
    with_branded = await metric_body(seeded, api, "ai.mention_rate", include_branded="true")
    branded = await metric_body(seeded, api, "ai.mention_rate", branded_only="true")
    share = await metric_body(seeded, api, "ai.citation_share")
    share_with = await metric_body(seeded, api, "ai.citation_share", include_branded="true")
    share_branded = await metric_body(seeded, api, "ai.citation_share", branded_only="true")

    assert _counts(_of(default, CHATGPT)) == (pytest.approx(1.4), 3, 8)
    assert _counts(_of(share, CHATGPT)) == (3, 7, 7)
    # The branded prompt names the own brand in both its answers: 1.4 + 1 over 4 prompts.
    assert _counts(_of(with_branded, CHATGPT)) == (pytest.approx(2.4), 4, 10)
    assert _of(with_branded, CHATGPT)["filters"]["include_branded"] is True
    assert _counts(_of(share_with, CHATGPT)) == (4, 8, 9)
    # Branded only: the one prompt, and the one citation it has.
    assert _counts(_of(branded, CHATGPT)) == (1, 1, 2)
    assert _of(branded, CHATGPT)["filters"]["branded_only"] is True
    assert _counts(_of(share_branded, CHATGPT)) == (1, 1, 2)
    assert (await metric_body(seeded, api, "ai.prompts_in_scope", branded_only="true"))["data"][0][
        "value"
    ] == 1


async def test_the_term_subtree_scopes_every_value(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    """Managed SOC (the prompts `providers` and `pricing`) is put under a new term Security: a
    filter on Security keeps the prompts given any term below it, `misc` stays out."""
    soc = seeded.topics["soc"]
    parent = await fetchrow(
        migrated,
        "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, name, slug, path) "
        "SELECT workspace_id, vocabulary_id, 'Security', 'security', 'security' "
        "FROM core.taxonomy_terms WHERE id = $1 RETURNING id",
        soc,
    )
    await execute(
        migrated,
        "UPDATE core.taxonomy_terms SET parent_id = $2, path = 'security/managed-soc' "
        "WHERE id = $1",
        soc,
        parent["id"],
    )

    for term in (soc, parent["id"]):
        scope = {"filter[term]": str(term)}
        mention = await metric_body(seeded, api, "ai.mention_rate", **scope)
        share = await metric_body(seeded, api, "ai.citation_share", **scope)

        # Providers 2/5 and pricing 0/1 over 2 prompts, 6 valid answers of 7.
        assert _counts(_of(mention, CHATGPT)) == (pytest.approx(0.4), 2, 7), term
        assert _of(mention, CHATGPT)["pooled"] == {"successes": 2, "trials": 6}
        assert _of(mention, CHATGPT)["filters"]["term_id"] == str(term)
        # Own 2, competitor 2 and third party 2: the citation of `misc` is not counted.
        assert _counts(_of(share, CHATGPT)) == (2, 6, 6), term
        prompts = await metric_body(seeded, api, "ai.prompts_in_scope", **scope)
        assert prompts["data"][0]["value"] == 2


async def test_the_country_and_engine_filters_scope_every_value(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    await execute(
        migrated,
        "UPDATE ai.prompts SET country_iso = 'IN' WHERE id = $1",
        seeded.prompts["providers"].id,
    )

    india = await metric_body(seeded, api, "ai.mention_rate", **{"filter[country_iso]": "IN"})
    france = await metric_body(seeded, api, "ai.mention_rate", **{"filter[country_iso]": "FR"})
    gemini = await metric_body(
        seeded, api, "ai.citation_share", **{"filter[engine_code_in]": GEMINI}
    )
    tile = engine_tiles(
        await overview_data(seeded, api, **{"filter[engine_code_in]": GEMINI}), GEMINI
    )["ai.citation_share"]

    # Providers alone: 2/5 over 1 prompt, 6 answers.
    assert _counts(_of(india, CHATGPT)) == (pytest.approx(0.4), 1, 6)
    assert _of(india, CHATGPT)["filters"]["country_iso"] == "IN"
    # No prompt in that market: every engine has a null value and counts of zero, and no average.
    for value in france["data"]:
        assert (value["value"], _counts(value)) == (None, (0, 0, 0)), value["metric"]
    assert [v["metric"] for v in france["data"]] == ["ai.mention_rate"] * 2
    # One engine: its value alone, the same as the overview's tile for that engine.
    assert [(v["engine_code"], _counts(v)) for v in gemini["data"]] == [(GEMINI, _counts(tile))]


async def test_share_of_voice_per_entity_equals_the_summary_entity_cells(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    total = (await summary_data(seeded, api, include="total,entities", rows="none"))["total"]
    ids = f"{seeded.own},{seeded.rival}"

    mention = await metric_body(seeded, api, "ai.mention_rate", entity_ids=ids)
    share = await metric_body(seeded, api, "ai.share_of_voice", entity_ids=ids)

    for engine in total["engines"]:
        for cell in engine["entities"]:
            for body, name in ((mention, "mentioned"), (share, "share_of_voice")):
                value = next(
                    v
                    for v in body["data"]
                    if v["engine_code"] == engine["engine_code"]
                    and v.get("entity_id") == cell["entity_id"]
                )
                assert (value["value"], *_counts(value)) == (
                    cell[name]["value"],
                    *_cell_counts(cell[name]),
                )
                assert value.get("pooled") == cell[name]["pooled"]
    own, rival = str(seeded.own), str(seeded.rival)

    def chatgpt(body: dict[str, Any], entity: str) -> dict[str, Any]:
        return next(
            v for v in body["data"] if v["engine_code"] == CHATGPT and v["entity_id"] == entity
        )

    # The rival is named in providers 1 and 4: 2/5 of one prompt, answers 2 of 7.
    assert _counts(chatgpt(mention, rival)) == (pytest.approx(0.4), 3, 8)
    assert chatgpt(mention, rival)["pooled"] == {"successes": 2, "trials": 7}
    assert _counts(chatgpt(mention, own)) == (pytest.approx(1.4), 3, 8)
    # Over the 4 answers that name a tracked entity the shares add up to the whole: 2.5 + 1.5.
    assert _counts(chatgpt(share, own)) == (2.5, 4, 8)
    assert _counts(chatgpt(share, rival)) == (1.5, 4, 8)
    assert chatgpt(share, own)["numerator"] + chatgpt(share, rival)["numerator"] == 4
    assert chatgpt(share, rival)["aggregation"] == "observation_weighted"
    assert chatgpt(mention, rival)["aggregation"] == "prompt_weighted"


async def test_entity_ids_give_values_for_those_entities_in_tracked_order(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    own, rival = str(seeded.own), str(seeded.rival)

    both = await metric_body(
        seeded, api, "ai.share_of_voice", entity_ids=f"{seeded.rival},{seeded.own}"
    )
    only = await metric_body(seeded, api, "ai.share_of_voice", entity_ids=str(seeded.rival))

    # In place of each engine's own cell: the engines by code, the own entity first within each
    # (the listing order of the request does not matter), then one average of the engines for
    # each entity.
    assert [(v["metric"], v.get("engine_code"), v["entity_id"]) for v in both["data"]] == [
        ("ai.share_of_voice", CHATGPT, own),
        ("ai.share_of_voice", CHATGPT, rival),
        ("ai.share_of_voice", GEMINI, own),
        ("ai.share_of_voice", GEMINI, rival),
        ("ai.share_of_voice.engine_average", None, own),
        ("ai.share_of_voice.engine_average", None, rival),
    ]
    averages = both["data"][4:]
    # Own: ChatGPT 2.5/4 and Gemini 0.5/1; rival: 1.5/4 and 0.5/1.
    assert averages[0]["value"] == pytest.approx((0.625 + 0.5) / 2)
    assert averages[1]["value"] == pytest.approx((0.375 + 0.5) / 2)
    assert averages[0]["engines"] == [CHATGPT, GEMINI]
    assert [(v.get("engine_code"), v["entity_id"]) for v in only["data"]] == [
        (CHATGPT, rival),
        (GEMINI, rival),
        (None, rival),
    ]
    # The entities of the tracked set, as the summary lists them (competitors, then the own).
    assert [e["name"] for e in only["meta"]["entities"]] == ["CyberNX", "Eventus Security"]


async def test_entity_ids_are_for_mention_rate_and_share_of_voice_only(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    for key in (
        "ai.citation_rate",
        "ai.valid_answers",
        "ai.prompts_in_scope",
        "ai.outcome_mix",
        "ai.citation_share",
        "ai.first_mention_rate",
        "ai.recommendation_rate",
    ):
        response = await get_metric(seeded, api, key, entity_ids=str(seeded.own))

        assert problem(response) == (422, "validation_failed"), key
        assert ("entity_ids", "not_supported") in _codes(response), key
    for key in ("ai.mention_rate", "ai.share_of_voice"):
        response = await get_metric(seeded, api, key, entity_ids=str(seeded.own))

        assert response.status_code == 200, key


async def test_an_empty_entity_ids_is_no_entity_ids(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    """`entity_ids=` is not asked: the engines' own values, also on a key that does not take
    `entity_ids` (C-27), and on the series route."""
    for key in ("ai.mention_rate", "ai.share_of_voice", "ai.citation_rate", "ai.valid_answers"):
        empty = await get_metric(seeded, api, key, entity_ids="")
        plain = await get_metric(seeded, api, key)

        assert empty.status_code == 200, key
        assert empty.json() == plain.json(), key
        assert all("entity_id" not in value for value in empty.json()["data"]), key
    series = await get_metric(seeded, api, "ai.citation_rate", "series", entity_ids="")
    assert series.status_code == 200
    assert series.json() == (await get_metric(seeded, api, "ai.citation_rate", "series")).json()


async def test_an_entity_that_is_not_tracked_is_left_out_and_is_200(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    """A watched entity, one not tracked in AI answers, a removed one, an entity of another
    project and an id that names nothing: none is a value, and the answer is 200."""

    async def give(name: str, **body: Any) -> str:
        created = await api.post(
            entities_url(seeded.workspace),
            json={"entity_type": "brand", "canonical_name": name},
            headers=seeded.owner.headers,
        )
        assert created.status_code == 201, created.text
        entity_id: str = created.json()["data"]["entity_id"]
        given = await api.post(
            project_url(seeded.workspace, seeded.project.id, "entities"),
            json={"entity_id": entity_id, "role": "competitor", **body},
            headers=seeded.owner.headers,
        )
        assert given.status_code == 201, given.text
        return entity_id

    watched = await give("Watched", role="watch")
    untracked = await give("Untracked", track_ai=False)
    gone = await give("Gone")
    removed = await api.delete(
        project_url(seeded.workspace, seeded.project.id, "entities", gone),
        headers=seeded.owner.headers,
    )
    assert removed.status_code == 200
    elsewhere = Project(seeded.workspace.id, await make_project(migrated, seeded.workspace.id))
    other = await _entity(migrated, elsewhere, "Elsewhere", "elsewhere.example", "competitor")
    nobody = str(uuid.uuid4())
    asked = ",".join([str(seeded.rival), watched, untracked, gone, str(other), nobody])

    for key in ("ai.mention_rate", "ai.share_of_voice"):
        body = await metric_body(seeded, api, key, entity_ids=asked)

        assert {v["entity_id"] for v in body["data"]} == {str(seeded.rival)}, key
        assert [v.get("engine_code") for v in body["data"]] == [CHATGPT, GEMINI, None], key
        nothing = await metric_body(
            seeded, api, key, entity_ids=",".join([watched, untracked, gone, str(other), nobody])
        )
        assert nothing["data"] == [], key


async def test_an_unknown_key_is_404_unknown_metric(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    for key in ("ai.nope", "ai.mention", "a", "seo.top3_count", "fp.sessions", "ai.outcome_mix.x"):
        response = await get_metric(seeded, api, key)

        assert problem(response) == (404, "unknown_metric"), key
        assert key in response.json()["detail"]


async def test_a_known_unbuilt_key_is_501_naming_it(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    for key in (
        "ai.sentiment",
        "ai.sentiment.positive",
        "ai.sentiment.mixed",
        "ai.structured_top3_rate",
        "ai.competitor_gap",
        "ai.source_share",
        "ai.flip_rate",
    ):
        response = await get_metric(seeded, api, key)

        assert problem(response) == (501, "not_implemented"), key
        assert response.json()["detail"] == f"Not built yet: {key}.", key


async def test_a_bad_key_and_a_missing_project_answers_unknown_metric(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    """The key is checked in the route body, before any read: a project that is deleted answers
    `unknown_metric` for a bad key and `not_found` for a good one."""
    await execute(
        migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", seeded.project.id
    )

    assert problem(await get_metric(seeded, api, "ai.nope")) == (404, "unknown_metric")
    assert problem(await get_metric(seeded, api, "ai.sentiment")) == (501, "not_implemented")
    assert problem(await get_metric(seeded, api, "ai.mention_rate")) == (404, "not_found")


async def test_a_deleted_project_is_not_found_for_a_known_key(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    await execute(
        migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", seeded.project.id
    )

    for key in ("ai.mention_rate", "ai.valid_answers", "ai.prompts_in_scope", "ai.citation_share"):
        assert problem(await get_metric(seeded, api, key)) == (404, "not_found"), key


async def test_compare_on_a_metric(api: httpx.AsyncClient, seeded: Summary) -> None:
    ids = f"{seeded.own},{seeded.rival}"
    scope = {"from": day(27), "to": day(0), "compare": "previous_period"}

    mention = await metric_body(seeded, api, "ai.mention_rate", **scope)
    citation = await metric_body(seeded, api, "ai.citation_rate", **scope)
    share = await metric_body(seeded, api, "ai.share_of_voice", entity_ids=ids, **scope)
    again = await metric_body(seeded, api, "ai.mention_rate", entity_ids=ids, **scope)

    # The window before holds answer 9 alone (28 days old): own brand named and cited, valid.
    assert _of(mention, CHATGPT)["previous"] == {
        "value": 1.0,
        "numerator": 1.0,
        "denominator": 1,
        "n_observations": 1,
        "pooled": {"successes": 1, "trials": 1},
    }
    # Gemini had no answer there: the key is there, null.
    assert "previous" in _of(mention, GEMINI)
    assert _of(mention, GEMINI)["previous"] is None
    assert _cell_counts(_of(citation, CHATGPT)["previous"]) == (1, 1, 1)
    # Per entity: the own brand is 1 of 1 there, the rival 0 of 1 (an entity not named in a valid
    # answer is a real 0, not no data).
    by_entity = {
        (v["engine_code"], v["entity_id"]): v["previous"]
        for v in share["data"]
        if "engine_code" in v
    }
    assert _cell_counts(by_entity[(CHATGPT, str(seeded.own))]) == (1, 1, 1)
    assert _cell_counts(by_entity[(CHATGPT, str(seeded.rival))]) == (0, 1, 1)
    assert by_entity[(GEMINI, str(seeded.own))] is None
    assert by_entity[(GEMINI, str(seeded.rival))] is None
    again_entity = {
        (v["engine_code"], v["entity_id"]): v["previous"]
        for v in again["data"]
        if "engine_code" in v
    }
    assert again_entity[(CHATGPT, str(seeded.rival))]["pooled"] == {"successes": 0, "trials": 1}
    for body in (mention, share):
        assert all("previous" not in v for v in body["data"] if "engine_code" not in v)
        assert body["meta"]["previous_answers"] == 1
        assert body["meta"]["compare_window"]["to"] == day(28)
    # The keys that do not compare, and the counts, have no `previous` at all.
    for key in (
        "ai.citation_share",
        "ai.valid_answers",
        "ai.first_mention_rate",
        "ai.fanout_presence_rate",
        "ai.recommendation_rate",
        "ai.prompts_in_scope",
    ):
        body = await metric_body(seeded, api, key, **scope)

        assert all("previous" not in v for v in body["data"]), key
        assert body["meta"]["previous_answers"] == 1, key
    outcome = await metric_body(seeded, api, "ai.outcome_mix", **scope)
    assert [_cell_counts(v["previous"]) for v in outcome["data"][:4]] == [
        (1, 1, 1),
        (0, 1, 1),
        (0, 1, 1),
        (0, 1, 1),
    ]
    plain = await metric_body(seeded, api, "ai.mention_rate")
    assert all("previous" not in v for v in plain["data"])
    assert "compare_window" not in plain["meta"]
    assert "previous_answers" not in plain["meta"]


async def test_the_meta_names_the_entities_and_the_days_each_configuration_took_effect(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    keys = ("ai.mention_rate", "ai.share_of_voice", "ai.citation_share", "ai.prompts_in_scope")
    window = {"from": day(40), "to": day(-1)}
    one = await metric_body(seeded, api, "ai.mention_rate", **window)

    # One version: as the summary lists the tracked set (competitors by name, then the own).
    assert [(e["entity_id"], e["role"]) for e in one["meta"]["entities"]] == [
        (str(seeded.rival), "competitor"),
        (str(seeded.own), "own"),
    ]
    assert one["meta"]["entity_config_versions"] == [1]
    assert "entity_config_changes" not in one["meta"]
    await two_versions(
        migrated,
        worker_db,
        import_store,
        seeded,
        (datetime(2026, 10, 3, 10, 0, tzinfo=UTC), datetime(2026, 11, 5, 23, 30, tzinfo=UTC)),
    )

    for key in keys:
        meta = (await metric_body(seeded, api, key, **window))["meta"]

        assert meta["entity_config_versions"] == [1, 2], key
        # The project zone is UTC: the day of each fixed instant, oldest version first.
        assert meta["entity_config_changes"] == [
            {"version": 1, "from": "2026-10-03"},
            {"version": 2, "from": "2026-11-05"},
        ], key


async def test_the_days_a_configuration_took_effect_are_this_projects_alone(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    """A project of the workspace and one of another workspace derived their first answers long
    before this one did, under the same version number: neither moves the day this one's did."""
    await two_versions(
        migrated,
        worker_db,
        import_store,
        seeded,
        (datetime(2026, 10, 3, 10, 0, tzinfo=UTC), datetime(2026, 11, 5, 23, 30, tzinfo=UTC)),
    )
    other_workspace = await make_workspace(migrated)
    for number, workspace_id in enumerate((seeded.workspace.id, other_workspace.id)):
        await answer_in_another_project(
            migrated, worker_db, import_store, workspace_id, f"Otherco{number}", 1
        )
    await ingest(worker_db, import_store)
    await execute(
        migrated,
        "UPDATE ai.derivations SET created_at = $2 WHERE project_id <> $1",
        seeded.project.id,
        datetime(2026, 1, 2, 9, 0, tzinfo=UTC),
    )

    for key in ("ai.mention_rate", "ai.citation_share"):
        meta = (await metric_body(seeded, api, key, **{"from": day(40), "to": day(-1)}))["meta"]

        assert meta["entity_config_changes"] == [
            {"version": 1, "from": "2026-10-03"},
            {"version": 2, "from": "2026-11-05"},
        ], key


async def test_a_window_of_the_callers_own_is_compared_with_the_days_it_names(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    body = await metric_body(
        seeded, api, "ai.mention_rate", compare_from=day(45), compare_to=day(40)
    )

    # Nothing answered between 45 and 40 days ago: null on every engine, no valid answer there.
    assert body["meta"]["previous_answers"] == 0
    assert body["meta"]["compare_window"]["from"] == day(45)
    assert [v["previous"] for v in body["data"] if "engine_code" in v] == [None, None]


async def test_the_window_is_at_most_92_days(api: httpx.AsyncClient, seeded: Summary) -> None:
    longest = await get_metric(seeded, api, "ai.mention_rate", **{"from": day(91), "to": day(0)})
    too_long = await get_metric(seeded, api, "ai.mention_rate", **{"from": day(92), "to": day(0)})

    assert longest.status_code == 200
    assert problem(too_long) == (422, "window_too_large")
    assert too_long.json()["limit_days"] == 92


async def test_another_projects_and_workspaces_answers_are_not_counted(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    """A second project of the workspace and a second workspace each answer today, naming their
    brand and citing a page: no value, count or share moves."""
    keys = ("ai.mention_rate", "ai.citation_share", "ai.valid_answers", "ai.prompts_in_scope")
    asked = {"compare": "previous_period", "include_branded": "true"}
    before = [(await get_metric(seeded, api, key, **asked)).json() for key in keys]
    other_workspace = await make_workspace(migrated)
    for number, workspace_id in enumerate((seeded.workspace.id, other_workspace.id)):
        await answer_in_another_project(
            migrated, worker_db, import_store, workspace_id, f"Otherco{number}", 1
        )
    await ingest(worker_db, import_store)

    after = [(await get_metric(seeded, api, key, **asked)).json() for key in keys]

    assert after == before


async def test_a_metric_read_checks_access_before_a_value(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, seeded: Summary
) -> None:
    outsider = await member(resources, migrated, await make_workspace(migrated), "owner")
    billing = await member(resources, migrated, seeded.workspace, "billing")
    url = project_url(seeded.workspace, seeded.project.id, "ai", "metrics", "ai.nope")

    anonymous = await api.get(url)
    unseen = await api.get(url, headers=outsider.headers)
    refused = await api.get(url, headers=billing.headers)

    # Who may ask comes before what is asked: a bad key is not told to those who may not read.
    assert problem(anonymous) == (401, "unauthenticated")
    assert problem(unseen) == (404, "not_found")
    assert problem(refused) == (403, "forbidden")
