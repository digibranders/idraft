"""The mention phase of `crawl_enrich` (plan 04 Task 7, decisions D8, D11 and D12)."""

from __future__ import annotations

import time
import uuid

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.crawl_enrich import CrawlEnrichTask, enrich_run
from idraft.collectors.crawl_ingest import html_key
from idraft.storage.raw import compress
from tests.api.auth.support import Workspace, execute, fetch, make_workspace
from tests.api.internal_links.support import SeedLink, seed_crawl, set_counts
from tests.api.keywords.support import keyword_project
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

type Sessions = async_sessionmaker[AsyncSession]

PAGE = (
    "<html><body><main><p>Teams ask about managed detection and response before they buy."
    " Our SOC as a service runs all night.</p></main></body></html>"
)


async def _site(
    pg: PostgresServer,
) -> tuple[Workspace, uuid.UUID, uuid.UUID, dict[str, int], MemoryStore]:
    """A crawl of four pages, all reachable, with the same HTML stored for each. "/" links to
    "/soc" in its text and to "/mdr" only through the menu."""
    workspace = await make_workspace(pg)
    project = await keyword_project(pg, workspace)
    run, ids = await seed_crawl(
        pg,
        workspace,
        project,
        [("/", 200), ("/mdr", 200), ("/soc", 200), ("/blog/a", 200)],
        [
            SeedLink("/", "/mdr", "navigation", "MDR"),
            SeedLink("/", "/blog/a", "content", "Post"),
            SeedLink("/", "/soc", "content", "SOC as a service"),
        ],
    )
    await set_counts(pg, run)
    await execute(pg, "UPDATE seo.crawl_pages SET click_depth = 1 WHERE run_id = $1", run)
    await execute(
        pg,
        "UPDATE seo.crawl_pages SET click_depth = 0 WHERE run_id = $1 AND url_id = $2",
        run,
        ids["/"],
    )
    store = MemoryStore()
    for url in ids.values():
        row = await fetch(pg, "SELECT url_hash FROM core.urls WHERE id = $1", url)
        await store.put(html_key(project, row[0]["url_hash"]), compress(PAGE.encode()))
    return workspace, project, run, ids, store


async def _track(
    pg: PostgresServer,
    workspace: Workspace,
    project: uuid.UUID,
    keyword: str,
    target: int | None,
) -> uuid.UUID:
    """A tracked keyword of a page (the keyword's text is its normalized text here)."""
    row = await fetch(
        pg,
        "WITH k AS (INSERT INTO seo.keywords (workspace_id, text, normalized_text, language_code) "
        "VALUES ($1, $4, $4, 'en') RETURNING id) "
        "INSERT INTO seo.tracked_keywords (workspace_id, project_id, keyword_id, location_id, "
        "language_code, device, target_url_id) SELECT $1, $2, k.id, "
        "(SELECT default_location_id FROM core.projects WHERE id = $2), 'en', 'desktop', $3 "
        "FROM k RETURNING id",
        workspace.id,
        project,
        target,
        keyword,
    )
    tracked: uuid.UUID = row[0]["id"]
    return tracked


async def _enrich(
    sessions: Sessions, store: MemoryStore, workspace: Workspace, run: uuid.UUID
) -> None:
    outcome = await enrich_run(
        sessions,
        store,
        CrawlEnrichTask(workspace_id=workspace.id, run_id=run),
        deadline=time.monotonic() + 120,
    )
    assert not outcome.failed


async def _mentions(pg: PostgresServer, run: uuid.UUID) -> set[tuple[str, str, str, str]]:
    rows = await fetch(
        pg,
        "SELECT su.path AS source, tu.path AS target, m.phrase, m.origin FROM seo.crawl_mentions m "
        "JOIN core.urls su ON su.id = m.source_url_id JOIN core.urls tu ON tu.id = m.target_url_id "
        "WHERE m.run_id = $1",
        run,
    )
    return {(row["source"], row["target"], row["phrase"], row["origin"]) for row in rows}


async def test_a_page_that_mentions_a_keyword_of_another_page_gets_a_mention(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, run, ids, store = await _site(migrated)
    await _track(migrated, workspace, project, "managed detection and response", ids["/mdr"])

    await _enrich(worker_db, store, workspace, run)

    pairs = await _mentions(migrated, run)
    assert ("/", "/mdr", "managed detection and response", "keyword") in pairs
    # No page mentions itself.
    assert all(source != target for source, target, _, _ in pairs)


async def test_a_keyword_with_no_target_belongs_to_the_page_it_ranks_with(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, run, ids, store = await _site(migrated)
    tracked = await _track(migrated, workspace, project, "managed detection and response", None)
    await execute(
        migrated,
        "INSERT INTO seo.tracked_keyword_state (tracked_keyword_id, workspace_id, project_id, "
        "current_url_id) VALUES ($1, $2, $3, $4)",
        tracked,
        workspace.id,
        project,
        ids["/mdr"],
    )

    await _enrich(worker_db, store, workspace, run)

    assert ("/", "/mdr", "managed detection and response", "keyword") in await _mentions(
        migrated, run
    )


async def test_a_target_the_source_already_links_to_by_an_editorial_link_is_not_a_mention(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, run, ids, store = await _site(migrated)
    await _track(migrated, workspace, project, "soc as a service", ids["/soc"])

    await _enrich(worker_db, store, workspace, run)

    # "/" links to "/soc" in its text ("SOC as a service"), so there is no opportunity.
    assert ("/", "/soc", "SOC as a service", "keyword") not in await _mentions(migrated, run)


async def test_without_a_store_the_phase_finishes_with_no_mentions(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, run, ids, _ = await _site(migrated)
    await _track(migrated, workspace, project, "managed detection and response", ids["/mdr"])

    outcome = await enrich_run(
        worker_db,
        None,
        CrawlEnrichTask(workspace_id=workspace.id, run_id=run),
        deadline=time.monotonic() + 120,
    )

    assert not outcome.failed
    assert await _mentions(migrated, run) == set()
    state = await fetch(migrated, "SELECT enrich_state FROM seo.crawl_runs WHERE id = $1", run)
    assert state[0]["enrich_state"] == "done"
