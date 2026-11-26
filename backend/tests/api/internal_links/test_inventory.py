"""The words of the Pages spec section 4 as one predicate: `filter[view]` on the pages list counts
the same pages as the numbers the Overview shows (decision D8)."""

from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime
from typing import Any, get_args

import httpx
import pytest
from sqlalchemy import select

from idraft.api.internal_links.inventory import section_of
from idraft.api.resources import Resources
from idraft.api.schemas.internal_links import PageView
from idraft.db.tables import urls
from tests.api.auth.support import fetchrow, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import seed_crawl, url_id
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


async def _overview(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    *,
    sitemap: bool = True,
) -> tuple[dict[str, Any], str, dict[str, str], list[uuid.UUID]]:
    """The overview of the seeded crawl, the pages list's address, the viewer's headers and the
    tier ids of the site."""
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    _, _, tiers = await inventory_site(migrated, workspace, project, sitemap=sitemap)
    response = await api.get(
        project_url(workspace, project, "internal-links", "overview"), headers=viewer.headers
    )
    assert response.status_code == 200, response.text
    pages = project_url(workspace, project, "internal-links", "pages")
    return response.json()["data"], pages, viewer.headers, tiers


def _number_of_view(data: dict[str, Any], view: str) -> int | None:
    """The Overview field that has the same number as a view (plan contract C2)."""
    status, sitemap = data["status"], data["sitemap"]
    numbers: dict[str, int | None] = {
        "live": status["live"],
        "indexable": data["indexable"],
        "not_indexable": data["not_indexable"],
        "redirects": status["redirected"],
        "errors": status["client_error"] + status["server_error"],
        "client_errors": status["client_error"],
        "server_errors": status["server_error"],
        "blocked": status["blocked"],
        "other": status["other"],
        "variants": status["variant"],
        "in_sitemap_indexable": sitemap["indexable_in_sitemap"],
        "not_in_sitemap": sitemap["indexable_missing"],
        "sitemap_not_live": sitemap["listed_not_live"],
        "sitemap_not_indexable": sitemap["listed_not_indexable"],
        "reachable": data["reachable"],
        "unreachable": data["unreachable"],
    }
    return numbers[view]


async def test_the_overview_numbers_are_the_known_cases_of_the_crawl(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    data, _, _, _ = await _overview(api, resources, migrated)

    assert data["addresses"] == EXPECTED["addresses"]
    assert data["status"] == {
        key: EXPECTED[key]
        for key in (
            "live",
            "variant",
            "redirected",
            "client_error",
            "server_error",
            "blocked",
            "other",
        )
    }
    for key in ("indexable", "not_indexable", "reachable", "unreachable", "orphans"):
        assert data[key] == EXPECTED[key], key
    assert data["sitemap"] == {
        "state": "read",
        **{
            key: EXPECTED[key]
            for key in (
                "indexable_in_sitemap",
                "indexable_missing",
                "listed_not_live",
                "listed_not_indexable",
            )
        },
    }


async def test_the_overview_counts_add_up(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    data, _, _, _ = await _overview(api, resources, migrated)

    status, sitemap = data["status"], data["sitemap"]
    assert sum(status.values()) == data["addresses"]
    assert data["indexable"] + data["not_indexable"] == status["live"]
    assert data["reachable"] + data["unreachable"] == status["live"]
    assert len(data["depth"]) == 7
    assert [row["clicks"] for row in data["depth"]] == list(range(7))
    assert sum(row["pages"] for row in data["depth"]) == data["reachable"]
    assert sum(row["pages"] for row in data["tiers"]) == status["live"]
    assert sum(row["pages"] for row in data["sections"]) == status["live"]
    assert data["sections_total"] == len(data["sections"])
    assert sitemap["indexable_in_sitemap"] + sitemap["indexable_missing"] == data["indexable"]


async def test_the_page_nine_clicks_away_is_in_the_row_for_six_and_more(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    data, _, _, _ = await _overview(api, resources, migrated)

    assert [row["pages"] for row in data["depth"]] == [1, 2, 2, 0, 0, 0, 1]


async def test_the_tiers_are_in_order_with_untiered_last_and_an_empty_tier_is_left_out(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    data, _, _, tiers = await _overview(api, resources, migrated)

    assert [
        (row["tier"]["tier_id"] if row["tier"] else None, row["pages"]) for row in data["tiers"]
    ] == [(str(tiers[0]), 1), (str(tiers[2]), 1), (None, 5)]


async def test_the_sections_are_largest_first_then_by_name(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    data, _, _, _ = await _overview(api, resources, migrated)

    assert [(row["section"], row["pages"]) for row in data["sections"]] == [
        ("/", 3),
        ("/blog/", 3),
        ("/docs/", 1),
    ]
    assert data["sections_total"] == 3


@pytest.mark.parametrize("view", get_args(PageView))
async def test_an_overview_number_equals_the_total_of_its_list(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, view: str
) -> None:
    data, pages, headers, _ = await _overview(api, resources, migrated)

    response = await api.get(
        pages, params={"filter[view]": view, "scope": "all", "limit": "1"}, headers=headers
    )

    assert response.status_code == 200, response.text
    assert response.json()["meta"]["total"] == _number_of_view(data, view)


async def test_the_orphans_equal_the_total_of_the_orphans_worklist(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    data, pages, headers, _ = await _overview(api, resources, migrated)

    response = await api.get(
        pages, params={"filter[worklist]": "orphans", "scope": "all"}, headers=headers
    )

    assert response.json()["meta"]["total"] == data["orphans"]


async def test_without_a_sitemap_the_counts_are_null_and_its_views_are_empty(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    data, pages, headers, _ = await _overview(api, resources, migrated, sitemap=False)

    assert data["sitemap"] == {
        "state": "no_sitemap",
        "indexable_in_sitemap": None,
        "indexable_missing": None,
        "listed_not_live": None,
        "listed_not_indexable": None,
    }
    for view in ("in_sitemap_indexable", "sitemap_not_live", "sitemap_not_indexable"):
        response = await api.get(
            pages, params={"filter[view]": view, "scope": "all"}, headers=headers
        )
        assert response.json()["meta"]["total"] == 0, view


async def test_the_overview_says_which_crawl_and_when(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run_id, _, _ = await inventory_site(migrated, workspace, project)

    response = await api.get(
        project_url(workspace, project, "internal-links", "overview"), headers=viewer.headers
    )

    finished = await fetchrow(
        migrated, "SELECT finished_at FROM seo.crawl_runs WHERE id = $1", run_id
    )
    data = response.json()["data"]
    assert data["run_id"] == str(run_id)
    assert datetime.fromisoformat(data["crawled_at"]) == finished["finished_at"]


async def test_an_older_crawl_answers_its_own_numbers(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    older, _, _ = await inventory_site(migrated, workspace, project)
    newer, _ = await seed_crawl(migrated, workspace, project, [("/", 200)])
    url = project_url(workspace, project, "internal-links", "overview")

    latest = await api.get(url, headers=viewer.headers)
    by_id = await api.get(url, params={"run": str(older)}, headers=viewer.headers)

    assert latest.json()["data"]["run_id"] == str(newer)
    assert latest.json()["data"]["addresses"] == 1
    assert by_id.json()["data"]["run_id"] == str(older)
    assert by_id.json()["data"]["addresses"] == EXPECTED["addresses"]


async def test_a_project_without_a_finished_crawl_has_no_overview(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)

    response = await api.get(
        project_url(workspace, project, "internal-links", "overview"), headers=viewer.headers
    )

    assert problem(response) == (404, "no_crawl")


async def test_the_overview_of_another_workspaces_project_is_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    outsider = await member(resources, migrated, workspace, "viewer")
    other = await make_workspace(migrated)
    foreign = await keyword_project(migrated, other)
    await inventory_site(migrated, other, foreign)

    response = await api.get(
        project_url(workspace, foreign, "internal-links", "overview"), headers=outsider.headers
    )

    assert problem(response) == (404, "not_found")


async def test_a_role_without_data_read_is_refused_the_overview(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    billing = await member(resources, migrated, workspace, "billing")
    project = await keyword_project(migrated, workspace)
    await inventory_site(migrated, workspace, project)

    response = await api.get(
        project_url(workspace, project, "internal-links", "overview"), headers=billing.headers
    )

    assert response.status_code == 403
