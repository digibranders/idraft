"""The scope of the additions to the prompts summary (WP-12 task 8), all options at once: each
block is absent unless asked, and every aggregate (the total, the countries, the co-mentions, the
previous window, the weekly points and entity cells, the small cells) leaves out the branded
prompts by default, stays inside the term's subtree, and counts nothing of another project or
workspace. A scope guard that fails to reach one statement shows as a response that differs from
the same request over a world without the out-of-scope prompt.

The world (all ChatGPT answers, written straight into the tables on a Wednesday; W is the week
asked for and W-1 the one before it, the previous window):
  `a` (Managed SOC):    W both brands named; W-1 the own brand
  `b` (Managed SOC):    W the own brand
  `branded` (Managed SOC, branded): W both; W-1 both
  `c` (Compliance):     W both; W-1 the rival"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, replace
from datetime import timedelta
from typing import Any

import httpx

from idraft.api.resources import Resources
from tests.api.ai.summary_support import (
    CHATGPT,
    Summary,
    assign_topic,
    get_summary,
    new_prompts,
    new_topic,
    new_world,
    summary_data,
)
from tests.api.ai.test_summary_entity_series import Named, _write_named
from tests.api.ai.test_summary_filters import OPPORTUNITY, _at, _in_the_week
from tests.api.ai.test_summary_pooling import _base_week, _project, _span
from tests.api.auth.support import execute, make_workspace
from tests.api.entities.support import member, problem
from tests.api.keywords.support import project_url
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import enable_engine
from tests.collectors.rank_support import _entity
from tests.collectors.support import Project
from tests.conftest import PostgresServer

OPTIONS = {
    "include": "series,entities,total,co_mentions,cells",
    "compare": "previous_period",
    "group_by": "country",
}


@dataclass(frozen=True)
class Scope:
    world: Summary
    soc: uuid.UUID
    compliance: uuid.UUID


def _window() -> dict[str, str]:
    week = _base_week()
    return _span(week, week + timedelta(days=6))


def _every(**more: str) -> dict[str, str]:
    """Every option of the summary over the week W."""
    return {**_window(), **OPTIONS, **more}


async def _scope(resources: Resources, migrated: PostgresServer) -> Scope:
    world = await new_world(resources, migrated)
    world = replace(world, prompts=await new_prompts(migrated, world, ["a", "b", "branded", "c"]))
    soc = await new_topic(migrated, world.project, "Managed SOC")
    compliance = await new_topic(migrated, world.project, "Compliance")
    for name, topic in (("a", soc), ("b", soc), ("branded", soc), ("c", compliance)):
        await assign_topic(migrated, world, name, topic)
    await execute(
        migrated,
        "UPDATE ai.prompts SET is_branded = true WHERE id = $1",
        world.prompts["branded"].id,
    )
    both, own, rival = (world.own, world.rival), (world.own,), (world.rival,)
    await _write_named(
        migrated,
        world,
        [
            Named("a", _at(), both),
            Named("a", _at(-168), own),
            Named("b", _at(1), own),
            Named("branded", _at(2), both),
            Named("branded", _at(-166), both),
            Named("c", _at(3), both),
            Named("c", _at(-165), rival),
        ],
    )
    return Scope(world, soc, compliance)


def _blocks(data: dict[str, Any]) -> set[str]:
    """The opt-in blocks a response carries, wherever they sit."""
    found: set[str] = {
        key
        for key in ("compare_window", "previous_answers", "total", "co_mentions", "by_country")
        if key in data
    }
    if "detail" in data["metric_context"]:
        found.add("metric_context.detail")
    rows = [*data["prompts"], *data["topics"], *data.get("by_country", [])]
    if "total" in data:
        rows.append(data["total"])
    for engine in (engine for row in rows for engine in row["engines"]):
        found.update(
            f"engine.{key}" for key in ("previous", "series", "entities", "detail") if key in engine
        )
        if any("previous" in cells for cells in engine.get("entities", [])):
            found.add("entity.previous")
        if any("entities" in point for point in engine.get("series", [])):
            found.add("week.entities")
    return found


async def test_each_block_is_absent_unless_asked(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """A default response carries none of the opt-in blocks, not even as null; each option brings
    its own block and no other. The world has answers, so an absent block is not an empty one."""
    scope = await _scope(resources, migrated)
    week = _base_week()
    before = {
        "compare_from": (week - timedelta(days=7)).isoformat(),
        "compare_to": (week - timedelta(days=1)).isoformat(),
    }
    compared = {"compare_window", "previous_answers", "engine.previous"}
    cases: list[tuple[dict[str, str], set[str]]] = [
        ({}, set()),
        ({"compare": "none"}, set()),
        ({"compare": "previous_period"}, compared),
        ({"compare": "previous_year"}, compared),
        (before, compared),
        ({"include": "series"}, {"engine.series"}),
        ({"include": "entities"}, {"engine.entities"}),
        ({"include": "series,entities"}, {"engine.series", "engine.entities", "week.entities"}),
        (
            {"include": "entities", "compare": "previous_period"},
            {"engine.entities", "entity.previous", *compared},
        ),
        ({"include": "total"}, {"total"}),
        ({"include": "co_mentions"}, {"co_mentions"}),
        ({"include": "cells"}, {"engine.detail", "metric_context.detail"}),
        ({"group_by": "country"}, {"by_country"}),
        ({"rows": "none"}, set()),
        ({"rows": "topics"}, set()),
        ({"filter[outcome]": "neither"}, set()),
        ({"filter[opportunity]": "nobody_named"}, set()),
    ]

    for params, expected in cases:
        data = await summary_data(scope.world, api, **_window(), **params)
        assert _blocks(data) == expected, params
    everything = await summary_data(scope.world, api, **_every())
    assert _blocks(everything) == set().union(*(blocks for _, blocks in cases))


async def test_branded_prompts_are_left_out_of_every_new_aggregate_by_default(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The branded prompt names both brands in W and W-1. With every option and no
    `include_branded`, the response is the one of a project without that prompt; with it, every
    aggregate moves."""
    scope = await _scope(resources, migrated)
    default = await summary_data(scope.world, api, **_every())
    branded = await summary_data(scope.world, api, **_every(include_branded="true"))

    assert default["total"]["prompt_count"] == 3
    assert branded["total"]["prompt_count"] == 4
    assert branded["previous_answers"] == default["previous_answers"] + 1
    for key in ("co_mentions", "by_country"):
        assert branded[key] != default[key], key
    for block in ("previous", "series", "entities", "detail"):
        assert branded["total"]["engines"][0][block] != default["total"]["engines"][0][block]

    await execute(
        migrated,
        "UPDATE ai.prompts SET deleted_at = now() WHERE id = $1",
        scope.world.prompts["branded"].id,
    )
    assert await summary_data(scope.world, api, **_every()) == default


async def test_the_term_subtree_scopes_every_new_aggregate(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Under `filter[term]` Managed SOC the prompts `a` and `b` are in scope; `c` (Compliance)
    answered in W and W-1 and is in none of the aggregates: the response is the one of a project
    without `c`. Without the filter `c` is counted everywhere."""
    scope = await _scope(resources, migrated)
    soc = {"filter[term]": str(scope.soc)}
    scoped = await summary_data(scope.world, api, **_every(), **soc)
    everything = await summary_data(scope.world, api, **_every())

    assert scoped["total"]["prompt_count"] == 2
    assert everything["total"]["prompt_count"] == 3
    assert everything["previous_answers"] == scoped["previous_answers"] + 1
    for key in ("co_mentions", "by_country"):
        assert everything[key] != scoped[key], key
    for block in ("previous", "series", "entities", "detail"):
        assert everything["total"]["engines"][0][block] != scoped["total"]["engines"][0][block]

    await execute(
        migrated,
        "UPDATE ai.prompts SET deleted_at = now() WHERE id = $1",
        scope.world.prompts["c"].id,
    )
    assert await summary_data(scope.world, api, **_every(), **soc) == scoped


async def test_another_projects_and_workspaces_answers_are_not_counted_with_every_option(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """A second project of the workspace tracks the same two brands, and a second workspace has
    its own: each answers naming both, in W and W-1, and none of it is in the first project's
    response, whatever the option. The second project does count its own answers."""
    scope = await _scope(resources, migrated)
    world = scope.world
    before = await summary_data(world, api, **_every())

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
    both = (world.own, world.rival)
    await _write_named(
        migrated,
        stranger,
        [Named("x", _at(), both), Named("y", _at(1), both), Named("x", _at(-168), both)],
    )
    elsewhere = await _project(resources, migrated, ["z"])
    await _write_named(
        migrated,
        elsewhere,
        [Named("z", _at(), (elsewhere.own, elsewhere.rival)), Named("z", _at(-168), ())],
    )

    assert await summary_data(world, api, **_every()) == before
    own = await summary_data(stranger, api, **_every())
    assert own["total"]["prompt_count"] == 2
    assert own["previous_answers"] == 1
    assert own != before


async def test_a_foreign_or_deleted_project_is_not_found_with_every_option(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Never `200` with empty data: a member of another workspace, a project of another
    workspace read through this one, an unknown project and a deleted one are all `404`."""
    scope = await _scope(resources, migrated)
    world = scope.world
    outsider = await member(resources, migrated, await make_workspace(migrated), "owner")
    elsewhere = await new_world(resources, migrated)
    url = project_url(world.workspace, world.project.id, "ai", "prompts-summary")

    foreign_member = await api.get(url, params=_every(), headers=outsider.headers)
    foreign_project = await api.get(
        project_url(world.workspace, elsewhere.project.id, "ai", "prompts-summary"),
        params=_every(),
        headers=world.owner.headers,
    )
    unknown = await api.get(
        project_url(world.workspace, uuid.uuid4(), "ai", "prompts-summary"),
        params=_every(),
        headers=world.owner.headers,
    )
    await execute(
        migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", world.project.id
    )
    deleted = await get_summary(world, api, **_every())

    for response in (foreign_member, foreign_project, unknown, deleted):
        assert problem(response) == (404, "not_found")


async def test_lost_to_a_removed_or_untracked_competitor_keeps_nothing_and_is_200(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """`b` names a competitor and `c` another, alone; `a` names the rival. While both are tracked
    each opportunity keeps its prompt. Once one is removed from the project and the other no
    longer tracked in AI answers, `lost_to` of either keeps no row and is `200`, not `404`: only
    the competitors the project tracks now are asked about (C-6), though their old answers stay."""
    world = await _project(resources, migrated, ["a", "b", "c"])
    removed = await _entity(migrated, world.project, "Removedco", "removedco.example", "competitor")
    untracked = await _entity(
        migrated, world.project, "Untrackedco", "untrackedco.example", "competitor"
    )
    await _write_named(
        migrated,
        world,
        [
            Named("a", _at(), (world.rival,)),
            Named("b", _at(1), (removed,)),
            Named("c", _at(2), (untracked,)),
        ],
    )
    assert await _in_the_week(world, api, **{OPPORTUNITY: f"lost_to:{world.rival}"}) == ["a"]
    assert await _in_the_week(world, api, **{OPPORTUNITY: f"lost_to:{removed}"}) == ["b"]
    assert await _in_the_week(world, api, **{OPPORTUNITY: f"lost_to:{untracked}"}) == ["c"]

    update = "UPDATE core.project_entities SET {} WHERE project_id = $1 AND entity_id = $2"
    await execute(migrated, update.format("removed_at = now()"), world.project.id, removed)
    await execute(migrated, update.format("track_ai = false"), world.project.id, untracked)

    for gone in (removed, untracked):
        response = await get_summary(world, api, **_window(), **{OPPORTUNITY: f"lost_to:{gone}"})
        assert response.status_code == 200, response.text
        assert response.json()["data"]["prompts"] == [], gone
    assert await _in_the_week(world, api, **{OPPORTUNITY: f"lost_to:{world.rival}"}) == ["a"]
