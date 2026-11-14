"""Statement counts of the prompts summary (WP-12 plan section 3): every option adds a fixed number
of statements, whatever the number of prompts, engines, entities or weeks, because each block is
one grouped query or Python over counts already read. The counts are asserted as differences, on
the base plan (150 prompts, three engines, 3,600 answers), never as absolute figures: what the
plain summary reads may change, what an option adds may not."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from idraft.api.resources import Resources
from tests.api.ai.summary_support import (
    day,
    full_project,
    get_summary,
    mention_every_answer,
    statements,
    summary_data,
)
from tests.api.ai.test_summary_comentions import _name_all
from tests.api.auth.support import execute, fetchrow
from tests.collectors.rank_support import _entity
from tests.conftest import PostgresServer

Counted = Callable[..., Awaitable[int]]
# One option of each block at once; the filters narrow rows and cost nothing.
EVERY = {
    "include": "series,entities,total,co_mentions,cells",
    "compare": "previous_period",
    "group_by": "country",
    "filter[outcome]": "neither",
}
Case = tuple[str, dict[str, str], dict[str, str], int]


def _cases(term: str, rival: uuid.UUID, co_mentions: int) -> list[Case]:
    """(label, request, the request it is compared with, statements more than it). `{}` is the
    plain summary. `co_mentions` is what the pair statement adds: 1 when a pair is possible (two
    tracked entities), 0 when the own brand is alone."""
    in_term = {"filter[term]": term}
    return [
        ("compare=previous_period", {"compare": "previous_period"}, {}, 1),
        ("compare=previous_year", {"compare": "previous_year"}, {}, 1),
        (
            "compare_from and compare_to",
            {"compare_from": day(40), "compare_to": day(30)},
            {},
            1,
        ),
        ("include=series", {"include": "series"}, {}, 1),
        ("include=entities", {"include": "entities"}, {}, 1),
        # The weekly entity statement also gives the window's entity counts.
        ("include=series,entities", {"include": "series,entities"}, {}, 2),
        (
            "compare beside include=entities",
            {"compare": "previous_period", "include": "entities"},
            {"include": "entities"},
            2,
        ),
        (
            "compare beside include=series",
            {"compare": "previous_period", "include": "series"},
            {"include": "series"},
            1,
        ),
        ("include=co_mentions", {"include": "co_mentions"}, {}, co_mentions),
        ("include=total", {"include": "total"}, {}, 0),
        ("include=cells", {"include": "cells"}, {}, 0),
        ("group_by=country", {"group_by": "country"}, {}, 0),
        ("filter[outcome]", {"filter[outcome]": "neither"}, {}, 0),
        ("filter[opportunity]", {"filter[opportunity]": "named_not_cited"}, {}, 0),
        ("filter[opportunity]=lost_to", {"filter[opportunity]": f"lost_to:{rival}"}, {}, 0),
        ("rows=topics", {"rows": "topics"}, {}, 0),
        ("rows=none", {"rows": "none"}, {}, -2),
        ("rows=none with the total", {"rows": "none", "include": "total"}, {}, -2),
        ("rows=none under filter[term]", {"rows": "none", **in_term}, in_term, -3),
        # The five reads are the previous window, its entity counts, the weekly counts, the
        # weekly entity counts and the pairs.
        ("every option", EVERY, {}, 2 + 2 + co_mentions),
        ("every option with rows=none", {**EVERY, "rows": "none"}, EVERY, -2),
    ]


async def _check_table(counted: Counted, term: str, rival: uuid.UUID, co_mentions: int) -> None:
    plain = await counted()
    measured: dict[str, int] = {}
    for label, params, over, expected in _cases(term, rival, co_mentions):
        base = await counted(**over) if over else plain
        measured[label] = await counted(**params) - base
        assert measured[label] == expected, f"{label}: {measured[label]} more, not {expected}"
    # The sum rule: the options of different blocks share no statement.
    assert measured["every option"] == (
        measured["include=series,entities"]
        + measured["compare beside include=entities"]
        + measured["include=co_mentions"]
    )


async def test_every_include_combination_has_a_fixed_statement_count(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Twice over the same base plan: with the own brand alone, a pair is impossible and
    `include=co_mentions` reads nothing, so every option together adds four statements; once a
    rival is tracked and named in every answer, the pair statement is read and it adds five. The
    plan's table said five for both: it holds only with a second tracked entity. A first read
    warms the session cache so each counted read starts alike."""
    world = await full_project(resources, migrated)
    await mention_every_answer(migrated, world)
    term = await fetchrow(
        migrated,
        "SELECT id FROM core.taxonomy_terms WHERE workspace_id = $1 AND name = 'Managed SOC'",
        world.workspace.id,
    )
    await get_summary(world, api)

    async def counted(**params: Any) -> int:
        with statements(resources) as seen:
            response = await get_summary(world, api, **params)
        assert response.status_code == 200, response.text
        return len(seen)

    await _check_table(counted, str(term["id"]), world.rival, co_mentions=0)

    rival = await _entity(migrated, world.project, "Rival", "rival.example", "competitor")
    await execute(
        migrated, "DELETE FROM ai.entity_mentions WHERE project_id = $1", world.project.id
    )
    await _name_all(migrated, world, [world.own, rival])
    await get_summary(world, api)

    await _check_table(counted, str(term["id"]), rival, co_mentions=1)
    # The pair statement did run over the answers: both brands in all 1,200 of each engine.
    data = await summary_data(world, api, include="co_mentions")
    assert [pair["answers"] for entry in data["co_mentions"] for pair in entry["pairs"]] == [
        1200
    ] * len(data["engine_codes"])
