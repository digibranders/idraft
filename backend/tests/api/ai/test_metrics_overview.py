"""The Overview (contract C8, routes 1 and 2): the tiles of each engine, read from the prompts
summary and the sources lane, over the seeded world of `test_prompts_summary` (see the docstring
of its `summary` fixture). The expected numbers are worked out by hand from that world: ChatGPT,
default scope (the prompts `providers`, `pricing` and `misc`; the branded prompt and the archived
one are not in scope):

    providers  6 answers, 5 valid:  Mentioned 2/5, Cited 2/5, outcomes 1/5 1/5 1/5 2/5, SOV 3/2
    pricing    1 answer, valid:     Mentioned 0/1, Cited 0/1, outcome neither,           SOV none
    misc       1 answer, valid:     Mentioned 1/1, Cited 1/1, outcome mentioned+cited,   SOV 1
    prompt weighted over the 3 prompts: Mentioned (2/5 + 0 + 1) = 1.4 of 3, answers 3 of 7, in 8
    Citation units (one page each): own 3 (answers 2, 5 and misc), competitor 2 (4 and pricing),
    third party 2 (1 and 3): 3 of 7."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest

from idraft.api.ai import metrics
from idraft.api.ai.source_routes import FLAGGED_COUNTED_BY_DEFAULT, flag_toggles
from idraft.api.resources import Resources
from idraft.collectors.ai_prompt_ingest import ingest
from tests.api.ai import summary_support
from tests.api.ai.metrics_support import (
    OVERVIEW,
    OVERVIEW_AI,
    counts,
    engine_tiles,
    get_overview,
    overview_data,
)
from tests.api.ai.summary_support import (
    CHATGPT,
    GEMINI,
    OWN_ONLY,
    OWN_PAGE,
    REFUSAL,
    Answer,
    Summary,
    answer_in_another_project,
    day,
    ingested,
    summary_data,
)
from tests.api.auth.support import execute, fetchrow, make_workspace
from tests.api.entities.support import member, problem
from tests.api.keywords.support import project_url
from tests.api.keywords.test_tracked_keyword_ranks import Ledger
from tests.collectors.ai_support import enable_engine
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

seeded = summary_support.seeded

TILES = [
    "ai.valid_answers",
    "ai.mention_rate",
    "ai.citation_rate",
    "ai.mention_and_citation_rate",
    "ai.outcome_mix.mentioned_and_cited",
    "ai.outcome_mix.mentioned_only",
    "ai.outcome_mix.cited_only",
    "ai.outcome_mix.neither",
    "ai.recommendation_rate",
    "ai.share_of_voice",
    "ai.citation_share",
    "ai.citation_rate_given_citations",
    "ai.first_mention_rate",
]
FANOUT = ["ai.fanout_presence_rate", "ai.fanout_mean_queries"]
OUTCOMES = TILES[4:8]
AVERAGES = [
    "ai.mention_rate.engine_average",
    "ai.citation_rate.engine_average",
    "ai.mention_and_citation_rate.engine_average",
    "ai.share_of_voice.engine_average",
    "ai.citation_share.engine_average",
]
COMPARABLE = {TILES[1], TILES[2], TILES[3], *OUTCOMES, TILES[9]}
AI_MODE = "google_ai_mode"


async def _total(world: Summary, api: httpx.AsyncClient, **params: Any) -> dict[str, Any]:
    """The `total` row of the summary for the same scope, with the small cells."""
    data = await summary_data(world, api, include="total,cells", rows="none", **params)
    total: dict[str, Any] = data["total"]
    return total


def _summary_cell(cell: dict[str, Any]) -> dict[str, Any]:
    """A summary cell as a tile writes its counts."""
    return {
        "value": cell["value"],
        "numerator": cell["numerator"],
        "denominator": cell["denominator"],
        "n_observations": cell["n_observations"],
    }


def _counts_of(tile: dict[str, Any]) -> dict[str, Any]:
    return {key: tile[key] for key in ("value", "numerator", "denominator", "n_observations")}


async def _sources_by_engine(
    world: Summary, api: httpx.AsyncClient, **params: Any
) -> dict[str, tuple[int, int]]:
    """(own citation units, all citation units) of each engine, as the Sources page counts them."""
    response = await api.get(
        project_url(world.workspace, world.project.id, "ai", "sources", "domains"),
        params={
            "include": "by_role_by_engine",
            "filter[engine_code_in]": f"{CHATGPT},{GEMINI}",
            **params,
        },
        headers=world.owner.headers,
    )
    assert response.status_code == 200, response.text
    split = response.json()["meta"]["by_role_by_engine"]
    return {
        entry["engine_code"]: (
            entry["own"]["citation_units"],
            sum(entry[role]["citation_units"] for role in ("own", "competitor", "third_party")),
        )
        for entry in split
    }


def _share(tile: dict[str, Any]) -> tuple[int, int]:
    return int(tile["numerator"]), int(tile["denominator"])


async def test_the_overview_has_the_tiles_of_the_note_in_order_for_each_engine(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    data = await overview_data(seeded, api)

    assert [engine["engine_code"] for engine in data["engines"]] == [CHATGPT, GEMINI]
    assert {engine["observation_class"] for engine in data["engines"]} == {"consumer_ui"}
    chatgpt, gemini = data["engines"]
    # ChatGPT exposes its fan-out and Gemini does not: it has no such tile, not a tile of 0.
    assert [tile["metric"] for tile in chatgpt["tiles"]] == [*TILES, *FANOUT]
    assert [tile["metric"] for tile in gemini["tiles"]] == TILES
    for tile in chatgpt["tiles"]:
        assert tile["engine_code"] == CHATGPT
        assert tile["observation_class"] == "consumer_ui"
        assert tile["window"]["timezone"] == "UTC"
        assert tile["filters"] == {
            "include_branded": False,
            "branded_only": False,
            "country_iso": None,
            "term_id": None,
        }
        assert (tile["is_estimate"], tile["method_version"]) == (False, 1)
        assert "ci" not in tile


async def test_every_value_is_its_numerator_over_its_denominator(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    data = await overview_data(seeded, api, compare="previous_period")

    values = [tile for engine in data["engines"] for tile in engine["tiles"]]
    values += [*data["engine_average"], data["prompts_in_scope"]]
    for tile in values:
        if tile.get("suppressed_reason") or tile["denominator"] is None:
            assert tile["value"] is None or tile["unit"] == "count", tile["metric"]
        elif tile["denominator"] == 0:
            assert tile["value"] is None, tile["metric"]
        else:
            assert tile["value"] == pytest.approx(tile["numerator"] / tile["denominator"]), tile[
                "metric"
            ]


async def test_the_overview_numbers_are_the_summary_total_cells(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    total = await _total(seeded, api)

    data = await overview_data(seeded, api)

    for summary_engine in total["engines"]:
        tiles = engine_tiles(data, summary_engine["engine_code"])
        same = {
            "ai.mention_rate": summary_engine["mentioned"],
            "ai.citation_rate": summary_engine["cited"],
            "ai.mention_and_citation_rate": summary_engine["outcomes"]["mentioned_and_cited"],
            "ai.share_of_voice": summary_engine["share_of_voice"],
            **{f"ai.outcome_mix.{name}": cell for name, cell in summary_engine["outcomes"].items()},
        }
        for key, cell in same.items():
            assert _counts_of(tiles[key]) == _summary_cell(cell), (
                summary_engine["engine_code"],
                key,
            )
            assert tiles[key].get("pooled") == cell["pooled"], key


async def test_chatgpt_mention_rate_anchor(api: httpx.AsyncClient, seeded: Summary) -> None:
    tiles = engine_tiles(await overview_data(seeded, api), CHATGPT)

    mention = tiles["ai.mention_rate"]
    # Providers 2/5 + pricing 0/1 + misc 1/1 = 1.4 over 3 prompts; 3 of 7 valid answers; 8 answers.
    assert mention["value"] == pytest.approx(1.4 / 3)
    assert counts(mention) == (pytest.approx(1.4), 3, 8)
    assert mention["n_prompts"] == 3
    assert mention["pooled"] == {"successes": 3, "trials": 7}
    assert mention["aggregation"] == "prompt_weighted"
    assert mention["unit"] == "ratio"
    # The four outcomes: 1.2 + 0.2 + 0.2 + 1.4 = 3 prompts.
    assert [tiles[key]["numerator"] for key in OUTCOMES] == pytest.approx([1.2, 0.2, 0.2, 1.4])
    assert {tiles[key]["denominator"] for key in OUTCOMES} == {3}
    # Share of voice: providers 3 answers name a tracked entity (1/2 + 1 + 0), misc 1.
    share = tiles["ai.share_of_voice"]
    assert counts(share) == (2.5, 4, 8)
    assert share["aggregation"] == "observation_weighted"
    assert "pooled" not in share
    assert "n_prompts" not in share
    gemini = engine_tiles(await overview_data(seeded, api), GEMINI)
    assert counts(gemini["ai.mention_rate"]) == (1, 1, 1)
    assert counts(gemini["ai.share_of_voice"]) == (0.5, 1, 1)


async def test_valid_answers_counts_valid_and_n_observations_every_answer(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    data = await overview_data(seeded, api)

    chatgpt = engine_tiles(data, CHATGPT)["ai.valid_answers"]
    gemini = engine_tiles(data, GEMINI)["ai.valid_answers"]
    # ChatGPT: 8 answers, one of them a refusal: 7 valid. Gemini: its one answer.
    assert (chatgpt["value"], chatgpt["numerator"], chatgpt["denominator"]) == (7, 7, None)
    assert (chatgpt["n_observations"], chatgpt["unit"]) == (8, "count")
    assert (gemini["value"], gemini["n_observations"]) == (1, 1)
    assert "aggregation" not in chatgpt


async def test_prompts_in_scope_counts_each_prompt_once(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    default = (await overview_data(seeded, api))["prompts_in_scope"]
    with_branded = (await overview_data(seeded, api, include_branded="true"))["prompts_in_scope"]
    branded = (await overview_data(seeded, api, branded_only="true"))["prompts_in_scope"]

    # providers (two topics, six answers), pricing and misc; the branded prompt when asked.
    assert (default["value"], default["numerator"], default["denominator"]) == (3, 3, None)
    assert (default["metric"], default["unit"]) == ("ai.prompts_in_scope", "count")
    assert "engine_code" not in default
    assert "observation_class" not in default
    # The answers of every engine shown: 8 on ChatGPT and 1 on Gemini.
    assert default["n_observations"] == 9
    assert (with_branded["value"], with_branded["n_observations"]) == (4, 10)
    assert (branded["value"], branded["n_observations"]) == (1, 1)


async def test_an_engine_with_no_answer_has_null_values_and_zero_counts_not_zero_rates(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    await enable_engine(migrated, seeded.project, AI_MODE)

    data = await overview_data(seeded, api)

    assert [engine["engine_code"] for engine in data["engines"]] == [CHATGPT, GEMINI, AI_MODE]
    tiles = engine_tiles(data, AI_MODE)
    assert [tile["metric"] for tile in tiles.values()] == TILES
    for key in ("ai.mention_rate", "ai.citation_rate", *OUTCOMES, "ai.share_of_voice"):
        assert (tiles[key]["value"], counts(tiles[key])[1:]) == (None, (0, 0)), key
    assert tiles["ai.citation_share"]["value"] is None
    assert counts(tiles["ai.citation_share"]) == (0, 0, 0)
    assert (tiles["ai.valid_answers"]["value"], tiles["ai.valid_answers"]["n_observations"]) == (
        0,
        0,
    )
    # An engine with no value is left out of the average: it is the mean of the other two.
    average = {entry["metric"]: entry for entry in data["engine_average"]}
    mention = average["ai.mention_rate.engine_average"]
    assert mention["engines"] == [CHATGPT, GEMINI]
    assert mention["denominator"] == 2


async def test_recommendation_is_suppressed_not_zero(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    data = await overview_data(seeded, api)

    for code, valid in ((CHATGPT, 7), (GEMINI, 1)):
        tile = engine_tiles(data, code)["ai.recommendation_rate"]
        assert (tile["value"], tile["numerator"], tile["denominator"]) == (None, None, None)
        assert tile["suppressed_reason"] == "not_classified"
        assert tile["n_observations"] == valid


async def test_the_engine_average_is_the_equal_weight_mean_of_the_engines_with_a_value(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    data = await overview_data(seeded, api)

    assert [entry["metric"] for entry in data["engine_average"]] == AVERAGES
    mention, citation, both, share, units = data["engine_average"]
    # ChatGPT 1.4/3 and Gemini 1/1: the mean of the two rates, not of the 8 answers.
    assert mention["numerator"] == pytest.approx(1.4 / 3 + 1)
    assert mention["denominator"] == 2
    assert mention["value"] == pytest.approx((1.4 / 3 + 1) / 2)
    assert mention["engines"] == [CHATGPT, GEMINI]
    assert mention["n_observations"] == 9
    assert mention["aggregation"] == "prompt_weighted"
    assert "pooled" not in mention
    assert "engine_code" not in mention
    # Share of voice: ChatGPT 2.5/4 = 0.625 and Gemini 0.5/1.
    assert share["value"] == pytest.approx((0.625 + 0.5) / 2)
    assert share["aggregation"] == "observation_weighted"
    assert {entry["method_version"] for entry in data["engine_average"]} == {1}
    assert units["engines"] == [CHATGPT, GEMINI]
    assert citation["n_observations"] == both["n_observations"] == 9
    # One engine is no average: the list is empty, never a copy of the engine.
    one = await overview_data(seeded, api, **{"filter[engine_code_in]": GEMINI})
    assert one["engine_average"] == []


async def test_citation_share_equals_the_sources_page_by_role_for_the_engine(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    data = await overview_data(seeded, api)

    page = await _sources_by_engine(seeded, api)
    for code in (CHATGPT, GEMINI):
        tile = engine_tiles(data, code)["ai.citation_share"]
        assert _share(tile) == page[code], code
        assert tile["aggregation"] == "observation_weighted"
        assert "pooled" not in tile
    chatgpt = engine_tiles(data, CHATGPT)["ai.citation_share"]
    # Own 3, competitor 2, third party 2 of the 7 valid answers.
    assert (_share(chatgpt), chatgpt["n_observations"]) == ((3, 7), 7)
    assert chatgpt["value"] == pytest.approx(3 / 7)


async def test_citation_share_ignores_flagged_citations_like_the_sources_page(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    """The two third party citations of ChatGPT are flagged `unresolved_redirect` and the two
    competitor ones `engine_internal`: only the own 3 count, and the answers still count."""
    for role, flag in (("third_party", "unresolved_redirect"), ("competitor", "engine_internal")):
        await execute(
            migrated,
            "UPDATE ai.citations SET flags = ARRAY[$3] "
            "WHERE project_id = $1 AND engine_code = 'chatgpt_web' AND domain_role = $2",
            seeded.project.id,
            role,
            flag,
        )

    data = await overview_data(seeded, api)

    chatgpt = engine_tiles(data, CHATGPT)["ai.citation_share"]
    assert (_share(chatgpt), chatgpt["n_observations"]) == ((3, 3), 7)
    assert _share(chatgpt) == (await _sources_by_engine(seeded, api))[CHATGPT]
    counted_again = await _sources_by_engine(
        seeded, api, include_unresolved_redirects="true", include_engine_internal="true"
    )
    assert counted_again[CHATGPT] == (3, 7)
    assert engine_tiles(data, CHATGPT)["ai.valid_answers"]["value"] == 7


def test_the_flags_left_out_are_the_flags_the_sources_page_leaves_out() -> None:
    assert FLAGGED_COUNTED_BY_DEFAULT is False
    assert flag_toggles() == metrics.EXCLUDED_FLAGS


async def test_the_small_cells_equal_the_summary_detail_cells(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    total = await _total(seeded, api)

    data = await overview_data(seeded, api)

    for summary_engine in total["engines"]:
        code, detail = summary_engine["engine_code"], summary_engine["detail"]
        tiles = engine_tiles(data, code)
        same = {
            "ai.citation_rate_given_citations": detail["cited_given_citations"],
            "ai.first_mention_rate": detail["first_mention"],
            "ai.fanout_presence_rate": detail["fanout_presence"],
            "ai.fanout_mean_queries": detail["fanout_mean"],
        }
        for key, cell in same.items():
            if cell is None:
                # Not exposed by the engine: no tile at all.
                assert key not in tiles, (code, key)
            else:
                assert _counts_of(tiles[key]) == _summary_cell(cell), (code, key)
                assert tiles[key].get("pooled") == cell["pooled"], (code, key)
    mean = engine_tiles(data, CHATGPT)["ai.fanout_mean_queries"]
    assert (mean["unit"], mean["aggregation"]) == ("count", "observation_weighted")
    presence = engine_tiles(data, CHATGPT)["ai.fanout_presence_rate"]
    assert presence["aggregation"] == "prompt_weighted"


async def test_branded_prompts_are_left_out_by_default_and_counted_when_asked(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    """The branded prompt has two answers that name the own brand, one of them citing the own
    page: the default scope must not see them, in the tiles or in the citation share."""
    await ingested(
        seeded, migrated, worker_db, import_store, [Answer("brand", OWN_ONLY, (OWN_PAGE,), 1)]
    )

    default = engine_tiles(await overview_data(seeded, api), CHATGPT)
    with_branded = engine_tiles(await overview_data(seeded, api, include_branded="true"), CHATGPT)
    branded = engine_tiles(await overview_data(seeded, api, branded_only="true"), CHATGPT)

    assert counts(default["ai.mention_rate"]) == (pytest.approx(1.4), 3, 8)
    assert _share(default["ai.citation_share"]) == (3, 7)
    # The branded prompt names the own brand in both its answers: 1.4 + 1 over 4 prompts.
    assert counts(with_branded["ai.mention_rate"]) == (pytest.approx(2.4), 4, 10)
    assert with_branded["ai.mention_rate"]["filters"]["include_branded"] is True
    assert _share(with_branded["ai.citation_share"]) == (4, 8)
    # Branded only: the one prompt, and the one citation it has.
    assert counts(branded["ai.mention_rate"]) == (1, 1, 2)
    assert _share(branded["ai.citation_share"]) == (1, 1)
    assert branded["ai.mention_rate"]["filters"]["branded_only"] is True
    assert branded["ai.valid_answers"]["value"] == 2


async def test_the_term_subtree_scopes_every_tile(
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
        tiles = engine_tiles(
            await overview_data(seeded, api, **{"filter[term]": str(term)}), CHATGPT
        )

        # Providers 2/5 and pricing 0/1 over 2 prompts, 6 valid answers of 7.
        assert counts(tiles["ai.mention_rate"]) == (pytest.approx(0.4), 2, 7), term
        assert tiles["ai.mention_rate"]["pooled"] == {"successes": 2, "trials": 6}
        # Own 2, competitor 2 and third party 2: the citation of `misc` is not counted.
        assert _share(tiles["ai.citation_share"]) == (2, 6), term
        assert tiles["ai.citation_share"]["n_observations"] == 6
        assert tiles["ai.mention_rate"]["filters"]["term_id"] == str(term)
    data = await overview_data(seeded, api, **{"filter[term]": str(parent["id"])})
    assert data["prompts_in_scope"]["value"] == 2
    # The topic rows of the summary under the filter: Security and Managed SOC below it.
    assert data["topics_in_scope"] == 2
    own = await overview_data(seeded, api, **{"filter[term]": str(soc)})
    assert own["topics_in_scope"] == 1


async def test_the_country_and_engine_filters_scope_every_tile(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    await execute(
        migrated,
        "UPDATE ai.prompts SET country_iso = 'IN' WHERE id = $1",
        seeded.prompts["providers"].id,
    )

    india = await overview_data(seeded, api, **{"filter[country_iso]": "IN"})
    france = await overview_data(seeded, api, **{"filter[country_iso]": "FR"})
    gemini = await overview_data(seeded, api, **{"filter[engine_code_in]": GEMINI})

    tiles = engine_tiles(india, CHATGPT)
    # Providers alone: 2/5 over 1 prompt, 6 answers; units own 2, competitor 1, third party 2.
    assert counts(tiles["ai.mention_rate"]) == (pytest.approx(0.4), 1, 6)
    assert _share(tiles["ai.citation_share"]) == (2, 5)
    assert tiles["ai.mention_rate"]["filters"]["country_iso"] == "IN"
    assert india["prompts_in_scope"]["value"] == 1
    # No prompt in that market: every engine answers with null values and counts of zero.
    assert france["prompts_in_scope"]["value"] == 0
    for engine in france["engines"]:
        tiles = {tile["metric"]: tile for tile in engine["tiles"]}
        assert counts(tiles["ai.mention_rate"]) == (0, 0, 0)
        assert tiles["ai.mention_rate"]["value"] is None
        assert counts(tiles["ai.citation_share"]) == (0, 0, 0)
    assert france["engine_average"] == []
    # One engine: only it is shown, and the prompts in scope do not depend on the engines.
    assert [engine["engine_code"] for engine in gemini["engines"]] == [GEMINI]
    assert gemini["prompts_in_scope"]["value"] == 3


async def test_compare_puts_previous_beside_the_comparable_tiles(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    response = await get_overview(seeded, api, compare="previous_period")

    assert response.status_code == 200, response.text
    body = response.json()
    chatgpt = engine_tiles(body["data"], CHATGPT)
    gemini = engine_tiles(body["data"], GEMINI)
    # The window before holds answer 9 alone (28 days old): own brand named and cited, valid.
    assert chatgpt["ai.mention_rate"]["previous"] == {
        "value": 1.0,
        "numerator": 1.0,
        "denominator": 1,
        "n_observations": 1,
        "pooled": {"successes": 1, "trials": 1},
    }
    assert counts(chatgpt["ai.mention_and_citation_rate"]["previous"]) == (1, 1, 1)
    assert [counts(chatgpt[key]["previous"]) for key in OUTCOMES] == [
        (1, 1, 1),
        (0, 1, 1),
        (0, 1, 1),
        (0, 1, 1),
    ]
    assert counts(chatgpt["ai.share_of_voice"]["previous"]) == (1, 1, 1)
    # Gemini had no answer there: the key is there, null.
    for key in COMPARABLE:
        assert "previous" in gemini[key], key
        assert gemini[key]["previous"] is None, key
    # The tiles that do not compare have no `previous` at all.
    for tiles in (chatgpt, gemini):
        for key in set(tiles) - COMPARABLE:
            assert "previous" not in tiles[key], key
    assert all("previous" not in entry for entry in body["data"]["engine_average"])
    assert "previous" not in body["data"]["prompts_in_scope"]
    assert body["meta"]["compare_window"] == {"from": day(55), "to": day(28), "timezone": "UTC"}
    assert body["meta"]["previous_answers"] == 1


async def test_a_window_of_the_callers_own_compares_with_the_days_it_names(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    quiet = await get_overview(seeded, api, compare_from=day(45), compare_to=day(40))
    same = await get_overview(seeded, api, compare_from=day(30), compare_to=day(28))

    # Nothing answered between 45 and 40 days ago: null, and no valid answer there.
    assert quiet.json()["meta"]["previous_answers"] == 0
    assert quiet.json()["meta"]["compare_window"]["from"] == day(45)
    chatgpt = engine_tiles(quiet.json()["data"], CHATGPT)
    assert chatgpt["ai.mention_rate"]["previous"] is None
    assert counts(engine_tiles(same.json()["data"], CHATGPT)["ai.mention_rate"]["previous"]) == (
        1,
        1,
        1,
    )


async def test_previous_is_absent_without_compare(api: httpx.AsyncClient, seeded: Summary) -> None:
    response = await get_overview(seeded, api)

    assert '"previous"' not in response.text
    meta = response.json()["meta"]
    assert "compare_window" not in meta
    assert "previous_answers" not in meta


async def test_meta_has_window_compare_window_previous_answers_entities_and_versions(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    response = await get_overview(seeded, api, compare="previous_period")

    meta = response.json()["meta"]
    today = datetime.now(UTC).date()
    assert meta["window"] == {"from": day(27), "to": today.isoformat(), "timezone": "UTC"}
    assert (meta["include_branded"], meta["branded_only"]) == (False, False)
    assert meta["engine_codes"] == [CHATGPT, GEMINI]
    # As the summary lists them: competitors by name, then the own entities.
    assert [(e["entity_id"], e["role"]) for e in meta["entities"]] == [
        (str(seeded.rival), "competitor"),
        (str(seeded.own), "own"),
    ]
    assert meta["entity_config_versions"] == [1]
    assert "entity_config_changes" not in meta
    assert meta["notes"] == []
    # The topics with a prompt in scope: Managed SOC and Compliance, not the prompts with none.
    assert response.json()["data"]["topics_in_scope"] == 2


async def test_the_days_each_entity_configuration_took_effect_are_named_with_more_than_one(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    await execute(
        migrated,
        "UPDATE core.projects SET entity_config_version = 2 WHERE id = $1",
        seeded.project.id,
    )
    await ingested(
        seeded, migrated, worker_db, import_store, [Answer("misc", OWN_ONLY, (OWN_PAGE,), 1)]
    )

    meta = (await get_overview(seeded, api)).json()["meta"]

    assert meta["entity_config_versions"] == [1, 2]
    # Each version took effect when its first answer was derived: today, in this test.
    assert meta["entity_config_changes"] == [
        {"version": 1, "from": day(0)},
        {"version": 2, "from": day(0)},
    ]


async def test_last_observed_and_last_valid_are_the_newest_answers(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    """A refusal today is the newest answer and not a valid one; the newest valid is answer 1,
    a day old."""
    await ingested(seeded, migrated, worker_db, import_store, [Answer("providers", REFUSAL, (), 0)])

    data = await overview_data(seeded, api)

    total = await _total(seeded, api)
    assert data["last_observed_at"] == total["last_observed_at"]
    assert data["last_valid_at"] == total["last_valid_at"]
    observed = datetime.fromisoformat(data["last_observed_at"])
    valid = datetime.fromisoformat(data["last_valid_at"])
    assert abs(datetime.now(UTC) - observed) < timedelta(minutes=10)
    assert abs(datetime.now(UTC) - timedelta(days=1) - valid) < timedelta(minutes=10)


async def test_nothing_answered_gives_null_times(api: httpx.AsyncClient, seeded: Summary) -> None:
    data = await overview_data(seeded, api, **{"filter[country_iso]": "FR"})

    assert (data["last_observed_at"], data["last_valid_at"]) == (None, None)


async def test_overview_ai_answers_the_body_of_the_metrics_overview(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    for params in ({}, {"compare": "previous_period", "include_branded": "true"}):
        metrics_overview = await get_overview(seeded, api, OVERVIEW, **params)
        alias = await get_overview(seeded, api, OVERVIEW_AI, **params)

        assert alias.status_code == 200, alias.text
        assert alias.json() == metrics_overview.json()


async def test_overview_ai_takes_filter_engine_code_in_and_refuses_engines(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    one = await get_overview(seeded, api, OVERVIEW_AI, **{"filter[engine_code_in]": CHATGPT})
    refused = await get_overview(seeded, api, OVERVIEW_AI, engines=CHATGPT)

    assert [e["engine_code"] for e in one.json()["data"]["engines"]] == [CHATGPT]
    assert problem(refused) == (422, "validation_failed")
    assert {(i["path"], i["code"]) for i in refused.json()["errors"]} == {
        ("engines", "extra_forbidden")
    }


async def test_a_window_is_at_most_92_days(api: httpx.AsyncClient, seeded: Summary) -> None:
    longest = await get_overview(seeded, api, **{"from": day(91), "to": day(0)})
    too_long = await get_overview(seeded, api, **{"from": day(92), "to": day(0)})
    only_from = await get_overview(seeded, api, **{"from": day(92)})
    compared = await get_overview(seeded, api, compare_from=day(100), compare_to=day(8))

    assert longest.status_code == 200
    for refused in (too_long, only_from, compared):
        assert problem(refused) == (422, "window_too_large")
        assert refused.json()["limit_days"] == 92


async def test_another_projects_answers_are_not_counted(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    """A second project of the workspace and a second workspace each answer today, naming their
    brand and citing a page: the tiles, the citation share and the times do not move."""
    before = await get_overview(seeded, api, compare="previous_period", include_branded="true")
    other_workspace = await make_workspace(migrated)
    for number, workspace_id in enumerate((seeded.workspace.id, other_workspace.id)):
        await answer_in_another_project(
            migrated, worker_db, import_store, workspace_id, f"Otherco{number}", 1
        )
    await ingest(worker_db, import_store)

    after = await get_overview(seeded, api, compare="previous_period", include_branded="true")

    assert after.json() == before.json()


async def test_a_deleted_project_is_not_found(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    await execute(
        migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", seeded.project.id
    )

    for route in (OVERVIEW, OVERVIEW_AI):
        assert problem(await get_overview(seeded, api, route)) == (404, "not_found")


async def test_the_overview_checks_access_before_a_value(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, seeded: Summary
) -> None:
    outsider = await member(resources, migrated, await make_workspace(migrated), "owner")
    billing = await member(resources, migrated, seeded.workspace, "billing")
    url = project_url(seeded.workspace, seeded.project.id, *OVERVIEW.tail)

    anonymous = await api.get(url)
    unseen = await api.get(url, headers=outsider.headers)
    refused = await api.get(url, headers=billing.headers)

    assert problem(anonymous) == (401, "unauthenticated")
    assert problem(unseen) == (404, "not_found")
    assert problem(refused) == (403, "forbidden")
