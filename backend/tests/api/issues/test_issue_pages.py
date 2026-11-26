"""What a check found on each page: `include=issue` and the CSV columns (spec 4 and 6.2)."""

from __future__ import annotations

import csv
import io

import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.auth.support import execute, make_workspace
from tests.api.entities.support import member, problem
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
    ("redirect-pages", "/redir-null", NONE),
    ("redirect-pages", "/redir-away", _detail(target_path="/off-crawl")),
    ("canonical-elsewhere", "/canon-nostatus", _detail(target_path="/no-status")),
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
    ("nofollow-internal", "/Plans_Old", _detail(count=2)),
    ("title-duplicate", "/pricing", _detail(count=1, target_path="/Plans_Old")),
    ("title-duplicate", "/Plans_Old", _detail(count=1, target_path="/pricing")),
    # Byte order is /Zulu-dup, /alpha-dup, /mike-dup (a locale order would end with /Zulu-dup).
    ("title-duplicate", "/Zulu-dup", _detail(count=2, target_path="/alpha-dup")),
    ("title-duplicate", "/alpha-dup", _detail(count=2, target_path="/Zulu-dup")),
    ("title-duplicate", "/mike-dup", _detail(count=2, target_path="/Zulu-dup")),
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

    # Three pages share the title: each names the first of the other two by path.
    assert {path: issues[path] for path in ("/Plans_Old", "/pricing", "/title-60")} == {
        "/Plans_Old": _detail(count=2, target_path="/pricing"),
        "/pricing": _detail(count=2, target_path="/Plans_Old"),
        "/title-60": _detail(count=2, target_path="/Plans_Old"),
    }


def _csv_cells(text: str) -> dict[str, list[str]]:
    """The five detail cells of each row of a check's CSV, by path."""
    return {row[1]: row[-5:] for row in list(csv.reader(io.StringIO(text)))[1:]}


async def _csv_of(
    api: httpx.AsyncClient, url: str, headers: dict[str, str], check_id: str
) -> httpx.Response:
    return await api.get(url, params={"format": "csv", "filter[issue]": check_id}, headers=headers)


@pytest.mark.parametrize("chunk", [None, 2])
async def test_the_csv_of_duplicate_titles_keeps_each_rows_cells(
    chunk: int | None,
    monkeypatch: pytest.MonkeyPatch,
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    if chunk is not None:
        monkeypatch.setattr("idraft.api.issues.details._CHUNK", chunk)
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await audit_site(migrated, workspace, project)
    url = project_url(workspace, project, "internal-links", "pages")

    found = await _csv_of(api, url, viewer.headers, "title-duplicate")

    assert found.status_code == 200, found.text
    assert _csv_cells(found.text) == {
        "/Plans_Old": ["/pricing", "", "1", "", ""],
        "/pricing": ["/Plans_Old", "", "1", "", ""],
        "/Zulu-dup": ["/alpha-dup", "", "2", "", ""],
        "/alpha-dup": ["/Zulu-dup", "", "2", "", ""],
        "/mike-dup": ["/Zulu-dup", "", "2", "", ""],
    }


async def test_the_csv_of_long_titles_has_the_count(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await audit_site(migrated, workspace, project)
    url = project_url(workspace, project, "internal-links", "pages")

    long_titles = await _csv_of(api, url, viewer.headers, "title-long")
    noindex = await _csv_of(api, url, viewer.headers, "noindex")

    assert _csv_cells(long_titles.text) == {"/long-title": ["", "", "70", "", ""]}
    assert _csv_cells(noindex.text) == {"/hidden": ["", "", "", "meta_tag", ""]}


async def test_the_csv_of_nofollow_on_a_crawl_without_links_is_410(
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

    found = await _csv_of(api, url, viewer.headers, "nofollow-internal")

    assert problem(found) == (410, "links_dropped")


async def test_the_issue_of_another_workspaces_project_is_404(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    await audit_site(migrated, workspace, project)
    other = await make_workspace(migrated)
    stranger = await member(resources, migrated, other, "viewer")
    url = project_url(other, project, "internal-links", "pages")

    found = await api.get(
        url,
        params={"filter[issue]": "redirect-pages", "include": "issue"},
        headers=stranger.headers,
    )

    assert problem(found) == (404, "not_found")


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
