"""Rank, citations, anchors, Search Console and change columns of the Pages tab, the new flag
and worklists (plan 04 Task 11, decisions D7 to D10)."""

from __future__ import annotations

import time
import uuid

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.resources import Resources
from idraft.collectors.crawl_enrich import CrawlEnrichTask, enrich_run
from tests.api.auth.support import Workspace, execute, make_workspace
from tests.api.entities.support import member
from tests.api.internal_links.support import SeedLink, seed_crawl, seed_tiers, set_counts
from tests.api.internal_links.support_changes import PAGES, track_keyword, two_crawls
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer
from tests.db.support import connection, insert_prompt

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
    assert rows["/blog"]["extras"]["change"] is None
    anchors = rows["/blog/b"]["extras"]["anchors"]
    assert (anchors["total"], anchors["distinct"], anchors["generic"]) == (2, 2, 1)
    assert anchors["matches_keyword"] is None
    assert str(ids["/pricing"]) == rows["/pricing"]["url_id"]


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

    response = await api.get(
        project_url(workspace, project, "internal-links", "pages"),
        params={"include": "keywords"},
        headers=viewer.headers,
    )

    keywords = {row["path"]: row for row in response.json()["data"]}["/pricing"]["extras"][
        "keywords"
    ]
    assert keywords == {"tracked": 2, "ranking": 1, "average_rank": 4.0, "best_volume": 2900}
    detail = await api.get(
        project_url(workspace, project, "internal-links", "pages", ids["/pricing"]),
        headers=viewer.headers,
    )
    rows = detail.json()["data"]["extras"]["keywords"]
    assert {(row["keyword"], row["rank"], row["change"], row["volume"]) for row in rows} == {
        ("pricing plans", 4, 2, 2900),
        ("soc cost", None, None, 700),
    }


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
    assert citations == {"chatgpt": 2, "gemini": 1, "ai_mode": 0, "total": 3}


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


async def insert_citation(
    pg: PostgresServer,
    workspace: Workspace,
    project: uuid.UUID,
    url_id: int,
    engine: str,
    days_ago: int,
) -> None:
    """One answer of `engine`, `days_ago` days old, that cites the page as the project's own
    domain. The statements are those of `seed_ai` in `tests/db/support.py`."""
    observation_class = "serp_ai" if engine == "google_ai_mode" else "consumer_ui"
    async with connection(pg) as db:
        prompt_id, version_id = await insert_prompt(
            db, workspace.id, project, f"Which tool is best {uuid.uuid4().hex}?"
        )
        raw_payload_id: int = await db.fetchval(
            "INSERT INTO ops.raw_payloads (storage, object_key, sha256, bytes_raw, bytes_stored, "
            "compression, content_type, provider_code, provider_endpoint, fetched_at, "
            "retention_class) VALUES ('r2', $1, $2, 10, 10, 'zstd', 'application/json', "
            "'dataforseo', 'ai_optimization/chat_gpt/llm_scraper/task_get/advanced', now(), "
            "'ai_raw') RETURNING id",
            f"ai_raw/{uuid.uuid4().hex}",
            uuid.uuid4().bytes + uuid.uuid4().bytes,
        )
        observed_at = await db.fetchval("SELECT now() - make_interval(days => $1)", days_ago)
        observation_id: int = await db.fetchval(
            "INSERT INTO ai.observations (observed_at, observed_date, workspace_id, project_id, "
            "engine_code, observation_class, prompt_id, prompt_version_id, query_text, "
            "location_id, language_code, provider_code, provider_endpoint, status, answer_text, "
            "answer_char_count, has_citations, citation_count, raw_payload_id, adapter_version, "
            "normalizer_version, canonicalizer_version) VALUES ($1::timestamptz, "
            "($1::timestamptz)::date, $2, $3, $4, $5, $6, $7, 'Which tool is best?', "
            "(SELECT default_location_id FROM core.projects WHERE id = $3), 'en', 'dataforseo', "
            "'ai_optimization/chat_gpt/llm_scraper', "
            "'complete', 'Acme.', 5, true, 1, $8, 1, 1, 1) RETURNING id",
            observed_at,
            workspace.id,
            project,
            engine,
            observation_class,
            prompt_id,
            version_id,
            raw_payload_id,
        )
        await db.execute(
            "INSERT INTO ai.citations (observation_id, observed_at, citation_index, "
            "workspace_id, project_id, engine_code, url_id, domain_id, raw_url, citation_kind, "
            "domain_role) SELECT $1, $2, 1, $3, $4, $5, u.id, u.domain_id, u.canonical_url, "
            "'source_list', 'own' FROM core.urls u WHERE u.id = $6",
            observation_id,
            observed_at,
            workspace.id,
            project,
            engine,
            url_id,
        )
