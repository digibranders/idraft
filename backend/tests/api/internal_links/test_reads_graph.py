"""The Link map's graph read (plan 10)."""

from __future__ import annotations

import uuid
from typing import Any

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import execute, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import SeedLink, read_site, seed_crawl
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


async def _custom_graph(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    pages: list[tuple[str, int]],
    links: list[SeedLink],
    **query: object,
) -> tuple[dict[str, Any], dict[str, int], uuid.UUID]:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run, ids = await seed_crawl(migrated, workspace, project, pages, links)
    response = await api.get(
        project_url(workspace, project, "internal-links", "graph"),
        params={key: str(value).lower() for key, value in query.items()},
        headers=viewer.headers,
    )
    assert response.status_code == 200, response.text
    data: dict[str, Any] = response.json()["data"]
    return data, ids, run


async def test_a_page_in_the_menu_of_half_the_pages_is_sitewide_and_has_no_edges(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    pages = [("/", 200), ("/a", 200), ("/b", 200), ("/c", 200), ("/menu", 200)]
    links = [SeedLink(source, "/menu", "navigation") for source in ("/", "/a", "/b")]

    data, ids, _ = await _custom_graph(api, resources, migrated, pages, links)

    by_id = {node["url_id"]: node for node in data["nodes"]}
    assert by_id[str(ids["/menu"])]["sitewide_from"] == 3
    assert by_id[str(ids["/a"])]["sitewide_from"] == 0
    assert data["edges"] == []


async def test_an_ignored_link_is_not_an_edge_and_the_start_page_is_named(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run, ids = await seed_crawl(
        migrated,
        workspace,
        project,
        [("/", 200), ("/a", 200), ("/b", 200)],
        [SeedLink("/", "/a", "content"), SeedLink("/", "/b", "content")],
    )
    await execute(
        migrated,
        "UPDATE seo.crawl_links SET ignored = true WHERE run_id = $1 AND target_url_id = $2",
        run,
        ids["/b"],
    )
    await execute(
        migrated, "UPDATE seo.crawl_runs SET start_url_id = $2 WHERE id = $1", run, ids["/"]
    )

    response = await api.get(
        project_url(workspace, project, "internal-links", "graph"), headers=viewer.headers
    )

    data = response.json()["data"]
    assert [(edge["source"], edge["target"]) for edge in data["edges"]] == [
        (str(ids["/"]), str(ids["/a"]))
    ]
    assert data["home_url_id"] == str(ids["/"])
    assert data["run_id"] == str(run)


async def test_over_max_pages_the_graph_is_truncated(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    pages = [(f"/p{number}", 200) for number in range(101)]
    links = [SeedLink("/p99", "/p100", "content")]

    data, ids, _ = await _custom_graph(api, resources, migrated, pages, links, max_pages=100)

    assert data["pages_total"] == 101
    assert data["truncated"] is True
    assert len(data["nodes"]) == 100
    # The two linked pages have the most edges, so they stay though theirs are the highest ids
    assert {str(ids["/p99"]), str(ids["/p100"])} <= {node["url_id"] for node in data["nodes"]}
    assert len(data["edges"]) == 1


async def test_a_project_of_another_workspace_is_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    other = await make_workspace(migrated)
    foreign = await keyword_project(migrated, other)
    await read_site(migrated, other, foreign)

    response = await api.get(
        project_url(workspace, foreign, "internal-links", "graph"), headers=viewer.headers
    )

    assert problem(response) == (404, "not_found")
