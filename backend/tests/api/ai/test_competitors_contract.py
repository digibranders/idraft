"""Contract C5 (docs/ai-visibility/contracts/c5-competitors.md): the parameters only the competitors
read takes. The access order, the scope and the compare parameters of both routes are in
test_metrics_contract.py."""

from __future__ import annotations

import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.ai.metrics_support import COMPETITORS, OVERVIEW_COMPETITORS, World
from tests.api.entities.support import problem
from tests.conftest import PostgresServer

NOT_BUILT = (501, "not_implemented")
INVALID = (422, "validation_failed")


@pytest.fixture
async def world(api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer) -> World:
    return await World(api).build(resources, migrated)


def _codes(response: httpx.Response) -> set[tuple[str, str]]:
    return {(item["path"], item["code"]) for item in response.json()["errors"]}


@pytest.mark.parametrize(
    "include",
    ["lost_prompts", "top_sources", "lost_prompts,top_sources", "top_sources,lost_prompts"],
)
async def test_include_takes_the_two_blocks(world: World, include: str) -> None:
    assert problem(await world.read(COMPETITORS, include=include)) == NOT_BUILT


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
        assert problem(await world.read(COMPETITORS, **{name: value})) == NOT_BUILT, value
    for value in bad:
        assert problem(await world.read(COMPETITORS, **{name: value})) == INVALID, value


@pytest.mark.parametrize("name", ["include", "lost_limit", "sources_limit", "entity_ids"])
async def test_the_overview_competitors_read_takes_none_of_them(world: World, name: str) -> None:
    value = "5" if name.endswith("limit") else "lost_prompts"
    response = await world.read(OVERVIEW_COMPETITORS, **{name: value})

    assert problem(response) == INVALID
    assert (name, "extra_forbidden") in _codes(response)
