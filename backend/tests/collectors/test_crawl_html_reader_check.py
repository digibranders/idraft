"""The HTML reader's version and the per-page link check, at ingest and at relink (plan 12)."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors import crawl_ingest, crawl_relink
from idraft.collectors.crawl_relink import RelinkError, relink_crawl
from idraft.crawl.integrity import HTML_READER_VERSION
from idraft.crawl.placement import classify as real_classify
from tests.api.auth.support import execute, fetch, fetchrow
from tests.collectors.crawl_support import synthetic_site
from tests.collectors.test_crawl_ingest import _crawled, _ingest
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

Sessions = async_sessionmaker[AsyncSession]


def _lose_links(monkeypatch: pytest.MonkeyPatch) -> None:
    """A reader that keeps only the first link of a page: the bug of 2026-11-26 in small."""
    monkeypatch.setattr(crawl_ingest, "classify", lambda html, url: real_classify(html, url)[:1])


async def _run(pg: PostgresServer, run_id: uuid.UUID) -> dict[str, Any]:
    row = await fetchrow(
        pg,
        "SELECT html_reader_version, pages_links_suspect, links_stored "
        "FROM seo.crawl_runs WHERE id = $1",
        run_id,
    )
    return dict(row)


async def _checks(pg: PostgresServer, run_id: uuid.UUID) -> list[dict[str, Any]]:
    rows = await fetch(
        pg,
        "SELECT links_state, html_anchors, links_read, links_suspect FROM seo.crawl_pages "
        "WHERE run_id = $1",
        run_id,
    )
    return [dict(row) for row in rows]


async def test_a_crawl_read_whole_is_stamped_and_no_page_is_suspect(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = synthetic_site()
    crawled = await _crawled(migrated, worker_db, on_page)
    await _ingest(worker_db, on_page, MemoryStore(), crawled.task)

    run = await _run(migrated, crawled.task.run_id)
    pages = [
        p for p in await _checks(migrated, crawled.task.run_id) if p["links_state"] == "from_html"
    ]

    assert run["html_reader_version"] == HTML_READER_VERSION
    assert run["pages_links_suspect"] == 0
    assert pages
    assert all(p["links_suspect"] is False for p in pages)
    assert all(p["html_anchors"] == p["links_read"] and p["links_read"] > 0 for p in pages)


async def test_a_reader_that_loses_links_makes_its_pages_suspect_and_the_crawl_counts_them(
    migrated: PostgresServer, worker_db: Sessions, monkeypatch: pytest.MonkeyPatch
) -> None:
    _lose_links(monkeypatch)
    on_page = synthetic_site()
    crawled = await _crawled(migrated, worker_db, on_page)
    await _ingest(worker_db, on_page, MemoryStore(), crawled.task)

    run = await _run(migrated, crawled.task.run_id)
    pages = [
        p for p in await _checks(migrated, crawled.task.run_id) if p["links_state"] == "from_html"
    ]

    # A page of four links that lost three is within the check's slack; larger ones are not.
    big = [p for p in pages if p["html_anchors"] > 4]
    assert big
    assert all(p["links_suspect"] is True for p in big)
    assert all(p["links_read"] == 1 for p in pages)
    assert run["pages_links_suspect"] == sum(1 for p in pages if p["links_suspect"])


async def test_a_crawl_read_by_an_older_reader_keeps_the_older_version(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = synthetic_site()
    crawled = await _crawled(migrated, worker_db, on_page)
    await execute(
        migrated,
        "UPDATE seo.crawl_runs SET html_reader_version = 1 WHERE id = $1",
        crawled.task.run_id,
    )
    await _ingest(worker_db, on_page, MemoryStore(), crawled.task)

    assert (await _run(migrated, crawled.task.run_id))["html_reader_version"] == 1


async def test_a_crawl_read_only_from_the_providers_links_has_no_version_and_no_check(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = synthetic_site()
    on_page.html = {}  # no HTML for any page: the provider's links stand in
    crawled = await _crawled(migrated, worker_db, on_page)
    await _ingest(worker_db, on_page, MemoryStore(), crawled.task)

    run = await _run(migrated, crawled.task.run_id)
    pages = await _checks(migrated, crawled.task.run_id)

    assert run["html_reader_version"] is None
    assert run["pages_links_suspect"] is None
    assert all(p["links_suspect"] is None for p in pages)


async def test_a_relink_with_the_right_reader_clears_the_flags_and_stamps_the_version(
    migrated: PostgresServer, worker_db: Sessions, monkeypatch: pytest.MonkeyPatch
) -> None:
    with monkeypatch.context() as broken:
        _lose_links(broken)
        on_page = synthetic_site()
        store = MemoryStore()
        crawled = await _crawled(migrated, worker_db, on_page)
        await _ingest(worker_db, on_page, store, crawled.task)
    run_id = crawled.task.run_id
    await execute(
        migrated,
        "UPDATE seo.crawl_runs SET enrich_state = 'done', html_reader_version = 1 WHERE id = $1",
        run_id,
    )
    assert (await _run(migrated, run_id))["pages_links_suspect"] > 0

    outcome = await relink_crawl(
        worker_db, store, workspace_id=crawled.task.workspace_id, run_id=run_id
    )

    assert outcome is not None
    run = await _run(migrated, run_id)
    pages = [p for p in await _checks(migrated, run_id) if p["links_state"] == "from_html"]
    assert run["html_reader_version"] == HTML_READER_VERSION
    assert run["pages_links_suspect"] == 0
    assert all(p["links_suspect"] is False for p in pages)


async def test_a_relink_whose_recount_does_not_run_does_not_stamp_the_version(
    migrated: PostgresServer, worker_db: Sessions, monkeypatch: pytest.MonkeyPatch
) -> None:
    on_page = synthetic_site()
    store = MemoryStore()
    crawled = await _crawled(migrated, worker_db, on_page)
    await _ingest(worker_db, on_page, store, crawled.task)
    run_id = crawled.task.run_id
    await execute(
        migrated,
        "UPDATE seo.crawl_runs SET enrich_state = 'done', html_reader_version = 1 WHERE id = $1",
        run_id,
    )

    async def nothing(*args: object, **kwargs: object) -> None:
        return None

    monkeypatch.setattr(crawl_relink, "recount_variants", nothing)
    with pytest.raises(RelinkError):
        await relink_crawl(worker_db, store, workspace_id=crawled.task.workspace_id, run_id=run_id)

    assert (await _run(migrated, run_id))["html_reader_version"] == 1
