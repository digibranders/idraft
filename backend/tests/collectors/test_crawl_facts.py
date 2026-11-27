"""Filling the facts of a stored crawl from its stored HTML (`crawl_facts`)."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.crawl_facts import backfill_facts
from tests.api.auth.support import execute, fetch, fetchrow
from tests.collectors.test_crawl_ingest import (
    FACT_COLUMNS,
    _crawled,
    _ingest,
    _pages,
    _site_with_facts,
    _snapshot,
)
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

Sessions = async_sessionmaker[AsyncSession]


async def _crawl_without_facts(
    pg: PostgresServer, sessions: Sessions
) -> tuple[MemoryStore, uuid.UUID, uuid.UUID, dict[str, dict[str, object]]]:
    """A finished crawl as ingest leaves it, and then as a crawl finished before the facts were
    kept: no page has any. The second value is the workspace, the third the run; the last is the
    facts a fresh ingest gave each page."""
    on_page = _site_with_facts()
    store = MemoryStore()
    crawled = await _crawled(pg, sessions, on_page)
    await _ingest(sessions, on_page, store, crawled.task)
    run_id = crawled.task.run_id
    fresh = {
        path: {column: page[column] for column in ("facts_read", *FACT_COLUMNS)}
        for path, page in (await _pages(pg, run_id)).items()
    }
    await execute(
        pg,
        "UPDATE seo.crawl_pages SET facts_read = false, meta_description = NULL, h1_count = NULL, "
        "word_count = NULL, text_hash = NULL, images_without_alt = NULL, og_complete = NULL, "
        "jsonld_errors = NULL, hreflang_errors = NULL, http_resources = NULL WHERE run_id = $1",
        run_id,
    )
    return store, crawled.task.workspace_id, run_id, fresh


async def test_a_stored_crawl_gets_the_facts_a_fresh_ingest_gives_and_its_links_are_untouched(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    store, workspace_id, run_id, fresh = await _crawl_without_facts(migrated, worker_db)
    snapshot = await _snapshot(migrated, run_id)
    expected = sum(1 for page in fresh.values() if page["facts_read"])
    assert expected > 1

    first = await backfill_facts(worker_db, store, workspace_id=workspace_id, run_id=run_id)
    second = await backfill_facts(worker_db, store, workspace_id=workspace_id, run_id=run_id)

    assert first is not None
    assert (first.read, first.missing) == (expected, 0)
    assert second == first
    now = {
        path: {column: page[column] for column in ("facts_read", *FACT_COLUMNS)}
        for path, page in (await _pages(migrated, run_id)).items()
    }
    assert now == fresh
    # The links and what is counted from them; the pages' own rows differ by the facts.
    assert (await _snapshot(migrated, run_id))[1:] == snapshot[1:]


async def test_a_page_whose_html_is_gone_keeps_no_facts_and_is_counted(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    store, workspace_id, run_id, fresh = await _crawl_without_facts(migrated, worker_db)
    expected = sum(1 for page in fresh.values() if page["facts_read"])
    store.objects.pop(next(iter(store.objects)))

    outcome = await backfill_facts(worker_db, store, workspace_id=workspace_id, run_id=run_id)

    assert outcome is not None
    assert (outcome.read, outcome.missing) == (expected - 1, 1)
    rows = await fetch(migrated, "SELECT facts_read FROM seo.crawl_pages WHERE run_id = $1", run_id)
    assert sum(1 for row in rows if row["facts_read"]) == expected - 1


async def test_a_crawl_that_is_not_finished_is_left_alone(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = _site_with_facts()
    crawled = await _crawled(migrated, worker_db, on_page)

    outcome = await backfill_facts(
        worker_db, MemoryStore(), workspace_id=crawled.task.workspace_id, run_id=crawled.task.run_id
    )

    assert outcome is None


async def test_the_latest_crawl_of_a_project_is_filled_by_its_ids(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    from idraft.worker.crawl_facts import facts_latest

    store, workspace_id, run_id, _ = await _crawl_without_facts(migrated, worker_db)
    run = await fetchrow(migrated, "SELECT project_id FROM seo.crawl_runs WHERE id = $1", run_id)

    outcome = await facts_latest(
        worker_db, store, workspace_id=workspace_id, project_id=run["project_id"]
    )
    other = await facts_latest(worker_db, store, workspace_id=workspace_id, project_id=uuid.uuid4())

    assert outcome is not None
    assert (outcome.run_id, outcome.missing) == (run_id, 0)
    assert outcome.read > 1
    assert other is None
