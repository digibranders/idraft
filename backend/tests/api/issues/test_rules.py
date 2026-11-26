"""The 24 crawl rules, read through `filter[issue]` on the Pages list (spec section 4)."""

from __future__ import annotations

from typing import get_args

import httpx
import pytest

from idraft.api.issues.catalogue import CHECKS
from idraft.api.resources import Resources
from idraft.api.schemas.issues import CheckId
from tests.api.auth.support import execute, make_workspace
from tests.api.entities.support import member, problem
from tests.api.issues.support import EXPECTED, SHARED_TITLE, audit_site
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer


@pytest.mark.parametrize("check_id", sorted(EXPECTED))
async def test_a_check_finds_exactly_its_pages(
    check_id: str, api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await audit_site(migrated, workspace, project)
    url = project_url(workspace, project, "internal-links", "pages")

    found = await api.get(
        url,
        params={"filter[issue]": check_id, "sort": "path", "limit": 200},
        headers=viewer.headers,
    )

    assert found.status_code == 200, found.text
    assert sorted(row["path"] for row in found.json()["data"]) == sorted(EXPECTED[check_id])
    assert found.json()["meta"]["total"] == len(EXPECTED[check_id])


async def test_an_unknown_issue_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await audit_site(migrated, workspace, project)
    url = project_url(workspace, project, "internal-links", "pages")

    bad_status = await api.get(url, params={"filter[status]": "9xx"}, headers=viewer.headers)
    bad_issue = await api.get(url, params={"filter[issue]": "nope"}, headers=viewer.headers)

    assert bad_status.status_code == 422
    assert problem(bad_issue) == problem(bad_status)


async def test_the_issue_filter_composes_with_search(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await audit_site(migrated, workspace, project)
    url = project_url(workspace, project, "internal-links", "pages")

    found = await api.get(
        url,
        params={"filter[issue]": "redirect-pages", "q": "old", "sort": "path"},
        headers=viewer.headers,
    )

    assert [row["path"] for row in found.json()["data"]] == ["/old", "/older"]


async def test_nofollow_on_a_crawl_without_links_is_410(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run_id, _ = await audit_site(migrated, workspace, project)
    await execute(
        migrated, "UPDATE seo.crawl_runs SET links_dropped_at = now() WHERE id = $1", run_id
    )
    url = project_url(workspace, project, "internal-links", "pages")

    nofollow = await api.get(
        url, params={"filter[issue]": "nofollow-internal"}, headers=viewer.headers
    )
    other = await api.get(url, params={"filter[issue]": "orphans"}, headers=viewer.headers)

    assert problem(nofollow) == (410, "links_dropped")
    assert other.status_code == 200


def test_check_ids_match_the_catalogue() -> None:
    assert get_args(CheckId) == tuple(check.id for check in CHECKS)


NBSP = chr(0xA0)


async def _paths(
    api: httpx.AsyncClient, url: str, headers: dict[str, str], check_id: str
) -> list[str]:
    found = await api.get(
        url, params={"filter[issue]": check_id, "sort": "path", "limit": 200}, headers=headers
    )
    assert found.status_code == 200, found.text
    return [row["path"] for row in found.json()["data"]]


@pytest.mark.parametrize("sitemap_pages", [0, None])
@pytest.mark.parametrize("check_id", ["sitemap-broken", "sitemap-nonindexable", "not-in-sitemap"])
async def test_a_sitemap_check_finds_nothing_when_no_sitemap_was_found(
    check_id: str,
    sitemap_pages: int | None,
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run_id, _ = await audit_site(migrated, workspace, project)
    await execute(
        migrated,
        "UPDATE seo.crawl_runs SET sitemap_pages = $2 WHERE id = $1",
        run_id,
        sitemap_pages,
    )
    url = project_url(workspace, project, "internal-links", "pages")

    assert await _paths(api, url, viewer.headers, check_id) == []


async def test_a_cursor_of_one_check_is_refused_on_another(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await audit_site(migrated, workspace, project)
    url = project_url(workspace, project, "internal-links", "pages")
    params: dict[str, str | int] = {"filter[issue]": "redirect-pages", "sort": "path", "limit": 1}
    first = await api.get(url, params=params, headers=viewer.headers)
    cursor = first.json()["page"]["next_cursor"]

    same = await api.get(url, params={**params, "cursor": cursor}, headers=viewer.headers)
    other = await api.get(
        url,
        params={**params, "filter[issue]": "canonical-elsewhere", "cursor": cursor},
        headers=viewer.headers,
    )

    assert same.status_code == 200
    assert same.json()["data"][0]["path"] == EXPECTED["redirect-pages"][1]
    assert problem(other) == (400, "invalid_cursor")


async def test_the_cursor_of_the_plain_pages_list_still_pages(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await audit_site(migrated, workspace, project)
    url = project_url(workspace, project, "internal-links", "pages")
    params: dict[str, str | int] = {"sort": "path", "limit": 1}
    first = await api.get(url, params=params, headers=viewer.headers)
    cursor = first.json()["page"]["next_cursor"]

    second = await api.get(url, params={**params, "cursor": cursor}, headers=viewer.headers)

    assert second.status_code == 200, second.text
    assert second.json()["data"][0]["path"] != first.json()["data"][0]["path"]


async def test_a_title_is_trimmed_of_every_kind_of_whitespace(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run_id, ids = await audit_site(migrated, workspace, project)
    update = "UPDATE seo.crawl_pages SET title = $3 WHERE run_id = $1 AND url_id = $2"
    await execute(migrated, update, run_id, ids["/lost"], "\n\t " + NBSP)
    await execute(migrated, update, run_id, ids["/title-30"], NBSP + "t" * 29)
    await execute(migrated, update, run_id, ids["/pricing"], SHARED_TITLE + "\t")
    url = project_url(workspace, project, "internal-links", "pages")

    assert await _paths(api, url, viewer.headers, "title-missing") == ["/lost"]
    assert await _paths(api, url, viewer.headers, "title-short") == ["/services", "/title-30"]
    assert sorted(await _paths(api, url, viewer.headers, "title-duplicate")) == sorted(
        EXPECTED["title-duplicate"]
    )
