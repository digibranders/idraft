"""The small cells (contract C2, change log C-9): `include=cells` adds `EngineSummary.detail` to
every row that carries engines: Cited among the answers with citations, the own share of the
citation units, First mention, and the two fan-out cells. Worked by hand from the seeded world of
`test_prompts_summary` (see the docstring of its `summary` fixture): the prompts in scope are
`providers`, `pricing` and `misc`. On ChatGPT every valid answer of `providers` cites one page
(five units, the own page twice: answers 2 and 5), `pricing` cites one outside page, `misc` the own
page, and the answers of `providers` that name the own brand (1 and 2) name it first. Gemini
answered `providers` once with the captured answer: thirteen sources that are five pages (one of
them the own), the rival named before the own brand. The fan-out counts are written by SQL: the
seeded answers have none."""

from __future__ import annotations

import uuid
from dataclasses import replace
from typing import Any

import httpx
import pytest

from idraft.api.resources import Resources
from idraft.collectors.ai_prompt_ingest import ingest
from idraft.domain.ai_engines import ENGINES, EngineCode
from tests.api.ai import summary_support
from tests.api.ai.summary_support import (
    CHATGPT,
    GEMINI,
    Summary,
    answer_in_another_project,
    by,
    cell,
    full_project,
    get_summary,
    ingested,
    new_prompts,
    new_world,
    pooled,
    prompt_row,
    statements,
    summary_data,
    topic_row,
)
from tests.api.ai.test_prompts_summary import (
    BOTH,
    NEITHER,
    OTHER_PAGE,
    OWN_ONLY,
    OWN_PAGE,
    REFUSAL,
    RIVAL_ONLY,
    Answer,
)
from tests.api.auth.support import execute, make_workspace
from tests.api.entities.support import member, problem
from tests.api.keywords.support import project_url
from tests.api.keywords.test_tracked_keyword_ranks import Ledger
from tests.collectors.ai_support import OWN_NAME, RIVAL_NAME
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

seeded = summary_support.seeded

CELLS = {"include": "cells"}
DETAIL_NAMES = (
    "cited_given_citations",
    "citation_share",
    "first_mention",
    "fanout_presence",
    "fanout_mean",
)
RIVAL_FIRST = f"{RIVAL_NAME} and {OWN_NAME} both run managed SOC services in India today."
# Answers 1 and 4 of `providers` get fan-out queries (3 and 5): 2 of its 5 valid answers.
FANOUT = ((BOTH, 3), (RIVAL_ONLY, 5))


def _detail(row: dict[str, Any], code: str = CHATGPT) -> dict[str, Any]:
    detail: dict[str, Any] = by(row["engines"], "engine_code")[code]["detail"]
    return detail


async def _fan_out(migrated: PostgresServer, world: Summary) -> None:
    """Fan-out queries on two answers of `providers`, found by their text (each is the only one
    of its text on that prompt)."""
    for text, queries in FANOUT:
        await execute(
            migrated,
            "UPDATE ai.observations SET fanout_count = $3 WHERE prompt_id = $1 AND "
            "answer_text = $2 AND engine_code = 'chatgpt_web'",
            world.prompts["providers"].id,
            text,
            queries,
        )


async def test_cited_among_answers_with_citations(api: httpx.AsyncClient, seeded: Summary) -> None:
    data = await summary_data(seeded, api, **CELLS)
    branded = await summary_data(seeded, api, include_branded="true", **CELLS)

    # All five valid answers of `providers` cite something and two cite the own domain: the
    # answer with the refusal is a sixth that was counted and is not valid.
    providers = _detail(prompt_row(data, seeded, "providers"))["cited_given_citations"]
    assert cell(providers) == (2, 5, 6)
    assert providers["value"] == pytest.approx(0.4)
    assert providers["pooled"] is None
    assert cell(_detail(prompt_row(data, seeded, "pricing"))["cited_given_citations"]) == (0, 1, 1)
    assert cell(_detail(prompt_row(data, seeded, "misc"))["cited_given_citations"]) == (1, 1, 1)
    assert cell(
        _detail(prompt_row(data, seeded, "providers"), GEMINI)["cited_given_citations"]
    ) == (
        1,
        1,
        1,
    )
    # The branded prompt's one valid answer cites nothing: it was not cited, and it is not in the
    # denominator either (`cited` is 0 of 1, this one 0 of 0).
    brand = prompt_row(branded, seeded, "brand")["engines"][0]
    assert cell(brand["cited"]) == (0, 1, 1)
    assert cell(brand["detail"]["cited_given_citations"]) == (0, 0, 1)


async def test_own_citation_share_is_own_units_over_all_units(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    data = await summary_data(seeded, api, **CELLS)

    # Five units on `providers`, two of them the own page; each answer cites one page.
    share = _detail(prompt_row(data, seeded, "providers"))["citation_share"]
    assert cell(share) == (2, 5, 6)
    assert share["value"] == pytest.approx(0.4)
    # One outside unit: a rate of 0, which is not the null of no unit at all.
    pricing = _detail(prompt_row(data, seeded, "pricing"))["citation_share"]
    assert cell(pricing) == (0, 1, 1)
    assert pricing["value"] == 0
    assert cell(_detail(prompt_row(data, seeded, "misc"))["citation_share"]) == (1, 1, 1)
    # Gemini's captured answer holds thirteen sources that are five pages: one own, four outside.
    assert cell(_detail(prompt_row(data, seeded, "providers"), GEMINI)["citation_share"]) == (
        1,
        5,
        1,
    )


async def test_a_repeated_url_is_one_citation_unit(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
) -> None:
    """A page cited again in one answer, written as another address of it too, is one unit
    (docs/16 A8: a distinct canonical URL per answer): the provider's parser keeps one source per
    page, so `total_citation_count` is already the units and no read of the citations is needed."""
    world = await new_world(resources, migrated)
    world = replace(world, prompts=await new_prompts(migrated, world, ["a"]))
    await ingested(
        world,
        migrated,
        worker_db,
        import_store,
        [
            Answer(
                "a",
                OWN_ONLY,
                (OWN_PAGE, OWN_PAGE, f"{OWN_PAGE}?utm_source=chatgpt.com", OTHER_PAGE),
                1,
            ),
            Answer("a", NEITHER, (OTHER_PAGE, OTHER_PAGE), 2),
        ],
    )

    data = await summary_data(world, api, **CELLS)

    detail = _detail(data["prompts"][0])
    # Two units in the first answer (one own), one in the second.
    assert cell(detail["citation_share"]) == (1, 3, 2)
    assert cell(detail["cited_given_citations"]) == (1, 2, 2)


async def test_first_mention_is_order_one_among_answers_naming_the_own_brand(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    data = await summary_data(seeded, api, **CELLS)

    # Answers 1 and 2 name the own brand and it comes first in both.
    first = _detail(prompt_row(data, seeded, "providers"))["first_mention"]
    assert cell(first) == (2, 2, 6)
    assert first["value"] == 1
    # Gemini names the rival first: the own brand is named, and it is second.
    gemini = _detail(prompt_row(data, seeded, "providers"), GEMINI)["first_mention"]
    assert cell(gemini) == (0, 1, 1)
    assert gemini["value"] == 0
    # Nobody names the own brand in `pricing`: no answer to rate, so no value.
    pricing = _detail(prompt_row(data, seeded, "pricing"))["first_mention"]
    assert cell(pricing) == (0, 0, 1)
    assert pricing["value"] is None

    # Four valid answers on one prompt: the own brand first, first again, second, not named.
    world = await new_world(resources, migrated)
    world = replace(world, prompts=await new_prompts(migrated, world, ["a"]))
    await ingested(
        world,
        migrated,
        worker_db,
        import_store,
        [
            Answer("a", OWN_ONLY, (), 1),
            Answer("a", BOTH, (), 2),
            Answer("a", RIVAL_FIRST, (), 3),
            Answer("a", NEITHER, (), 4),
        ],
    )
    row = (await summary_data(world, api, **CELLS))["prompts"][0]

    assert cell(_detail(row)["first_mention"]) == (2, 3, 4)
    assert _detail(row)["first_mention"]["value"] == pytest.approx(2 / 3)


async def test_fanout_cells_are_null_on_an_engine_without_fanout_and_never_zero(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    # Gemini exposes no fan-out, whatever a row of its answers says.
    await execute(
        migrated,
        "UPDATE ai.observations SET fanout_count = 2 WHERE engine_code = 'gemini_web' "
        "AND project_id = $1",
        seeded.project.id,
    )

    data = await summary_data(seeded, api, include="cells,total")

    providers = prompt_row(data, seeded, "providers")
    gemini = _detail(providers, GEMINI)
    assert (gemini["fanout_presence"], gemini["fanout_mean"]) == (None, None)
    assert set(gemini) == set(DETAIL_NAMES)
    # ChatGPT does: no answer has fan-out, which is a rate of 0 over 5 and no mean at all.
    chatgpt = _detail(providers)
    assert cell(chatgpt["fanout_presence"]) == (0, 5, 6)
    assert chatgpt["fanout_presence"]["value"] == 0
    assert cell(chatgpt["fanout_mean"]) == (0, 0, 6)
    assert chatgpt["fanout_mean"]["value"] is None
    total = _detail(data["total"], GEMINI)
    assert (total["fanout_presence"], total["fanout_mean"]) == (None, None)


async def test_fanout_presence_and_mean_on_chatgpt(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    await _fan_out(migrated, seeded)

    data = await summary_data(seeded, api, **CELLS)

    chatgpt = _detail(prompt_row(data, seeded, "providers"))
    # Two of the five valid answers have fan-out queries: 3 and 5, a mean of 4 over those two.
    assert cell(chatgpt["fanout_presence"]) == (2, 5, 6)
    assert chatgpt["fanout_presence"]["value"] == pytest.approx(0.4)
    assert cell(chatgpt["fanout_mean"]) == (8, 2, 6)
    assert chatgpt["fanout_mean"]["value"] == 4
    # The other prompts have none.
    pricing = _detail(prompt_row(data, seeded, "pricing"))
    assert cell(pricing["fanout_presence"]) == (0, 1, 1)
    assert cell(pricing["fanout_mean"]) == (0, 0, 1)


async def test_topic_total_and_country_cells_are_weighted_as_stated(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    await _fan_out(migrated, seeded)
    await execute(
        migrated,
        "UPDATE ai.prompts SET country_iso = 'IN' WHERE id = $1",
        seeded.prompts["pricing"].id,
    )

    data = await summary_data(seeded, api, include="cells,total", group_by="country")

    # The three rates are prompt weighted (a prompt with no denominator is left out) with the
    # answers behind them in `pooled`; the share and the mean are sums over sums.
    total = _detail(data["total"])
    assert cell(total["cited_given_citations"]) == (pytest.approx(1.4), 3, 8)
    assert pooled(total["cited_given_citations"]) == (3, 7)
    assert cell(total["first_mention"]) == (2, 2, 8)
    assert pooled(total["first_mention"]) == (3, 3)
    assert cell(total["fanout_presence"]) == (pytest.approx(0.4), 3, 8)
    assert pooled(total["fanout_presence"]) == (2, 7)
    assert cell(total["citation_share"]) == (3, 7, 8)
    assert total["citation_share"]["pooled"] is None
    assert cell(total["fanout_mean"]) == (8, 2, 8)
    assert total["fanout_mean"]["pooled"] is None
    gemini = _detail(data["total"], GEMINI)
    assert cell(gemini["citation_share"]) == (1, 5, 1)
    assert cell(gemini["first_mention"]) == (0, 1, 1)
    assert pooled(gemini["first_mention"]) == (0, 1)
    # Managed SOC holds `providers` and `pricing`: 2/5 and 0/1 of the answers that cite.
    soc = _detail(topic_row(data, "Managed SOC"))
    assert cell(soc["cited_given_citations"]) == (pytest.approx(0.4), 2, 7)
    assert pooled(soc["cited_given_citations"]) == (2, 6)
    assert cell(soc["first_mention"]) == (1, 1, 7)
    assert pooled(soc["first_mention"]) == (2, 2)
    assert cell(soc["citation_share"]) == (2, 6, 7)
    assert cell(soc["fanout_mean"]) == (8, 2, 7)
    # `pricing` moved to IN: one prompt in each market.
    countries = by(data["by_country"], "country_iso")
    india, america = _detail(countries["IN"]), _detail(countries["US"])
    assert cell(india["cited_given_citations"]) == (0, 1, 1)
    assert pooled(india["cited_given_citations"]) == (0, 1)
    assert cell(india["first_mention"]) == (0, 0, 1)
    assert india["first_mention"]["value"] is None
    assert cell(india["citation_share"]) == (0, 1, 1)
    assert cell(india["fanout_mean"]) == (0, 0, 1)
    assert cell(america["cited_given_citations"]) == (pytest.approx(1.4), 2, 7)
    assert pooled(america["cited_given_citations"]) == (3, 6)
    assert cell(america["citation_share"]) == (3, 6, 7)
    assert cell(america["fanout_mean"]) == (8, 2, 7)
    # A country entry is the total under that country's filter, detail included.
    filtered = await summary_data(
        seeded, api, include="cells,total", **{"filter[country_iso]": "US"}
    )
    assert filtered["total"]["engines"] == countries["US"]["engines"]


async def test_zero_is_a_rate_and_no_denominator_is_a_null_value(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    data = await summary_data(seeded, api, include_branded="true", **CELLS)

    # Cells with nothing to rate keep their counts: a denominator of 0 and no value.
    brand = _detail(prompt_row(data, seeded, "brand"))
    for name in ("cited_given_citations", "citation_share", "fanout_mean"):
        assert cell(brand[name])[:2] == (0, 0), name
        assert brand[name]["value"] is None, name
    assert brand["first_mention"]["value"] == 1
    # One valid answer without fan-out is a real 0 of 1, not a null.
    assert cell(brand["fanout_presence"]) == (0, 1, 1)
    assert brand["fanout_presence"]["value"] == 0
    # No answer at all on Gemini for `pricing`: the same counts, and fan-out stays null there.
    gemini = _detail(prompt_row(data, seeded, "pricing"), GEMINI)
    for name in ("cited_given_citations", "citation_share", "first_mention"):
        assert cell(gemini[name]) == (0, 0, 0), name
        assert gemini[name]["value"] is None, name
    assert (gemini["fanout_presence"], gemini["fanout_mean"]) == (None, None)


async def test_detail_is_absent_unless_asked_and_has_no_previous_or_week_cells(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    def engines(data: dict[str, Any]) -> list[dict[str, Any]]:
        blocks = [*data["prompts"], *data["topics"], data["total"], *data["by_country"]]
        return [engine for block in blocks for engine in block["engines"]]

    asked = {"include": "series,entities,total", "compare": "previous_period"}
    plain = await summary_data(seeded, api, group_by="country", **asked)

    assert engines(plain)
    assert all("detail" not in engine for engine in engines(plain))
    assert "detail" not in plain["metric_context"]
    data = await summary_data(
        seeded, api, group_by="country", **{**asked, "include": "series,entities,total,cells"}
    )
    assert all(set(engine["detail"]) == set(DETAIL_NAMES) for engine in engines(data))
    for engine in engines(data):
        # The detail is of the window alone: the window before and a week have none.
        if engine["previous"] is not None:
            assert "detail" not in engine["previous"]
        assert all("detail" not in point for point in engine["series"])
    context = data["metric_context"]["detail"]
    assert set(context) == set(DETAIL_NAMES)
    assert {name: entry["metric"] for name, entry in context.items()} == {
        "cited_given_citations": "ai.citation_rate_given_citations",
        "citation_share": "ai.citation_share",
        "first_mention": "ai.first_mention_rate",
        "fanout_presence": "ai.fanout_presence_rate",
        "fanout_mean": "ai.fanout_mean_queries",
    }
    assert {name: entry["topic_rows"] for name, entry in context.items()} == {
        "cited_given_citations": "prompt_weighted",
        "citation_share": "observation_weighted",
        "first_mention": "prompt_weighted",
        "fanout_presence": "prompt_weighted",
        "fanout_mean": "observation_weighted",
    }
    assert {entry["prompt_rows"] for entry in context.values()} == {"observation_weighted"}
    # The context is said once, even when no row carries the detail.
    bare = await summary_data(seeded, api, rows="none", **CELLS)
    assert set(bare["metric_context"]["detail"]) == set(DETAIL_NAMES)
    assert "total" not in bare


async def test_rows_none_with_cells_keeps_the_total_detail_and_the_statements(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, seeded: Summary
) -> None:
    data = await summary_data(seeded, api, rows="none", include="total,cells")

    assert (data["prompts"], data["topics"]) == ([], [])
    chatgpt = _detail(data["total"])
    assert cell(chatgpt["citation_share"]) == (3, 7, 8)

    async def counted(**params: Any) -> int:
        with statements(resources) as seen:
            response = await get_summary(seeded, api, **params)
        assert response.status_code == 200, response.text
        return len(seen)

    await counted()
    assert await counted(rows="none", include="total,cells") == await counted(
        rows="none", include="total"
    )


async def test_detail_follows_the_engine_filter(api: httpx.AsyncClient, seeded: Summary) -> None:
    data = await summary_data(
        seeded, api, include="cells,total", **{"filter[engine_code_in]": GEMINI}
    )

    assert [engine["engine_code"] for engine in data["total"]["engines"]] == [GEMINI]
    assert cell(_detail(data["total"], GEMINI)["citation_share"]) == (1, 5, 1)


async def test_detail_excludes_branded_prompts_and_follows_the_term_subtree(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    default = await summary_data(seeded, api, include="cells,total")
    branded = await summary_data(seeded, api, include="cells,total", include_branded="true")
    compliance = await summary_data(
        seeded, api, include="cells,total", **{"filter[term]": str(seeded.topics["compliance"])}
    )

    # The branded prompt `brand` (a valid answer naming the own brand first, citing nothing)
    # is in the counts only when asked for.
    assert cell(_detail(default["total"])["first_mention"]) == (2, 2, 8)
    assert cell(_detail(branded["total"])["first_mention"]) == (3, 3, 9)
    assert cell(_detail(default["total"])["cited_given_citations"]) == (pytest.approx(1.4), 3, 8)
    assert cell(_detail(branded["total"])["cited_given_citations"]) == (pytest.approx(1.4), 3, 9)
    # Under a term the total is the prompts given it or a term below it: `providers` alone.
    total = _detail(compliance["total"])
    assert cell(total["cited_given_citations"]) == (pytest.approx(0.4), 1, 6)
    assert cell(total["citation_share"]) == (2, 5, 6)
    assert compliance["total"]["engines"] == topic_row(compliance, "Compliance")["engines"]


async def test_an_invalid_answer_counts_in_no_detail_cell(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    before = await summary_data(seeded, api, **CELLS)
    # The refusal of `providers` is given everything a valid answer has; it is still not valid.
    await execute(
        migrated,
        "UPDATE ai.observation_facts SET total_citation_count = 4, own_citation_count = 2, "
        "own_domain_cited = true, own_mentioned = true, own_mention_order = 1 "
        "WHERE project_id = $1 AND NOT is_valid",
        seeded.project.id,
    )
    await execute(
        migrated,
        "UPDATE ai.observations SET fanout_count = 4 WHERE project_id = $1 AND answer_text = $2",
        seeded.project.id,
        REFUSAL,
    )

    after = await summary_data(seeded, api, **CELLS)

    assert after == before
    providers = _detail(prompt_row(after, seeded, "providers"))
    assert cell(providers["cited_given_citations"]) == (2, 5, 6)
    assert cell(providers["fanout_presence"]) == (0, 5, 6)


async def test_another_projects_answers_are_not_in_the_detail(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    before = await summary_data(seeded, api, include="cells,total", group_by="country")
    other_workspace = await make_workspace(migrated)
    for number, workspace_id in enumerate((seeded.workspace.id, other_workspace.id)):
        await answer_in_another_project(
            migrated, worker_db, import_store, workspace_id, f"Otherco{number}", 1
        )
    await ingest(worker_db, import_store)

    after = await summary_data(seeded, api, include="cells,total", group_by="country")

    assert after == before


async def test_a_deleted_or_foreign_project_is_not_found_with_cells(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    seeded: Summary,
) -> None:
    outsider = await member(resources, migrated, await make_workspace(migrated), "owner")
    url = project_url(seeded.workspace, seeded.project.id, "ai", "prompts-summary")

    foreign = await api.get(url, params=CELLS, headers=outsider.headers)
    await execute(
        migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", seeded.project.id
    )
    deleted = await get_summary(seeded, api, **CELLS)

    assert problem(foreign) == (404, "not_found")
    assert problem(deleted) == (404, "not_found")
    unknown = project_url(seeded.workspace, uuid.uuid4(), "ai", "prompts-summary")
    assert problem(await api.get(unknown, params=CELLS, headers=seeded.owner.headers)) == (
        404,
        "not_found",
    )


async def test_detail_adds_no_statement(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The five cells are columns of the statement that counts the answers: `include=cells`
    costs no statement, alone or beside every other block. A first read warms the session cache
    so each counted read starts alike."""
    world = await full_project(resources, migrated)
    await get_summary(world, api)

    async def counted(**params: Any) -> int:
        with statements(resources) as seen:
            response = await get_summary(world, api, **params)
        assert response.status_code == 200, response.text
        return len(seen)

    every = {
        "include": "series,entities,total",
        "compare": "previous_period",
        "group_by": "country",
    }
    plain = await counted()

    assert await counted(**CELLS) - plain == 0
    assert await counted(**{**every, "include": f"{every['include']},cells"}) == await counted(
        **every
    )
    assert await counted(rows="none", **CELLS) - plain == -2
    data = await summary_data(world, api, **CELLS)
    for engine in data["topics"][0]["engines"]:
        # No answer of the base plan cites anything or has fan-out queries.
        assert cell(engine["detail"]["cited_given_citations"]) == (0, 0, 1200)
        assert cell(engine["detail"]["citation_share"]) == (0, 0, 1200)
        exposes = ENGINES[EngineCode(engine["engine_code"])].exposes_fanout
        assert (engine["detail"]["fanout_presence"] is not None) is exposes
        assert (engine["detail"]["fanout_mean"] is not None) is exposes
        if exposes:
            assert cell(engine["detail"]["fanout_presence"]) == (0, 150, 1200)
            assert cell(engine["detail"]["fanout_mean"]) == (0, 0, 1200)


async def test_the_default_summary_does_not_join_observations_for_detail(
    api: httpx.AsyncClient, resources: Resources, seeded: Summary
) -> None:
    """The fan-out counts live on the answers' own table, joined to the facts only for
    `include=cells`: a plain summary reads neither the columns nor the join."""
    await get_summary(seeded, api)
    with statements(resources) as plain:
        await get_summary(seeded, api)
    with statements(resources) as asked:
        await get_summary(seeded, api, **CELLS)

    assert not [text for text in plain if "fanout_count" in text]
    assert len([text for text in asked if "fanout_count" in text]) == 1
