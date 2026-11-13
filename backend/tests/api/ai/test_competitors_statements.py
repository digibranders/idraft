"""Statement counts of the competitors read (contract C5, change C-7): `ai/competitors` costs the
statements of the summary request it makes plus a fixed number of reads of its own, whatever the
number of prompts, answers, engines or entities. Asserted as differences, never as absolute
figures, after one warm read so each counted read starts alike."""

from __future__ import annotations

import uuid
from typing import Any

import httpx

from idraft.api.resources import Resources
from tests.api.ai import summary_support
from tests.api.ai.competitors_support import get_competitors
from tests.api.ai.summary_support import Summary, full_project, get_summary, statements
from tests.conftest import PostgresServer

seeded = summary_support.seeded

# The reads after the summary request, in a second transaction: the scope of the transaction, the
# entity references of the rows, the citation units by entity and the day each entity
# configuration took effect.
COMPETITORS_EXTRA = 4
# `compare` adds the summary's own two: the counts of the window compared with and the entity
# counts there (the Overview, which reads no entity cells, adds one).
COMPARE_EXTRA = 2
# What the summary request of the competitors read asks for.
COMPETITORS_SUMMARY = {"include": "total,entities"}


async def _competitors(
    world: Summary, api: httpx.AsyncClient, resources: Resources, **params: Any
) -> int:
    with statements(resources) as seen:
        response = await get_competitors(world, api, **params)
    assert response.status_code == 200, response.text
    return len(seen)


async def _summary(
    world: Summary, api: httpx.AsyncClient, resources: Resources, **params: Any
) -> int:
    with statements(resources) as seen:
        response = await get_summary(world, api, **COMPETITORS_SUMMARY, **params)
    assert response.status_code == 200, response.text
    return len(seen)


async def _extra(
    world: Summary, api: httpx.AsyncClient, resources: Resources, **params: Any
) -> int:
    """The statements the read adds to the summary request it makes, for the same scope (the
    summary takes no `entity_ids`: it gives cells for the whole tracked set either way)."""
    await get_competitors(world, api, **params)
    scope = {name: value for name, value in params.items() if name != "entity_ids"}
    return await _competitors(world, api, resources, **params) - await _summary(
        world, api, resources, **scope
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


async def test_a_read_of_no_prompt_reads_no_citation_units(
    api: httpx.AsyncClient, resources: Resources, seeded: Summary
) -> None:
    """No prompt in scope: the cells are empty and there is no citation to count."""
    assert await _extra(seeded, api, resources, **{"filter[country_iso]": "FR"}) == (
        COMPETITORS_EXTRA - 1
    )
