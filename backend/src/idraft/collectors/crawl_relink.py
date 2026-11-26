"""Re-read a finished crawl's links from the raw HTML it stored, with no new crawl.

A crawl's links, counts, flags and mentions are all derived from the HTML kept in storage
(decision D9). When the reading of HTML improves (the empty-comment fix of 2026-11-26 is the case
that made this), a crawl read before it keeps the old, wrong numbers. This puts them right from
the same HTML: it calls no provider and spends nothing.

It gives what a fresh ingest of the same HTML would give, because it uses the same functions:
`page_links_from_html` for the edges, the template pass, then the recount of counts, flags,
depth, equity and anchors, then the second job (changes, anchors, mentions). It is all or
nothing for the links: if the HTML of any page is gone, nothing is changed, so the links of a
crawl are never a mix of two readings. It can be run again.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from uuid import UUID

import structlog
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.crawl_enrich import CrawlEnrichTask, enrich_run
from idraft.collectors.crawl_ingest import (
    LINKS_PER_CRAWL_MAX,
    _long_transaction,
    _read_run,
    _store_html_canonical,
    _template_input,
    _url_ids,
    _write_template,
    lock_finished_crawl,
    page_links_from_html,
    recount_variants,
)
from idraft.collectors.crawl_runs import CrawlIngestTask
from idraft.collectors.crawl_store import html_key
from idraft.crawl.hosts import site_hosts
from idraft.crawl.template import template_placements
from idraft.db.tables import crawl_links, crawl_pages, crawl_runs, urls
from idraft.storage.raw import ObjectStore, RawStorageError, decompress

_log = structlog.get_logger(__name__)
_ENRICH_PASS_SECONDS = 120.0
_ENRICH_PASSES_MAX = 200
_LINK_ROWS_PER_STATEMENT = 2_000


class RelinkError(Exception):
    """The crawl cannot be re-read as a whole: nothing was changed."""


@dataclass(frozen=True, slots=True)
class RelinkOutcome:
    run_id: UUID
    pages: int
    links_before: int
    links_after: int


async def _from_html_pages(
    sessions: async_sessionmaker[AsyncSession], run_id: UUID, workspace_id: UUID
) -> list[tuple[int, str, str, bytes]]:
    async with sessions() as db:
        rows = (
            await db.execute(
                select(
                    crawl_pages.c.url_id,
                    crawl_pages.c.crawled_url,
                    urls.c.canonical_url,
                    urls.c.url_hash,
                )
                .join(urls, urls.c.id == crawl_pages.c.url_id)
                .where(
                    crawl_pages.c.run_id == run_id,
                    crawl_pages.c.workspace_id == workspace_id,
                    crawl_pages.c.links_state == "from_html",
                )
                .order_by(crawl_pages.c.url_id)
            )
        ).all()
    return [(row.url_id, row.crawled_url, row.canonical_url, bytes(row.url_hash)) for row in rows]


async def relink_crawl(
    sessions: async_sessionmaker[AsyncSession],
    store: ObjectStore,
    *,
    workspace_id: UUID,
    run_id: UUID,
) -> RelinkOutcome | None:
    """Replace the links of the crawl's pages that were read from HTML by a new reading of the
    stored HTML, then redo everything derived from them. None: the crawl is not one to touch
    (not finished, its second job running, or its links dropped). `RelinkError`: some HTML is
    not stored, and nothing was changed."""
    run = await _read_run(sessions, CrawlIngestTask(workspace_id=workspace_id, run_id=run_id))
    if run is None:
        return None
    pages = await _from_html_pages(sessions, run_id, workspace_id)
    hosts = site_hosts(run.target_host, run.allowed_subdomains)

    reads = []
    missing = 0
    held = 0
    for url_id, crawled_url, canonical_url, url_hash in pages:
        try:
            html = decompress(await store.get(html_key(run.project_id, url_hash))).decode(
                "utf-8", errors="replace"
            )
        except (RawStorageError, KeyError):
            missing += 1
            continue
        read = await page_links_from_html(html, url_id, crawled_url, canonical_url, hosts)
        held += len(read.edges)
        if held > LINKS_PER_CRAWL_MAX:
            raise RelinkError("the crawl holds more links than a crawl may")
        reads.append(read)
    if missing:
        raise RelinkError(f"the stored HTML of {missing} pages is gone; nothing was changed")

    async with sessions() as db, db.begin():
        await _long_transaction(db)
        if (
            await lock_finished_crawl(
                db,
                workspace_id=workspace_id,
                project_id=run.project_id,
                run_id=run_id,
                project=True,
            )
            is None
        ):
            return None
        from_html = select(crawl_pages.c.url_id).where(
            crawl_pages.c.run_id == run_id,
            crawl_pages.c.workspace_id == workspace_id,
            crawl_pages.c.links_state == "from_html",
        )
        before = (
            await db.execute(
                select(func.count()).where(
                    crawl_links.c.run_id == run_id, crawl_links.c.workspace_id == workspace_id
                )
            )
        ).scalar_one()
        await db.execute(
            delete(crawl_links).where(
                crawl_links.c.run_id == run_id,
                crawl_links.c.workspace_id == workspace_id,
                crawl_links.c.source_url_id.in_(from_html),
            )
        )
        ids = await _url_ids(
            db,
            [edge.target for read in reads for edge in read.edges]
            + [read.canonical for read in reads if read.canonical is not None],
        )
        for read in reads:
            if read.canonical is not None:
                await _store_html_canonical(db, run, read.url_id, ids[read.canonical.url_hash])
            rows = [
                {
                    "run_id": run_id,
                    "workspace_id": workspace_id,
                    "source_url_id": read.url_id,
                    "target_url_id": ids[edge.target.url_hash],
                    "anchor": edge.anchor,
                    "kind": edge.kind,
                    "placement": edge.placement,
                    "scope": edge.scope.value,
                    "rel": list(edge.rel),
                    "is_followed": edge.followed,
                    "occurrences": edge.occurrences,
                    "container_hash": edge.container_hash,
                    "template_candidate": edge.template_candidate,
                }
                for edge in read.edges
            ]
            for start in range(0, len(rows), _LINK_ROWS_PER_STATEMENT):
                await db.execute(
                    crawl_links.insert().values(rows[start : start + _LINK_ROWS_PER_STATEMENT])
                )
        template_rows, template_pages = await _template_input(db, run_id, workspace_id)
        await _write_template(
            db,
            run_id,
            workspace_id,
            await asyncio.to_thread(template_placements, template_rows, template_pages),
        )
        after = (
            await db.execute(
                select(func.count()).where(
                    crawl_links.c.run_id == run_id, crawl_links.c.workspace_id == workspace_id
                )
            )
        ).scalar_one()
        await db.execute(
            update(crawl_runs)
            .where(crawl_runs.c.workspace_id == workspace_id, crawl_runs.c.id == run_id)
            .values(links_stored=after)
        )

    recounted = await recount_variants(sessions, workspace_id=workspace_id, run_id=run_id)
    if recounted is None:
        return None
    await _enrich_again(sessions, store, workspace_id=workspace_id, run_id=run_id)
    _log.info("crawl relinked", run_id=str(run_id), links_before=before, links_after=after)
    return RelinkOutcome(run_id=run_id, pages=len(reads), links_before=before, links_after=after)


async def _enrich_again(
    sessions: async_sessionmaker[AsyncSession],
    store: ObjectStore,
    *,
    workspace_id: UUID,
    run_id: UUID,
) -> None:
    """Run the second job (changes, anchors, mentions) again over the new links, here and now:
    it reads the database and the stored HTML only."""
    async with sessions() as db, db.begin():
        await db.execute(
            update(crawl_runs)
            .where(crawl_runs.c.workspace_id == workspace_id, crawl_runs.c.id == run_id)
            .values(enrich_state="pending", enrich_phase=None, enrich_offset=0, enrich_failures=0)
        )
    task = CrawlEnrichTask(workspace_id=workspace_id, run_id=run_id)
    for _ in range(_ENRICH_PASSES_MAX):
        outcome = await enrich_run(
            sessions, store, task, deadline=time.monotonic() + _ENRICH_PASS_SECONDS
        )
        if outcome.phase is None:
            break
    else:
        raise RelinkError("the second job did not end; run the relink again")
    async with sessions() as db:
        state: str = (
            await db.execute(
                select(crawl_runs.c.enrich_state).where(
                    crawl_runs.c.workspace_id == workspace_id, crawl_runs.c.id == run_id
                )
            )
        ).scalar_one()
    if state != "done":
        raise RelinkError(f"the second job ended as {state}; run the relink again")
