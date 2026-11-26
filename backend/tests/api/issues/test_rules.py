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
from tests.api.issues.support import EXPECTED, audit_site
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
