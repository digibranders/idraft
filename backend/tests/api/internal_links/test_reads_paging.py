"""Cursor paging returns each row exactly once, for every sort in both directions, on a crawl with
nulls and ties in the sorted columns (API contract; the cursor holds the last row's sort value
and its id)."""

from __future__ import annotations

import base64
import json
import uuid

import httpx
import pytest

from idraft.api.internal_links.reads import EdgeQuery
from idraft.api.pagination import encode_cursor
from idraft.api.resources import Resources
from idraft.api.schemas.internal_links import PageFilter
from idraft.crawl.scopes import LinkScope
from tests.api.auth.support import execute, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.internal_links.support import SeedLink, seed_crawl, seed_tiers, set_counts
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer

SORTS = ["path", "click_depth", "linking_pages", "outlinks", "equity_share", "status_code"]
# path, status, click depth, equity share: ties in every column, and nulls in the last three.
SITE = [
    ("/", 200, 0, 0.2),
    ("/a", 200, 1, 0.2),
    ("/b", None, 1, None),
    ("/c", 200, None, 0.1),
    ("/d", 404, 2, None),
    ("/e", 301, None, 0.3),
    ("/f", 200, 2, 0.1),
    ("/g", None, 1, 0.2),
    ("/h", 200, None, None),
]
LINKS = [
    SeedLink("/", "/a"),
    SeedLink("/", "/b"),
    SeedLink("/", "/c"),
    SeedLink("/a", "/b"),
    SeedLink("/a", "/c", "navigation"),
    SeedLink("/b", "/c", "auto_generated"),
    SeedLink("/c", "/d"),
    SeedLink("/d", "/e"),
    SeedLink("/e", "/f"),
    SeedLink("/f", "/g", "navigation"),
    SeedLink("/g", "/h"),
    SeedLink("/h", "/a"),
    SeedLink("/h", "/a", "content", "second link"),
    SeedLink("/h", "/a", "navigation", "third link"),
]


async def _site(
    pg: PostgresServer, resources: Resources
) -> tuple[Caller, str, dict[str, int], uuid.UUID]:
    workspace = await make_workspace(pg)
    viewer = await member(resources, pg, workspace, "viewer")
    project = await keyword_project(pg, workspace)
    await seed_tiers(pg, workspace)
    run, ids = await seed_crawl(pg, workspace, project, [(path, 200) for path, *_ in SITE], LINKS)
    await set_counts(pg, run)
    for path, status, depth, share in SITE:
        await execute(
            pg,
            "UPDATE seo.crawl_pages SET status_code = $3::smallint, click_depth = $4::integer, "
            "equity_share = $5::double precision WHERE run_id = $1 AND url_id = $2",
            run,
            ids[path],
            status,
            depth,
            share,
        )
    return viewer, project_url(workspace, project, "internal-links"), ids, run


async def _walk(
    api: httpx.AsyncClient,
    url: str,
    headers: dict[str, str],
    params: dict[str, str | int],
    key: str,
) -> list[str]:
    """Every row of a list by following the cursors at two rows a page."""
    seen: list[str] = []
    cursor: str | None = None
    for _ in range(30):
        asked = {**params, "limit": 2, **({} if cursor is None else {"cursor": cursor})}
        response = await api.get(url, params=asked, headers=headers)
        assert response.status_code == 200, response.text
        body = response.json()
        seen.extend(row[key] for row in body["data"])
        cursor = body["page"]["next_cursor"]
        assert (cursor is not None) == body["page"]["has_more"]
        if cursor is None:
            return seen
    raise AssertionError("the cursors never ended")


@pytest.mark.parametrize("scope", ["editorial", "all"])
@pytest.mark.parametrize("descending", [False, True])
@pytest.mark.parametrize("sort", SORTS)
async def test_pages_follow_the_cursors_once_each_in_every_sort(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    sort: str,
    descending: bool,
    scope: str,
) -> None:
    viewer, base, ids, _ = await _site(migrated, resources)
    order = f"-{sort}" if descending else sort
    params: dict[str, str | int] = {"sort": order, "scope": scope}

    walked = await _walk(api, f"{base}/pages", viewer.headers, params, "url_id")

    whole = await api.get(f"{base}/pages", params={**params, "limit": 200}, headers=viewer.headers)
    in_one_page = [row["url_id"] for row in whole.json()["data"]]
    assert len(in_one_page) == len(SITE)
    assert sorted(walked) == sorted(str(url) for url in ids.values())
    assert walked == in_one_page


async def test_the_csv_lists_the_pages_in_the_order_of_the_list_for_every_sort(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    viewer, base, _, _ = await _site(migrated, resources)

    for sort in (*SORTS, *(f"-{name}" for name in SORTS)):
        params: dict[str, str | int] = {"sort": sort, "scope": "all"}
        as_json = await api.get(
            f"{base}/pages", params={**params, "limit": 200}, headers=viewer.headers
        )
        as_csv = await api.get(
            f"{base}/pages", params={**params, "format": "csv"}, headers=viewer.headers
        )

        in_csv = [line.split(",")[1] for line in as_csv.text.splitlines()[1:]]
        assert in_csv == [row["path"] for row in as_json.json()["data"]], sort


@pytest.mark.parametrize("scope", ["editorial", "all"])
async def test_edges_follow_the_cursors_once_each_in_the_documented_order(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, scope: str
) -> None:
    viewer, base, _, _ = await _site(migrated, resources)
    params: dict[str, str | int] = {"scope": scope}

    walked = await _walk(api, f"{base}/edges", viewer.headers, params, "link_id")

    whole = await api.get(f"{base}/edges", params={**params, "limit": 200}, headers=viewer.headers)
    rows = whole.json()["data"]
    assert walked == [row["link_id"] for row in rows]
    assert len(set(walked)) == len(walked) == whole.json()["meta"]["total"]
    rank = {"template": 0, "auto_generated": 1, "editorial": 2}
    keys = [(rank[row["scope"]], row["target"]["path"], int(row["link_id"])) for row in rows]
    assert keys == sorted(keys)
    if scope == "all":
        assert len(walked) == len(LINKS)


async def test_a_cursor_from_other_filters_or_with_a_shape_the_list_never_made_is_a_400(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    viewer, base, _, run = await _site(migrated, resources)
    first = await api.get(
        f"{base}/pages", params={"sort": "click_depth", "limit": 2}, headers=viewer.headers
    )
    cursor = first.json()["page"]["next_cursor"]
    scope = {
        "run": str(run),
        "view": "editorial",
        "sort": "click_depth",
        "filter": PageFilter().model_dump(mode="json"),
    }

    page_keys: list[list[str | int]] = [
        ["99999999999999", 5],
        ["x", 5],
        [1],
        [1, "x"],
        [1, 2, 3],
        ["1.5", 5],
    ]
    for bad in (
        # Another sort or other filters than the ones that made it.
        (
            await api.get(
                f"{base}/pages", params={"sort": "path", "cursor": cursor}, headers=viewer.headers
            )
        ),
        (
            await api.get(
                f"{base}/pages",
                params={"sort": "click_depth", "q": "a", "cursor": cursor},
                headers=viewer.headers,
            )
        ),
        # Made under this list's own scope, but holding what the column cannot take.
        *[
            await api.get(
                f"{base}/pages",
                params={"sort": "click_depth", "cursor": encode_cursor(key, scope=scope)},
                headers=viewer.headers,
            )
            for key in page_keys
        ],
    ):
        assert problem(bad) == (400, "invalid_cursor")
    # The same for the Links list: the key of its default query, then keys it never makes.
    edge_scope = {"run": str(run), "query": EdgeQuery(view=LinkScope.EDITORIAL).key()}
    edge_keys: list[list[str | int]] = [
        [5, "/a", 1],
        [0, 5, 1],
        [0, "/a"],
        [0, "/a", "x"],
        [-1, "/a", 1],
    ]
    for key in edge_keys:
        response = await api.get(
            f"{base}/edges",
            params={"cursor": encode_cursor(key, scope=edge_scope)},
            headers=viewer.headers,
        )
        assert problem(response) == (400, "invalid_cursor"), key
    unsigned = base64.urlsafe_b64encode(json.dumps({"k": [1], "s": "x"}).encode()).decode()
    response = await api.get(f"{base}/edges", params={"cursor": unsigned}, headers=viewer.headers)
    assert problem(response) == (400, "invalid_cursor")
