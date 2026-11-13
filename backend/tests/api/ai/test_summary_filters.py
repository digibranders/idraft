"""The outcome and opportunity filters (contract C2, change log C-5 and C-6): a prompt row is kept
when at least one of its valid answers in the window, on the engines shown, had the outcome or
the opportunity asked for. They narrow `prompts` only: the cells, the topic rows, `total`,
`co_mentions` and `prompt_count` still count every prompt in scope. The seeded world gives the
outcomes (its docstring lists each answer); answers written straight into the tables give the
entities each one names, so every row is worked by hand."""

from __future__ import annotations

import uuid
from dataclasses import replace
from datetime import datetime, timedelta
from typing import Any

import httpx
import pytest

from idraft.api.resources import Resources
from idraft.collectors.ai_prompt_ingest import ingest
from tests.api.ai import summary_support
from tests.api.ai.summary_support import (
    GEMINI,
    Summary,
    answer_in_another_project,
    assign_topic,
    full_project,
    get_summary,
    new_prompts,
    new_world,
    statements,
    summary_data,
)
from tests.api.ai.support import ai_project
from tests.api.ai.test_prompts_summary import _term
from tests.api.ai.test_summary_entity_series import Named, _write_named
from tests.api.ai.test_summary_pooling import _base_week, _project, _span, _wednesday
from tests.api.auth.support import execute, fetchrow, make_workspace
from tests.api.entities.support import member, problem
from tests.api.keywords.support import project_url
from tests.api.keywords.test_tracked_keyword_ranks import Ledger
from tests.api.workspaces.support import make_project
from tests.collectors.rank_support import _entity
from tests.collectors.support import Project
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

seeded = summary_support.seeded

OUTCOME = "filter[outcome]"
OPPORTUNITY = "filter[opportunity]"
INVALID = (422, "validation_failed")


async def _kept(world: Summary, api: httpx.AsyncClient, **params: Any) -> list[str]:
    """The names of the prompt rows a summary gives, sorted."""
    data = await summary_data(world, api, **params)
    names = {str(prompt.id): name for name, prompt in world.prompts.items()}
    return sorted(names[row["prompt_id"]] for row in data["prompts"])


def _window() -> dict[str, str]:
    """The week of the answers written below: all on its Wednesday."""
    week = _base_week()
    return _span(week, week + timedelta(days=6))


def _at(hours: int = 0) -> datetime:
    return _wednesday(_base_week(), 0) + timedelta(hours=hours)


async def _in_the_week(world: Summary, api: httpx.AsyncClient, **params: Any) -> list[str]:
    return await _kept(world, api, **_window(), **params)


# The outcomes of the seeded world (docs of its fixture), on the default window: `providers`
# has a valid answer of each outcome but one is the Gemini one, `pricing` answered `neither`,
# `misc` `mentioned_and_cited`; the branded prompt answered `mentioned_only`.


@pytest.mark.parametrize(
    ("outcome", "kept"),
    [
        ("cited_only", ["providers"]),
        ("neither", ["pricing", "providers"]),
        ("mentioned_only", ["providers"]),
        ("mentioned_and_cited", ["misc", "providers"]),
    ],
)
async def test_outcome_keeps_the_prompts_with_a_valid_answer_of_that_outcome(
    api: httpx.AsyncClient, seeded: Summary, outcome: str, kept: list[str]
) -> None:
    """`providers` has five valid ChatGPT answers (both named and not cited, own named and cited,
    two with nobody named, one of which cites the own page, and the rival alone) and a Gemini one
    (own named and cited); `pricing` one (`neither`); `misc` one (`mentioned_and_cited`). The
    refusal, the superseded and not current answers, the branded prompt and the archived one are
    not in scope."""
    assert await _kept(seeded, api, **{OUTCOME: outcome}) == kept


async def test_a_kept_row_still_has_all_its_cells(api: httpx.AsyncClient, seeded: Summary) -> None:
    """The filter chooses rows; a row it keeps is the row it was, with every block and every
    engine, not only the answers that matched."""
    every = {"include": "series,entities", "compare": "previous_period"}
    plain = await summary_data(seeded, api, **every)
    narrowed = await summary_data(seeded, api, **every, **{OUTCOME: "cited_only"})

    [row] = narrowed["prompts"]
    assert row == next(r for r in plain["prompts"] if r["prompt_id"] == row["prompt_id"])
    assert row["prompt_id"] == str(seeded.prompts["providers"].id)
    assert [engine["engine_code"] for engine in row["engines"]] == plain["engine_codes"]


@pytest.mark.parametrize(
    ("name", "value"),
    [
        (OUTCOME, "cited_only"),
        (OUTCOME, "neither"),
        (OPPORTUNITY, "named_not_cited"),
        (OPPORTUNITY, "nobody_named"),
        (OPPORTUNITY, "lost_to:{rival}"),
    ],
)
async def test_topics_total_countries_and_co_mentions_are_not_narrowed_by_the_filters(
    api: httpx.AsyncClient, seeded: Summary, name: str, value: str
) -> None:
    """Everything of the response but `prompts` is what it is without the filter: the topic rows
    (with their `prompt_count`), `total`, `by_country`, `co_mentions`, the previous cells, the
    series and the entity cells. The prompt rows are fewer than the three of the scope."""
    every = {
        "include": "series,entities,total,co_mentions",
        "compare": "previous_period",
        "group_by": "country",
    }
    plain = await summary_data(seeded, api, **every)
    narrowed = await summary_data(seeded, api, **every, **{name: value.format(rival=seeded.rival)})

    assert len(plain["prompts"]) == 3
    assert [entry["country_iso"] for entry in plain["by_country"]] == ["US"]
    assert 0 < len(narrowed["prompts"]) < 3
    assert {k: v for k, v in narrowed.items() if k != "prompts"} == {
        k: v for k, v in plain.items() if k != "prompts"
    }
    assert plain["total"]["prompt_count"] == 3
    assert [topic["prompt_count"] for topic in narrowed["topics"]] == [
        topic["prompt_count"] for topic in plain["topics"]
    ]


async def test_the_engine_filter_narrows_the_engines_the_rule_looks_at(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    """Only Gemini is shown: its one answer (of `providers`) is `mentioned_and_cited`, so
    `neither` keeps nothing, though `providers` has `neither` answers on ChatGPT."""
    gemini = {"filter[engine_code_in]": GEMINI}

    assert await _kept(seeded, api, **{OUTCOME: "neither"}) == ["pricing", "providers"]
    assert await _kept(seeded, api, **gemini, **{OUTCOME: "neither"}) == []
    assert await _kept(seeded, api, **gemini, **{OUTCOME: "mentioned_and_cited"}) == ["providers"]
    assert await _kept(seeded, api, **gemini, **{OPPORTUNITY: "nobody_named"}) == []
    assert await _kept(seeded, api, **{"filter[engine_code_in]": "chatgpt_web"}) == [
        "misc",
        "pricing",
        "providers",
    ]


@pytest.mark.parametrize(
    ("opportunity", "branded", "kept"),
    [
        ("named_not_cited", {}, ["providers"]),
        ("named_not_cited", {"include_branded": "true"}, ["brand", "providers"]),
        ("cited_not_named", {}, ["providers"]),
        ("cited_not_named", {"include_branded": "true"}, ["providers"]),
        ("nobody_named", {}, ["pricing", "providers"]),
        ("nobody_named", {"include_branded": "true"}, ["pricing", "providers"]),
    ],
)
async def test_named_not_cited_cited_not_named_and_nobody_named(
    api: httpx.AsyncClient,
    seeded: Summary,
    opportunity: str,
    branded: dict[str, str],
    kept: list[str],
) -> None:
    """`named_not_cited` is the outcome `mentioned_only` (`providers` by its first answer, the
    branded prompt too when it is in scope), `cited_not_named` is `cited_only` (`providers` by
    its fifth), `nobody_named` is an answer naming no tracked entity (`providers` by two,
    `pricing`; `misc` and the branded prompt name the own brand)."""
    assert await _kept(seeded, api, **branded, **{OPPORTUNITY: opportunity}) == kept


async def test_the_two_filters_are_two_row_rules_not_one_answer_rule(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    """Both apply, and a row must pass each: `providers` is kept by `cited_only` (its fifth
    answer) and by `named_not_cited` (its first), though no one answer is both. `misc` passes
    only the outcome and `pricing` only the opportunity."""
    assert await _kept(seeded, api, **{OUTCOME: "cited_only", OPPORTUNITY: "named_not_cited"}) == [
        "providers"
    ]
    assert await _kept(
        seeded, api, **{OUTCOME: "mentioned_and_cited", OPPORTUNITY: "nobody_named"}
    ) == ["providers"]
    assert await _kept(seeded, api, **{OUTCOME: "mentioned_and_cited"}) == ["misc", "providers"]
    assert await _kept(seeded, api, **{OPPORTUNITY: "nobody_named"}) == ["pricing", "providers"]
    assert await _kept(seeded, api, **{OUTCOME: "cited_only", OPPORTUNITY: "nobody_named"}) == [
        "providers"
    ]


async def test_lost_to_a_competitor_is_an_answer_that_names_it_and_not_the_own_brand(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """`a`: one answer naming both brands. `b`: the rival alone. `c`: the own brand alone. `d`:
    nobody. `e`: both, and on another answer the rival alone. `f`: the rival and a third
    competitor. Lost to the rival: `b`, `e`, `f`; to the third: `f`. A prompt where the rival is
    named beside the own brand has not lost to it."""
    world = await _project(resources, migrated, ["a", "b", "c", "d", "e", "f"])
    third = await _entity(migrated, world.project, "Thirdco", "thirdco.example", "competitor")
    both = (world.own, world.rival)
    await _write_named(
        migrated,
        world,
        [
            Named("a", _at(), both),
            Named("b", _at(1), (world.rival,)),
            Named("c", _at(2), (world.own,)),
            Named("d", _at(3)),
            Named("e", _at(4), both),
            Named("e", _at(5), (world.rival,)),
            Named("f", _at(6), (world.rival, third)),
        ],
    )

    assert await _in_the_week(world, api) == ["a", "b", "c", "d", "e", "f"]
    assert await _in_the_week(world, api, **{OPPORTUNITY: f"lost_to:{world.rival}"}) == [
        "b",
        "e",
        "f",
    ]
    assert await _in_the_week(world, api, **{OPPORTUNITY: f"lost_to:{third}"}) == ["f"]
    assert await _in_the_week(world, api, **{OPPORTUNITY: "nobody_named"}) == ["d"]
    assert await _in_the_week(world, api, **{OUTCOME: "mentioned_only"}) == ["a", "c", "e"]
    assert await _in_the_week(world, api, **{OUTCOME: "neither"}) == ["b", "d", "e", "f"]
    both_rules = {OUTCOME: "mentioned_only", OPPORTUNITY: f"lost_to:{world.rival}"}
    assert await _in_the_week(world, api, **both_rules) == ["e"]


async def test_lost_to_the_own_brand_an_unknown_or_a_foreign_id_keeps_nothing_and_is_200(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The answer of `b` names the rival alone, and its competitor list also holds the own brand,
    a competitor of another project of the workspace, a competitor of another workspace and an
    id nobody has (a list that, as a removed competitor's would, outlives the entity set). Only
    the competitors of this project count: each of those ids keeps no row, is not `404`, and the
    rival keeps `b`."""
    world = await _project(resources, migrated, ["a", "b"])
    other = Project(world.workspace.id, await make_project(migrated, world.workspace.id))
    elsewhere = await _entity(migrated, other, "Elsewhere", "elsewhere.example", "competitor")
    abroad = (await new_world(resources, migrated)).rival
    strangers = [world.own, elsewhere, abroad, uuid.uuid4()]
    await _write_named(
        migrated, world, [Named("a", _at(), (world.own,)), Named("b", _at(1), (world.rival,))]
    )
    await execute(
        migrated,
        "UPDATE ai.observation_facts SET competitor_mentions = competitor_mentions || $2::uuid[] "
        "WHERE prompt_id = $1",
        world.prompts["b"].id,
        strangers,
    )

    assert await _in_the_week(world, api, **{OPPORTUNITY: f"lost_to:{world.rival}"}) == ["b"]
    for stranger in strangers:
        response = await get_summary(
            world, api, **_window(), **{OPPORTUNITY: f"lost_to:{stranger}"}
        )
        assert response.status_code == 200, response.text
        assert response.json()["data"]["prompts"] == [], stranger


async def test_an_invalid_answer_does_not_match_any_filter(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """`a` and `c` hold only a refusal (`a` names the rival, `c` nobody): the refusal is no
    valid answer, so it is not `neither`, not `nobody_named`, not lost to the rival. `b` and `d`
    are the same answers, valid, and match."""
    world = await _project(resources, migrated, ["a", "b", "c", "d"])
    await _write_named(
        migrated,
        world,
        [
            Named("a", _at(), (world.rival,), valid=False),
            Named("b", _at(1), (world.rival,)),
            Named("c", _at(2), valid=False),
            Named("d", _at(3)),
        ],
    )

    assert await _in_the_week(world, api, **{OUTCOME: "neither"}) == ["b", "d"]
    assert await _in_the_week(world, api, **{OPPORTUNITY: "nobody_named"}) == ["d"]
    assert await _in_the_week(world, api, **{OPPORTUNITY: f"lost_to:{world.rival}"}) == ["b"]
    assert await _in_the_week(world, api, **{OPPORTUNITY: "named_not_cited"}) == []
    assert await _in_the_week(world, api) == ["a", "b", "c", "d"]


async def test_a_superseded_or_not_current_answer_matches_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The only answer of `b` is superseded and that of `c` has facts that are no longer current:
    neither matches, as neither is counted."""
    world = await _project(resources, migrated, ["a", "b", "c"])
    rival = (world.rival,)
    await _write_named(
        migrated,
        world,
        [Named("a", _at(), rival), Named("b", _at(1), rival), Named("c", _at(2), rival)],
    )
    await execute(
        migrated,
        "UPDATE ai.observations SET superseded_by = id WHERE prompt_id = $1",
        world.prompts["b"].id,
    )
    await execute(
        migrated,
        "UPDATE ai.observation_facts SET is_current = false WHERE prompt_id = $1",
        world.prompts["c"].id,
    )

    assert await _in_the_week(world, api, **{OPPORTUNITY: f"lost_to:{world.rival}"}) == ["a"]
    assert await _in_the_week(world, api, **{OUTCOME: "neither"}) == ["a"]


async def test_filters_follow_the_branded_scope(api: httpx.AsyncClient, seeded: Summary) -> None:
    """The branded prompt's one answer is `mentioned_only`: it keeps the row only when branded
    prompts are in scope, and alone under `branded_only`."""
    outcome = {OUTCOME: "mentioned_only"}

    assert await _kept(seeded, api, **outcome) == ["providers"]
    assert await _kept(seeded, api, include_branded="true", **outcome) == ["brand", "providers"]
    assert await _kept(seeded, api, branded_only="true", **outcome) == ["brand"]
    assert await _kept(seeded, api, branded_only="true", **{OUTCOME: "neither"}) == []


async def test_filters_follow_the_term_subtree(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Security holds SOC. Prompt `a` is in SOC, `b` in Security itself, `c` in no topic and `d`
    in an unrelated topic; each has an answer naming the rival alone. Under Security the rows are
    `a` and `b`, under SOC `a` alone."""
    world = await new_world(resources, migrated)
    world = replace(world, prompts=await new_prompts(migrated, world, ["a", "b", "c", "d"]))
    vocabulary = await fetchrow(
        migrated,
        "INSERT INTO core.taxonomy_vocabularies (workspace_id, project_id, kind, name) "
        "VALUES ($1, $2, 'topic', 'Tree') RETURNING id",
        world.workspace.id,
        world.project.id,
    )
    security = await _term(migrated, world, vocabulary["id"], "Security")
    soc = await _term(migrated, world, vocabulary["id"], "SOC", (security, "security"))
    unrelated = await _term(migrated, world, vocabulary["id"], "Unrelated")
    await assign_topic(migrated, world, "a", soc)
    await assign_topic(migrated, world, "b", security)
    await assign_topic(migrated, world, "d", unrelated)
    await _write_named(
        migrated,
        world,
        [Named(name, _at(index), (world.rival,)) for index, name in enumerate("abcd")],
    )
    lost = {OPPORTUNITY: f"lost_to:{world.rival}"}

    assert await _in_the_week(world, api, **lost) == ["a", "b", "c", "d"]
    assert await _in_the_week(world, api, **lost, **{"filter[term]": str(security)}) == ["a", "b"]
    assert await _in_the_week(world, api, **lost, **{"filter[term]": str(soc)}) == ["a"]
    assert await _in_the_week(world, api, **{OUTCOME: "neither", "filter[term]": str(soc)}) == ["a"]


async def test_another_projects_answers_never_match(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
) -> None:
    """The prompts of this project answered `neither` only. A second project of the workspace and
    a second workspace each have an answer that names its own brand and cites its page
    (`mentioned_and_cited`): it matches in neither summary but its own."""
    world = await _project(resources, migrated, ["a"])
    await _write_named(migrated, world, [Named("a", _at())])
    other_workspace = await make_workspace(migrated)
    for number, workspace_id in enumerate((world.workspace.id, other_workspace.id)):
        await answer_in_another_project(
            migrated, worker_db, import_store, workspace_id, f"Otherco{number}", 1
        )
    await ingest(worker_db, import_store)

    # The default window holds the other projects' answers (one day old), and not this one's.
    assert await _kept(world, api, **{OUTCOME: "mentioned_and_cited"}) == []
    assert await _in_the_week(world, api, **{OUTCOME: "mentioned_and_cited"}) == []
    assert await _in_the_week(world, api, **{OUTCOME: "neither"}) == ["a"]
    assert await _in_the_week(world, api, **{OPPORTUNITY: "nobody_named"}) == ["a"]


async def test_a_deleted_project_is_not_found_with_the_filters(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    await execute(
        migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", seeded.project.id
    )

    outcome = await get_summary(seeded, api, **{OUTCOME: "neither"})
    opportunity = await get_summary(seeded, api, **{OPPORTUNITY: f"lost_to:{seeded.rival}"})

    assert problem(outcome) == (404, "not_found")
    assert problem(opportunity) == (404, "not_found")


async def test_a_summary_without_the_filters_has_every_prompt_row(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    """Nothing is narrowed or added when the filters are not asked for."""
    data = await summary_data(seeded, api)

    assert sorted(row["prompt_id"] for row in data["prompts"]) == sorted(
        str(seeded.prompts[name].id) for name in ("providers", "pricing", "misc")
    )
    assert "by_country" not in data
    assert "total" not in data


async def test_filters_add_no_statement(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """3,600 answers of 150 prompts: the filters are Python over the counts already read, and
    `lost_to` only adds a column to that read, so each request costs what a plain one does. A
    first read warms the session cache so each counted read starts alike."""
    world = await full_project(resources, migrated)
    rival = await _entity(migrated, world.project, "Rivalco", "rivalco.example", "competitor")
    await get_summary(world, api)

    async def counted(**params: Any) -> tuple[int, int]:
        with statements(resources) as seen:
            response = await get_summary(world, api, **params)
        assert response.status_code == 200, response.text
        return len(seen), len(response.json()["data"]["prompts"])

    blocks = {"include": "series,entities,total", "compare": "previous_period"}
    plain, rows = await counted()
    plain_blocks, _ = await counted(**blocks)
    assert rows == 150
    # Every answer names the own brand and cites nothing: `mentioned_only`, naming no rival.
    for params, kept in [
        ({OUTCOME: "mentioned_only"}, 150),
        ({OUTCOME: "neither"}, 0),
        ({OPPORTUNITY: "named_not_cited"}, 150),
        ({OPPORTUNITY: "cited_not_named"}, 0),
        ({OPPORTUNITY: "nobody_named"}, 0),
        ({OPPORTUNITY: f"lost_to:{rival}"}, 0),
        ({OPPORTUNITY: f"lost_to:{uuid.uuid4()}"}, 0),
        ({OUTCOME: "mentioned_only", OPPORTUNITY: f"lost_to:{rival}"}, 0),
    ]:
        used, rows = await counted(**params)
        assert (used, rows) == (plain, kept), params
    used, rows = await counted(**blocks, **{OPPORTUNITY: f"lost_to:{rival}"})
    assert (used, rows) == (plain_blocks, 0)


@pytest.mark.parametrize(
    "params",
    [
        {OUTCOME: "lost"},
        {OUTCOME: ""},
        {OUTCOME: "NEITHER"},
        {OUTCOME: "named_not_cited"},
        {OPPORTUNITY: "neither"},
        {OPPORTUNITY: ""},
        {OPPORTUNITY: "lost_to:nope"},
        {OPPORTUNITY: "lost_to:"},
        {OPPORTUNITY: "lost_to"},
        {OPPORTUNITY: "xnamed_not_citedx"},
        {OPPORTUNITY: "xnamed_not_cited"},
        {OPPORTUNITY: "named_not_citedx"},
        {OPPORTUNITY: "named_not_cited\n"},
        {OPPORTUNITY: "named_not_cited,nobody_named"},
        {OPPORTUNITY: f"xlost_to:{uuid.UUID(int=75)}"},
        {OPPORTUNITY: f"lost_to:{uuid.UUID(int=75)}x"},
        {OPPORTUNITY: f"lost_to:{uuid.UUID(int=75)}\n"},
        {OPPORTUNITY: f"lost_to:{uuid.UUID(int=75)}0"},
        {OPPORTUNITY: f"lost_to:{str(uuid.UUID(int=0xABC)).upper()}"},
        {OUTCOME: "lost", OPPORTUNITY: "nobody_named"},
        {OUTCOME: "neither", OPPORTUNITY: "lost_to:nope"},
    ],
    ids=str,
)
async def test_filter_values_out_of_the_contract_are_422(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    params: dict[str, str],
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)

    response = await api.get(
        project_url(workspace, project, "ai", "prompts-summary"),
        params=params,
        headers=viewer.headers,
    )

    assert problem(response) == INVALID
