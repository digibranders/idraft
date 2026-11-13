"""Helpers of the WP-32 contract tests (docs/ai-visibility/contracts/c8-metrics.md and
c5-competitors.md): the seven routes, each with the query it needs to be a valid request."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import httpx

from idraft.api.resources import Resources
from tests.api.ai.summary_support import Summary
from tests.api.ai.support import ai_project
from tests.api.auth.support import make_workspace
from tests.api.entities.support import member
from tests.api.keywords.support import project_url
from tests.conftest import PostgresServer

KEY = "ai.mention_rate"


@dataclass(frozen=True)
class Route:
    name: str
    tail: tuple[str, ...]
    # Takes `compare`, `compare_from` and `compare_to` (routes 1, 2, 3, 6 and 7).
    compares: bool
    # What the route needs besides the scope to be a valid request.
    needs: dict[str, str] = field(default_factory=dict)


OVERVIEW = Route("ai/metrics/overview", ("ai", "metrics", "overview"), True)
OVERVIEW_AI = Route("overview/ai", ("overview", "ai"), True)
METRIC = Route("ai/metrics/{metric}", ("ai", "metrics", KEY), True)
SERIES = Route("ai/metrics/{metric}/series", ("ai", "metrics", KEY, "series"), False)
BREAKDOWN = Route(
    "ai/metrics/{metric}/breakdown",
    ("ai", "metrics", KEY, "breakdown"),
    False,
    {"dimension": "topic"},
)
COMPETITORS = Route("ai/competitors", ("ai", "competitors"), True)
OVERVIEW_COMPETITORS = Route("overview/competitors", ("overview", "competitors"), True)

METRIC_ROUTES = [OVERVIEW, OVERVIEW_AI, METRIC, SERIES, BREAKDOWN]
COMPETITOR_ROUTES = [COMPETITORS, OVERVIEW_COMPETITORS]
ROUTES = [*METRIC_ROUTES, *COMPETITOR_ROUTES]

# The date windows of the contract: 92 days is the longest, 93 is `window_too_large`.
LONGEST = {"from": "2026-01-01", "to": "2026-04-02"}
TOO_LONG = {"from": "2026-01-01", "to": "2026-04-03"}


async def get_overview(
    world: Summary, api: httpx.AsyncClient, route: Route = OVERVIEW, /, **params: Any
) -> httpx.Response:
    """The Overview of the seeded world of the summary tests, as its owner."""
    return await api.get(
        project_url(world.workspace, world.project.id, *route.tail),
        params=params,
        headers=world.owner.headers,
    )


async def overview_data(world: Summary, api: httpx.AsyncClient, **params: Any) -> dict[str, Any]:
    """The `data` of an Overview that answered 200."""
    response = await get_overview(world, api, **params)
    assert response.status_code == 200, response.text
    data: dict[str, Any] = response.json()["data"]
    return data


def engine_tiles(data: dict[str, Any], engine: str) -> dict[str, dict[str, Any]]:
    """The tiles of one engine of an Overview by metric key."""
    found = next(entry for entry in data["engines"] if entry["engine_code"] == engine)
    tiles: dict[str, dict[str, Any]] = {tile["metric"]: tile for tile in found["tiles"]}
    return tiles


def counts(tile: dict[str, Any]) -> tuple[Any, Any, Any]:
    """(numerator, denominator, n_observations) of a tile."""
    return tile["numerator"], tile["denominator"], tile["n_observations"]


class World:
    """A workspace with a viewer, a role without `data:read`, an outsider and one project."""

    def __init__(self, api: httpx.AsyncClient) -> None:
        self.api = api

    async def build(self, resources: Resources, pg: PostgresServer) -> World:
        self.workspace = await make_workspace(pg)
        self.viewer = await member(resources, pg, self.workspace, "viewer")
        self.billing = await member(resources, pg, self.workspace, "billing")
        self.outsider = await member(resources, pg, await make_workspace(pg), "owner")
        self.project = await ai_project(pg, self.workspace)
        return self

    def url(self, route: Route) -> str:
        return project_url(self.workspace, self.project, *route.tail)

    async def read(self, route: Route, **params: str) -> httpx.Response:
        """As the viewer, with what the route needs besides the scope."""
        return await self.api.get(
            self.url(route), params={**route.needs, **params}, headers=self.viewer.headers
        )
