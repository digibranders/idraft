"""Reading a finished crawl's links again from its stored HTML (`crawl_relink`)."""

from __future__ import annotations

import asyncio

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.crawl_relink import RelinkError, relink_crawl
from tests.api.auth.support import execute, fetch, fetchrow
from tests.collectors.test_crawl_ingest import (
    _counted,
    _crawled,
    _ingest,
    _pages,
    _site_with_head_canonicals,
    _snapshot,
)
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

Sessions = async_sessionmaker[AsyncSession]


async def _stale_crawl(
    pg: PostgresServer, sessions: Sessions
) -> tuple[MemoryStore, object, list[dict[str, object]], dict[str, dict[str, object]]]:
    """A finished crawl, its links and counts as a fresh ingest gives them, and then made to look
    as a crawl read by a parser that lost links: some links gone, the counts wrong."""
    on_page = _site_with_head_canonicals()
    store = MemoryStore()
    crawled = await _crawled(pg, sessions, on_page)
    await _ingest(sessions, on_page, store, crawled.task)
    run_id = crawled.task.run_id
    await execute(pg, "UPDATE seo.crawl_runs SET enrich_state = 'done' WHERE id = $1", run_id)
    _, fresh_links, _ = await _snapshot(pg, run_id)
    fresh_counts = {path: _counted(page) for path, page in (await _pages(pg, run_id)).items()}
    await execute(
        pg,
        "DELETE FROM seo.crawl_links WHERE run_id = $1 AND scope = 'editorial'",
        run_id,
    )
    await execute(
        pg,
        "UPDATE seo.crawl_pages SET linking_pages_all = 0, linking_pages_editorial = 0, "
        "is_orphan = true, is_editorial_orphan = true, click_depth = NULL WHERE run_id = $1",
        run_id,
    )
    return store, crawled, fresh_links, fresh_counts


async def test_a_crawl_that_lost_links_is_read_again_to_what_a_fresh_ingest_gives(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    store, crawled, fresh_links, fresh_counts = await _stale_crawl(migrated, worker_db)
    run_id = crawled.task.run_id  # type: ignore[attr-defined]
    workspace_id = crawled.task.workspace_id  # type: ignore[attr-defined]
    assert any(link["scope"] == "editorial" for link in fresh_links)

    outcome = await relink_crawl(worker_db, store, workspace_id=workspace_id, run_id=run_id)
    again = await relink_crawl(worker_db, store, workspace_id=workspace_id, run_id=run_id)

    assert outcome is not None
    assert outcome.links_after == len(fresh_links)
    assert outcome.links_before < outcome.links_after
    assert again is not None
    assert again.links_before == again.links_after == len(fresh_links)
    _, links, _ = await _snapshot(migrated, run_id)
    assert links == fresh_links
    counts = {path: _counted(page) for path, page in (await _pages(migrated, run_id)).items()}
    assert counts == fresh_counts
    run = await fetchrow(
        migrated, "SELECT enrich_state, links_stored FROM seo.crawl_runs WHERE id = $1", run_id
    )
    assert (run["enrich_state"], run["links_stored"]) == ("done", len(fresh_links))


async def test_a_crawl_with_a_page_whose_html_is_gone_is_not_changed_at_all(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    store, crawled, _, _ = await _stale_crawl(migrated, worker_db)
    run_id = crawled.task.run_id  # type: ignore[attr-defined]
    workspace_id = crawled.task.workspace_id  # type: ignore[attr-defined]
    before = await fetch(
        migrated, "SELECT * FROM seo.crawl_links WHERE run_id = $1 ORDER BY id", run_id
    )
    store.objects.pop(next(iter(store.objects)))

    with pytest.raises(RelinkError):
        await relink_crawl(worker_db, store, workspace_id=workspace_id, run_id=run_id)

    after = await fetch(
        migrated, "SELECT * FROM seo.crawl_links WHERE run_id = $1 ORDER BY id", run_id
    )
    assert [dict(row) for row in after] == [dict(row) for row in before]


async def test_a_crawl_whose_second_job_has_not_ended_is_not_read_again(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = _site_with_head_canonicals()
    store = MemoryStore()
    crawled = await _crawled(migrated, worker_db, on_page)
    await _ingest(worker_db, on_page, store, crawled.task)

    outcome = await relink_crawl(
        worker_db, store, workspace_id=crawled.task.workspace_id, run_id=crawled.task.run_id
    )

    assert outcome is None


async def test_the_latest_crawl_of_a_project_is_read_again_by_its_ids(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    from idraft.worker.relink_crawl import relink_latest

    store, crawled, fresh_links, _ = await _stale_crawl(migrated, worker_db)
    run = await fetchrow(
        migrated,
        "SELECT project_id FROM seo.crawl_runs WHERE id = $1",
        crawled.task.run_id,  # type: ignore[attr-defined]
    )

    outcome = await relink_latest(
        worker_db,
        store,
        workspace_id=crawled.task.workspace_id,  # type: ignore[attr-defined]
        project_id=run["project_id"],
    )

    assert outcome is not None
    assert outcome.links_after == len(fresh_links)


async def test_an_alert_raised_on_the_old_reading_is_judged_again(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    store, crawled, _, _ = await _stale_crawl(migrated, worker_db)
    run_id = crawled.task.run_id  # type: ignore[attr-defined]
    run = await fetchrow(migrated, "SELECT project_id FROM seo.crawl_runs WHERE id = $1", run_id)
    await execute(
        migrated,
        "INSERT INTO seo.crawl_alerts (run_id, workspace_id, project_id, lost_links, "
        "max_position, threshold, channel, delivery_state) "
        "VALUES ($1, $2, $3, 99, 3, 1, 'app', 'shown_in_app')",
        run_id,
        crawled.task.workspace_id,  # type: ignore[attr-defined]
        run["project_id"],
    )

    await relink_crawl(
        worker_db,
        store,
        workspace_id=crawled.task.workspace_id,  # type: ignore[attr-defined]
        run_id=run_id,
    )

    left = await fetch(
        migrated, "SELECT lost_links FROM seo.crawl_alerts WHERE run_id = $1", run_id
    )
    assert all(row["lost_links"] != 99 for row in left)


async def test_two_relinks_of_one_crawl_do_not_run_at_once(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    store, crawled, fresh_links, _ = await _stale_crawl(migrated, worker_db)
    run_id = crawled.task.run_id  # type: ignore[attr-defined]
    workspace_id = crawled.task.workspace_id  # type: ignore[attr-defined]

    results = await asyncio.gather(
        *(
            relink_crawl(worker_db, store, workspace_id=workspace_id, run_id=run_id)
            for _ in range(2)
        ),
        return_exceptions=True,
    )

    assert any(not isinstance(result, BaseException) and result for result in results)
    _, links, _ = await _snapshot(migrated, run_id)
    assert links == fresh_links
