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

    async def stored_day(
        self, integration: uuid.UUID, path: str, clicks: int, *, days_ago: int = 3
    ) -> None:
        """One stored day of clicks of a page of this project under `integration`."""
        await execute(
            self.pg,
            "INSERT INTO fp.gsc_page_daily (integration_id, metric_date, url_id, "
            "workspace_id, project_id, clicks, impressions) VALUES ($1, $2, $3, $4, $5, $6, 10)",
            integration,
            date.today() - timedelta(days=days_ago),
            self.ids[path],
            self.workspace.id,
            self.project,
            clicks,
        )

    async def page_days(self, clicks_by_path: dict[str, int]) -> uuid.UUID:
        """A property with a window and one stored day of clicks per page."""
        integration = await gsc_property(
            self.pg, self.workspace, self.project, f"sc-domain:{self.project}.example.com"
        )
        for path, clicks in clicks_by_path.items():
            await self.stored_day(integration, path, clicks)
        return integration

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

    async def other_device(
        self, text: str, *, target: str | None, ranks_with: str | None, rank: int
    ) -> None:
        """A mobile row of the keyword `text`, which `keyword` made as a desktop row."""
        await execute(
            self.pg,
            "WITH t AS (INSERT INTO seo.tracked_keywords (workspace_id, project_id, keyword_id, "
            "location_id, language_code, device, target_url_id) "
            "SELECT tk.workspace_id, tk.project_id, tk.keyword_id, tk.location_id, "
            "tk.language_code, 'mobile', $3::bigint FROM seo.tracked_keywords tk "
            "JOIN seo.keywords k ON k.id = tk.keyword_id "
            "WHERE tk.project_id = $1 AND k.text = $2 AND tk.device = 'desktop' "
            "RETURNING id, workspace_id, project_id) "
            "INSERT INTO seo.tracked_keyword_state (tracked_keyword_id, workspace_id, project_id, "
            "current_rank, current_url_id, last_observed_at) "
            "SELECT id, workspace_id, project_id, $4::smallint, $5::bigint, now() FROM t",
            self.project,
            text,
            None if target is None else self.ids[target],
            rank,
            None if ranks_with is None else self.ids[ranks_with],
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

    walked: list[str] = []
    cursor: str | None = None
    while True:
        response = await site.pages(params if cursor is None else {**params, "cursor": cursor})
        assert response.status_code == 200, response.text
        walked += [row["path"] for row in response.json()["data"]]
        cursor = response.json()["page"]["next_cursor"]
        if cursor is None:
            break
        assert len(walked) < len(EXPECTED["redirect-pages"]), walked

    # Clicks come first, most first; pages with the same clicks follow by URL id, highest first.
    quiet = set(EXPECTED["redirect-pages"]) - {"/old", "/older"}
    assert walked == [
        "/older",
        "/old",
        *sorted(quiet, key=lambda path: site.ids[path], reverse=True),
    ]


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


def _count(count: int) -> dict[str, object]:
    return {"target_path": None, "target_status": None, "count": count, "reason": None}


async def test_a_stored_day_with_no_clicks_finds_no_page(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(api, resources, migrated)
    await site.page_days({"/gone": 0})

    row = (await site.rows())["clicks-page-broken"]

    assert (row["state"], row["pages"], row["clicks"]) == ("ran", 0, 0)
    assert await site.found("clicks-page-broken") == {}


async def test_days_outside_the_window_and_of_another_property_do_not_count(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(api, resources, migrated)
    integration = await site.page_days({"/lost": 7})
    # 40 days ago is before the 28 days of the window.
    await site.stored_day(integration, "/gone", 50, days_ago=40)
    other = await gsc_property(
        migrated,
        site.workspace,
        await keyword_project(migrated, site.workspace),
        "sc-domain:other.example.com",
    )
    await site.stored_day(other, "/error", 60)

    rows = await site.rows()

    assert rows["clicks-page-orphan"]["pages"] == 1
    assert rows["clicks-page-broken"]["pages"] == 0
    assert rows["status-4xx"]["clicks"] == 0
    assert rows["status-5xx"]["clicks"] == 0
    assert await site.found("clicks-page-broken") == {}


async def test_two_tracked_rows_of_one_keyword_count_once(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(api, resources, migrated)
    await site.keyword("twin keyword", target=None, ranks_with="/gone", rank=3)
    await site.other_device("twin keyword", target=None, ranks_with="/gone", rank=9)

    rows = await site.rows()

    assert rows["rank-page-broken"]["pages"] == 1
    assert await site.found("rank-page-broken") == {"/gone": _count(1)}


async def test_off_target_reads_the_best_ranking_row_of_a_keyword(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(api, resources, migrated)
    # The desktop row (rank 3) is on its target; the mobile row (rank 9) ranks elsewhere.
    await site.keyword("steady keyword", target="/pricing", ranks_with="/pricing", rank=3)
    await site.other_device("steady keyword", target="/pricing", ranks_with="/services", rank=9)
    # The desktop row (rank 3) ranks elsewhere; the mobile row (rank 9) is on its target.
    await site.keyword("drifting keyword", target="/lost", ranks_with="/services", rank=3)
    await site.other_device("drifting keyword", target="/lost", ranks_with="/lost", rank=9)
    # The same rank on both rows: the row made first (the lower id) decides, and it is on target.
    await site.keyword("tied keyword", target="/title-60", ranks_with="/title-60", rank=4)
    await site.other_device("tied keyword", target="/title-60", ranks_with="/services", rank=4)

    rows = await site.rows()

    assert rows["off-target"]["pages"] == 1
    assert await site.found("off-target") == {"/lost": _count(1)}


async def test_a_keyword_that_ranks_with_its_target_is_not_off_target(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(api, resources, migrated)
    await site.keyword("on target", target="/pricing", ranks_with="/pricing", rank=2)

    row = (await site.rows())["off-target"]

    assert (row["state"], row["pages"]) == ("ran", 0)
    assert await site.found("off-target") == {}


async def test_a_citation_of_another_domain_does_not_count(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(api, resources, migrated)
    await site.citation("/old", 1)
    await execute(
        migrated,
        "UPDATE ai.citations SET domain_role = 'competitor' WHERE url_id = $1",
        site.ids["/old"],
    )

    row = (await site.rows())["cited-page-broken"]

    assert (row["state"], row["pages"]) == ("ran", 0)
    assert await site.found("cited-page-broken") == {}


async def test_a_rank_without_a_check_date_is_not_collected(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(api, resources, migrated)
    await site.keyword("unchecked keyword", target=None, ranks_with="/gone", rank=3)
    await execute(
        migrated,
        "UPDATE seo.tracked_keyword_state st SET last_observed_at = NULL "
        "FROM seo.tracked_keywords tk WHERE st.tracked_keyword_id = tk.id AND tk.project_id = $1",
        site.project,
    )

    rows = await site.rows()

    for check_id in RANK_CHECKS:
        assert (rows[check_id]["state"], rows[check_id]["reason"]) == ("not_run", "not_collected")


async def test_the_pages_of_a_check_that_did_not_run_are_empty(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(api, resources, migrated)

    listed = await site.pages({"filter[issue]": "clicks-page-broken", "include": "issue"})
    exported = await site.pages({"filter[issue]": "clicks-page-broken", "format": "csv"})

    assert listed.status_code == 200, listed.text
    assert listed.json()["data"] == []
    assert listed.json()["meta"]["total"] == 0
    assert exported.status_code == 200, exported.text
    rows = list(csv.reader(io.StringIO(exported.text)))
    assert len(rows) == 1
    assert rows[0][-5:] == [
        "Found address",
        "Found status",
        "Found count",
        "Found reason",
        "Clicks",
    ]


async def test_a_second_project_of_the_workspace_does_not_leak(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(api, resources, migrated)
    await site.page_days({"/gone": 40, "/lost": 7})
    await site.keyword("gone keyword", target="/pricing", ranks_with="/gone", rank=3)
    await site.citation("/old", 1)
    source_checks = (*GSC_CHECKS, *RANK_CHECKS, "cited-page-broken")

    async def read(of: Site) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
        return await of.rows(), {check_id: await of.found(check_id) for check_id in source_checks}

    before = await read(site)
    project = await keyword_project(migrated, site.workspace)
    run_id, ids = await audit_site(migrated, site.workspace, project)
    other = Site(api, migrated, site.workspace, site.headers, project, run_id, ids)
    await other.page_days({"/gone": 99})
    await other.keyword("other keyword", target="/services", ranks_with="/dead-end", rank=4)
    await other.citation("/old", 1)

    after = await read(site)
    theirs_rows, theirs_found = await read(other)

    assert after == before
    assert theirs_rows["clicks-page-broken"]["clicks"] == 99
    assert theirs_found["rank-page-broken"] == {"/dead-end": _count(1)}
    assert theirs_found["off-target"] == {"/services": _count(1)}
    assert theirs_found["cited-page-broken"] == {"/old": _count(1)}
