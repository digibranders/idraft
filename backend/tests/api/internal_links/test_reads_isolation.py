"""What a read can reach: `core.urls` is shared by every workspace, so a URL id proves nothing;
a crawl is reached only through its project and its state; a member limited to some projects
sees no other project's crawl (spec 6.5, API contract)."""

from __future__ import annotations

import uuid

import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.auth.support import Workspace, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import SeedLink, read_site, seed_crawl, set_counts
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer

NOT_DATA_STATES = ["queued", "crawling", "processing", "failed", "cancelled"]


def read_requests(
    workspace: Workspace, project: uuid.UUID, url_id: int, **query: str
) -> list[tuple[str, dict[str, str | int]]]:
    """Every read route of the API, each asked about `url_id` where it takes one."""

    def at(*parts: object) -> str:
        return project_url(workspace, project, "internal-links", *parts)

    return [
        (at("pages"), dict(query)),
        (at("pages", url_id), dict(query)),
        (at("edges"), dict(query)),
        (at("neighbors"), {"url_id": url_id, "direction": "out", **query}),
        (at("neighbors"), {"url_id": url_id, "direction": "in", **query}),
        (at("tier-flow"), dict(query)),
        (at("worklists"), dict(query)),
    ]


async def test_a_url_in_the_shared_dictionary_but_not_in_this_crawl_is_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    first, ids, _ = await read_site(migrated, workspace, project)
    # A second crawl of the same project holds a page the first one does not.
    extra = f"/only-in-the-second-{uuid.uuid4().hex[:8]}"
    second, second_ids = await seed_crawl(
        migrated,
        workspace,
        project,
        [("/", 200), (extra, 200)],
        [SeedLink("/", extra, "content", "Extra")],
    )
    # And another workspace crawls a page of its own.
    other_workspace = await make_workspace(migrated)
    other_project = await keyword_project(migrated, other_workspace)
    elsewhere = f"/only-elsewhere-{uuid.uuid4().hex[:8]}"
    _, elsewhere_ids = await seed_crawl(
        migrated,
        other_workspace,
        other_project,
        [("/", 200), (elsewhere, 200)],
        [SeedLink("/", elsewhere, "content", "Elsewhere")],
    )
    in_second, in_other = second_ids[extra], elsewhere_ids[elsewhere]

    for url_id in (in_second, in_other):
        for url, params in read_requests(workspace, project, url_id, run=str(first), scope="all"):
            if url.endswith(("/pages", "/edges", "/tier-flow", "/worklists")):
                continue
            response = await api.get(url, params=params, headers=viewer.headers)
            assert problem(response) == (404, "not_found"), (url, url_id)
        for side in ("source", "target"):
            response = await api.get(
                project_url(workspace, project, "internal-links", "edges"),
                params={"run": str(first), "scope": "all", f"filter[{side}]": url_id},
                headers=viewer.headers,
            )
            assert response.status_code == 200, response.text
            assert response.json()["data"] == []
            assert response.json()["meta"]["total"] == 0
    # The page does exist in the crawl that holds it.
    held = await api.get(
        project_url(workspace, project, "internal-links", "pages", in_second),
        params={"run": str(second)},
        headers=viewer.headers,
    )
    assert held.status_code == 200, held.text
    assert ids["/"] != in_second


@pytest.mark.parametrize("state", NOT_DATA_STATES)
async def test_a_crawl_without_data_is_not_found_by_its_id(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, state: str
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    _, ids, _ = await read_site(migrated, workspace, project)
    run, _ = await seed_crawl(
        migrated, workspace, project, [("/", 200)], [SeedLink("/", "/")], state=state
    )

    for url, params in read_requests(workspace, project, ids["/"], run=str(run)):
        response = await api.get(url, params=params, headers=viewer.headers)
        assert problem(response) == (404, "not_found"), (url, state)
    # The latest crawl with data is still the one `latest` reads.
    latest = await api.get(
        project_url(workspace, project, "internal-links", "pages"), headers=viewer.headers
    )
    assert latest.status_code == 200
    assert latest.json()["meta"]["run_id"] != str(run)


async def test_a_run_of_another_project_or_workspace_is_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    _, ids, _ = await read_site(migrated, workspace, project)
    sibling = await keyword_project(migrated, workspace)
    sibling_run, _ = await seed_crawl(migrated, workspace, sibling, [("/", 200)], [])
    other_workspace = await make_workspace(migrated)
    other_run, _ = await seed_crawl(
        migrated,
        other_workspace,
        await keyword_project(migrated, other_workspace),
        [("/", 200)],
        [],
    )

    for run in (sibling_run, other_run, uuid.uuid4()):
        for url, params in read_requests(workspace, project, ids["/"], run=str(run)):
            response = await api.get(url, params=params, headers=viewer.headers)
            assert problem(response) == (404, "not_found"), (url, run)


async def test_an_older_finished_crawl_of_the_project_can_be_read_by_its_id(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    first, ids, _ = await read_site(migrated, workspace, project)
    await seed_crawl(migrated, workspace, project, [("/", 200)], [], state="stopped_at_ceiling")

    for url, params in read_requests(workspace, project, ids["/"], run=str(first)):
        response = await api.get(url, params=params, headers=viewer.headers)
        assert response.status_code == 200, (url, response.text)
    latest = await api.get(
        project_url(workspace, project, "internal-links", "pages"), headers=viewer.headers
    )
    assert latest.json()["meta"]["total"] == 1


async def test_a_member_limited_to_some_projects_gets_404_outside_them_on_every_read(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    visible = await keyword_project(migrated, workspace)
    hidden = await keyword_project(migrated, workspace)
    first, ids, _ = await read_site(migrated, workspace, visible)
    hidden_run, hidden_ids = await seed_crawl(
        migrated, workspace, hidden, [("/", 200), ("/a", 200)], [SeedLink("/", "/a")]
    )
    await set_counts(migrated, hidden_run)
    limited = await member(resources, migrated, workspace, "admin", project_ids=[visible])

    for url_id, project in ((ids["/"], visible), (hidden_ids["/"], hidden)):
        for url, params in read_requests(workspace, project, url_id):
            response = await api.get(url, params=params, headers=limited.headers)
            if project == visible:
                assert response.status_code == 200, (url, response.text)
            else:
                assert problem(response) == (404, "not_found"), url
    # Naming the hidden project's own run through the visible project is no way in either.
    for url, params in read_requests(workspace, visible, ids["/"], run=str(hidden_run)):
        response = await api.get(url, params=params, headers=limited.headers)
        assert problem(response) == (404, "not_found"), url
    assert first != hidden_run
