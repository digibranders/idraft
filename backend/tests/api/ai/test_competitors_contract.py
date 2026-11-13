"""Contract C5 (docs/ai-visibility/contracts/c5-competitors.md): the parameters only the competitors
read takes. The access order, the scope and the compare parameters of both routes are in
test_metrics_contract.py. Both routes are built: the two `include` blocks are read (see
test_competitors_lost.py and test_competitors_sources.py for their numbers) and the Overview
competitor table answers 200."""

from __future__ import annotations

import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.ai.metrics_support import COMPETITORS, OVERVIEW_COMPETITORS, World
from tests.api.entities.support import problem
from tests.conftest import PostgresServer

INVALID = (422, "validation_failed")


@pytest.fixture
async def world(api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer) -> World:
    return await World(api).build(resources, migrated)


def _codes(response: httpx.Response) -> set[tuple[str, str]]:
    return {(item["path"], item["code"]) for item in response.json()["errors"]}


@pytest.mark.parametrize(
    ("include", "lost", "sources"),
    [
        ("lost_prompts", True, False),
        ("top_sources", False, True),
        ("lost_prompts,top_sources", True, True),
        ("top_sources,lost_prompts", True, True),
    ],
)
async def test_include_takes_the_two_blocks(
    world: World, include: str, lost: bool, sources: bool
) -> None:
    """Each block is there exactly when asked for, an unbuilt one never answers `501`."""
    response = await world.read(COMPETITORS, include=include)

    assert response.status_code == 200, response.text
    for row in response.json()["data"]:
        assert ("top_sources" in row) is sources
        for item in row["by_engine"]:
            assert ("lost_prompts" in item) is (lost and row["entity"]["role"] == "competitor")


@pytest.mark.parametrize("include", ["bogus", "lost_prompts,bogus", "Lost_Prompts"])
async def test_any_other_include_is_422(world: World, include: str) -> None:
    response = await world.read(COMPETITORS, include=include)

    assert problem(response) == INVALID
    assert any(path.startswith("include") for path, _ in _codes(response)), _codes(response)


@pytest.mark.parametrize(
    ("name", "good", "bad"),
    [
        ("lost_limit", ["1", "5", "10"], ["0", "11", "-1", "x"]),
        ("sources_limit", ["1", "3", "5"], ["0", "6", "x"]),
    ],
)
async def test_lost_limit_and_sources_limit_bounds(
    world: World, name: str, good: list[str], bad: list[str]
) -> None:
    for value in good:
        # Only a block asked for with `include` uses them: alone they change nothing.
        assert (await world.read(COMPETITORS, **{name: value})).status_code == 200, value
    for value in bad:
        assert problem(await world.read(COMPETITORS, **{name: value})) == INVALID, value


@pytest.mark.parametrize("name", ["include", "lost_limit", "sources_limit", "entity_ids"])
async def test_the_overview_competitors_read_takes_none_of_them(world: World, name: str) -> None:
    value = "5" if name.endswith("limit") else "lost_prompts"
    response = await world.read(OVERVIEW_COMPETITORS, **{name: value})

    assert problem(response) == INVALID
    assert (name, "extra_forbidden") in _codes(response)
