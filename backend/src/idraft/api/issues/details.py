"""What a check found on each page of one list page (spec section 4, last column): the other
address a page points at, a count, or a reason. The conditions are the ones in `rules.py`; this
module only reads the value next to them, for the ids on one page of the Pages list."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Final

from sqlalchemy import ColumnElement, Select, and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from idraft.api.internal_links.extras import gsc_of, gsc_window
from idraft.api.internal_links.page_filter import PageScope
from idraft.api.issues.rules import (
    CITATION_ROWS,
    HAS_CAPITALS,
    HAS_UNDERSCORES,
    KEYWORD_ROWS,
    NOFOLLOW_LINKS,
    PATH_LENGTH,
    CrawlRef,
    off_target_keywords,
    own_citations,
    ranked_keywords,
    title_key,
    title_length,
    titled,
)
from idraft.api.schemas.issues import IssueDetail
from idraft.db.tables import (
    ai_citations,
    crawl_links,
    crawl_pages,
    tracked_keyword_state,
    tracked_keywords,
    urls,
)

Rows = Select[*tuple[Any, ...]]
# Checks whose value is the page another column of the row names, and which column.
_TARGET_COLUMN: Final[dict[str, ColumnElement[int]]] = {
    "redirect-broken": crawl_pages.c.redirect_url_id,
    "redirect-chain": crawl_pages.c.redirect_url_id,
    "redirect-pages": crawl_pages.c.redirect_url_id,
    "canonical-broken": crawl_pages.c.canonical_url_id,
    "canonical-elsewhere": crawl_pages.c.canonical_url_id,
}
_COUNT: Final[dict[str, ColumnElement[Any]]] = {
    "status-4xx": crawl_pages.c.linking_pages_all,
    "editorial-orphans": crawl_pages.c.linking_pages_all,
    "links-to-redirect": crawl_pages.c.redirect_outlinks,
    "broken-internal-links": crawl_pages.c.broken_outlinks,
    "links-to-nonindexable": crawl_pages.c.non_indexable_outlinks,
    "deep-pages": crawl_pages.c.click_depth,
    "title-long": title_length(crawl_pages),
    "title-short": title_length(crawl_pages),
    "url-long": PATH_LENGTH,
    "nofollow-internal": select(func.count())
    .select_from(crawl_links)
    .where(NOFOLLOW_LINKS)
    .correlate(crawl_pages)
    .scalar_subquery(),
}
_REASON: Final[dict[str, ColumnElement[Any]]] = {
    "noindex": crawl_pages.c.non_indexable_reason,
    "sitemap-nonindexable": crawl_pages.c.non_indexable_reason,
    "url-format": case(
        (and_(HAS_CAPITALS, HAS_UNDERSCORES), "both"),
        (HAS_CAPITALS, "capitals"),
        (HAS_UNDERSCORES, "underscores"),
    ),
}
NO_DETAIL: Final = IssueDetail()
# Rows of the CSV whose details and clicks are read in one go.
_CHUNK: Final = 5_000


def _rows_of(crawl: CrawlRef, ids: Sequence[int], *columns: ColumnElement[Any]) -> Rows:
    return (
        select(crawl_pages.c.url_id, *columns)
        .select_from(crawl_pages.join(urls, urls.c.id == crawl_pages.c.url_id))
        .where(
            crawl_pages.c.workspace_id == crawl.workspace_id,
            crawl_pages.c.run_id == crawl.run_id,
            crawl_pages.c.url_id.in_(ids),
        )
    )


def _target_rows(crawl: CrawlRef, ids: Sequence[int], check_id: str) -> Rows:
    """The path and the status of the page the check's column names; the status is null when
    that page is not in the crawl."""
    named = _TARGET_COLUMN[check_id]
    target = aliased(crawl_pages)
    target_url = aliased(urls)
    return (
        _rows_of(crawl, ids, target_url.c.path, target.c.status_code)
        .outerjoin(target_url, target_url.c.id == named)
        .outerjoin(
            target,
            and_(
                target.c.workspace_id == crawl_pages.c.workspace_id,
                target.c.run_id == crawl_pages.c.run_id,
                target.c.url_id == named,
            ),
        )
    )


def _duplicate_rows(crawl: CrawlRef, ids: Sequence[int]) -> Rows:
    """For a page with a shared title: how many other pages share it, and the first of them in
    byte order. The pages of the crawl are ranked once per title, so a title shared by many
    pages is read once."""
    other = aliased(crawl_pages)
    other_url = aliased(urls)
    key = title_key(other)
    path = other_url.c.path.collate("C")
    wanted = _rows_of(crawl, ids, title_key(crawl_pages).label("key")).subquery("wanted")
    ranked = (
        select(
            key.label("key"),
            path.label("path"),
            func.row_number().over(partition_by=key, order_by=path).label("rank"),
            func.count().over(partition_by=key).label("size"),
        )
        .select_from(other.join(other_url, other_url.c.id == other.c.url_id))
        .where(
            other.c.workspace_id == crawl.workspace_id,
            other.c.run_id == crawl.run_id,
            titled(other),
            key.in_(select(wanted.c.key)),
        )
        .subquery("ranked")
    )
    shared = (
        select(
            ranked.c.key,
            func.max(ranked.c.size).label("size"),
            func.min(ranked.c.path).filter(ranked.c.rank == 1).label("first"),
            func.min(ranked.c.path).filter(ranked.c.rank == 2).label("second"),
        )
        .group_by(ranked.c.key)
        .subquery("shared")
    )
    # The page itself is one of the pages that share the title: name the first one that is not.
    other_path = case((shared.c.first == urls.c.path, shared.c.second), else_=shared.c.first)
    return _rows_of(crawl, ids, other_path, shared.c.size - 1).outerjoin(
        shared, and_(shared.c.key == title_key(crawl_pages), titled(crawl_pages))
    )


def _source_counts(crawl: CrawlRef, ids: Sequence[int], check_id: str) -> Rows:
    """Per page: the distinct keywords that rank with it, the keywords that target it and
    rank best with another page (`off_target_keywords`), or the distinct answers that cite it."""
    if check_id == "cited-page-broken":
        cited = ai_citations.c.url_id
        return (
            select(cited, func.count(ai_citations.c.observation_id.distinct()))
            .select_from(CITATION_ROWS)
            .where(*own_citations(crawl), cited.in_(ids))
            .group_by(cited)
        )
    if check_id == "off-target":
        off = off_target_keywords(crawl)
        return (
            select(off.c.target_url_id, func.count())
            .where(off.c.target_url_id.in_(ids))
            .group_by(off.c.target_url_id)
        )
    ranked = tracked_keyword_state.c.current_url_id
    return (
        select(ranked, func.count(tracked_keywords.c.keyword_id.distinct()))
        .select_from(KEYWORD_ROWS)
        .where(*ranked_keywords(crawl), ranked.in_(ids))
        .group_by(ranked)
    )


async def issue_details(
    db: AsyncSession, crawl: CrawlRef, check_id: str, ids: Sequence[int]
) -> dict[int, IssueDetail]:
    """The detail of a check for each of `ids`, one statement. A check with nothing to say
    (and an empty `ids`) reads nothing."""
    if not ids:
        return {}
    if check_id in _TARGET_COLUMN:
        rows = await db.execute(_target_rows(crawl, ids, check_id))
        return {
            url: IssueDetail(target_path=path, target_status=status) for url, path, status in rows
        }
    if check_id == "title-duplicate":
        rows = await db.execute(_duplicate_rows(crawl, ids))
        return {url: IssueDetail(target_path=path, count=count) for url, path, count in rows}
    if check_id in ("rank-page-broken", "off-target", "cited-page-broken"):
        rows = await db.execute(_source_counts(crawl, ids, check_id))
        return {url: IssueDetail(count=count) for url, count in rows}
    if check_id in _COUNT:
        rows = await db.execute(_rows_of(crawl, ids, _COUNT[check_id]))
        return {url: IssueDetail(count=count) for url, count in rows}
    if check_id in _REASON:
        rows = await db.execute(_rows_of(crawl, ids, _REASON[check_id]))
        return {url: IssueDetail(reason=reason) for url, reason in rows}
    return {}


async def detail_cells(
    db: AsyncSession, scope: PageScope, check_id: str, ids: Sequence[int]
) -> dict[int, tuple[str | int | None, ...]]:
    """The extra CSV cells of each id: the four details and the clicks (empty without Search
    Console), read in chunks."""
    cells: dict[int, tuple[str | int | None, ...]] = {}
    google = await gsc_window(db, scope) if ids else None
    for start in range(0, len(ids), _CHUNK):
        chunk = ids[start : start + _CHUNK]
        details = await issue_details(db, scope, check_id, chunk)
        clicks = await gsc_of(db, scope, chunk, google)
        for url in chunk:
            found = details.get(url, NO_DETAIL)
            cells[url] = (
                found.target_path,
                found.target_status,
                found.count,
                found.reason,
                clicks[url].clicks,
            )
    return cells
