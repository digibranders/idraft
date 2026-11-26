"""What ingest keeps of a page between crawls (spec 3 and 4 of the page history design).

`history_of` is the pure computation (run in a thread), `record_checks` writes a batch of pages
in the transaction that stores their links, and `summarize_history` counts a finished links
step from the stored checks (a crawl is read in steps, so nothing is held in memory). The worker
may only SELECT and INSERT `page_checks` and `page_snapshots`, so every write is an insert that
leaves an existing row alone.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime
from typing import Final
from uuid import UUID

from sqlalchemy import func, select, true
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.crawl.declared_dates import Declared, declared_of
from idraft.crawl.edges import PageEdge
from idraft.crawl.page_history import Snapshot, classify_change, summarize_run
from idraft.crawl.page_text import (
    content_hash,
    noncontent_links_of,
    read_page_text,
)
from idraft.crawl.placement import FoundLink
from idraft.crawl.scopes import LinkScope
from idraft.db.tables import page_checks, page_history_runs, page_snapshots

_SNAPSHOT_KINDS: Final = frozenset({"first", "content"})


@dataclass(frozen=True, slots=True)
class PageHistory:
    """What one crawl read of one page: its declared date and the snapshot it would keep."""

    declared: Declared | None
    snapshot: Snapshot


def history_of(
    html: str,
    page_url: str,
    html_canonical: str | None,
    sitemap_lastmod: datetime | None,
    links: Sequence[FoundLink],
    edges: Sequence[PageEdge],
) -> PageHistory:
    """The page's history record. Pure; may raise, and the caller then keeps none."""
    text = read_page_text(html, page_url, noncontent_links_of(links))
    return PageHistory(
        declared=declared_of(html, sitemap_lastmod),
        snapshot=Snapshot(
            title=text.title,
            description=text.description,
            headings=text.headings,
            words=text.words,
            links_all=len(edges),
            links_editorial=sum(1 for edge in edges if edge.scope is LinkScope.EDITORIAL),
            canonical=html_canonical,
            main_hash=content_hash(text.main_text),
            full_hash=content_hash(text.full_text),
        ),
    )


async def record_checks(
    db: AsyncSession,
    *,
    run_id: UUID,
    workspace_id: UUID,
    project_id: UUID,
    taken_at: datetime,
    pages: Sequence[tuple[int, PageHistory]],
) -> None:
    """One check per page, and a snapshot only for a first sight or a changed main text; the
    other checks point at the snapshot their content was first kept in. A page that already has
    a check in this crawl (a re-ingest) is left alone."""
    if not pages:
        return
    url_ids = [url_id for url_id, _ in pages]
    done: set[int] = set(
        (
            await db.execute(
                select(page_checks.c.url_id).where(
                    page_checks.c.run_id == run_id,
                    page_checks.c.workspace_id == workspace_id,
                    page_checks.c.url_id.in_(url_ids),
                )
            )
        ).scalars()
    )
    todo = [(url_id, history) for url_id, history in pages if url_id not in done]
    if not todo:
        return
    previous = {
        row.url_id: row
        for row in await db.execute(
            select(
                page_checks.c.url_id,
                page_checks.c.main_hash,
                page_checks.c.full_hash,
                page_checks.c.snapshot_id,
            )
            .where(
                page_checks.c.workspace_id == workspace_id,
                page_checks.c.project_id == project_id,
                page_checks.c.url_id.in_([url_id for url_id, _ in todo]),
                page_checks.c.run_id < run_id,
            )
            .order_by(page_checks.c.url_id, page_checks.c.run_id.desc())
            .ext(distinct_on(page_checks.c.url_id))
        )
    }
    kinds = {
        url_id: classify_change(
            (row.main_hash, row.full_hash) if (row := previous.get(url_id)) else None,
            (history.snapshot.main_hash, history.snapshot.full_hash),
        )
        for url_id, history in todo
    }
    new = [
        (url_id, history.snapshot) for url_id, history in todo if kinds[url_id] in _SNAPSHOT_KINDS
    ]
    snapshot_ids: dict[int, int] = {}
    if new:
        inserted = await db.execute(
            page_snapshots.insert()
            .values(
                [
                    {
                        "workspace_id": workspace_id,
                        "project_id": project_id,
                        "url_id": url_id,
                        "run_id": run_id,
                        "taken_at": taken_at,
                        "title": snap.title,
                        "description": snap.description,
                        "headings": [[h.level, h.text] for h in snap.headings],
                        "words": snap.words,
                        "links_all": snap.links_all,
                        "links_editorial": snap.links_editorial,
                        "canonical": snap.canonical,
                        "main_hash": snap.main_hash,
                        "full_hash": snap.full_hash,
                    }
                    for url_id, snap in new
                ]
            )
            .returning(page_snapshots.c.url_id, page_snapshots.c.id)
        )
        snapshot_ids = {row.url_id: row.id for row in inserted}
    await db.execute(
        upsert(page_checks)
        .values(
            [
                {
                    "run_id": run_id,
                    "url_id": url_id,
                    "workspace_id": workspace_id,
                    "project_id": project_id,
                    "main_hash": history.snapshot.main_hash,
                    "full_hash": history.snapshot.full_hash,
                    "declared_at": history.declared.at if history.declared else None,
                    "declared_source": history.declared.source if history.declared else None,
                    "snapshot_id": snapshot_ids[url_id]
                    if url_id in snapshot_ids
                    else previous[url_id].snapshot_id,
                }
                for url_id, history in todo
            ]
        )
        .on_conflict_do_nothing()
    )


async def summarize_history(db: AsyncSession, *, run_id: UUID, workspace_id: UUID) -> None:
    """The run's counts, from its stored checks against each page's previous check (an earlier
    crawl only, so a re-ingest never counts a page twice), and its `page_history_runs` row."""
    check, before = page_checks, page_checks.alias("before")
    latest = (
        select(before.c.main_hash, before.c.full_hash)
        .where(
            before.c.workspace_id == check.c.workspace_id,
            before.c.project_id == check.c.project_id,
            before.c.url_id == check.c.url_id,
            before.c.run_id < check.c.run_id,
        )
        .order_by(before.c.run_id.desc())
        .limit(1)
        .lateral("prev")
    )
    counts = (
        await db.execute(
            select(
                func.count(),
                func.count(latest.c.main_hash),
                func.count().filter(latest.c.main_hash != check.c.main_hash),
                func.count().filter(
                    latest.c.main_hash == check.c.main_hash,
                    latest.c.full_hash != check.c.full_hash,
                ),
            )
            .select_from(check)
            .join(latest, true(), isouter=True)
            .where(check.c.run_id == run_id, check.c.workspace_id == workspace_id)
        )
    ).one()
    checked, compared, changed, candidates = counts
    day = func.date(func.timezone("UTC", check.c.declared_at))
    declared_days: dict[date, int] = {
        row[0]: row[1]
        for row in await db.execute(
            select(day, func.count())
            .where(
                check.c.run_id == run_id,
                check.c.workspace_id == workspace_id,
                check.c.declared_at.is_not(None),
            )
            .group_by(day)
        )
    }
    summary = summarize_run(compared, candidates, declared_days)
    values = {
        "pages_checked": checked,
        "pages_main_changed": changed,
        "pages_site_wide": candidates if summary.site_wide else 0,
        "site_wide": summary.site_wide,
        "declared_unreliable": summary.declared_unreliable,
    }
    await db.execute(
        upsert(page_history_runs)
        .values(run_id=run_id, workspace_id=workspace_id, **values)
        .on_conflict_do_update(index_elements=[page_history_runs.c.run_id], set_=values)
    )
