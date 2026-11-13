"""The total row and the row selector (contract C2, change log C-3 and C-4): `include=total` adds
every prompt in scope as one row, built as a topic row is, and `rows` leaves the prompt rows or
both row lists out without touching the aggregates. Worked by hand from the seeded world of
`test_prompts_summary` (see the docstring of its `summary` fixture): the prompts in scope are
`providers`, `pricing` and `misc`; on ChatGPT `providers` has 2 of 5 valid answers naming the own
brand, `pricing` 0 of 1 and `misc` 1 of 1, and Gemini answered `providers` once."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.ai import summary_support
from tests.api.ai.summary_support import (
    CHATGPT,
    GEMINI,
    Summary,
    cell,
    entity_cell,
    full_project,
    get_summary,
    mention_every_answer,
    pooled,
    prompt_row,
    statements,
    summary_data,
    topic_row,
)
from tests.api.auth.support import execute, fetchrow, make_workspace
from tests.api.entities.support import member, problem
from tests.api.workspaces.support import make_project
from tests.collectors.support import Project
from tests.conftest import PostgresServer

seeded = summary_support.seeded

OUTCOME_NAMES = ("mentioned_and_cited", "mentioned_only", "cited_only", "neither")
EVERY_BLOCK = {"compare": "previous_period", "include": "series,entities,total"}


def _when(value: str) -> datetime:
    return datetime.fromisoformat(value)


def _engines(total: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {engine["engine_code"]: engine for engine in total["engines"]}


async def test_total_is_every_prompt_in_scope_as_one_topic_row(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    data = await summary_data(seeded, api, include="total")

    total = data["total"]
    assert total["prompt_count"] == 3
    chatgpt, gemini = total["engines"]
    assert (chatgpt["engine_code"], gemini["engine_code"]) == (CHATGPT, GEMINI)
    # Prompt weighted as a topic row is: 2/5 + 0/1 + 1/1 over 3 prompts, 7 valid answers in all
    # and 8 answers counted (the refusal of `providers` is one).
    assert cell(chatgpt["mentioned"]) == (pytest.approx(1.4), 3, 8)
    assert pooled(chatgpt["mentioned"]) == (3, 7)
    assert chatgpt["mentioned"]["value"] == pytest.approx(1.4 / 3)
    assert cell(chatgpt["cited"]) == (pytest.approx(1.4), 3, 8)
    assert pooled(chatgpt["cited"]) == (3, 7)
    # The outcomes are prompt weighted too, and add up to the prompts.
    assert [chatgpt["outcomes"][name]["numerator"] for name in OUTCOME_NAMES] == pytest.approx(
        [1.2, 0.2, 0.2, 1.4]
    )
    assert [pooled(chatgpt["outcomes"][name]) for name in OUTCOME_NAMES] == [
        (2, 7),
        (1, 7),
        (1, 7),
        (3, 7),
    ]
    assert all(chatgpt["outcomes"][name]["denominator"] == 3 for name in OUTCOME_NAMES)
    # Share of voice is one answer one weight: 1.5 + 0 + 1 over the 4 answers that name anyone.
    assert cell(chatgpt["share_of_voice"]) == (pytest.approx(2.5), 4, 8)
    assert chatgpt["share_of_voice"]["pooled"] is None
    # Gemini answered `providers` alone: both brands named, own page cited.
    assert cell(gemini["mentioned"]) == (1, 1, 1)
    assert pooled(gemini["mentioned"]) == (1, 1)
    assert cell(gemini["share_of_voice"]) == (0.5, 1, 1)
    # The last times are the newest of the prompt rows.
    for name in ("last_observed_at", "last_valid_at"):
        rows = [row[name] for row in data["prompts"]]
        assert total[name] is not None
        assert _when(total[name]) == max(_when(value) for value in rows if value)


async def test_total_equals_the_topic_row_under_a_term_filter(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    """Under the filter the topic row is Managed SOC and holds the very prompts in scope, so the
    total, built as a topic row, equals it in every block that is asked for."""
    soc = {"filter[term]": str(seeded.topics["soc"])}

    for params in ({"include": "total"}, EVERY_BLOCK):
        data = await summary_data(seeded, api, **soc, **params)

        assert [row["name"] for row in data["topics"]] == ["Managed SOC"]
        topic = topic_row(data, "Managed SOC")
        total = data["total"]
        assert total["prompt_count"] == topic["prompt_count"] == 2
        assert total["engines"] == topic["engines"]
        assert total["last_observed_at"] == topic["last_observed_at"]
        assert total["last_valid_at"] == topic["last_valid_at"]


async def test_total_counts_branded_prompts_only_when_asked(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    default = await summary_data(seeded, api, include="total")
    branded = await summary_data(seeded, api, include="total", include_branded="true")
    alone = await summary_data(seeded, api, include="total", branded_only="true")

    assert default["total"]["prompt_count"] == 3
    assert cell(_engines(default["total"])[CHATGPT]["mentioned"])[1] == 3
    # `brand` joins: one valid answer naming the own brand.
    assert branded["total"]["prompt_count"] == 4
    chatgpt = _engines(branded["total"])[CHATGPT]
    assert cell(chatgpt["mentioned"]) == (pytest.approx(2.4), 4, 9)
    assert pooled(chatgpt["mentioned"]) == (4, 8)
    assert alone["total"]["prompt_count"] == 1
    chatgpt, gemini = alone["total"]["engines"]
    assert cell(chatgpt["mentioned"]) == (1, 1, 1)
    assert cell(gemini["mentioned"]) == (0, 0, 0)
    assert gemini["mentioned"]["value"] is None


async def test_total_follows_the_engine_filter_and_country_scope(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    await execute(
        migrated,
        "UPDATE ai.prompts SET country_iso = 'IN' WHERE id = $1",
        seeded.prompts["pricing"].id,
    )

    gemini = await summary_data(seeded, api, include="total", **{"filter[engine_code_in]": GEMINI})
    india = await summary_data(seeded, api, include="total", **{"filter[country_iso]": "IN"})
    states = await summary_data(seeded, api, include="total", **{"filter[country_iso]": "US"})

    # The prompts in scope do not depend on the engines shown; the cells and times do.
    assert gemini["total"]["prompt_count"] == 3
    [only] = gemini["total"]["engines"]
    assert only["engine_code"] == GEMINI
    assert cell(only["mentioned"]) == (1, 1, 1)
    providers = prompt_row(gemini, seeded, "providers")
    assert gemini["total"]["last_observed_at"] == providers["last_observed_at"]
    assert gemini["total"]["last_valid_at"] == providers["last_valid_at"]
    # Indian prompts: `pricing` alone, 0 of its one valid answer.
    assert india["total"]["prompt_count"] == 1
    assert cell(_engines(india["total"])[CHATGPT]["mentioned"]) == (0, 1, 1)
    # US prompts: `providers` and `misc`, 2/5 + 1/1 over 2 prompts.
    assert states["total"]["prompt_count"] == 2
    assert cell(_engines(states["total"])[CHATGPT]["mentioned"]) == (pytest.approx(1.4), 2, 7)
    assert pooled(_engines(states["total"])[CHATGPT]["mentioned"]) == (3, 6)


async def test_total_is_present_with_zero_cells_when_nothing_is_in_scope(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    seeded: Summary,
) -> None:
    unknown = {"filter[term]": str(uuid.uuid4())}

    data = await summary_data(seeded, api, include="total", compare="previous_period", **unknown)

    assert (data["prompts"], data["topics"]) == ([], [])
    total = data["total"]
    assert total["prompt_count"] == 0
    assert (total["last_observed_at"], total["last_valid_at"]) == (None, None)
    # The engines are the project's enabled ones, with counts of 0 and no value, not a rate of 0.
    assert [engine["engine_code"] for engine in total["engines"]] == [CHATGPT, GEMINI]
    for engine in total["engines"]:
        assert engine["mentioned"]["value"] is None
        assert cell(engine["mentioned"]) == (0, 0, 0)
        assert pooled(engine["mentioned"]) == (0, 0)
        assert cell(engine["share_of_voice"]) == (0, 0, 0)
        assert [cell(engine["outcomes"][name]) for name in OUTCOME_NAMES] == [(0, 0, 0)] * 4
        # No prompt, so no answer in the window before either: null, not zero cells.
        assert "previous" in engine
        assert engine["previous"] is None
    # A project with no prompt and no engine has a total with no engine.
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = Project(workspace.id, await make_project(migrated, workspace.id))
    empty = Summary(workspace, project, owner, {}, {}, uuid.uuid4(), uuid.uuid4())

    bare = await summary_data(empty, api, include="total")

    assert bare["total"] == {
        "prompt_count": 0,
        "last_observed_at": None,
        "last_valid_at": None,
        "engines": [],
    }


async def test_total_carries_previous_series_and_entities_when_asked(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    data = await summary_data(seeded, api, **EVERY_BLOCK)

    chatgpt, gemini = data["total"]["engines"]
    # The window before holds answer 9 alone: `providers` 1 of 1, the own brand named and cited.
    assert cell(chatgpt["previous"]["mentioned"]) == (1, 1, 1)
    assert pooled(chatgpt["previous"]["mentioned"]) == (1, 1)
    assert cell(chatgpt["previous"]["share_of_voice"]) == (1, 1, 1)
    assert gemini["previous"] is None
    own, rival = (entity_cell(chatgpt, entity) for entity in (seeded.own, seeded.rival))
    assert cell(own["mentioned"]) == (pytest.approx(1.4), 3, 8)
    assert cell(own["previous"]["mentioned"]) == (1, 1, 1)
    # Named in 2 of the 5 valid answers of `providers` (1 and 4), by no other prompt.
    assert cell(rival["mentioned"]) == (pytest.approx(0.4), 3, 8)
    assert cell(rival["previous"]["mentioned"]) == (0, 1, 1)
    assert gemini["entities"]
    for entity in gemini["entities"]:
        assert entity["previous"] is None
    # A point for each week the window touches, on each engine, as a topic row has.
    soc = topic_row(data, "Managed SOC")["engines"][0]
    weeks = [point["week_start"] for point in soc["series"]]
    for engine in (chatgpt, gemini):
        assert [point["week_start"] for point in engine["series"]] == weeks
        assert len(weeks) in (4, 5)


async def test_rows_topics_leaves_the_prompt_rows_out(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    full = await summary_data(seeded, api, **EVERY_BLOCK)

    data = await summary_data(seeded, api, rows="topics", **EVERY_BLOCK)

    assert full["prompts"]
    assert data["prompts"] == []
    assert [row["name"] for row in data["topics"]] == ["Compliance", "Managed SOC", None]
    # The aggregates do not depend on `rows`: all that differs is the prompt list.
    assert data == {**full, "prompts": []}


async def test_rows_none_leaves_both_lists_and_keeps_total(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    full = await summary_data(seeded, api, **EVERY_BLOCK)

    data = await summary_data(seeded, api, rows="none", **EVERY_BLOCK)

    assert (data["prompts"], data["topics"]) == ([], [])
    assert data["total"] == full["total"]
    assert data["total"]["prompt_count"] == 3
    assert data == {**full, "prompts": [], "topics": []}


async def test_rows_none_alone_is_an_empty_summary_with_the_engines(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    full = await summary_data(seeded, api)

    data = await summary_data(seeded, api, rows="none")

    assert (data["prompts"], data["topics"]) == ([], [])
    assert "total" not in data
    assert data["engine_codes"] == [CHATGPT, GEMINI]
    assert data["entities"] == full["entities"]
    assert data["metric_context"] == full["metric_context"]
    assert data["window"] == full["window"]
    # A term filter and the branded flags change what is in scope, not what `rows=none` leaves.
    scoped = await summary_data(
        seeded, api, rows="none", branded_only="true", **{"filter[term]": str(uuid.uuid4())}
    )
    assert (scoped["prompts"], scoped["topics"]) == ([], [])
    assert scoped["branded_only"] is True


@pytest.mark.parametrize(
    "params",
    [{}, {"rows": "topics"}, {"rows": "none"}, {"include": "series,entities"}, {"compare": "none"}],
    ids=str,
)
async def test_a_total_is_absent_unless_asked(
    api: httpx.AsyncClient, seeded: Summary, params: dict[str, str]
) -> None:
    data = await summary_data(seeded, api, **params)

    assert "total" not in data


@pytest.mark.parametrize(
    "value", ["all", "prompts", "TOPICS", "topics,none", "", "none "], ids=repr
)
async def test_rows_values_other_than_topics_or_none_are_422(
    api: httpx.AsyncClient, seeded: Summary, value: str
) -> None:
    response = await get_summary(seeded, api, rows=value)

    assert problem(response) == (422, "validation_failed")


async def test_include_total_is_accepted_beside_the_other_values_and_a_bad_one_is_422(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    assert (await get_summary(seeded, api, include="total,series,entities")).status_code == 200
    assert (await get_summary(seeded, api, include="total,total")).status_code == 200
    assert problem(await get_summary(seeded, api, include="total,bogus")) == (
        422,
        "validation_failed",
    )
    # Not built yet: still refused, and `total` does not hide it.
    assert problem(await get_summary(seeded, api, include="total,co_mentions")) == (
        501,
        "not_implemented",
    )


async def test_rows_none_skips_the_topic_statements(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The prompts' topic rollup and the topics' names are two statements; `rows=none` reads
    neither, and `rows=topics` and the total read the same as a plain summary (C-3, C-4). A first
    read warms the session cache so each counted read starts alike."""
    world = await full_project(resources, migrated)
    await mention_every_answer(migrated, world)
    await get_summary(world, api)

    async def counted(**params: Any) -> int:
        with statements(resources) as seen:
            response = await get_summary(world, api, **params)
        assert response.status_code == 200, response.text
        return len(seen)

    plain = await counted()

    assert await counted(rows="none") - plain == -2
    assert await counted(rows="none", include="total") - plain == -2
    assert await counted(rows="topics") - plain == 0
    assert await counted(include="total") - plain == 0
    # The total is Python over the counts already read: with every block it adds nothing.
    everything = await counted(include="series,entities,total", compare="previous_period")
    assert everything == await counted(include="series,entities", compare="previous_period")
    data = await summary_data(world, api, rows="none", include="total")
    assert (data["prompts"], data["topics"]) == ([], [])
    assert data["total"]["prompt_count"] == 150
    for engine in data["total"]["engines"]:
        # Every answer names the own brand: 8 a prompt, 150 prompts.
        assert cell(engine["mentioned"]) == (150, 150, 1200)
        assert pooled(engine["mentioned"]) == (1200, 1200)


async def test_rows_none_under_a_term_filter_also_skips_the_subtree_statement(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    world = await full_project(resources, migrated)
    term = await fetchrow(
        migrated,
        "SELECT id FROM core.taxonomy_terms WHERE workspace_id = $1 AND name = 'Managed SOC'",
        world.workspace.id,
    )
    params = {"filter[term]": str(term["id"])}
    await get_summary(world, api, **params)

    async def counted(**more: Any) -> int:
        with statements(resources) as seen:
            response = await get_summary(world, api, **params, **more)
        assert response.status_code == 200, response.text
        return len(seen)

    # The rollup, the term's subtree and the names: three statements that no row reads.
    assert await counted(rows="none") - await counted() == -3
    data = await summary_data(world, api, rows="none", include="total", **params)
    assert data["total"]["prompt_count"] == 150


async def test_rows_none_with_a_term_still_scopes_the_total(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    """`rows=none` skips the term's subtree read for the rows, not for the scope: in the seeded
    world only `providers` holds Compliance, while the three prompts in scope hold one topic or
    none. (Under `full_project` all 150 prompts hold Managed SOC, so a term cannot narrow there.)"""
    compliance = {"filter[term]": str(seeded.topics["compliance"])}

    everything = await summary_data(seeded, api, rows="none", include="total")
    narrowed = await summary_data(seeded, api, rows="none", include="total", **compliance)

    assert everything["total"]["prompt_count"] == 3
    assert narrowed["total"]["prompt_count"] == 1
    assert (narrowed["prompts"], narrowed["topics"]) == ([], [])
    # `providers` alone, as a topic row: 2 of its 5 valid ChatGPT answers (6 counted) name the
    # own brand, one prompt weighing 0.4.
    chatgpt = _engines(narrowed["total"])[CHATGPT]
    assert cell(chatgpt["mentioned"]) == (pytest.approx(0.4), 1, 6)
    assert pooled(chatgpt["mentioned"]) == (2, 5)
