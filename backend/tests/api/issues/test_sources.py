"""The checks that join Search Console, rank checks and AI answers, and the clicks numbers
(spec sections 4, 5 and 6)."""

from __future__ import annotations

import csv
import io
import uuid
from datetime import date, timedelta
from typing import Any

import httpx

from idraft.api.issues.catalogue import BY_ID, CHECKS
from idraft.api.resources import Resources
from tests.api.auth.support import Workspace, execute, make_workspace
from tests.api.entities.support import member
from tests.api.internal_links.support_changes import gsc_property, insert_citation, track_keyword
from tests.api.issues.support import EXPECTED, audit_site
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer

GSC_CHECKS = ("clicks-page-broken", "clicks-page-orphan")
RANK_CHECKS = ("rank-page-broken", "off-target")


class Site:
    """The seeded crawl with a viewer, and the calls the tests make on it."""

    def __init__(
        self,
        api: httpx.AsyncClient,
        pg: PostgresServer,
        workspace: Workspace,
        viewer_headers: dict[str, str],
        project: uuid.UUID,
        run_id: uuid.UUID,
        ids: dict[str, int],
    ) -> None:
        self.api = api
        self.pg = pg
        self.workspace = workspace
        self.headers = viewer_headers
        self.project = project
        self.run_id = run_id
        self.ids = ids

    async def issues(self, **params: str) -> httpx.Response:
        url = project_url(self.workspace, self.project, "issues")
        return await self.api.get(url, params=params, headers=self.headers)

    async def rows(self) -> dict[str, dict[str, Any]]:
        response = await self.issues()
        assert response.status_code == 200, response.text
        return {row["id"]: row for row in response.json()["data"]}

    async def pages(self, params: dict[str, str | int]) -> httpx.Response:
        url = project_url(self.workspace, self.project, "internal-links", "pages")
        return await self.api.get(url, params=params, headers=self.headers)

    async def found(self, check_id: str) -> dict[str, dict[str, Any] | None]:
        """The paths a check found, with the detail of each."""
        response = await self.pages(
            {"filter[issue]": check_id, "include": "issue", "sort": "path", "limit": 200}
        )
        assert response.status_code == 200, response.text
        return {row["path"]: row["extras"]["issue"] for row in response.json()["data"]}

    async def page_days(self, clicks_by_path: dict[str, int]) -> None:
        """A property with a window and one stored day of clicks per page."""
        integration = await gsc_property(self.pg, self.workspace, self.project)
        for path, clicks in clicks_by_path.items():
            await execute(
                self.pg,
                "INSERT INTO fp.gsc_page_daily (integration_id, metric_date, url_id, "
                "workspace_id, project_id, clicks, impressions) "
                "VALUES ($1, $2, $3, $4, $5, $6, 10)",
                integration,
                date.today() - timedelta(days=3),
                self.ids[path],
                self.workspace.id,
                self.project,
                clicks,
            )

    async def keyword(
        self,
        text: str,
        *,
        target: str | None,
        ranks_with: str | None,
        rank: int | None,
        active: bool = True,
        deleted: bool = False,
    ) -> None:
        """A tracked keyword, checked now, that ranks `rank` with the page `ranks_with`."""
        await track_keyword(
            self.pg,
            self.workspace,
            self.project,
            text,
            None if target is None else self.ids[target],
            rank=rank,
            change=None,
            volume=None,
        )
        await execute(
            self.pg,
            "UPDATE seo.tracked_keyword_state st SET current_url_id = $3, last_observed_at = now() "
            "FROM seo.tracked_keywords tk JOIN seo.keywords k ON k.id = tk.keyword_id "
            "WHERE st.tracked_keyword_id = tk.id AND tk.project_id = $1 AND k.text = $2",
            self.project,
            text,
            None if ranks_with is None else self.ids[ranks_with],
        )
        await execute(
            self.pg,
            "UPDATE seo.tracked_keywords tk SET is_active = $3, "
            "deleted_at = CASE WHEN $4 THEN now() END FROM seo.keywords k "
            "WHERE k.id = tk.keyword_id AND tk.project_id = $1 AND k.text = $2",
            self.project,
            text,
            active,
            deleted,
        )

    async def citation(self, path: str, days_ago: int) -> None:
        await insert_citation(
            self.pg, self.workspace, self.project, self.ids[path], "chatgpt_web", days_ago
        )


async def _site(api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer) -> Site:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run_id, ids = await audit_site(migrated, workspace, project)
    return Site(api, migrated, workspace, viewer.headers, project, run_id, ids)


async def test_without_a_property_the_clicks_checks_do_not_run(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(api, resources, migrated)

    response = await site.issues()
    rows = await site.rows()

    assert response.json()["meta"]["gsc"] == {
        "state": "not_connected",
        "window_start": None,
        "window_end": None,
    }
    for check_id in GSC_CHECKS:
        assert rows[check_id]["state"] == "not_run", check_id
        assert rows[check_id]["reason"] == "source_not_connected", check_id
        assert rows[check_id]["pages"] is None, check_id
    assert {row["clicks"] for row in rows.values()} == {None}


async def test_a_property_without_a_stored_page_day_is_pending(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(api, resources, migrated)
    await gsc_property(migrated, site.workspace, site.project)

    response = await site.issues()
    rows = await site.rows()

    assert response.json()["meta"]["gsc"]["state"] == "pending"
    for check_id in GSC_CHECKS:
        assert rows[check_id]["state"] == "not_run", check_id
        assert rows[check_id]["reason"] == "not_collected", check_id
    assert {row["clicks"] for row in rows.values()} == {None}


async def test_clicks_come_from_the_stored_days_of_the_pages_a_check_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(api, resources, migrated)
    await site.page_days({"/gone": 40, "/lost": 7, "/services": 5})

    response = await site.issues()
    rows = await site.rows()

    gsc = response.json()["meta"]["gsc"]
    assert gsc["state"] == "ok"
    assert gsc["window_start"] is not None
    assert gsc["window_end"] is not None
    assert rows["clicks-page-broken"]["pages"] == 1
    assert rows["clicks-page-broken"]["example_path"] == "/gone"
    assert rows["clicks-page-orphan"]["pages"] == 1
    assert rows["clicks-page-orphan"]["example_path"] == "/lost"
    assert rows["clicks-page-broken"]["clicks"] == 40
    assert rows["clicks-page-orphan"]["clicks"] == 7
    assert rows["status-4xx"]["clicks"] == 40
    assert rows["broken-internal-links"]["clicks"] == 5
    assert rows["title-short"]["clicks"] == 5
    assert rows["status-5xx"]["clicks"] == 0
    assert await site.found("clicks-page-broken") == {
        "/gone": {"target_path": None, "target_status": None, "count": None, "reason": None}
    }


async def test_a_check_that_found_nothing_has_zero_clicks(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(api, resources, migrated)
    await site.page_days({"/gone": 40, "/lost": 7})
    await execute(
        migrated,
        "UPDATE seo.crawl_pages SET is_orphan = false WHERE run_id = $1 AND url_id = $2",
        site.run_id,
        site.ids["/lost"],
    )

    rows = await site.rows()

    assert rows["clicks-page-orphan"]["state"] == "ran"
    assert rows["clicks-page-orphan"]["pages"] == 0
    assert rows["clicks-page-orphan"]["clicks"] == 0
    assert rows["clicks-page-orphan"]["example_path"] is None


async def test_the_csv_carries_the_clicks(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(api, resources, migrated)
    await site.page_days({"/gone": 40})
    url = project_url(site.workspace, site.project, "issues")
    pages = project_url(site.workspace, site.project, "internal-links", "pages")

    listed = await api.get(url, params={"format": "csv"}, headers=site.headers)
    found = await api.get(
        pages,
        params={"format": "csv", "filter[issue]": "clicks-page-broken"},
        headers=site.headers,
    )

    by_check = {row[2]: row for row in csv.reader(io.StringIO(listed.text))}
    assert by_check["status-4xx"][7] == "40"
    assert by_check["rank-page-broken"][7:] == [""]
    rows = list(csv.reader(io.StringIO(found.text)))
    assert [(row[1], row[-1]) for row in rows[1:]] == [("/gone", "40")]


async def test_the_pages_of_a_check_sorted_by_clicks_still_page(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(api, resources, migrated)
    await site.page_days({"/old": 3, "/older": 9})
    params: dict[str, str | int] = {
        "filter[issue]": "redirect-pages",
        "sort": "-clicks",
        "include": "gsc",
        "limit": 2,
    }

    first = await site.pages(params)
    second = await site.pages({**params, "cursor": first.json()["page"]["next_cursor"]})

    assert [row["path"] for row in first.json()["data"]] == ["/older", "/old"]
    assert second.status_code == 200, second.text
    assert len(second.json()["data"]) == 2
    paths = {row["path"] for row in first.json()["data"] + second.json()["data"]}
    assert len(paths) == 4
    assert paths <= set(EXPECTED["redirect-pages"])


async def test_without_a_tracked_keyword_the_rank_checks_do_not_run(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(api, resources, migrated)

    rows = await site.rows()

    for check_id in RANK_CHECKS:
        assert rows[check_id]["state"] == "not_run", check_id
        assert rows[check_id]["reason"] == "not_collected", check_id
        assert rows[check_id]["pages"] is None, check_id


async def test_rank_checks_read_active_keywords_that_have_a_rank(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(api, resources, migrated)
    await site.keyword("gone keyword", target=None, ranks_with="/gone", rank=3)
    await site.keyword("plans keyword", target="/pricing", ranks_with="/services", rank=5)
    # Without a rank, deleted, or inactive: none of these finds a page.
    await site.keyword("unranked keyword", target="/gone", ranks_with="/services", rank=None)
    await site.keyword("deleted keyword", target=None, ranks_with="/dead-end", rank=2, deleted=True)
    await site.keyword("inactive keyword", target=None, ranks_with="/error", rank=2, active=False)

    rows = await site.rows()

    assert rows["rank-page-broken"]["state"] == "ran"
    assert rows["rank-page-broken"]["pages"] == 1
    assert rows["off-target"]["pages"] == 1
    assert await site.found("rank-page-broken") == {
        "/gone": {"target_path": None, "target_status": None, "count": 1, "reason": None}
    }
    assert await site.found("off-target") == {
        "/pricing": {"target_path": None, "target_status": None, "count": 1, "reason": None}
    }


async def test_without_an_answer_the_ai_check_does_not_run(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(api, resources, migrated)

    row = (await site.rows())["cited-page-broken"]

    assert (row["state"], row["reason"], row["pages"]) == ("not_run", "not_collected", None)


async def test_the_ai_check_reads_own_citations_of_the_last_28_days(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(api, resources, migrated)
    await site.citation("/old", 1)
    await site.citation("/old", 2)
    # Too old, and an answer that was superseded: neither counts.
    await site.citation("/gone", 40)
    await site.citation("/error", 1)
    await execute(
        migrated,
        "UPDATE ai.observations o SET superseded_by = o.id + 1 FROM ai.citations c "
        "WHERE c.observation_id = o.id AND c.observed_at = o.observed_at AND c.url_id = $1",
        site.ids["/error"],
    )

    row = (await site.rows())["cited-page-broken"]

    assert row["state"] == "ran"
    assert row["pages"] == 1
    assert row["example_path"] == "/old"
    assert await site.found("cited-page-broken") == {
        "/old": {"target_path": None, "target_status": None, "count": 2, "reason": None}
    }


async def test_with_every_source_all_checks_run_and_a_page_counts_once(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(api, resources, migrated)
    await site.page_days({"/gone": 40, "/lost": 7})
    await site.keyword("gone keyword", target="/pricing", ranks_with="/gone", rank=3)
    await site.citation("/old", 1)
    # /gone is found by status-4xx, sitemap-broken, clicks-page-broken and rank-page-broken;
    # /old moves from the warning and notice checks to the error ones; /pricing is off target.
    found = {
        **EXPECTED,
        "clicks-page-broken": ["/gone"],
        "clicks-page-orphan": ["/lost"],
        "rank-page-broken": ["/gone"],
        "off-target": ["/pricing"],
        "cited-page-broken": ["/old"],
    }

    response = await site.issues()

    def paths(severity: str) -> set[str]:
        return {
            path
            for check_id, found_paths in found.items()
            if BY_ID[check_id].severity == severity
            for path in found_paths
        }

    summary = response.json()["summary"]
    assert summary["checks_ran"] == len(CHECKS)
    assert summary["pages_with_error"] == len(paths("error"))
    assert summary["pages_with_warning"] == len(paths("warning"))
    assert summary["pages_with_notice"] == len(paths("notice"))
    assert summary["pages_with_issue"] == len(paths("error") | paths("warning") | paths("notice"))
    rows = await site.rows()
    assert rows["off-target"]["pages"] == 1
    assert rows["off-target"]["clicks"] == 0
