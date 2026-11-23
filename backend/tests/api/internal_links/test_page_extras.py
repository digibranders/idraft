"""Rank, citations, anchors, Search Console and change columns of the Pages tab, the new flag
and worklists (plan 04 Task 11, decisions D7 to D10)."""

from __future__ import annotations

import time
import uuid
from datetime import date, timedelta

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.resources import Resources
from idraft.collectors.crawl_enrich import CrawlEnrichTask, enrich_run
from tests.api.auth.support import Workspace, execute, fetchrow, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import SeedLink, seed_crawl, seed_tiers, set_counts
from tests.api.internal_links.support_changes import (
    PAGES,
    gsc_property,
    insert_citation,
    track_keyword,
    two_crawls,
)
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer

type Sessions = async_sessionmaker[AsyncSession]


async def _setup(
    pg: PostgresServer, sessions: Sessions
) -> tuple[Workspace, uuid.UUID, uuid.UUID, dict[str, int], list[uuid.UUID]]:
    workspace = await make_workspace(pg)
    project = await keyword_project(pg, workspace)
    _, newer, ids, tiers = await two_crawls(pg, workspace, project)
    await enrich_run(
        sessions,
        None,
        CrawlEnrichTask(workspace_id=workspace.id, run_id=newer),
        deadline=time.monotonic() + 120,
    )
    return workspace, project, newer, ids, tiers


async def test_extras_are_absent_unless_asked_for(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, _, _, _ = await _setup(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await api.get(
        project_url(workspace, project, "internal-links", "pages"), headers=viewer.headers
    )

    assert {row["extras"] for row in response.json()["data"]} == {None}


async def test_change_and_anchor_columns_follow_the_stored_changes_and_counts(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, _, ids, _ = await _setup(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await api.get(
        project_url(workspace, project, "internal-links", "pages"),
        params={"include": "changes,anchors"},
        headers=viewer.headers,
    )

    rows = {row["path"]: row for row in response.json()["data"]}
    assert rows["/pricing"]["extras"]["change"]["editorial_in_delta"] == -2
    # A page that did not change is a zero, not "no data": the run has an earlier crawl.
    assert rows["/blog"]["extras"]["change"] == {
        "is_new": False,
        "editorial_in_delta": 0,
        "equity_points": 0.0,
        "depth_state": None,
        "depth_delta": 0,
    }
    anchors = rows["/blog/b"]["extras"]["anchors"]
    assert (anchors["total"], anchors["distinct"], anchors["generic"]) == (2, 2, 1)
    assert anchors["matches_keyword"] is None
    assert str(ids["/pricing"]) == rows["/pricing"]["url_id"]


async def _utc_day(pg: PostgresServer, days_ago: int) -> str:
    row = await fetchrow(
        pg,
        "SELECT ((now() AT TIME ZONE 'UTC') - make_interval(days => $1))::date::text AS day",
        days_ago,
    )
    return str(row["day"])


async def test_tracked_keywords_rank_and_volume_come_from_the_keyword_tables(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, _, ids, _ = await _setup(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")
    page = ids["/pricing"]
    await track_keyword(
        migrated, workspace, project, "pricing plans", page, rank=4, change=2, volume=2900
    )
    await track_keyword(
        migrated, workspace, project, "soc cost", page, rank=None, change=None, volume=700
    )
    # Only the ranked keyword was checked, three days ago; the other was never checked.
    await execute(
        migrated,
        "UPDATE seo.tracked_keyword_state SET last_observed_at = now() - interval '3 days' "
        "WHERE project_id = $1 AND current_rank IS NOT NULL",
        project,
    )
    as_of = await _utc_day(migrated, 3)

    response = await api.get(
        project_url(workspace, project, "internal-links", "pages"),
        params={"include": "keywords"},
        headers=viewer.headers,
    )

    keywords = {row["path"]: row for row in response.json()["data"]}["/pricing"]["extras"][
        "keywords"
    ]
    assert keywords == {
        "tracked": 2,
        "ranking": 1,
        "average_rank": 4.0,
        "best_volume": 2900,
        "rank_as_of": as_of,
    }
    detail = await api.get(
        project_url(workspace, project, "internal-links", "pages", ids["/pricing"]),
        headers=viewer.headers,
    )
    rows = detail.json()["data"]["extras"]["keywords"]
    assert {
        (row["keyword"], row["rank"], row["change"], row["volume"], row["rank_as_of"])
        for row in rows
    } == {("pricing plans", 4, 2, 2900, as_of), ("soc cost", None, None, 700, None)}


async def test_a_keyword_tracked_on_two_devices_counts_once_with_its_best_rank(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, _, ids, _ = await _setup(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")
    await track_keyword(
        migrated, workspace, project, "pricing plans", ids["/pricing"], rank=9, change=0, volume=10
    )
    await execute(
        migrated,
        "INSERT INTO seo.tracked_keywords (workspace_id, project_id, keyword_id, location_id, "
        "language_code, device, target_url_id) SELECT workspace_id, project_id, keyword_id, "
        "location_id, language_code, 'mobile', target_url_id FROM seo.tracked_keywords "
        "WHERE project_id = $1",
        project,
    )
    await execute(
        migrated,
        "INSERT INTO seo.tracked_keyword_state (tracked_keyword_id, workspace_id, project_id, "
        "current_rank, rank_change) SELECT id, workspace_id, project_id, 3, 1 "
        "FROM seo.tracked_keywords WHERE project_id = $1 AND device = 'mobile'",
        project,
    )

    detail = await api.get(
        project_url(workspace, project, "internal-links", "pages", ids["/pricing"]),
        headers=viewer.headers,
    )

    rows = detail.json()["data"]["extras"]["keywords"]
    assert [(row["keyword"], row["rank"]) for row in rows] == [("pricing plans", 3)]


async def test_a_keyword_without_a_target_belongs_to_the_page_it_ranks_with(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, _, ids, _ = await _setup(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")
    await track_keyword(
        migrated, workspace, project, "blog tips", None, rank=6, change=-1, volume=None
    )
    await execute(
        migrated,
        "UPDATE seo.tracked_keyword_state SET current_url_id = $1 WHERE project_id = $2",
        ids["/blog"],
        project,
    )

    response = await api.get(
        project_url(workspace, project, "internal-links", "pages"),
        params={"include": "keywords"},
        headers=viewer.headers,
    )

    rows = {row["path"]: row for row in response.json()["data"]}
    assert rows["/blog"]["extras"]["keywords"]["tracked"] == 1
    assert rows["/pricing"]["extras"]["keywords"]["tracked"] == 0


async def test_ai_citations_count_answers_of_the_last_28_days_per_engine(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, _, ids, _ = await _setup(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")
    # Two answers of ChatGPT and one of Gemini cite /pricing; one of 40 days ago does not count.
    for engine, days_ago in (
        ("chatgpt_web", 1),
        ("chatgpt_web", 2),
        ("gemini_web", 3),
        ("google_ai_mode", 40),
    ):
        await insert_citation(migrated, workspace, project, ids["/pricing"], engine, days_ago)

    response = await api.get(
        project_url(workspace, project, "internal-links", "pages"),
        params={"include": "citations"},
        headers=viewer.headers,
    )

    citations = {row["path"]: row for row in response.json()["data"]}["/pricing"]["extras"][
        "citations"
    ]
    # The newest answer of the project (the ChatGPT one of yesterday) dates the counts.
    assert citations == {
        "chatgpt": 2,
        "gemini": 1,
        "ai_mode": 0,
        "total": 3,
        "citations_as_of": await _utc_day(migrated, 1),
    }
    # A page nobody cites still says how old the numbers are.
    other = {row["path"]: row for row in response.json()["data"]}["/blog"]["extras"]["citations"]
    assert other["total"] == 0
    assert other["citations_as_of"] == await _utc_day(migrated, 1)


async def test_search_console_is_not_connected_without_a_property(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, _, _, _ = await _setup(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await api.get(
        project_url(workspace, project, "internal-links", "pages"),
        params={"include": "gsc"},
        headers=viewer.headers,
    )

    gsc = response.json()["data"][0]["extras"]["gsc"]
    assert gsc["state"] == "not_connected"
    assert gsc["clicks"] is None


async def test_the_generic_anchor_flag_and_the_lost_link_and_weak_outlink_worklists(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, _, ids, tiers = await _setup(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")
    base = project_url(workspace, project, "internal-links", "pages")
    # /blog/b has two editorial anchors and one is generic: not more than half, so no flag.
    plain = await api.get(base, params={"filter[flags]": "generic_anchors"}, headers=viewer.headers)
    await execute(
        migrated,
        "UPDATE seo.crawl_pages SET generic_anchors = 2 WHERE url_id = $1",
        ids["/blog/b"],
    )
    flags = {"filter[flags]": "generic_anchors"}
    flagged = await api.get(base, params=flags, headers=viewer.headers)
    worklist = {"filter[worklist]": "lost_links_top"}
    lost = await api.get(base, params=worklist, headers=viewer.headers)

    assert plain.json()["data"] == []
    assert [row["path"] for row in flagged.json()["data"]] == ["/blog/b"]
    assert "generic_anchors" in flagged.json()["data"][0]["flags"]
    assert [row["path"] for row in lost.json()["data"]] == ["/pricing"]
    counts = await api.get(
        project_url(workspace, project, "internal-links", "worklists"), headers=viewer.headers
    )
    assert counts.json()["data"]["lost_links_top"] == 1
    assert counts.json()["data"]["weak_outlinks"] == 0
    assert tiers


async def test_a_t1_page_that_mostly_links_to_weak_targets_is_a_weak_outlinks_page(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    tiers = await seed_tiers(migrated, workspace)
    links = [SeedLink("/pricing", target, "content", "more") for target in ("/blog", "/blog/a")]
    links.append(SeedLink("/pricing", "/blog/b", "content", "more"))
    links.append(SeedLink("/", "/pricing", "content", "plans"))
    run, ids = await seed_crawl(migrated, workspace, project, PAGES, links)
    await set_counts(migrated, run)
    await execute(
        migrated,
        "INSERT INTO core.project_pages (project_id, url_id, workspace_id, tier_id, "
        "tier_source) VALUES ($1, $2, $3, $4, 'manual')",
        project,
        ids["/pricing"],
        workspace.id,
        tiers[0],
    )
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await api.get(
        project_url(workspace, project, "internal-links", "pages"),
        params={"filter[worklist]": "weak_outlinks"},
        headers=viewer.headers,
    )

    assert [row["path"] for row in response.json()["data"]] == ["/pricing"]


async def test_pages_sort_by_the_change_in_editorial_links(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, _, _, _ = await _setup(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await api.get(
        project_url(workspace, project, "internal-links", "pages"),
        params={"sort": "change", "limit": 2},
        headers=viewer.headers,
    )

    assert response.json()["data"][0]["path"] == "/pricing"


async def test_search_console_is_pending_until_a_page_day_is_stored_then_missing_pages_are_zero(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, _, ids, _ = await _setup(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")
    integration = await gsc_property(migrated, workspace, project)
    base = project_url(workspace, project, "internal-links", "pages")

    before = await api.get(base, params={"include": "gsc"}, headers=viewer.headers)
    await execute(
        migrated,
        "INSERT INTO fp.gsc_page_daily (integration_id, metric_date, url_id, workspace_id, "
        "project_id, clicks, impressions) VALUES ($1, $2, $3, $4, $5, 7, 70)",
        integration,
        date.today() - timedelta(days=3),
        ids["/pricing"],
        workspace.id,
        project,
    )
    after = await api.get(base, params={"include": "gsc"}, headers=viewer.headers)
    detail = await api.get(
        project_url(workspace, project, "internal-links", "pages", ids["/blog"]),
        headers=viewer.headers,
    )

    assert {row["extras"]["gsc"]["state"] for row in before.json()["data"]} == {"pending"}
    assert {row["extras"]["gsc"]["clicks"] for row in before.json()["data"]} == {None}
    rows = {row["path"]: row["extras"]["gsc"] for row in after.json()["data"]}
    assert (rows["/pricing"]["state"], rows["/pricing"]["clicks"]) == ("ok", 7)
    assert (rows["/blog"]["state"], rows["/blog"]["clicks"]) == ("ok", 0)
    assert detail.json()["data"]["extras"]["gsc"]["clicks"] == 0


async def test_a_change_is_null_while_the_crawl_is_not_compared_yet(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, newer, _, _ = await _setup(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")
    await execute(
        migrated, "UPDATE seo.crawl_runs SET enrich_state = 'running' WHERE id = $1", newer
    )

    response = await api.get(
        project_url(workspace, project, "internal-links", "pages"),
        params={"include": "changes"},
        headers=viewer.headers,
    )

    rows = {row["path"]: row["extras"]["change"] for row in response.json()["data"]}
    assert rows["/blog"] is None
    assert rows["/pricing"] is not None


async def test_the_anchor_numbers_are_the_stored_counts_and_group_the_way_the_job_does(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    sources = [f"/s{n}" for n in range(6)]
    anchors = ["Click here", "click HERE ", '"Read more"', "Pricing", "pricing", "Pricing guide"]
    pages = [("/", 200), ("/t", 200), *[(path, 200) for path in sources]]
    links = [
        SeedLink(path, "/t", "content", anchor)
        for path, anchor in zip(sources, anchors, strict=True)
    ]
    links.append(SeedLink("/t", "/t", "content", "itself"))
    run, ids = await seed_crawl(migrated, workspace, project, pages, links)
    await track_keyword(
        migrated, workspace, project, "pricing plans", ids["/t"], rank=5, change=0, volume=None
    )
    await enrich_run(
        worker_db,
        None,
        CrawlEnrichTask(workspace_id=workspace.id, run_id=run),
        deadline=time.monotonic() + 120,
    )
    viewer = await member(resources, migrated, workspace, "viewer")
    stored = await fetchrow(
        migrated,
        "SELECT editorial_anchors, generic_anchors FROM seo.crawl_pages "
        "WHERE run_id = $1 AND url_id = $2",
        run,
        ids["/t"],
    )

    listed = await api.get(
        project_url(workspace, project, "internal-links", "pages"),
        params={"include": "anchors", "q": "/t"},
        headers=viewer.headers,
    )
    detail = await api.get(
        project_url(workspace, project, "internal-links", "pages", ids["/t"]),
        headers=viewer.headers,
    )

    summary = {row["path"]: row for row in listed.json()["data"]}["/t"]["extras"]["anchors"]
    full = detail.json()["data"]["extras"]["anchors"]
    assert (full["total"], full["generic"]) == (
        stored["editorial_anchors"],
        stored["generic_anchors"],
    )
    assert (full["total"], full["distinct"], full["generic"]) == (6, 4, 3)
    assert full["generic_share"] == 0.5
    assert full["matches_keyword"] is True
    assert [(row["text"], row["count"], row["generic"]) for row in full["top"]] == [
        ("Click here", 2, True),
        ("Pricing", 2, False),
        ("Pricing guide", 1, False),
        ("Read more", 1, True),
    ]
    assert {key: value for key, value in full.items() if key != "top"} == summary


async def test_a_crawl_without_its_links_has_no_anchor_list_and_only_the_stored_counts(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, newer, ids, _ = await _setup(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")
    await execute(
        migrated, "UPDATE seo.crawl_runs SET links_dropped_at = now() WHERE id = $1", newer
    )

    listed = await api.get(
        project_url(workspace, project, "internal-links", "pages"),
        params={"include": "anchors"},
        headers=viewer.headers,
    )
    detail = await api.get(
        project_url(workspace, project, "internal-links", "pages", ids["/blog/b"]),
        headers=viewer.headers,
    )

    assert {row["extras"]["anchors"] for row in listed.json()["data"]} == {None}
    assert detail.json()["data"]["extras"]["anchors"] == {
        "total": 2,
        "distinct": None,
        "generic": 1,
        "generic_share": 0.5,
        "matches_keyword": None,
        "top": None,
    }


async def test_weak_outlinks_answers_gone_for_a_crawl_without_its_links(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, newer, _, _ = await _setup(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")
    await execute(
        migrated, "UPDATE seo.crawl_runs SET links_dropped_at = now() WHERE id = $1", newer
    )

    filtered = await api.get(
        project_url(workspace, project, "internal-links", "pages"),
        params={"filter[worklist]": "weak_outlinks"},
        headers=viewer.headers,
    )
    counts = await api.get(
        project_url(workspace, project, "internal-links", "worklists"), headers=viewer.headers
    )

    assert problem(filtered) == (410, "links_dropped")
    assert counts.json()["data"]["weak_outlinks"] == 0


async def test_a_target_that_was_never_fetched_or_has_no_crawl_row_is_a_weak_target(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    tiers = await seed_tiers(migrated, workspace)
    links = [SeedLink("/pricing", target, "content", "more") for target in ("/blog", "/blog/a")]
    links.append(SeedLink("/pricing", "/blog/b", "content", "more"))
    links.append(SeedLink("/", "/pricing", "content", "plans"))
    run, ids = await seed_crawl(migrated, workspace, project, PAGES, links)
    await set_counts(migrated, run)
    placed = [("/pricing", tiers[0])] + [
        (path, tiers[1]) for path in ("/blog", "/blog/a", "/blog/b")
    ]
    for path, tier in placed:
        await execute(
            migrated,
            "INSERT INTO core.project_pages (project_id, url_id, workspace_id, tier_id, "
            "tier_source) VALUES ($1, $2, $3, $4, 'manual')",
            project,
            ids[path],
            workspace.id,
            tier,
        )
    await execute(
        migrated,
        "UPDATE seo.crawl_pages SET status_code = NULL WHERE run_id = $1 AND url_id = $2",
        run,
        ids["/blog"],
    )
    await execute(
        migrated,
        "DELETE FROM seo.crawl_pages WHERE run_id = $1 AND url_id = $2",
        run,
        ids["/blog/a"],
    )
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await api.get(
        project_url(workspace, project, "internal-links", "pages"),
        params={"filter[worklist]": "weak_outlinks"},
        headers=viewer.headers,
    )

    assert [row["path"] for row in response.json()["data"]] == ["/pricing"]
