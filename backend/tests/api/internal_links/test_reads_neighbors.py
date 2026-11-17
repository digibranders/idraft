"""One journey step, either side (spec 7.5 and 8)."""

from __future__ import annotations

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import make_workspace
from tests.api.entities.support import member
from tests.api.internal_links.support import read_site
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer


async def _step(
    api: httpx.AsyncClient, url: str, headers: dict[str, str], **params: str | int
) -> dict[str, object]:
    response = await api.get(url, params=params, headers=headers)
    assert response.status_code == 200, response.text
    body: dict[str, object] = response.json()
    return body


async def test_links_out_in_scope_with_reciprocal_pairs_and_group_counts(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    _, ids, _ = await read_site(migrated, workspace, project)
    url = project_url(workspace, project, "internal-links", "neighbors")

    body = await _step(api, url, viewer.headers, url_id=ids["/blog/a"], direction="out")

    data = body["data"]
    assert isinstance(data, list)
    assert [(row["path"], row["anchor"], row["reciprocal"]) for row in data] == [
        ("/pricing", "See plans", True),
    ]
    meta = body["meta"]
    assert isinstance(meta, dict)
    assert meta["total"] == 1
    assert meta["other_scopes"] == [{"scope": "auto_generated", "pages": 1}]


async def test_links_in_sort_by_tier_then_equity(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    _, ids, _ = await read_site(migrated, workspace, project)
    url = project_url(workspace, project, "internal-links", "neighbors")

    body = await _step(api, url, viewer.headers, url_id=ids["/blog/a"], direction="in", scope="all")

    data = body["data"]
    assert isinstance(data, list)
    # /pricing is T1; /blog and /blog/b are both untiered with the same share: the path decides.
    assert [row["path"] for row in data] == ["/pricing", "/blog", "/blog/b"]
    assert [row["has_children"] for row in data] == [True, True, True]


async def test_a_redirect_focus_has_one_child_its_target(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    _, ids, _ = await read_site(migrated, workspace, project)
    url = project_url(workspace, project, "internal-links", "neighbors")

    body = await _step(api, url, viewer.headers, url_id=ids["/old"], direction="out")

    data = body["data"]
    assert isinstance(data, list)
    assert [(row["path"], row["placement"]) for row in data] == [("/pricing", None)]
    meta = body["meta"]
    assert isinstance(meta, dict)
    assert meta["focus"]["redirect_url_id"] == str(ids["/pricing"])


async def test_offset_pages_through_the_neighbors(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    _, ids, _ = await read_site(migrated, workspace, project)
    url = project_url(workspace, project, "internal-links", "neighbors")
    paths: list[object] = []
    for offset in (0, 2):
        step = await _step(
            api,
            url,
            viewer.headers,
            url_id=ids["/blog/a"],
            direction="in",
            scope="all",
            limit=2,
            offset=offset,
        )
        data = step["data"]
        assert isinstance(data, list)
        paths.extend(row["path"] for row in data)

    assert paths == ["/pricing", "/blog", "/blog/b"]
