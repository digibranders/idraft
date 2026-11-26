"""The words of the Pages spec section 4 as one predicate: `filter[view]` on the pages list counts
the same pages as the numbers the Overview shows (decision D8)."""

from __future__ import annotations

import csv
import io
from typing import get_args

import httpx
import pytest

from idraft.api.resources import Resources
from idraft.api.schemas.internal_links import PageView
from tests.api.auth.support import make_workspace
from tests.api.entities.support import member, problem
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
