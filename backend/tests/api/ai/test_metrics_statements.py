"""Statement counts of the metric routes (contract C8, change C-13): a route costs the statements
of the summary request it makes plus a fixed number of reads of its own, whatever the number of
prompts, answers or engines. Asserted as differences, never as absolute figures (what the summary
reads may change, what a metric route adds may not), after one warm read so each counted read
starts alike."""

from __future__ import annotations

from typing import Any

import httpx

from idraft.api.resources import Resources
from tests.api.ai import summary_support
from tests.api.ai.metrics_support import OVERVIEW, OVERVIEW_AI, Route, get_overview
from tests.api.ai.summary_support import Summary, full_project, get_summary, statements
from tests.conftest import PostgresServer

seeded = summary_support.seeded

# The Overview reads, in a second transaction after its summary request: the scope of the
# transaction, the citation units by engine and role (citation share) and the day each entity
# configuration took effect.
OVERVIEW_EXTRA = 3
# What the summary request of the Overview asks for.
OVERVIEW_SUMMARY = {"include": "total,cells"}


async def _overview(
    world: Summary, api: httpx.AsyncClient, resources: Resources, route: Route, **params: Any
) -> int:
    with statements(resources) as seen:
        response = await get_overview(world, api, route, **params)
    assert response.status_code == 200, response.text
    return len(seen)


async def _summary(
    world: Summary, api: httpx.AsyncClient, resources: Resources, **params: Any
) -> int:
    with statements(resources) as seen:
        response = await get_summary(world, api, **OVERVIEW_SUMMARY, **params)
    assert response.status_code == 200, response.text
    return len(seen)


async def _extra(
    world: Summary, api: httpx.AsyncClient, resources: Resources, **params: Any
) -> int:
    """The statements the Overview adds to the summary request it makes, for the same scope."""
    await get_overview(world, api, **params)
    both = await _overview(world, api, resources, OVERVIEW, **params)
    assert await _overview(world, api, resources, OVERVIEW_AI, **params) == both
    return both - await _summary(world, api, resources, **params)


async def test_the_overview_adds_a_fixed_number_of_statements_to_its_summary_request(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, seeded: Summary
) -> None:
    """Over a small world (14 answers) and over the base plan (150 prompts, three engines, 3,600
    answers) the Overview adds the same reads; `compare` adds the summary's own one."""
    world = await full_project(resources, migrated)

    for each in (seeded, world):
        assert await _extra(each, api, resources) == OVERVIEW_EXTRA
        plain = await _overview(each, api, resources, OVERVIEW)
        for params in (
            {"compare": "previous_period"},
            {"compare_from": summary_support.day(40), "compare_to": summary_support.day(30)},
        ):
            # The summary's own read of the window compared with, and nothing of the Overview's.
            assert await _extra(each, api, resources, **params) == OVERVIEW_EXTRA, params
            compared = await _overview(each, api, resources, OVERVIEW, **params)
            assert compared - plain == 1, params
        for params in ({"include_branded": "true"}, {"filter[engine_code_in]": "chatgpt_web"}):
            assert await _extra(each, api, resources, **params) == OVERVIEW_EXTRA, params


async def test_an_overview_of_no_prompt_reads_nothing_of_its_own(
    api: httpx.AsyncClient, resources: Resources, seeded: Summary
) -> None:
    """No prompt in scope: the cells are empty and there is no citation to count."""
    assert await _extra(seeded, api, resources, **{"filter[country_iso]": "FR"}) == 0
