"""The countries a project has keywords in (docs/19 section 3.6.1)."""

from __future__ import annotations

import uuid
from typing import Any

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import Workspace, execute, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.keywords.support import (
    LOCATION,
    OTHER_LOCATION,
    keyword_project,
    project_url,
    tracked_id,
)
from tests.conftest import PostgresServer

CITY = 990011


async def _owner(resources: Resources, pg: PostgresServer) -> tuple[Workspace, uuid.UUID, Caller]:
    workspace = await make_workspace(pg)
    owner = await member(resources, pg, workspace, "owner")
    return workspace, await keyword_project(pg, workspace), owner


async def _countries(
    api: httpx.AsyncClient, workspace: Workspace, project: uuid.UUID, caller: Caller
) -> httpx.Response:
    return await api.get(
        project_url(workspace, project, "tracked-keywords", "countries"), headers=caller.headers
    )


def _summary(response: httpx.Response) -> list[tuple[int, int]]:
    assert response.status_code == 200, response.text
    return [
        (entry["location"]["location_id"], entry["keyword_count"])
        for entry in response.json()["data"]
    ]


async def _city(pg: PostgresServer) -> None:
    await execute(
        pg,
        "INSERT INTO core.locations (id, name, country_iso, location_type, parent_id) "
        "VALUES ($1, 'New York', 'US', 'City', $2) ON CONFLICT (id) DO NOTHING",
        CITY,
        LOCATION,
    )


async def test_the_countries_are_those_with_keywords_counted_by_keyword_largest_first(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    await _city(migrated)
    await tracked_id(api, workspace, project, owner, "erp", location_id=OTHER_LOCATION)
    await tracked_id(api, workspace, project, owner, "crm")
    await tracked_id(api, workspace, project, owner, "nyc crm", location_id=CITY)

    response = await _countries(api, workspace, project, owner)

    # The city counts for its country, and every entry is the country itself
    assert _summary(response) == [(LOCATION, 2), (OTHER_LOCATION, 1)]
    first: dict[str, Any] = response.json()["data"][0]
    assert first["location"] == {
        "location_id": LOCATION,
        "name": "United States",
        "country_iso": "US",
        "location_type": "Country",
    }


async def test_a_keyword_on_both_devices_counts_once(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    await tracked_id(api, workspace, project, owner, "crm", device="desktop")
    await tracked_id(api, workspace, project, owner, "crm", device="mobile")

    assert _summary(await _countries(api, workspace, project, owner)) == [(LOCATION, 1)]


async def test_archived_keywords_do_not_count_and_an_empty_project_has_none(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    empty = await _countries(api, workspace, project, owner)
    archived = await tracked_id(api, workspace, project, owner, "crm")
    await api.patch(
        project_url(workspace, project, "tracked-keywords", archived),
        json={"is_active": False},
        headers=owner.headers,
    )
    await tracked_id(api, workspace, project, owner, "erp", location_id=OTHER_LOCATION)

    assert empty.status_code == 200
    assert empty.json() == {"data": []}
    assert _summary(await _countries(api, workspace, project, owner)) == [(OTHER_LOCATION, 1)]


async def test_another_workspaces_project_is_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    other = await make_workspace(migrated)
    stranger = await member(resources, migrated, other, "viewer")
    await tracked_id(api, workspace, project, owner, "crm")

    assert problem(await _countries(api, workspace, project, stranger)) == (404, "not_found")
    assert problem(await _countries(api, other, project, stranger)) == (404, "not_found")
