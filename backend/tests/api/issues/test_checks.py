"""The list of checks: counts, example, summary, states and CSV (spec 5 and 6.1)."""

from __future__ import annotations

import csv
import io
import uuid
from dataclasses import dataclass
from typing import Any

import httpx
import pytest
from sqlalchemy.dialects import postgresql

from idraft.api.issues.catalogue import BY_ID, CHECKS
from idraft.api.issues.service import checks_statement
from idraft.api.resources import Resources
from tests.api.auth.support import execute, fetch, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import seed_crawl
from tests.api.issues.support import EXPECTED, PAGES, audit_site
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer

CROSS_SOURCE = [check.id for check in CHECKS if check.found_by != "crawl"]
SITEMAP_CHECKS = [check.id for check in CHECKS if check.need == "sitemap"]


def _byte_order(paths: list[str]) -> str:
    return min(paths, key=str.encode)


def _paths(severity: str) -> set[str]:
    return {
        path
        for check_id, paths in EXPECTED.items()
        if BY_ID[check_id].severity == severity
        for path in paths
    }


async def _read(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    *,
    prepare: str | None = None,
) -> httpx.Response:
    """The list of checks of the seeded site, as a viewer; `prepare` is run on the crawl first."""
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run_id, _ = await audit_site(migrated, workspace, project)
    if prepare is not None:
        await execute(migrated, prepare, run_id)
    return await api.get(project_url(workspace, project, "issues"), headers=viewer.headers)


def _rows(response: httpx.Response) -> dict[str, dict[str, Any]]:
    assert response.status_code == 200, response.text
    return {row["id"]: row for row in response.json()["data"]}


async def test_each_check_counts_its_pages(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    rows = _rows(await _read(api, resources, migrated))

    for check_id, paths in EXPECTED.items():
        row = rows[check_id]
        assert row["state"] == "ran", check_id
        assert row["reason"] is None, check_id
        assert row["pages"] == len(paths), check_id
        assert row["example_path"] == _byte_order(paths), check_id
        assert row["clicks"] is None, check_id


async def test_the_rows_come_in_catalogue_order(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    response = await _read(api, resources, migrated)

    assert [row["id"] for row in response.json()["data"]] == [check.id for check in CHECKS]
    assert {row["id"]: (row["tab"], row["severity"]) for row in response.json()["data"]} == {
        check.id: (check.tab, check.severity) for check in CHECKS
    }


async def test_the_summary_counts_an_address_once(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    summary = (await _read(api, resources, migrated)).json()["summary"]

    assert summary["pages_with_error"] == len(_paths("error"))
    assert summary["pages_with_warning"] == len(_paths("warning"))
    assert summary["pages_with_notice"] == len(_paths("notice"))
    assert summary["pages_with_issue"] == len(
        _paths("error") | _paths("warning") | _paths("notice")
    )
    assert summary["pages_crawled"] == len(PAGES)
    assert summary["checks_ran"] == len(EXPECTED)
    assert summary["checks_passed"] == 0


async def test_the_other_sources_do_not_run_yet(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    rows = _rows(await _read(api, resources, migrated))

    for check_id in CROSS_SOURCE:
        assert rows[check_id]["state"] == "not_run", check_id
        assert rows[check_id]["reason"] == "not_collected", check_id
        assert rows[check_id]["pages"] is None, check_id
        assert rows[check_id]["clicks"] is None, check_id


@pytest.mark.parametrize("sitemap_pages", ["0", "NULL"])
async def test_sitemap_checks_do_not_run_without_a_sitemap(
    sitemap_pages: str, api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    response = await _read(
        api,
        resources,
        migrated,
        prepare=f"UPDATE seo.crawl_runs SET sitemap_pages = {sitemap_pages} WHERE id = $1",
    )

    rows = _rows(response)
    for check_id in SITEMAP_CHECKS:
        assert rows[check_id]["state"] == "not_run", check_id
        assert rows[check_id]["reason"] == "no_sitemap", check_id
        assert rows[check_id]["pages"] is None, check_id
    # /gone and /blocked-noindex are still counted through status-4xx.
    assert rows["status-4xx"]["pages"] == len(EXPECTED["status-4xx"])
    kept_errors = {
        path
        for check_id, paths in EXPECTED.items()
        if check_id not in SITEMAP_CHECKS and BY_ID[check_id].severity == "error"
        for path in paths
    }
    summary = response.json()["summary"]
    assert summary["pages_with_error"] == len(kept_errors)
    assert summary["checks_ran"] == len(EXPECTED) - len(SITEMAP_CHECKS)


async def test_nofollow_does_not_run_without_links(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    response = await _read(
        api,
        resources,
        migrated,
        prepare="UPDATE seo.crawl_runs SET links_dropped_at = now() WHERE id = $1",
    )

    rows = _rows(response)
    assert rows["nofollow-internal"]["state"] == "not_run"
    assert rows["nofollow-internal"]["reason"] == "links_dropped"
    assert rows["nofollow-internal"]["pages"] is None
    assert response.json()["meta"]["links_available"] is False
    assert response.json()["summary"]["checks_ran"] == len(EXPECTED) - 1


async def test_the_meta_names_the_crawl(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    meta = (await _read(api, resources, migrated)).json()["meta"]

    assert meta["links_available"] is True
    assert meta["crawled_at"] is not None
    assert meta["gsc"] == {"state": "not_connected", "window_start": None, "window_end": None}


async def test_no_crawl_is_404(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)

    response = await api.get(project_url(workspace, project, "issues"), headers=viewer.headers)

    assert problem(response) == (404, "no_crawl")


async def test_another_workspace_sees_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    await audit_site(migrated, workspace, project)
    other = await make_workspace(migrated)
    stranger = await member(resources, migrated, other, "viewer")

    response = await api.get(project_url(other, project, "issues"), headers=stranger.headers)

    assert problem(response) == (404, "not_found")


async def test_csv(api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await audit_site(migrated, workspace, project)

    response = await api.get(
        project_url(workspace, project, "issues"),
        params={"format": "csv"},
        headers=viewer.headers,
    )

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/csv")
    rows = list(csv.reader(io.StringIO(response.text)))
    assert rows[0] == [
        "Tab",
        "Category",
        "Check",
        "Severity",
        "Found by",
        "State",
        "Pages",
        "Clicks",
    ]
    assert len(rows) == 1 + len(CHECKS)
    by_check = {row[2]: row for row in rows[1:]}
    assert by_check["status-4xx"][5:] == ["ran", str(len(EXPECTED["status-4xx"])), ""]
    assert by_check["rank-page-broken"][5:] == ["not_run", "", ""]


@dataclass(frozen=True)
class _Crawl:
    workspace_id: uuid.UUID
    project_id: uuid.UUID
    run_id: uuid.UUID


async def test_every_rule_is_evaluated_once_per_page(migrated: PostgresServer) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    run_id, _ = await audit_site(migrated, workspace, project)
    running = [check for check in CHECKS if check.found_by == "crawl"]
    statement = checks_statement(_Crawl(workspace.id, project, run_id), running)
    # The dialect class has no type hints for its constructor.
    dialect = postgresql.asyncpg.dialect()  # type: ignore[no-untyped-call]
    sql = str(statement.compile(dialect=dialect, compile_kwargs={"literal_binds": True}))

    plan = "\n".join(row[0] for row in await fetch(migrated, f"EXPLAIN {sql}"))

    assert "flags AS MATERIALIZED" in sql
    assert "CTE Scan on flags" in plan, plan


async def test_the_example_path_is_the_first_in_byte_order(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    rows = _rows(await _read(api, resources, migrated))

    # In byte order "/About" is the first of the url-format pages; in an English locale
    # "/aa_x" would come first.
    assert rows["url-format"]["pages"] == len(EXPECTED["url-format"])
    assert rows["url-format"]["example_path"] == "/About"


async def test_run_picks_the_crawl(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    older, _ = await seed_crawl(migrated, workspace, project, [("/", 200), ("/gone", 404)])
    newer, _ = await audit_site(migrated, workspace, project)
    other_project = await keyword_project(migrated, workspace)
    foreign, _ = await seed_crawl(migrated, workspace, other_project, [("/", 200)])
    url = project_url(workspace, project, "issues")

    by_older = await api.get(url, params={"run": str(older)}, headers=viewer.headers)
    by_newer = await api.get(url, params={"run": str(newer)}, headers=viewer.headers)
    latest = await api.get(url, params={"run": "latest"}, headers=viewer.headers)
    by_foreign = await api.get(url, params={"run": str(foreign)}, headers=viewer.headers)

    assert by_older.json()["meta"]["run_id"] == str(older)
    assert by_older.json()["summary"]["pages_crawled"] == 2
    assert _rows(by_older)["status-4xx"]["pages"] == 1
    assert _rows(by_older)["status-4xx"]["example_path"] == "/gone"
    assert latest.json() == by_newer.json()
    assert latest.json()["meta"]["run_id"] == str(newer)
    assert latest.json()["summary"]["pages_crawled"] == len(PAGES)
    assert problem(by_foreign) == (404, "not_found")


async def test_a_crawl_without_pages_passes_every_check(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run_id, _ = await seed_crawl(migrated, workspace, project, [])
    await execute(migrated, "UPDATE seo.crawl_runs SET sitemap_pages = 1 WHERE id = $1", run_id)

    response = await api.get(project_url(workspace, project, "issues"), headers=viewer.headers)

    summary = response.json()["summary"]
    assert summary["pages_crawled"] == 0
    assert summary["pages_with_issue"] == 0
    assert summary["checks_ran"] == len(EXPECTED)
    assert summary["checks_passed"] == len(EXPECTED)
    for check_id in EXPECTED:
        row = _rows(response)[check_id]
        assert row["state"] == "ran", check_id
        assert row["pages"] == 0, check_id
        assert row["example_path"] is None, check_id


async def test_rows_with_missing_values_count_as_crawled_and_are_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    response = await _read(api, resources, migrated)

    found = {path for paths in EXPECTED.values() for path in paths}
    assert "/no-depth" not in found
    assert "/no-status" not in found
    assert response.json()["summary"]["pages_crawled"] == len(PAGES)
    for check_id in ("deep-pages", "noindex", "status-4xx", "status-5xx", "url-format"):
        assert _rows(response)[check_id]["pages"] == len(EXPECTED[check_id]), check_id


async def test_a_page_found_by_an_error_and_a_notice_counts_once(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run_id, ids = await seed_crawl(
        migrated, workspace, project, [("/Bad_Page", 200), ("/fine", 200), ("/gone", 404)]
    )
    await execute(
        migrated,
        "UPDATE seo.crawl_pages SET title = 'A page title of exactly forty characters' "
        "WHERE run_id = $1 AND url_id = $2",
        run_id,
        ids["/Bad_Page"],
    )
    await execute(
        migrated,
        "UPDATE seo.crawl_pages SET title = 'Another page title of about forty chars' "
        "WHERE run_id = $1 AND url_id = $2",
        run_id,
        ids["/fine"],
    )
    # /Bad_Page: broken-internal-links (error) and url-format (notice). /gone: status-4xx (error).
    # /fine: nothing. There is no sitemap, so the sitemap checks do not run.
    await execute(
        migrated,
        "UPDATE seo.crawl_pages SET broken_outlinks = 1 WHERE run_id = $1 AND url_id = $2",
        run_id,
        ids["/Bad_Page"],
    )

    response = await api.get(project_url(workspace, project, "issues"), headers=viewer.headers)

    summary = response.json()["summary"]
    assert summary["pages_crawled"] == 3
    assert summary["pages_with_error"] == 2
    assert summary["pages_with_warning"] == 0
    assert summary["pages_with_notice"] == 1
    assert summary["pages_with_issue"] == 2
    rows = _rows(response)
    assert rows["broken-internal-links"]["example_path"] == "/Bad_Page"
    assert rows["url-format"]["example_path"] == "/Bad_Page"
    assert rows["status-4xx"]["example_path"] == "/gone"
