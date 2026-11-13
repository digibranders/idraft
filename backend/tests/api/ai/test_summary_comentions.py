"""Co-mentions per engine (contract C2, change log C-8): with `include=co_mentions` the summary
says, for each engine shown, how many valid answers are in scope and, for each pair of tracked
entities named in the same valid answer, how many answers name both. Answers are written straight
into the tables, with the entities each one names in order, so every number is worked by hand."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import replace
from datetime import datetime, timedelta
from itertools import combinations
from typing import Any

import httpx
import pytest

from idraft.api.ai.summary import ENTITY_CELLS_MAX, co_mention_pairs, entity_cell_ids
from idraft.api.ai.summary_repository import TrackedEntity
from idraft.api.resources import Resources
from tests.api.ai import summary_support
from tests.api.ai.summary_support import (
    CHATGPT,
    GEMINI,
    Summary,
    assign_topic,
    full_project,
    get_summary,
    new_prompts,
    new_world,
    statements,
    summary_data,
)
from tests.api.ai.test_prompts_summary import _term
from tests.api.ai.test_summary_entity_series import Named, _write_named
from tests.api.ai.test_summary_pooling import _base_week, _project, _span, _wednesday
from tests.api.auth.support import execute, fetchrow, make_workspace
from tests.api.entities.support import member, problem
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import add_prompt, enable_engine
from tests.collectors.rank_support import _entity
from tests.collectors.support import Project
from tests.conftest import PostgresServer

seeded = summary_support.seeded

Pair = tuple[uuid.UUID, uuid.UUID]


def test_pairs_are_sorted_by_answers_descending_then_by_id() -> None:
    low, middle, high = sorted(uuid.uuid4() for _ in range(3))
    found = {(middle, high): 2, (low, high): 5, (low, middle): 2}

    pairs = co_mention_pairs(found)

    assert [(pair.a, pair.b, pair.answers) for pair in pairs] == [
        (low, high, 5),
        (low, middle, 2),
        (middle, high, 2),
    ]
    assert co_mention_pairs({}) == []


def test_the_entity_cap_keeps_the_own_entities_first_and_the_order_given() -> None:
    competitors = [TrackedEntity(uuid.uuid4(), f"Rival {n:02d}", "competitor") for n in range(25)]
    own = [TrackedEntity(uuid.uuid4(), name, "own") for name in ("Zeta", "Alpha")]

    # The repository gives the own entities after the competitors when they sort so by role.
    ids = entity_cell_ids([*competitors, *own])

    assert ENTITY_CELLS_MAX == 20
    assert ids == [e.id for e in own] + [e.id for e in competitors[:18]]
    assert entity_cell_ids(own) == [e.id for e in own]
    assert entity_cell_ids([]) == []


def _window() -> dict[str, str]:
    """The week of the answers written below: all on its Wednesday."""
    week = _base_week()
    return _span(week, week + timedelta(days=6))


def _at(hours: int = 0) -> datetime:
    return _wednesday(_base_week(), 0) + timedelta(hours=hours)


def _ordered(first: uuid.UUID, second: uuid.UUID) -> Pair:
    """A pair as the response gives it: the lower id first."""
    low, high = sorted((first, second))
    return low, high


def _engines(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {entry["engine_code"]: entry for entry in data["co_mentions"]}


def _pairs(entry: dict[str, Any]) -> list[tuple[Pair, int]]:
    return [
        ((uuid.UUID(pair["a"]), uuid.UUID(pair["b"])), pair["answers"]) for pair in entry["pairs"]
    ]


async def _co_mentions(world: Summary, api: httpx.AsyncClient, **params: Any) -> dict[str, Any]:
    """The `co_mentions` of a summary of the week the answers were written in."""
    data = await summary_data(world, api, include="co_mentions", **{**_window(), **params})
    return _engines(data)


async def test_co_mentions_count_the_answers_that_name_both(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    """The default window. ChatGPT has seven valid answers in scope (`providers` 5, `pricing` 1,
    `misc` 1: the refusal, the superseded and the not current answers, the branded prompt and the
    archived one are not) and only the first of `providers` names both brands. Gemini answered
    once, naming both."""
    data = await summary_data(seeded, api, include="co_mentions")

    pair = _ordered(seeded.own, seeded.rival)
    assert [entry["engine_code"] for entry in data["co_mentions"]] == data["engine_codes"]
    engines = _engines(data)
    assert set(engines) == {CHATGPT, GEMINI}
    assert engines[CHATGPT]["answers"] == 7
    assert _pairs(engines[CHATGPT]) == [(pair, 1)]
    assert engines[GEMINI]["answers"] == 1
    assert _pairs(engines[GEMINI]) == [(pair, 1)]
    assert set(engines[CHATGPT]["pairs"][0]) == {"a", "b", "answers"}


async def test_answers_is_every_valid_answer_in_scope_not_only_naming_ones(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Three valid answers: both brands, the own brand alone, nobody. `answers` is the three."""
    world = await _project(resources, migrated, ["a", "b", "c"])
    both = (world.own, world.rival)
    await _write_named(
        migrated,
        world,
        [
            Named("a", _at(), both),
            Named("b", _at(1), (world.own,)),
            Named("c", _at(2)),
        ],
    )

    engines = await _co_mentions(world, api)

    assert list(engines) == [CHATGPT]
    assert engines[CHATGPT]["answers"] == 3
    assert _pairs(engines[CHATGPT]) == [(_ordered(*both), 1)]


async def test_a_pair_is_counted_once_per_answer_however_often_it_is_named(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The answer names each brand seven times, and an older derivation of it is kept beside the
    current one with the same mentions: the pair is in one answer, so it counts once."""
    world = await _project(resources, migrated, ["a"])
    await _write_named(migrated, world, [Named("a", _at(), (world.own, world.rival))])
    await execute(
        migrated,
        "UPDATE ai.entity_mentions SET mention_count = 7 WHERE project_id = $1",
        world.project.id,
    )
    derivation = await fetchrow(
        migrated,
        "INSERT INTO ai.derivations (workspace_id, project_id, extractor_version, "
        "entity_config_version, recommendation_version, sentiment_version) "
        "VALUES ($1, $2, 2, 1, 1, 1) RETURNING id",
        world.workspace.id,
        world.project.id,
    )
    await execute(
        migrated,
        "INSERT INTO ai.observation_facts (observation_id, observed_at, derivation_id, "
        "workspace_id, project_id, observed_date, engine_code, observation_class, prompt_id, "
        "prompt_version_id, replicate_index, is_valid, own_mentioned, own_domain_cited, "
        "own_citation_count, total_citation_count, tracked_entities_mentioned, "
        "competitor_mentions, had_structured_list, is_current) "
        "SELECT observation_id, observed_at, $2, workspace_id, project_id, observed_date, "
        "engine_code, observation_class, prompt_id, prompt_version_id, replicate_index, "
        "is_valid, own_mentioned, own_domain_cited, own_citation_count, total_citation_count, "
        "tracked_entities_mentioned, competitor_mentions, had_structured_list, false "
        "FROM ai.observation_facts WHERE project_id = $1 AND derivation_id <> $2",
        world.project.id,
        derivation["id"],
    )
    await execute(
        migrated,
        "INSERT INTO ai.entity_mentions (observation_id, observed_at, entity_id, derivation_id, "
        "workspace_id, project_id, engine_code, role, mention_count, first_char_offset, "
        "mention_order, prominence, match_method, mention_status, confidence, evidence_spans, "
        "is_current) SELECT observation_id, observed_at, entity_id, $2, workspace_id, "
        "project_id, engine_code, role, mention_count, first_char_offset, mention_order, "
        "prominence, match_method, mention_status, confidence, evidence_spans, false "
        "FROM ai.entity_mentions WHERE project_id = $1 AND derivation_id <> $2",
        world.project.id,
        derivation["id"],
    )

    engines = await _co_mentions(world, api)

    assert engines[CHATGPT]["answers"] == 1
    assert _pairs(engines[CHATGPT]) == [(_ordered(world.own, world.rival), 1)]


async def test_a_superseded_or_not_current_answer_is_not_a_co_mention(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Three prompts, one answer each, all naming both brands: the answer of `b` is superseded
    and the facts of `c` are no longer current, so only `a` counts, in `answers` and in the
    pair."""
    world = await _project(resources, migrated, ["a", "b", "c"])
    both = (world.own, world.rival)
    await _write_named(
        migrated,
        world,
        [Named("a", _at(), both), Named("b", _at(1), both), Named("c", _at(2), both)],
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

    engines = await _co_mentions(world, api)

    assert engines[CHATGPT]["answers"] == 1
    assert _pairs(engines[CHATGPT]) == [(_ordered(*both), 1)]


async def test_an_invalid_answer_is_not_a_co_mention(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """A refusal that names both brands has mention rows with an order, and is no valid answer:
    it is in neither `answers` nor a pair."""
    world = await _project(resources, migrated, ["a"])
    both = (world.own, world.rival)
    await _write_named(
        migrated,
        world,
        [Named("a", _at(), both), Named("a", _at(1), both, valid=False)],
    )

    engines = await _co_mentions(world, api)

    assert engines[CHATGPT]["answers"] == 1
    assert _pairs(engines[CHATGPT]) == [(_ordered(*both), 1)]


async def test_a_mention_without_an_order_makes_no_pair(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """An uncertain mention of the rival is stored without an order, outside the share of voice
    set: the answer is valid and counted, and it names the own brand alone."""
    world = await _project(resources, migrated, ["a"])
    await _write_named(
        migrated,
        world,
        [Named("a", _at(), (world.own,), unordered=(world.rival,))],
    )

    engines = await _co_mentions(world, api)

    assert engines[CHATGPT]["answers"] == 1
    assert engines[CHATGPT]["pairs"] == []


async def test_a_mention_that_is_not_current_makes_no_pair(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    world = await _project(resources, migrated, ["a"])
    await _write_named(migrated, world, [Named("a", _at(), (world.own, world.rival))])
    await execute(
        migrated,
        "UPDATE ai.entity_mentions SET is_current = false WHERE project_id = $1 AND entity_id = $2",
        world.project.id,
        world.rival,
    )

    engines = await _co_mentions(world, api)

    assert engines[CHATGPT]["answers"] == 1
    assert engines[CHATGPT]["pairs"] == []


async def test_no_self_pairs_and_no_reversed_pairs(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Two entities in one answer are one pair, the lower id first: never the pair the other way
    round, never an entity with itself."""
    world = await _project(resources, migrated, ["a"])
    await _write_named(migrated, world, [Named("a", _at(), (world.own, world.rival))])

    engines = await _co_mentions(world, api)

    [(pair, answers)] = _pairs(engines[CHATGPT])
    assert (pair, answers) == (_ordered(world.own, world.rival), 1)
    assert pair[0] < pair[1]


async def test_a_pair_is_ordered_by_id_not_by_role(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Ids are issued in time order, so a competitor added now has a higher id than the own
    brand; one with the lowest id there is stands for an older entity. In the pairs the own
    brand is the second entity of the first and the first of the second."""
    world = await _project(resources, migrated, ["a"])
    above = await _entity(migrated, world.project, "Later", "later.example", "competitor")
    below = uuid.UUID(int=1)
    await execute(
        migrated,
        "INSERT INTO core.entities (id, workspace_id, entity_type, canonical_name) "
        "VALUES ($1, $2, 'brand', 'Earlier')",
        below,
        world.workspace.id,
    )
    await execute(
        migrated,
        "INSERT INTO core.project_entities (project_id, entity_id, workspace_id, role) "
        "VALUES ($1, $2, $3, 'competitor')",
        world.project.id,
        below,
        world.workspace.id,
    )
    assert below < world.own < above
    await _write_named(migrated, world, [Named("a", _at(), (world.own, below, above))])

    engines = await _co_mentions(world, api)

    pairs = dict(_pairs(engines[CHATGPT]))
    assert (below, world.own) in pairs
    assert (world.own, above) in pairs
    assert all(a < b for a, b in pairs)


async def test_three_entities_make_three_pairs(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    world = await _project(resources, migrated, ["a"])
    third = await _entity(migrated, world.project, "Third", "third.example", "competitor")
    named = (world.own, world.rival, third)
    await _write_named(migrated, world, [Named("a", _at(), named)])

    engines = await _co_mentions(world, api)

    assert engines[CHATGPT]["answers"] == 1
    assert {pair for pair, _ in _pairs(engines[CHATGPT])} == {
        _ordered(x, y) for x, y in combinations(named, 2)
    }
    assert [answers for _, answers in _pairs(engines[CHATGPT])] == [1, 1, 1]


async def test_pairs_are_sorted_by_answers_then_ids(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The first answer names the three, the second the own brand and the rival: that pair is in
    two answers, the other two in one, and those two come in the order of their ids."""
    world = await _project(resources, migrated, ["a", "b"])
    third = await _entity(migrated, world.project, "Third", "third.example", "competitor")
    await _write_named(
        migrated,
        world,
        [
            Named("a", _at(), (world.own, world.rival, third)),
            Named("b", _at(1), (world.own, world.rival)),
        ],
    )

    engines = await _co_mentions(world, api)

    pairs = _pairs(engines[CHATGPT])
    assert pairs[0] == (_ordered(world.own, world.rival), 2)
    assert [answers for _, answers in pairs] == [2, 1, 1]
    assert [pair for pair, _ in pairs[1:]] == sorted(
        [_ordered(world.own, third), _ordered(world.rival, third)]
    )


async def test_co_mentions_exclude_branded_prompts_by_default(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """A branded prompt's answer names both brands: it is counted, in `answers` and in the pair,
    only with `include_branded`, and it is the only one with `branded_only`."""
    world = await _project(resources, migrated, ["a"])
    branded = await add_prompt(migrated, world.project, "Is Eventus Security good?", branded=True)
    both = (world.own, world.rival)
    await _write_named(
        migrated,
        replace(world, prompts={**world.prompts, "brand": branded}),
        [Named("a", _at(), both), Named("brand", _at(1), both)],
    )
    pair = _ordered(*both)

    default = await _co_mentions(world, api)
    included = await _co_mentions(world, api, include_branded="true")
    only = await _co_mentions(world, api, branded_only="true")

    assert (default[CHATGPT]["answers"], _pairs(default[CHATGPT])) == (1, [(pair, 1)])
    assert (included[CHATGPT]["answers"], _pairs(included[CHATGPT])) == (2, [(pair, 2)])
    assert (only[CHATGPT]["answers"], _pairs(only[CHATGPT])) == (1, [(pair, 1)])


async def test_co_mentions_follow_the_term_subtree_country_and_engine_filter(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Security holds SOC. Prompt `a` is in SOC, `b` in Security itself and `c` in no topic; `b`
    is a prompt of India. Each answers on ChatGPT naming both brands, and `a` answers on Gemini
    too. Whatever the filter, the counts are those of the prompts it leaves."""
    world = await new_world(resources, migrated)
    world = replace(world, prompts=await new_prompts(migrated, world, ["a", "b", "c"]))
    vocabulary = await fetchrow(
        migrated,
        "INSERT INTO core.taxonomy_vocabularies (workspace_id, project_id, kind, name) "
        "VALUES ($1, $2, 'topic', 'Tree') RETURNING id",
        world.workspace.id,
        world.project.id,
    )
    security = await _term(migrated, world, vocabulary["id"], "Security")
    soc = await _term(migrated, world, vocabulary["id"], "SOC", (security, "security"))
    await assign_topic(migrated, world, "a", soc)
    await assign_topic(migrated, world, "b", security)
    await execute(
        migrated, "UPDATE ai.prompts SET country_iso = 'IN' WHERE id = $1", world.prompts["b"].id
    )
    both = (world.own, world.rival)
    await _write_named(
        migrated,
        world,
        [
            Named("a", _at(), both),
            Named("b", _at(1), both),
            Named("c", _at(2), both),
            Named("a", _at(3), both, engine=GEMINI),
        ],
    )
    pair = _ordered(*both)

    async def counts(**params: Any) -> dict[str, tuple[int, list[tuple[Pair, int]]]]:
        engines = await _co_mentions(world, api, **params)
        return {code: (entry["answers"], _pairs(entry)) for code, entry in engines.items()}

    assert await counts() == {CHATGPT: (3, [(pair, 3)]), GEMINI: (1, [(pair, 1)])}
    # Under Security: itself and SOC below it, so `a` and `b`; under SOC: `a` alone.
    assert await counts(**{"filter[term]": str(security)}) == {
        CHATGPT: (2, [(pair, 2)]),
        GEMINI: (1, [(pair, 1)]),
    }
    assert await counts(**{"filter[term]": str(soc)}) == {
        CHATGPT: (1, [(pair, 1)]),
        GEMINI: (1, [(pair, 1)]),
    }
    # The market of `b`: Gemini has no answer of it, so it is not an engine of this summary.
    assert await counts(**{"filter[country_iso]": "IN"}) == {CHATGPT: (1, [(pair, 1)])}
    assert await counts(**{"filter[engine_code_in]": GEMINI}) == {GEMINI: (1, [(pair, 1)])}
    assert await counts(**{"filter[engine_code_in]": CHATGPT}) == {CHATGPT: (3, [(pair, 3)])}


async def test_pairs_stop_at_twenty_entities(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The own brand, the rival and nineteen more competitors: 21 tracked, and one answer names
    them all. The set is the first twenty, the own brand first (as the entity cells' set): 190
    pairs, none with the entity that is cut off."""
    world = await _project(resources, migrated, ["a"])
    extra = [
        await _entity(
            migrated, world.project, f"Rival {n:02d}", f"rival{n:02d}.example", "competitor"
        )
        for n in range(1, 20)
    ]
    await _write_named(migrated, world, [Named("a", _at(), (world.own, world.rival, *extra))])

    data = await summary_data(world, api, include="co_mentions,entities", **_window())

    assert len(data["entities"]) == 21
    kept = [world.own, world.rival, *extra[:18]]
    [entry] = data["co_mentions"]
    assert entry["answers"] == 1
    assert len(entry["pairs"]) == 190
    assert {pair for pair, _ in _pairs(entry)} == {_ordered(x, y) for x, y in combinations(kept, 2)}
    assert {answers for _, answers in _pairs(entry)} == {1}
    # The entity cells are the same twenty.
    cells = data["prompts"][0]["engines"][0]["entities"]
    assert [uuid.UUID(c["entity_id"]) for c in cells] == kept


async def test_co_mentions_are_absent_unless_asked(api: httpx.AsyncClient, seeded: Summary) -> None:
    for include in (None, "series", "entities", "total", "series,entities,total"):
        params = {} if include is None else {"include": include}
        data = await summary_data(seeded, api, **params)
        assert "co_mentions" not in data

    asked = await summary_data(seeded, api, include="co_mentions")
    assert asked["co_mentions"]


async def test_rows_does_not_change_the_co_mentions(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    every = await summary_data(seeded, api, include="co_mentions")

    for rows in ("topics", "none"):
        data = await summary_data(seeded, api, include="co_mentions", rows=rows)
        assert data["co_mentions"] == every["co_mentions"]
    with_total = await summary_data(
        seeded, api, include="co_mentions,total,series,entities", rows="none"
    )
    assert with_total["co_mentions"] == every["co_mentions"]
    assert (with_total["prompts"], with_total["topics"]) == ([], [])


async def test_no_answers_gives_an_entry_per_engine_with_no_pairs(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    world = await _project(resources, migrated, ["a"])

    data = await summary_data(world, api, include="co_mentions", **_window())

    assert data["engine_codes"] == [CHATGPT]
    assert data["co_mentions"] == [{"engine_code": CHATGPT, "answers": 0, "pairs": []}]


async def test_another_projects_pairs_are_not_counted(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    """A second project of the workspace tracks the same two brands, and a second workspace has
    its own: each answers naming both, in the same week, and none of it is in the first
    project's counts."""
    world = await _project(resources, migrated, ["a"])
    both = (world.own, world.rival)
    await _write_named(migrated, world, [Named("a", _at(), both)])
    before = await _co_mentions(world, api)

    other = Project(world.workspace.id, await make_project(migrated, world.workspace.id))
    for entity, role in ((world.own, "own"), (world.rival, "competitor")):
        await execute(
            migrated,
            "INSERT INTO core.project_entities (project_id, entity_id, workspace_id, role, "
            "is_primary) VALUES ($1, $2, $3, $4, $5)",
            other.id,
            entity,
            other.workspace_id,
            role,
            role == "own",
        )
    await enable_engine(migrated, other, CHATGPT)
    stranger = replace(world, project=other)
    stranger = replace(stranger, prompts=await new_prompts(migrated, stranger, ["x", "y"]))
    await _write_named(migrated, stranger, [Named("x", _at(), both), Named("y", _at(1), both)])
    elsewhere = await _project(resources, migrated, ["a"])
    await _write_named(migrated, elsewhere, [Named("a", _at(), (elsewhere.own, elsewhere.rival))])

    after = await _co_mentions(world, api)

    assert after == before
    assert before[CHATGPT]["answers"] == 1
    # The second project does count its own answers.
    own = await _co_mentions(stranger, api)
    assert (own[CHATGPT]["answers"], _pairs(own[CHATGPT])) == (2, [(_ordered(*both), 2)])


async def test_a_foreign_or_deleted_project_is_not_found_with_co_mentions(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    seeded: Summary,
) -> None:
    outsider_workspace = await make_workspace(migrated)
    outsider = await member(resources, migrated, outsider_workspace, "owner")
    foreign = replace(
        seeded,
        workspace=outsider_workspace,
        owner=outsider,
        project=Project(outsider_workspace.id, seeded.project.id),
    )

    assert problem(await get_summary(foreign, api, include="co_mentions")) == (404, "not_found")

    await execute(
        migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", seeded.project.id
    )
    assert problem(await get_summary(seeded, api, include="co_mentions")) == (404, "not_found")


async def _twenty_entities(migrated: PostgresServer, world: Summary) -> list[uuid.UUID]:
    """Nineteen competitors for the full project (150 prompts, three engines, 3,600 answers,
    which tracks the own brand alone): twenty tracked entities, the most the summary gives cells
    or pairs for."""
    extra = [
        await _entity(
            migrated, world.project, f"Rival {n:02d}", f"rival{n:02d}.example", "competitor"
        )
        for n in range(1, 20)
    ]
    return [world.own, *extra]


async def _name_all(
    migrated: PostgresServer, world: Summary, entities: Sequence[uuid.UUID]
) -> None:
    """Every entity of `entities` named, in that order, in every answer of the project. The rows
    are bulk loaded, so the tables are analyzed after, as autovacuum does a partition that has
    filled: without statistics the planner reads the tables as one row each and nests the joins
    (a minute for the 684,000 pairs of the full project, 0.2 s with them)."""
    await execute(
        migrated,
        "INSERT INTO ai.entity_mentions (observation_id, observed_at, entity_id, derivation_id, "
        "workspace_id, project_id, engine_code, role, mention_count, first_char_offset, "
        "mention_order, prominence, match_method, confidence, evidence_spans) "
        "SELECT f.observation_id, f.observed_at, e.id, f.derivation_id, f.workspace_id, "
        "f.project_id, f.engine_code, CASE WHEN e.id = $2 THEN 'own' ELSE 'competitor' END, "
        "1, 0, e.position::smallint, 1, 'alias_word', 1, ARRAY['[0,8)'::int4range] "
        "FROM ai.observation_facts f CROSS JOIN unnest($3::uuid[]) "
        "WITH ORDINALITY AS e(id, position) WHERE f.project_id = $1",
        world.project.id,
        world.own,
        list(entities),
    )
    await execute(migrated, "ANALYZE ai.entity_mentions, ai.observation_facts, ai.observations")


async def test_co_mentions_is_one_statement_more_than_plain(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """One self join over the mentions, whatever the number of prompts, engines, entities or
    pairs. With a single tracked entity no pair is possible and nothing is read. A first read
    warms the session cache so each counted read starts alike."""
    world = await full_project(resources, migrated)
    await get_summary(world, api)

    async def counted(**params: Any) -> int:
        with statements(resources) as seen:
            response = await get_summary(world, api, **params)
        assert response.status_code == 200, response.text
        return len(seen)

    plain = await counted()
    # Only the own brand is tracked yet.
    assert await counted(include="co_mentions") - plain == 0

    await _name_all(migrated, world, await _twenty_entities(migrated, world))
    await get_summary(world, api)
    assert await counted() == plain
    assert await counted(include="co_mentions") - plain == 1
    assert await counted(include="co_mentions", rows="none") - plain == 1 - 2
    assert await counted(include="co_mentions,total", rows="topics") - plain == 1
    # Beside the other blocks it is still one statement, none of theirs is shared with it.
    both = await counted(include="series,entities", compare="previous_period")
    assert (
        await counted(include="series,entities,co_mentions", compare="previous_period") - both == 1
    )


async def test_a_full_project_with_twenty_entities_is_bounded(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """3,600 answers, each naming twenty entities: 190 pairs per engine, each in every answer of
    the engine (1,200). The response and its time are those of the worst case."""
    world = await full_project(resources, migrated)
    entities = await _twenty_entities(migrated, world)
    await _name_all(migrated, world, entities)
    await get_summary(world, api)

    response = await get_summary(world, api, include="co_mentions")

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert [entry["engine_code"] for entry in data["co_mentions"]] == data["engine_codes"]
    expected = {_ordered(x, y) for x, y in combinations(entities, 2)}
    assert len(expected) == 190
    for entry in data["co_mentions"]:
        assert entry["answers"] == 1200
        assert {pair for pair, _ in _pairs(entry)} == expected
        assert {answers for _, answers in _pairs(entry)} == {1200}
    assert len(data["co_mentions"]) == 3


async def test_the_include_parser_accepts_co_mentions_beside_the_other_values(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    response = await get_summary(seeded, api, include="co_mentions,series,entities,total")
    assert response.status_code == 200, response.text
    assert response.json()["data"]["co_mentions"]
    assert (await get_summary(seeded, api, include="co_mentions,co_mentions")).status_code == 200
    assert problem(await get_summary(seeded, api, include="co_mentions,bogus")) == (
        422,
        "validation_failed",
    )


@pytest.mark.parametrize("include", ["co_mentions", "total,co_mentions", "series,co_mentions"])
async def test_the_summary_without_prompts_has_empty_co_mentions(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, include: str
) -> None:
    """A project with no prompt: no engine has an answer, so the entry of each enabled engine
    says 0 answers and no pairs."""
    world = await new_world(resources, migrated)

    data = await summary_data(world, api, include=include)

    assert data["co_mentions"] == [{"engine_code": CHATGPT, "answers": 0, "pairs": []}]
