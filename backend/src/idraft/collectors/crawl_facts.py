"""Fill the facts of a finished crawl from the raw HTML it stored, with no new crawl.

A crawl read before migration 0047 has no facts (`crawl_pages.facts_read` is false). This reads
each page's stored HTML with `read_facts` and writes the facts, and nothing else: it never touches
links, counts or the second job, calls no provider and spends nothing. A page whose HTML is gone
keeps no facts. It can be run again and gives the same result.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from uuid import UUID

import structlog
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.crawl_ingest import _read_run, facts_values
from idraft.collectors.crawl_relink import _from_html_pages
from idraft.collectors.crawl_runs import CrawlIngestTask
from idraft.collectors.crawl_store import DATA_STATES, html_key
from idraft.crawl.page_facts import read_facts
from idraft.db.tables import crawl_pages
from idraft.storage.raw import ObjectStore, RawStorageError, decompress

_log = structlog.get_logger(__name__)
# Pages written in one transaction: the facts of a page do not depend on another's.
_PAGES_PER_TRANSACTION = 200


@dataclass(frozen=True, slots=True)
class FactsOutcome:
    run_id: UUID
    # Pages whose facts were written, and pages left without: no stored HTML, or HTML the
    # reader could not read.
    read: int
    missing: int


async def backfill_facts(
    sessions: async_sessionmaker[AsyncSession],
    store: ObjectStore,
    *,
    workspace_id: UUID,
    run_id: UUID,
) -> FactsOutcome | None:
    """Write the facts of the pages of a finished crawl that were read from HTML. None: the crawl
    is not there or has no data yet."""
    run = await _read_run(sessions, CrawlIngestTask(workspace_id=workspace_id, run_id=run_id))
    if run is None or run.state not in DATA_STATES:
        return None
    read = 0
    missing = 0
    waiting: list[tuple[int, dict[str, object]]] = []
    for url_id, crawled_url, _, url_hash in await _from_html_pages(sessions, run_id, workspace_id):
        try:
            html = decompress(await store.get(html_key(run.project_id, url_hash))).decode(
                "utf-8", errors="replace"
            )
        except (RawStorageError, KeyError):
            missing += 1
            continue
        facts = await asyncio.to_thread(read_facts, html, crawled_url)
        if facts is None:
            missing += 1
            continue
        waiting.append((url_id, facts_values(facts)))
        read += 1
        if len(waiting) == _PAGES_PER_TRANSACTION:
            await _write(sessions, workspace_id, run_id, waiting)
            waiting = []
    await _write(sessions, workspace_id, run_id, waiting)
    _log.info("crawl facts filled", run_id=str(run_id), read=read, missing=missing)
    return FactsOutcome(run_id=run_id, read=read, missing=missing)


async def _write(
    sessions: async_sessionmaker[AsyncSession],
    workspace_id: UUID,
    run_id: UUID,
    pages: list[tuple[int, dict[str, object]]],
) -> None:
    if not pages:
        return
    async with sessions() as db, db.begin():
        for url_id, values in pages:
            await db.execute(
                update(crawl_pages)
                .where(
                    crawl_pages.c.run_id == run_id,
                    crawl_pages.c.workspace_id == workspace_id,
                    crawl_pages.c.url_id == url_id,
                )
                .values(**values)
            )
