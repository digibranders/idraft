"""The Pages tab and the inspector (spec 7.2 and 7.4)."""

from __future__ import annotations

import csv
import io

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import execute, fetchrow, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import (
    SeedLink,
    read_site,
    seed_crawl,
    seed_tiers,
    set_counts,
)
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer


async def test_pages_list_counts_in_the_scope_in_view_and_sorts_by_equity(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await read_site(migrated, workspace, project)
    url = project_url(workspace, project, "internal-links", "pages")

    editorial = await api.get(url, headers=viewer.headers)
    every = await api.get(url, params={"scope": "all"}, headers=viewer.headers)

    assert editorial.status_code == 200, editorial.text
    rows = editorial.json()["data"]
    assert rows[0]["path"] == "/pricing"
    pricing = rows[0]
    assert (pricing["linking_pages"], pricing["linking_pages_all"]) == (1, 2)
    assert pricing["tier"]["code"] == "T1"
    assert pricing["tier_source"] == "manual"
    (from_tier,) = pricing["linked_from_tiers"]
    assert (from_tier["tier"]["code"], from_tier["pages"]) == ("T3", 1)
    assert editorial.json()["meta"]["total"] == 7
    every_pricing = next(row for row in every.json()["data"] if row["path"] == "/pricing")
    assert every_pricing["linking_pages"] == 2
    assert all(isinstance(row["url_id"], str) and row["url_id"].isdigit() for row in rows)


async def test_a_row_names_who_set_its_tier_and_its_tags(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    _, ids, _ = await read_site(migrated, workspace, project)
    await execute(
        migrated,
        "UPDATE core.project_pages SET set_by = $3, set_at = now() "
        "WHERE project_id = $1 AND url_id = $2",
        project,
        ids["/pricing"],
        editor.user_id,
    )
    vocabulary = await fetchrow(
        migrated,
        "INSERT INTO core.taxonomy_vocabularies (workspace_id, kind, name) "
        "VALUES ($1, 'tag', 'Page tags') RETURNING id",
        workspace.id,
    )
    term = await fetchrow(
        migrated,
        "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, name, slug, path) "
        "VALUES ($1, $2, 'Launch', 'launch', 'launch') RETURNING id",
        workspace.id,
        vocabulary["id"],
    )
    await execute(
        migrated,
        "INSERT INTO core.page_terms (project_id, url_id, term_id, workspace_id) "
        "VALUES ($1, $2, $3, $4)",
        project,
        ids["/pricing"],
        term["id"],
        workspace.id,
    )

    response = await api.get(
        project_url(workspace, project, "internal-links", "pages"),
        params={"filter[tag]": str(term["id"])},
        headers=viewer.headers,
    )

    (row,) = response.json()["data"]
    assert row["path"] == "/pricing"
    assert row["tier_set_by"]["user_id"] == str(editor.user_id)
    assert row["tier_set_by"]["name"]
    assert row["tier_set_by"]["email"]
    assert row["tier_set_at"] is not None
    assert row["tags"] == [{"term_id": str(term["id"]), "name": "Launch"}]


async def test_filters_worklists_and_cursor_paging(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await read_site(migrated, workspace, project)
    url = project_url(workspace, project, "internal-links", "pages")

    errors = await api.get(url, params={"filter[status]": "3xx,4xx"}, headers=viewer.headers)
    untiered = await api.get(
        url, params={"filter[tier]": "none", "q": "blog"}, headers=viewer.headers
    )
    first = await api.get(url, params={"sort": "path", "limit": 3}, headers=viewer.headers)
    second = await api.get(
        url,
        params={"sort": "path", "limit": 3, "cursor": first.json()["page"]["next_cursor"]},
        headers=viewer.headers,
    )

    assert {row["path"] for row in errors.json()["data"]} == {"/old", "/gone"}
    assert {row["path"] for row in untiered.json()["data"]} == {"/blog", "/blog/b"}
    assert [row["path"] for row in first.json()["data"]] == ["/", "/blog", "/blog/a"]
    assert [row["path"] for row in second.json()["data"]] == ["/blog/b", "/gone", "/old"]
    flags = {row["path"]: row["flags"] for row in errors.json()["data"]}
    assert flags == {"/old": ["redirect"], "/gone": ["broken"]}


async def test_the_inspector_shows_tiers_placements_anchors_and_capped_lists(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    _, ids, _ = await read_site(migrated, workspace, project)

    response = await api.get(
        project_url(workspace, project, "internal-links", "pages", ids["/pricing"]),
        params={"scope": "all"},
        headers=viewer.headers,
    )

    data = response.json()["data"]
    assert data["page"]["path"] == "/pricing"
    assert {(row["placement"], row["pages"]) for row in data["linking_by_placement"]} == {
        ("navigation", 1),
        ("content", 1),
    }
    assert [anchor["anchor"] for anchor in data["top_anchors"]] == ["Pricing", "See plans"]
    assert {row["path"] for row in data["linking_pages"]} == {"/", "/blog/a"}
    assert data["linking_pages_total"] == 2
    missing = await api.get(
        project_url(workspace, project, "internal-links", "pages", 999_999_999),
        headers=viewer.headers,
    )
    assert missing.status_code == 404


async def test_csv_follows_the_filter_and_defuses_formulas(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await read_site(migrated, workspace, project)

    response = await api.get(
        project_url(workspace, project, "internal-links", "pages"),
        params={"format": "csv", "filter[tier]": "none"},
        headers=viewer.headers,
    )

    assert response.headers["content-type"].startswith("text/csv")
    rows = list(csv.DictReader(io.StringIO(response.text)))
    assert {row["path"] for row in rows} == {"/", "/blog", "/blog/b", "/old", "/gone"}
    assert rows[0].keys() >= {"url", "tier", "status_code", "click_depth", "linking_pages"}
    # The product never shows an equity share, so the export does not carry one either.
    assert "equity_share" not in rows[0]


async def test_csv_cells_that_a_spreadsheet_would_run_are_quoted_and_match_the_json_list(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await seed_tiers(migrated, workspace)
    run, ids = await seed_crawl(
        migrated,
        workspace,
        project,
        [("/", 200), ("/a", 200), ("/b", 200), ("/c", 200), ("/d", 200)],
        [SeedLink("/", "/a"), SeedLink("/", "/b"), SeedLink("/", "/c"), SeedLink("/", "/d")],
    )
    await set_counts(migrated, run)
    for title, path in (
        ("=HYPERLINK(1)", "/a"),
        ("+1", "/b"),
        ("-2", "/c"),
        ("@SUM(1)", "/d"),
    ):
        await execute(
            migrated,
            "UPDATE seo.crawl_pages SET title = $3, top_anchor = $3 "
            "WHERE run_id = $1 AND url_id = $2",
            run,
            ids[path],
            title,
        )
    url = project_url(workspace, project, "internal-links", "pages")
    params = {"filter[status]": "2xx", "q": "/", "sort": "path"}

    as_csv = await api.get(url, params={**params, "format": "csv"}, headers=viewer.headers)
    as_json = await api.get(url, params=params, headers=viewer.headers)

    rows = list(csv.DictReader(io.StringIO(as_csv.text)))
    assert {row["title"] for row in rows} == {"", "'=HYPERLINK(1)", "'+1", "'-2", "'@SUM(1)"}
    assert {row["top_anchor"] for row in rows} == {"", "'=HYPERLINK(1)", "'+1", "'-2", "'@SUM(1)"}
    assert [row["path"] for row in rows] == [row["path"] for row in as_json.json()["data"]]
    assert len(rows) == as_json.json()["meta"]["total"] == 5


async def test_no_finished_crawl_is_a_404_with_its_own_code(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)

    response = await api.get(
        project_url(workspace, project, "internal-links", "pages"), headers=viewer.headers
    )

    assert problem(response) == (404, "no_crawl")


async def test_another_workspace_cannot_read_the_pages(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    await read_site(migrated, workspace, project)
    stranger = await member(resources, migrated, await make_workspace(migrated), "owner")

    response = await api.get(
        project_url(workspace, project, "internal-links", "pages"), headers=stranger.headers
    )

    assert response.status_code == 404
