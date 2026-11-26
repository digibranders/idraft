"""The words of the Pages spec section 4 as one predicate: `filter[view]` on the pages list counts
the same pages as the numbers the Overview shows (decision D8)."""

from __future__ import annotations

import csv
import io
from typing import get_args

import httpx
import pytest
from sqlalchemy import select

from idraft.api.internal_links.inventory import section_of
from idraft.api.resources import Resources
from idraft.api.schemas.internal_links import PageView
from idraft.db.tables import urls
from tests.api.auth.support import fetchrow, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import url_id
from tests.api.internal_links.support_inventory import EXPECTED, inventory_site
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer

# The Overview number each view must equal (plan contract C2).
VIEW_TOTALS = {
    "live": EXPECTED["live"],
    "indexable": EXPECTED["indexable"],
    "not_indexable": EXPECTED["not_indexable"],
    "redirects": EXPECTED["redirected"],
    "errors": EXPECTED["client_error"] + EXPECTED["server_error"],
    "client_errors": EXPECTED["client_error"],
    "server_errors": EXPECTED["server_error"],
    "blocked": EXPECTED["blocked"],
    "other": EXPECTED["other"],
    "variants": EXPECTED["variant"],
    "in_sitemap_indexable": EXPECTED["indexable_in_sitemap"],
    "not_in_sitemap": EXPECTED["indexable_missing"],
    "sitemap_not_live": EXPECTED["listed_not_live"],
    "sitemap_not_indexable": EXPECTED["listed_not_indexable"],
    "reachable": EXPECTED["reachable"],
    "unreachable": EXPECTED["unreachable"],
}


async def _site(
    resources: Resources, migrated: PostgresServer
) -> tuple[str, dict[str, str], dict[str, int]]:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    _, ids, _ = await inventory_site(migrated, workspace, project)
    return project_url(workspace, project, "internal-links", "pages"), viewer.headers, ids


def test_every_view_has_a_number_to_match() -> None:
    assert set(VIEW_TOTALS) == set(get_args(PageView))


@pytest.mark.parametrize("view", get_args(PageView))
async def test_a_view_lists_as_many_pages_as_its_number_says(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, view: str
) -> None:
    url, headers, _ = await _site(resources, migrated)

    response = await api.get(
        url, params={"filter[view]": view, "scope": "all", "limit": "50"}, headers=headers
    )

    assert response.status_code == 200, response.text
    assert response.json()["meta"]["total"] == VIEW_TOTALS[view]
    assert len(response.json()["data"]) == VIEW_TOTALS[view]


async def test_the_variants_view_lists_the_variant_without_asking_for_variants(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    url, headers, _ = await _site(resources, migrated)

    response = await api.get(
        url, params={"filter[view]": "variants", "scope": "all"}, headers=headers
    )

    assert [row["path"] for row in response.json()["data"]] == ["/blog/a-variant"]


async def test_a_view_and_a_worklist_together_are_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    url, headers, _ = await _site(resources, migrated)

    response = await api.get(
        url, params={"filter[view]": "live", "filter[worklist]": "orphans"}, headers=headers
    )

    assert response.status_code == 422


async def test_an_unknown_view_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    url, headers, _ = await _site(resources, migrated)

    response = await api.get(url, params={"filter[view]": "everything"}, headers=headers)

    assert response.status_code == 422


async def test_the_csv_follows_the_view(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    url, headers, _ = await _site(resources, migrated)

    response = await api.get(
        url, params={"filter[view]": "redirects", "format": "csv", "scope": "all"}, headers=headers
    )

    rows = list(csv.DictReader(io.StringIO(response.text)))
    assert response.status_code == 200, response.text
    assert [row["path"] for row in rows] == ["/old"]


async def test_the_search_narrows_a_view_further(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    url, headers, _ = await _site(resources, migrated)

    response = await api.get(
        url, params={"filter[view]": "errors", "q": "/go", "scope": "all"}, headers=headers
    )

    assert [row["path"] for row in response.json()["data"]] == ["/gone"]


async def test_a_member_of_another_workspace_cannot_list_the_views(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    outsider = await member(resources, migrated, workspace, "viewer")
    other = await make_workspace(migrated)
    foreign = await keyword_project(migrated, other)
    await inventory_site(migrated, other, foreign)

    response = await api.get(
        project_url(workspace, foreign, "internal-links", "pages"),
        params={"filter[view]": "live"},
        headers=outsider.headers,
    )

    assert problem(response) == (404, "not_found")


async def _paths(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    **params: str,
) -> list[str]:
    url, headers, _ = await _site(resources, migrated)
    response = await api.get(url, params={"scope": "all", "limit": "50", **params}, headers=headers)
    assert response.status_code == 200, response.text
    return sorted(row["path"] for row in response.json()["data"])


async def test_a_folder_lists_the_pages_of_its_section(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    paths = await _paths(api, resources, migrated, **{"filter[folder]": "/blog/"})

    assert paths == ["/blog/a", "/blog/b", "/blog/deep"]


async def test_the_root_section_holds_top_level_pages_and_a_folders_own_index(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    paths = await _paths(api, resources, migrated, **{"filter[folder]": "/"})

    assert paths == sorted(
        ["/", "/pricing", "/blog/", "/old", "/gone", "/down", "/private", "/file.pdf", "/unknown"]
    )


async def test_a_view_and_a_folder_narrow_together(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    url, headers, _ = await _site(resources, migrated)

    response = await api.get(
        url,
        params={"filter[view]": "live", "filter[folder]": "/blog/", "scope": "all"},
        headers=headers,
    )

    assert response.json()["meta"]["total"] == 3


@pytest.mark.parametrize(
    ("depth", "expected"), [("2", ["/blog/a", "/blog/b"]), ("6", ["/blog/deep"])]
)
async def test_a_depth_lists_the_live_pages_that_many_clicks_away(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    depth: str,
    expected: list[str],
) -> None:
    paths = await _paths(api, resources, migrated, **{"filter[depth]": depth})

    assert paths == expected


@pytest.mark.parametrize(
    "params",
    [
        {"filter[depth]": "7"},
        {"filter[depth]": "-1"},
        {"filter[folder]": "/" + "a" * 200},
    ],
)
async def test_a_depth_or_folder_out_of_range_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, params: dict[str, str]
) -> None:
    url, headers, _ = await _site(resources, migrated)

    response = await api.get(url, params=params, headers=headers)

    assert response.status_code == 422


@pytest.mark.parametrize(
    ("path", "section"),
    [
        ("/", "/"),
        ("/pricing", "/"),
        ("/blog/", "/"),
        ("/blog/post", "/blog/"),
        ("/blog/2026/post", "/blog/"),
    ],
)
async def test_the_section_of_a_path(migrated: PostgresServer, path: str, section: str) -> None:
    row_id = await url_id(migrated, f"https://example.com{path}")
    statement = select(section_of()).where(urls.c.id == row_id)
    sql = str(statement.compile(compile_kwargs={"literal_binds": True}))

    row = await fetchrow(migrated, sql)

    assert row[0] == section
