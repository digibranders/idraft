"""What a check found on each page: `include=issue` and the CSV columns (spec 4 and 6.2)."""

from __future__ import annotations

import csv
import io

import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.auth.support import execute, make_workspace
from tests.api.entities.support import member
from tests.api.issues.support import LONG_PATH, SHARED_TITLE, audit_site
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer

NONE: dict[str, object] = {
    "target_path": None,
    "target_status": None,
    "count": None,
    "reason": None,
}


def _detail(**found: object) -> dict[str, object]:
    return {**NONE, **found}


CASES = [
    ("status-4xx", "/gone", _detail(count=1)),
    ("redirect-broken", "/dead-end", _detail(target_path="/gone", target_status=404)),
    ("redirect-chain", "/old", _detail(target_path="/older", target_status=301)),
    ("redirect-pages", "/older", _detail(target_path="/services", target_status=200)),
    ("redirect-pages", "/to-blocked", _detail(target_path="/private", target_status=403)),
    ("canonical-broken", "/canon-dead", _detail(target_path="/gone", target_status=404)),
    ("canonical-broken", "/canon-redirect", _detail(target_path="/old", target_status=301)),
    ("canonical-elsewhere", "/services-copy", _detail(target_path="/services", target_status=200)),
    ("noindex", "/hidden", _detail(reason="meta_tag")),
    ("sitemap-nonindexable", "/services-copy", _detail(reason="canonical")),
    ("sitemap-nonindexable", "/hidden", _detail(reason="meta_tag")),
    ("links-to-redirect", "/services", _detail(count=1)),
    ("broken-internal-links", "/services", _detail(count=1)),
    ("links-to-nonindexable", "/services", _detail(count=1)),
    ("editorial-orphans", "/pricing", _detail(count=1)),
    ("deep-pages", "/a/b/c/d", _detail(count=4)),
    ("nofollow-internal", "/Plans_Old", _detail(count=1)),
    ("title-duplicate", "/pricing", _detail(count=1, target_path="/Plans_Old")),
    ("title-duplicate", "/Plans_Old", _detail(count=1, target_path="/pricing")),
    ("title-long", "/long-title", _detail(count=70)),
    ("title-short", "/services", _detail(count=8)),
    ("url-format", "/Plans_Old", _detail(reason="both")),
    ("url-format", "/Zed_page", _detail(reason="both")),
    ("url-format", "/About", _detail(reason="capitals")),
    ("url-format", "/old_page", _detail(reason="underscores")),
    ("url-format", "/aa_x", _detail(reason="underscores")),
    ("url-long", LONG_PATH, _detail(count=121)),
    ("orphans", "/lost", NONE),
    ("not-in-sitemap", "/Plans_Old", NONE),
    ("title-missing", "/lost", NONE),
    ("status-5xx", "/error", NONE),
    ("sitemap-broken", "/gone", NONE),
]


async def _issue_of(
    api: httpx.AsyncClient, url: str, headers: dict[str, str], check_id: str
) -> dict[str, dict[str, object] | None]:
    found = await api.get(
        url,
        params={"filter[issue]": check_id, "include": "issue", "sort": "path", "limit": 200},
        headers=headers,
    )
    assert found.status_code == 200, found.text
    return {row["path"]: row["extras"]["issue"] for row in found.json()["data"]}


@pytest.mark.parametrize(("check_id", "path", "expected"), CASES)
async def test_a_page_shows_what_its_check_found(
    check_id: str,
    path: str,
    expected: dict[str, object],
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await audit_site(migrated, workspace, project)
    url = project_url(workspace, project, "internal-links", "pages")

    issues = await _issue_of(api, url, viewer.headers, check_id)

    assert issues[path] == expected


async def test_the_issue_is_null_without_a_check(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await audit_site(migrated, workspace, project)
    url = project_url(workspace, project, "internal-links", "pages")

    found = await api.get(url, params={"include": "issue", "limit": 200}, headers=viewer.headers)

    assert found.status_code == 200, found.text
    assert found.json()["data"]
    assert all(row["extras"]["issue"] is None for row in found.json()["data"])


async def test_a_title_shared_by_three_pages_names_the_first_other_page(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run_id, ids = await audit_site(migrated, workspace, project)
    await execute(
        migrated,
        "UPDATE seo.crawl_pages SET title = $3 WHERE run_id = $1 AND url_id = $2",
        run_id,
        ids["/title-60"],
        SHARED_TITLE,
    )
    url = project_url(workspace, project, "internal-links", "pages")

    issues = await _issue_of(api, url, viewer.headers, "title-duplicate")

    # In byte order the three are /Plans_Old, /pricing and /title-60.
    assert issues == {
        "/Plans_Old": _detail(count=2, target_path="/pricing"),
        "/pricing": _detail(count=2, target_path="/Plans_Old"),
        "/title-60": _detail(count=2, target_path="/Plans_Old"),
    }


async def test_the_csv_of_a_check_has_the_detail_columns(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await audit_site(migrated, workspace, project)
    url = project_url(workspace, project, "internal-links", "pages")

    plain = await api.get(url, params={"format": "csv"}, headers=viewer.headers)
    found = await api.get(
        url, params={"format": "csv", "filter[issue]": "redirect-broken"}, headers=viewer.headers
    )

    assert found.status_code == 200, found.text
    rows = list(csv.reader(io.StringIO(found.text)))
    plain_header = next(csv.reader(io.StringIO(plain.text)))
    assert rows[0] == [
        *plain_header,
        "Found address",
        "Found status",
        "Found count",
        "Found reason",
        "Clicks",
    ]
    assert len(rows) == 2
    assert rows[1][1] == "/dead-end"
    assert rows[1][-5:] == ["/gone", "404", "", "", ""]
    assert found.text.splitlines()[1].endswith("/gone,404,,,")


PAGES_CSV_HEADER = (
    "url,path,title,tier,status_code,indexable,click_depth,linking_pages,linking_pages_all,"
    "outlinks,in_sitemap,top_anchor,flags"
)


async def test_the_csv_without_a_check_is_unchanged(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await audit_site(migrated, workspace, project)
    url = project_url(workspace, project, "internal-links", "pages")

    found = await api.get(
        url, params={"format": "csv", "sort": "path", "q": "services"}, headers=viewer.headers
    )

    assert found.status_code == 200, found.text
    lines = found.text.splitlines()
    assert lines[0] == PAGES_CSV_HEADER
    assert lines[1:] == ["https://example.com/services,/services,Services,,200,True,1,0,0,0,True,,"]
