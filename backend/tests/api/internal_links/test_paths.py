"""The path finder: the shortest route from the start page over every link and over editorial
links only (plan 04 Task 14, decision D14)."""

from __future__ import annotations

from itertools import pairwise

import httpx
import pytest

from idraft.api.internal_links import route_finder
from idraft.api.resources import Resources
from idraft.crawl.paths import MAX_LEVELS
from tests.api.auth.support import execute, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import SeedLink, read_site, seed_crawl
from tests.api.internal_links.support_changes import start_at
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer


async def test_the_route_over_any_link_can_be_shorter_than_the_editorial_one(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run, ids, _ = await read_site(migrated, workspace, project)
    await start_at(migrated, run, ids["/"])

    response = await api.get(
        project_url(workspace, project, "internal-links", "paths"),
        params={"url_id": ids["/blog/b"]},
        headers=viewer.headers,
    )

    data = response.json()["data"]
    assert data["target"]["path"] == "/blog/b"
    # "/" links to /blog by the menu, and /blog links to /blog/b in its text.
    assert [step["page"]["path"] for step in data["any"]["steps"]] == ["/", "/blog", "/blog/b"]
    assert data["any"]["clicks"] == 2
    # Editorial links only: "/" has none, so the page cannot be reached that way.
    assert data["editorial"] is None


async def test_each_step_names_the_link_that_reached_it(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run, ids, _ = await read_site(migrated, workspace, project)
    await start_at(migrated, run, ids["/"])

    response = await api.get(
        project_url(workspace, project, "internal-links", "paths"),
        params={"url_id": ids["/blog/b"]},
        headers=viewer.headers,
    )

    steps = response.json()["data"]["any"]["steps"]
    assert (steps[0]["anchor"], steps[0]["placement"]) == (None, None)
    assert (steps[1]["anchor"], steps[1]["placement"], steps[1]["scope"]) == (
        "Blog",
        "navigation",
        "template",
    )
    assert (steps[2]["anchor"], steps[2]["scope"]) == ("Post B", "editorial")
    assert [step["status_code"] for step in steps] == [200, 200, 200]


async def test_a_redirect_is_one_step_to_its_target(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run, ids = await seed_crawl(
        migrated,
        workspace,
        project,
        [("/", 200), ("/old", 301), ("/new", 200)],
        [SeedLink("/", "/old", "content", "Old page")],
    )
    await start_at(migrated, run, ids["/"])
    await execute(
        migrated,
        "UPDATE seo.crawl_pages SET redirect_url_id = $2 WHERE run_id = $1 AND url_id = $3",
        run,
        ids["/new"],
        ids["/old"],
    )

    response = await api.get(
        project_url(workspace, project, "internal-links", "paths"),
        params={"url_id": ids["/new"], "run": str(run)},
        headers=viewer.headers,
    )

    steps = response.json()["data"]["editorial"]["steps"]
    assert [step["page"]["path"] for step in steps] == ["/", "/old", "/new"]
    assert [step["via_redirect"] for step in steps] == [False, False, True]
    assert steps[2]["anchor"] == "301 redirect"


async def test_nofollow_links_are_not_followed(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run, ids = await seed_crawl(
        migrated,
        workspace,
        project,
        [("/", 200), ("/a", 200)],
        [SeedLink("/", "/a", "content", "A", followed=False)],
    )
    await start_at(migrated, run, ids["/"])

    response = await api.get(
        project_url(workspace, project, "internal-links", "paths"),
        params={"url_id": ids["/a"], "run": str(run)},
        headers=viewer.headers,
    )

    data = response.json()["data"]
    assert (data["any"], data["editorial"]) == (None, None)


async def test_among_links_between_two_pages_the_editorial_one_is_the_step(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run, ids = await seed_crawl(
        migrated,
        workspace,
        project,
        [("/", 200), ("/a", 200)],
        [
            SeedLink("/", "/a", "navigation", "Menu A"),
            SeedLink("/", "/a", "auto_generated", "Related"),
            SeedLink("/", "/a", "content", "Text A"),
        ],
    )
    await start_at(migrated, run, ids["/"])

    response = await api.get(
        project_url(workspace, project, "internal-links", "paths"),
        params={"url_id": ids["/a"], "run": str(run)},
        headers=viewer.headers,
    )

    data = response.json()["data"]
    for name in ("any", "editorial"):
        step = data[name]["steps"][1]
        assert (step["anchor"], step["scope"]) == ("Text A", "editorial")


async def test_a_page_deeper_than_the_search_goes_is_not_reached(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    chain = ["/", *(f"/p{number}" for number in range(1, MAX_LEVELS + 2))]
    run, ids = await seed_crawl(
        migrated,
        workspace,
        project,
        [(path, 200) for path in chain],
        [SeedLink(source, target, "content", "next") for source, target in pairwise(chain)],
    )
    await start_at(migrated, run, ids["/"])
    url = project_url(workspace, project, "internal-links", "paths")

    last_reached = await api.get(
        url, params={"url_id": ids[chain[MAX_LEVELS]], "run": str(run)}, headers=viewer.headers
    )
    too_deep = await api.get(
        url, params={"url_id": ids[chain[MAX_LEVELS + 1]], "run": str(run)}, headers=viewer.headers
    )

    assert last_reached.json()["data"]["any"]["clicks"] == MAX_LEVELS
    assert too_deep.json()["data"]["any"] is None


async def test_the_start_page_is_a_route_of_one_step_and_a_foreign_page_is_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run, ids, _ = await read_site(migrated, workspace, project)
    await start_at(migrated, run, ids["/"])
    other = await make_workspace(migrated)
    other_project = await keyword_project(migrated, other)
    _, other_ids = await seed_crawl(
        migrated, other, other_project, [("/", 200), ("/secret-xyz", 200)]
    )
    url = project_url(workspace, project, "internal-links", "paths")

    home = await api.get(url, params={"url_id": ids["/"]}, headers=viewer.headers)
    foreign = await api.get(
        url, params={"url_id": other_ids["/secret-xyz"]}, headers=viewer.headers
    )

    assert home.json()["data"]["any"]["clicks"] == 0
    assert problem(foreign) == (404, "not_found")


async def test_a_crawl_without_links_answers_410_and_unknown_parameters_422(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run, ids, _ = await read_site(migrated, workspace, project)
    await start_at(migrated, run, ids["/"])
    url = project_url(workspace, project, "internal-links", "paths")

    unknown = await api.get(
        url, params={"url_id": ids["/"], "scope": "all"}, headers=viewer.headers
    )
    await execute(migrated, "SELECT seo.drop_crawl_links_partition($1)", run)
    await execute(migrated, "UPDATE seo.crawl_runs SET links_dropped_at = now() WHERE id = $1", run)
    dropped = await api.get(url, params={"url_id": ids["/"]}, headers=viewer.headers)

    assert problem(unknown) == (422, "validation_failed")
    assert problem(dropped) == (410, "links_dropped")


async def test_a_link_worded_like_a_redirect_is_not_a_redirect_step(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run, ids = await seed_crawl(
        migrated,
        workspace,
        project,
        [("/", 200), ("/a", 200)],
        [SeedLink("/", "/a", "content", "301 redirect")],
    )
    await start_at(migrated, run, ids["/"])

    response = await api.get(
        project_url(workspace, project, "internal-links", "paths"),
        params={"url_id": ids["/a"]},
        headers=viewer.headers,
    )

    assert [step["via_redirect"] for step in response.json()["data"]["any"]["steps"]] == [
        False,
        False,
    ]


async def test_a_level_wider_than_one_query_is_still_searched_whole(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(route_finder, "FRONTIER_CHUNK", 1)
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    pages = [("/", 200), ("/a", 200), ("/b", 200), ("/c", 200), ("/deep", 200)]
    links = [
        SeedLink("/", "/a", "content", "a"),
        SeedLink("/", "/b", "content", "b"),
        SeedLink("/", "/c", "content", "c"),
        SeedLink("/c", "/deep", "content", "deep"),
    ]
    run, ids = await seed_crawl(migrated, workspace, project, pages, links)
    await start_at(migrated, run, ids["/"])

    response = await api.get(
        project_url(workspace, project, "internal-links", "paths"),
        params={"url_id": ids["/deep"]},
        headers=viewer.headers,
    )

    steps = response.json()["data"]["any"]["steps"]
    assert [step["page"]["path"] for step in steps] == ["/", "/c", "/deep"]
