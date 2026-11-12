"""New sources (plan D2 Task 3; docs/16 C5): with `compare=previous_period` each domain and
page row says how often it was cited in as many days just before the window, 0 when it was not,
and the answer states that window and its answers."""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.ai.sources_support import (
    FULL_SUPERSEDED,
    GUIDE,
    OWN,
    WIKI,
    Cite,
    World,
    answer,
    full_project,
    make_world,
    statements,
)
from tests.api.entities.support import problem
from tests.collectors.ai_support import OWN_HOST, add_prompt
from tests.conftest import PostgresServer


def _day(days: int) -> str:
    return (datetime.now(UTC).date() - timedelta(days=days)).isoformat()


def _window() -> dict[str, str]:
    """The last 5 days: 4 days ago to today. The window before is 9 to 5 days ago."""
    return {"from": _day(4), "to": _day(0)}


@pytest.fixture
async def world(resources: Resources, migrated: PostgresServer) -> World:
    """One prompt. In the window: the own page and the guide (1 day ago), the own page (2). In
    the window before: the own page (6), the own page and wiki (7)."""
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    own = world.own_cite()
    await answer(migrated, world, prompt, days_ago=1, cites=[own, Cite(GUIDE)])
    await answer(migrated, world, prompt, days_ago=2, cites=[own])
    await answer(migrated, world, prompt, days_ago=6, cites=[own])
    await answer(migrated, world, prompt, days_ago=7, cites=[own, Cite(WIKI)])
    return world


async def _get(world: World, api: httpx.AsyncClient, path: str, **params: Any) -> httpx.Response:
    return await api.get(
        world.url("ai", "sources", path),
        params={**_window(), **params},
        headers=world.owner.headers,
    )


async def test_each_domain_says_how_often_it_was_cited_in_the_window_before(
    api: httpx.AsyncClient, world: World
) -> None:
    response = await _get(world, api, "domains", compare="previous_period")

    assert response.status_code == 200, response.text
    rows = {row["registrable_domain"]: row for row in response.json()["data"]}
    # Wiki was cited only before: it is not a row of this window.
    assert set(rows) == {OWN_HOST, "example.org"}
    assert rows[OWN_HOST]["citation_units"] == 2
    assert rows[OWN_HOST]["previous"] == {"citation_units": 2, "observations": 2}
    assert rows["example.org"]["previous"] == {"citation_units": 0, "observations": 0}
    meta = response.json()["meta"]
    assert meta["compare_window"]["from"] == _day(9)
    assert meta["compare_window"]["to"] == _day(5)
    assert meta["previous_answers"] == 2


async def test_each_page_says_it_too(api: httpx.AsyncClient, world: World) -> None:
    response = await _get(world, api, "pages", compare="previous_period")

    rows = {row["url"]: row["previous"] for row in response.json()["data"]}
    assert rows == {
        OWN: {"citation_units": 2, "observations": 2},
        GUIDE: {"citation_units": 0, "observations": 0},
    }


async def test_without_compare_nothing_of_it_is_in_the_answer(
    api: httpx.AsyncClient, world: World
) -> None:
    for path in ("domains", "pages"):
        response = await _get(world, api, path)
        body = response.json()
        assert all("previous" not in row for row in body["data"])
        assert "compare_window" not in body["meta"]
        assert "previous_answers" not in body["meta"]


async def test_only_the_period_before_is_built(api: httpx.AsyncClient, world: World) -> None:
    response = await _get(world, api, "domains", compare="previous_year")

    assert problem(response) == (422, "validation_failed")


async def test_a_full_project_compares_fast_without_statistics(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """3,600 answers 3 days apart, 300 of them replaced by a newer one. The last 11 days hold
    the answers 0 to 9 days old (4 a pair), the 11 days before them those 12 to 21 days old. The
    first read of the freshly loaded project (no ANALYZE) must not nest its loops: 15 s is the
    hard limit."""
    full = await full_project(resources, migrated)
    params: dict[str, str | int] = {
        "from": _day(10),
        "to": _day(0),
        "compare": "previous_period",
        "limit": 200,
    }
    for path, rows in (("domains", 20), ("pages", 50)):
        started = time.perf_counter()
        response = await api.get(
            full.url("ai", "sources", path), params=params, headers=full.owner.headers
        )
        assert time.perf_counter() - started < 15

        assert response.status_code == 200, response.text
        body = response.json()
        assert len(body["data"]) == rows
        assert body["meta"]["answers"] == 4 * 450
        assert body["meta"]["previous_answers"] == 4 * 450 - FULL_SUPERSEDED
        assert sum(row["previous"]["citation_units"] for row in body["data"]) == (
            (4 * 450 - FULL_SUPERSEDED) * 10
        )


async def test_compare_adds_two_statements(
    api: httpx.AsyncClient, resources: Resources, world: World
) -> None:
    await _get(world, api, "domains")
    with statements(resources) as plain:
        await _get(world, api, "domains")
    with statements(resources) as compared:
        await _get(world, api, "domains", compare="previous_period")

    assert len(compared) - len(plain) == 2, compared
