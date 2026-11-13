"""Statement counts of the competitors reads (contract C5, change C-7): `ai/competitors` costs the
statements of the summary request it makes plus a fixed number of reads of its own, one more for
each `include` block, and `overview/competitors` the statements of its own summary request plus
three: whatever the number of prompts, answers, engines or entities. Asserted as differences, never
as absolute figures, after one warm read so each counted read starts alike."""

from __future__ import annotations

import uuid
from typing import Any

import httpx

from idraft.api.resources import Resources
from tests.api.ai import summary_support
from tests.api.ai.competitors_support import get_competitors
from tests.api.ai.metrics_support import COMPETITORS, OVERVIEW_COMPETITORS, Route, get_overview
from tests.api.ai.summary_support import Summary, full_project, get_summary, statements
from tests.collectors.rank_support import _entity
from tests.conftest import PostgresServer

seeded = summary_support.seeded

# The reads after the summary request, in a second transaction: the scope of the transaction, the
# planner setting that keeps the citation joins from nesting loops (`SET LOCAL enable_nestloop`,
# as the sources service does), the entity references of the rows, the citation units by entity and
# the day each entity configuration took effect.
COMPETITORS_EXTRA = 5
# With no prompt in scope no citation is read, so the planner setting is not issued either: the
# scope of the transaction, the entity references and the day each configuration took effect.
NO_PROMPT_EXTRA = COMPETITORS_EXTRA - 2
# `include=lost_prompts` adds the one grouped read of the lost answers of every competitor and
# engine (with the prompts' importance); the valid answers and the texts are in the summary's
# prompt rows. `include=top_sources` adds the one ranked read of the domains of every entity.
LOST_EXTRA = 1
SOURCES_EXTRA = 1
# The Overview competitor table reads no citation and no prompt: the scope of the transaction, the
# entity references and the day each entity configuration took effect.
OVERVIEW_EXTRA = 3
# `compare` adds the summary's own two: the counts of the window compared with and the entity
# counts there.
COMPARE_EXTRA = 2
# What the summary request of each read asks for.
COMPETITORS_SUMMARY = {"include": "total,entities"}
OVERVIEW_SUMMARY = {"rows": "none", "include": "total,entities"}


async def _competitors(
    world: Summary, api: httpx.AsyncClient, resources: Resources, **params: Any
) -> int:
    with statements(resources) as seen:
        response = await get_competitors(world, api, **params)
    assert response.status_code == 200, response.text
    return len(seen)


async def _overview(
    world: Summary, api: httpx.AsyncClient, resources: Resources, **params: Any
) -> int:
    with statements(resources) as seen:
        response = await get_overview(world, api, OVERVIEW_COMPETITORS, **params)
    assert response.status_code == 200, response.text
    return len(seen)


async def _summary(
    world: Summary,
    api: httpx.AsyncClient,
    resources: Resources,
    asked: dict[str, str],
    **params: Any,
) -> int:
    with statements(resources) as seen:
        response = await get_summary(world, api, **asked, **params)
    assert response.status_code == 200, response.text
    return len(seen)


async def _extra(
    world: Summary, api: httpx.AsyncClient, resources: Resources, **params: Any
) -> int:
    """The statements the read adds to the summary request it makes, for the same scope (the
    summary takes none of the route's own parameters: it gives cells for the whole tracked set
    either way)."""
    await get_competitors(world, api, **params)
    own = ("entity_ids", "include", "lost_limit", "sources_limit")
    scope = {name: value for name, value in params.items() if name not in own}
    return await _competitors(world, api, resources, **params) - await _summary(
        world, api, resources, COMPETITORS_SUMMARY, **scope
    )


async def _overview_extra(
    world: Summary, api: httpx.AsyncClient, resources: Resources, **params: Any
) -> int:
    await get_overview(world, api, OVERVIEW_COMPETITORS, **params)
    return await _overview(world, api, resources, **params) - await _summary(
        world, api, resources, OVERVIEW_SUMMARY, **params
    )


async def test_the_competitors_read_adds_a_fixed_number_of_statements_to_its_summary_request(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, seeded: Summary
) -> None:
    """Over a small world (14 answers) and over the base plan (150 prompts, three engines, 3,600
    answers) the read adds the same reads; `compare` adds the summary's own reads."""
    world = await full_project(resources, migrated)

    for each in (seeded, world):
        assert await _extra(each, api, resources) == COMPETITORS_EXTRA
        plain = await _competitors(each, api, resources)
        for params in (
            {"compare": "previous_period"},
            {"compare_from": summary_support.day(40), "compare_to": summary_support.day(30)},
        ):
            # The summary's own read of the window compared with, and nothing of this read's.
            assert await _extra(each, api, resources, **params) == COMPETITORS_EXTRA, params
            compared = await _competitors(each, api, resources, **params)
            assert compared - plain == COMPARE_EXTRA, params
        for params in (
            {"include_branded": "true"},
            {"filter[engine_code_in]": "chatgpt_web"},
            {"entity_ids": f"{each.own},{uuid.uuid4()}"},
        ):
            assert await _extra(each, api, resources, **params) == COMPETITORS_EXTRA, params


async def test_each_include_block_adds_one_read_whatever_the_data(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, seeded: Summary
) -> None:
    """The lost prompts are one statement over every competitor and engine, the top sources one
    over every entity, on a small world and on the full project, and with more entities."""
    world = await full_project(resources, migrated)
    for number in range(4):
        await _entity(
            migrated, world.project, f"Extra {number}", f"extra{number}.example", "competitor"
        )

    for each in (seeded, world):
        assert await _extra(each, api, resources, include="lost_prompts") == (
            COMPETITORS_EXTRA + LOST_EXTRA
        )
        assert await _extra(each, api, resources, include="top_sources") == (
            COMPETITORS_EXTRA + SOURCES_EXTRA
        )
        both = {"include": "lost_prompts,top_sources", "lost_limit": 10, "sources_limit": 5}
        assert await _extra(each, api, resources, **both) == (
            COMPETITORS_EXTRA + LOST_EXTRA + SOURCES_EXTRA
        )
        assert await _extra(each, api, resources, compare="previous_period", **both) == (
            COMPETITORS_EXTRA + LOST_EXTRA + SOURCES_EXTRA
        )
        narrowed = {"include": "lost_prompts,top_sources", "entity_ids": str(each.rival)}
        assert await _extra(each, api, resources, **narrowed) == (
            COMPETITORS_EXTRA + LOST_EXTRA + SOURCES_EXTRA
        )


async def test_the_overview_competitors_read_adds_a_fixed_number_of_statements(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, seeded: Summary
) -> None:
    world = await full_project(resources, migrated)

    for each in (seeded, world):
        assert await _overview_extra(each, api, resources) == OVERVIEW_EXTRA
        plain = await _overview(each, api, resources)
        for params in (
            {"include_branded": "true"},
            {"filter[engine_code_in]": "chatgpt_web"},
            {"filter[country_iso]": "US"},
        ):
            assert await _overview_extra(each, api, resources, **params) == OVERVIEW_EXTRA, params
        compared = await _overview(each, api, resources, compare="previous_period")
        # The summary's own read of the window compared with (its counts and its entity counts).
        assert compared - plain == COMPARE_EXTRA


async def test_a_read_of_no_prompt_reads_no_citation_units(
    api: httpx.AsyncClient, resources: Resources, seeded: Summary
) -> None:
    """No prompt in scope: the cells are empty and there is no citation to count, no lost answer
    and no source: the scope of the transaction, the references and the day each configuration took
    effect are all that is read."""
    scope = {"filter[country_iso]": "FR"}

    assert await _extra(seeded, api, resources, **scope) == NO_PROMPT_EXTRA
    assert await _extra(seeded, api, resources, include="lost_prompts,top_sources", **scope) == (
        NO_PROMPT_EXTRA
    )


async def _log(
    world: Summary, api: httpx.AsyncClient, resources: Resources, route: Route, **params: Any
) -> list[str]:
    """The statements of one request, warm."""
    await get_overview(world, api, route, **params)
    with statements(resources) as seen:
        response = await get_overview(world, api, route, **params)
    assert response.status_code == 200, response.text
    return list(seen)


def _nestloop(log: list[str]) -> list[int]:
    return [at for at, sql in enumerate(log) if "enable_nestloop" in sql]


async def test_the_citation_reads_run_with_nested_loops_off_before_they_start(
    api: httpx.AsyncClient, resources: Resources, seeded: Summary
) -> None:
    """Without table statistics (a new month's partition, a backfill) the planner nests loops over
    the citation join and the read is 30 to 100 times slower: the setting is local to the second
    transaction and comes before its first citation read, the units, the lost answers and the top
    domains alike."""
    for params in ({}, {"include": "lost_prompts,top_sources"}, {"include": "top_sources"}):
        log = await _log(seeded, api, resources, COMPETITORS, **params)

        (at,) = _nestloop(log)
        assert log[at].strip().upper() == "SET LOCAL ENABLE_NESTLOOP = OFF", params
        reads = [
            number
            for number, sql in enumerate(log)
            if "ai.citations" in sql or "unnest(" in sql.lower() or "ai_citations" in sql
        ]
        assert reads, params
        assert at < min(reads), params
    # No prompt in scope reads no citation, and the Overview table reads none either: no setting.
    assert (
        _nestloop(await _log(seeded, api, resources, COMPETITORS, **{"filter[country_iso]": "FR"}))
        == []
    )
    assert _nestloop(await _log(seeded, api, resources, OVERVIEW_COMPETITORS)) == []
