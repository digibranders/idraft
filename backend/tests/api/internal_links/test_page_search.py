"""The daily Search Console read of one page for the page drawer's Search tab (Pages spec 9.5)."""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from typing import Any

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import Workspace, execute, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import read_site, seed_crawl
from tests.api.internal_links.support_changes import gsc_property
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer


async def _site(
    pg: PostgresServer,
) -> tuple[Workspace, uuid.UUID, dict[str, int]]:
    workspace = await make_workspace(pg)
    project = await keyword_project(pg, workspace)
    _, ids, _ = await read_site(pg, workspace, project)
    return workspace, project, ids


async def _store_day(
    pg: PostgresServer,
    workspace: Workspace,
    project: uuid.UUID,
    integration: uuid.UUID,
    url: int,
    day: date,
    clicks: int,
    impressions: int,
) -> None:
    await execute(
        pg,
        "INSERT INTO fp.gsc_page_daily (integration_id, metric_date, url_id, workspace_id, "
        "project_id, clicks, impressions) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        integration,
        day,
        url,
        workspace.id,
        project,
        clicks,
        impressions,
    )


async def _read(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: uuid.UUID,
    url: object,
    headers: dict[str, str],
) -> httpx.Response:
    return await api.get(
        project_url(workspace, project, "internal-links", "pages", url, "search"), headers=headers
    )


def _nulls(data: dict[str, Any]) -> tuple[object, ...]:
    return (
        data["clicks"],
        data["impressions"],
        data["window_start"],
        data["window_end"],
        data["days"],
    )


async def test_a_project_without_a_property_is_not_connected(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, ids = await _site(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await _read(api, workspace, project, ids["/pricing"], viewer.headers)

    data = response.json()["data"]
    assert data["state"] == "not_connected"
    assert _nulls(data) == (None, None, None, None, [])


async def test_a_property_with_no_stored_page_day_is_pending(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, ids = await _site(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    await gsc_property(migrated, workspace, project)

    response = await _read(api, workspace, project, ids["/pricing"], viewer.headers)

    data = response.json()["data"]
    assert data["state"] == "pending"
    assert _nulls(data) == (None, None, None, None, [])


async def test_every_day_of_the_window_is_listed_and_a_missing_day_is_zero(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, ids = await _site(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    integration = await gsc_property(migrated, workspace, project)
    last = date.today() - timedelta(days=3)
    await _store_day(migrated, workspace, project, integration, ids["/pricing"], last, 6, 110)
    await _store_day(
        migrated, workspace, project, integration, ids["/pricing"], last - timedelta(days=1), 4, 90
    )

    response = await _read(api, workspace, project, ids["/pricing"], viewer.headers)

    data = response.json()["data"]
    start, end = date.fromisoformat(data["window_start"]), date.fromisoformat(data["window_end"])
    assert (data["state"], data["clicks"], data["impressions"]) == ("ok", 10, 200)
    assert [row["date"] for row in data["days"]] == [
        (start + timedelta(days=n)).isoformat() for n in range((end - start).days + 1)
    ]
    numbers = {row["date"]: (row["clicks"], row["impressions"]) for row in data["days"]}
    assert numbers[last.isoformat()] == (6, 110)
    assert numbers[(last - timedelta(days=1)).isoformat()] == (4, 90)
    assert sum(1 for value in numbers.values() if value == (0, 0)) == len(numbers) - 2


async def test_a_page_with_no_stored_row_is_zero_while_another_page_has_one(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, ids = await _site(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    integration = await gsc_property(migrated, workspace, project)
    await _store_day(
        migrated,
        workspace,
        project,
        integration,
        ids["/pricing"],
        date.today() - timedelta(days=3),
        7,
        70,
    )

    response = await _read(api, workspace, project, ids["/blog"], viewer.headers)

    data = response.json()["data"]
    assert (data["state"], data["clicks"], data["impressions"]) == ("ok", 0, 0)
    assert data["days"]
    assert {(row["clicks"], row["impressions"]) for row in data["days"]} == {(0, 0)}


async def test_a_page_the_crawl_in_view_does_not_hold_is_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, _ = await _site(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    # A page of the workspace that another project's crawl holds, not this one's.
    other = await keyword_project(migrated, workspace)
    _, elsewhere = await seed_crawl(migrated, workspace, other, [("/elsewhere", 200)])

    held_elsewhere = await _read(api, workspace, project, elsewhere["/elsewhere"], viewer.headers)
    unknown = await _read(api, workspace, project, 999_999_999, viewer.headers)
    not_digits = await _read(api, workspace, project, "abc", viewer.headers)

    assert problem(held_elsewhere) == (404, "not_found")
    assert problem(unknown) == (404, "not_found")
    assert not_digits.status_code == 422


async def test_another_workspace_cannot_read_the_search_days_of_a_page(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, ids = await _site(migrated)
    stranger = await member(resources, migrated, await make_workspace(migrated), "owner")

    response = await _read(api, workspace, project, ids["/pricing"], stranger.headers)

    assert response.status_code == 404


async def test_a_project_without_a_finished_crawl_has_no_search_days(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)

    response = await _read(api, workspace, project, 1, viewer.headers)

    assert problem(response) == (404, "no_crawl")
