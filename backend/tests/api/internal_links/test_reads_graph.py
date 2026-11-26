"""The Link map's graph read (plan 10)."""

from __future__ import annotations

import uuid
from typing import Any

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import execute, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import read_site
from tests.api.internal_links.support_changes import two_crawls
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer


async def _graph(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, **query: object
) -> tuple[dict[str, Any], dict[str, int], list[uuid.UUID]]:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    _, ids, tiers = await read_site(migrated, workspace, project)
    response = await api.get(
        project_url(workspace, project, "internal-links", "graph"),
        params={key: str(value).lower() for key, value in query.items()},
        headers=viewer.headers,
    )
    assert response.status_code == 200, response.text
    data: dict[str, Any] = response.json()["data"]
    return data, ids, tiers


async def test_the_graph_has_the_live_pages_and_the_editorial_links_with_redirects_folded(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    data, ids, tiers = await _graph(api, resources, migrated)
    path_of = {str(url_id): path for path, url_id in ids.items()}

    assert {path_of[node["url_id"]] for node in data["nodes"]} == {
        "/",
        "/pricing",
        "/blog",
        "/blog/a",
        "/blog/b",
    }
    assert {(path_of[edge["source"]], path_of[edge["target"]]) for edge in data["edges"]} == {
        ("/blog", "/blog/a"),
        ("/blog", "/blog/b"),
        ("/blog/a", "/pricing"),
        ("/pricing", "/blog/a"),
        ("/blog/b", "/pricing"),
    }
    assert data["pages_total"] == 5
    assert data["truncated"] is False
    assert data["include_auto"] is False
    by_path = {path_of[node["url_id"]]: node for node in data["nodes"]}
    assert (by_path["/pricing"]["links_in"], by_path["/pricing"]["links_out"]) == (2, 1)
    assert (by_path["/"]["links_in"], by_path["/"]["links_out"]) == (0, 0)
    assert by_path["/pricing"]["tier_id"] == str(tiers[0])
    assert by_path["/blog/a"]["tier_id"] == str(tiers[2])
    assert by_path["/blog"]["tier_id"] is None
    # Two navigation links from one page: nowhere near half of five pages
    assert all(node["sitewide_from"] == 0 for node in data["nodes"])
    # Every url id is a string, as on the other reads
    assert all(isinstance(node["url_id"], str) for node in data["nodes"])


async def test_auto_generated_links_are_edges_only_when_asked(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    data, ids, _ = await _graph(api, resources, migrated, include_auto=True)
    path_of = {str(url_id): path for path, url_id in ids.items()}

    edges = {(path_of[edge["source"]], path_of[edge["target"]]) for edge in data["edges"]}
    assert ("/blog/a", "/blog/b") in edges
    assert ("/blog/b", "/blog/a") in edges
    assert data["include_auto"] is True


async def test_max_pages_outside_100_to_5000_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await read_site(migrated, workspace, project)

    for value in ("99", "5001"):
        response = await api.get(
            project_url(workspace, project, "internal-links", "graph"),
            params={"max_pages": value},
            headers=viewer.headers,
        )
        assert response.status_code == 422


async def test_a_project_without_a_crawl_answers_no_crawl(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)

    response = await api.get(
        project_url(workspace, project, "internal-links", "graph"), headers=viewer.headers
    )

    assert problem(response) == (404, "no_crawl")


async def test_the_links_of_a_dropped_crawl_are_gone(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    older, _, _, _ = await two_crawls(migrated, workspace, project)
    await execute(migrated, "SELECT seo.drop_crawl_links_partition($1)", older)
    await execute(
        migrated, "UPDATE seo.crawl_runs SET links_dropped_at = now() WHERE id = $1", older
    )

    response = await api.get(
        project_url(workspace, project, "internal-links", "graph"),
        params={"run": str(older)},
        headers=viewer.headers,
    )

    assert problem(response) == (410, "links_dropped")
