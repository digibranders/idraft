"""Sort keys of the Pages list that come from outside the crawl's own page row (plan 06 Task 6,
decision D16, point P6): the best current rank, the AI citations of 28 days and the top editorial
anchor. Each is one grouped subquery, joined to the page rows only when the list is sorted by it,
and a page with no value sorts last whichever way the list runs (a null sorts as a sentinel).

The list is keyset-paged on (sort value, page id), so the value a page sorts by must be one
value: the rank is the smallest current rank of the page's active tracked keywords, the
citations are the distinct AI answers of the last 28 days that cite the page as the project's
own and were not superseded, the anchor is the page's most used editorial anchor text, edge-
trimmed and in lower case (ties by the text).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from typing import Any, Final
from uuid import UUID

from sqlalchemy import ColumnElement, FromClause, and_, func, literal, select, text
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.sql import expression

from idraft.api.internal_links.page_filter import PageScope
from idraft.crawl.anchors import EDGE_PATTERN
from idraft.db.tables import (
    ai_citations,
    ai_observations,
    crawl_links,
    crawl_pages,
    gsc_page_daily,
    page_tier_levels,
    project_pages,
    tracked_keyword_state,
    tracked_keywords,
)

EXTRA_SORTS: Final = frozenset({"rank", "citations", "anchor", "tier", "clicks", "title"})
# Tiers are at most 8, so a page with none sorts after T8 (or before T1 when descending).
TIER_LAST: Final = 99
# `current_rank` is a smallint: past it, and below any real value, a null still sorts last.
RANK_LAST: Final = 32_768
CITATION_DAYS: Final = 28


type GscWindow = tuple[UUID, tuple[date, date]]


@dataclass(frozen=True, slots=True)
class ExtraSort:
    """The value the list sorts by, and how to put the subquery it comes from beside the rows."""

    column: ColumnElement[Any]
    join: Callable[[FromClause], FromClause]


def _rank(scope: PageScope, *, descending: bool) -> ExtraSort:
    page_url = func.coalesce(
        tracked_keywords.c.target_url_id, tracked_keyword_state.c.current_url_id
    ).label("page_url")
    best = (
        select(page_url, func.min(tracked_keyword_state.c.current_rank).label("best"))
        .select_from(
            tracked_keywords.join(
                tracked_keyword_state,
                and_(
                    tracked_keyword_state.c.tracked_keyword_id == tracked_keywords.c.id,
                    tracked_keyword_state.c.workspace_id == tracked_keywords.c.workspace_id,
                ),
            )
        )
        .where(
            tracked_keywords.c.workspace_id == scope.workspace_id,
            tracked_keywords.c.project_id == scope.project_id,
            tracked_keywords.c.is_active,
            tracked_keywords.c.deleted_at.is_(None),
        )
        .group_by(page_url)
        .subquery("page_best_rank")
    )
    return ExtraSort(
        func.coalesce(best.c.best, -1 if descending else RANK_LAST),
        lambda rows: rows.outerjoin(best, best.c.page_url == crawl_pages.c.url_id),
    )


def _citations(scope: PageScope) -> ExtraSort:
    cited = (
        select(
            ai_citations.c.url_id,
            func.count(func.distinct(ai_citations.c.observation_id)).label("answers"),
        )
        .select_from(
            ai_citations.join(
                ai_observations,
                and_(
                    ai_observations.c.id == ai_citations.c.observation_id,
                    ai_observations.c.observed_at == ai_citations.c.observed_at,
                    ai_observations.c.workspace_id == ai_citations.c.workspace_id,
                ),
            )
        )
        .where(
            ai_citations.c.workspace_id == scope.workspace_id,
            ai_citations.c.project_id == scope.project_id,
            ai_citations.c.domain_role == "own",
            ai_citations.c.observed_at >= func.now() - text(f"interval '{CITATION_DAYS} days'"),
            ai_observations.c.superseded_by.is_(None),
        )
        .group_by(ai_citations.c.url_id)
        .subquery("page_citations")
    )
    return ExtraSort(
        func.coalesce(cited.c.answers, 0),
        lambda rows: rows.outerjoin(cited, cited.c.url_id == crawl_pages.c.url_id),
    )


def _anchor(scope: PageScope, *, descending: bool) -> ExtraSort:
    # The edge-trimmed text is computed once, in its own subquery: the same expression in the
    # select and in the group by would carry two bind parameters, which the database cannot
    # tell are the same.
    trimmed = (
        select(
            crawl_links.c.target_url_id,
            func.lower(func.regexp_replace(crawl_links.c.anchor, EDGE_PATTERN, "", "g")).label(
                "key"
            ),
        )
        .where(
            crawl_links.c.workspace_id == scope.workspace_id,
            crawl_links.c.run_id == scope.run_id,
            crawl_links.c.scope == "editorial",
            crawl_links.c.ignored.is_(False),
            crawl_links.c.source_url_id != crawl_links.c.target_url_id,
        )
        .subquery("anchor_trimmed")
    )
    grouped = (
        select(trimmed.c.target_url_id, trimmed.c.key, func.count().label("links"))
        .group_by(trimmed.c.target_url_id, trimmed.c.key)
        .subquery("anchor_texts")
    )
    top = (
        select(grouped.c.target_url_id, grouped.c.key)
        .ext(distinct_on(grouped.c.target_url_id))
        .where(grouped.c.key != "")
        .order_by(
            grouped.c.target_url_id,
            grouped.c.links.desc(),
            expression.collate(grouped.c.key, "C"),
        )
        .subquery("top_anchor")
    )
    # Byte order, so a sentinel can be the largest (or, with the empty text, the smallest) value.
    sentinel = literal("" if descending else "\U0010ffff")
    return ExtraSort(
        expression.collate(func.coalesce(top.c.key, sentinel), "C"),
        lambda rows: rows.outerjoin(top, top.c.target_url_id == crawl_pages.c.url_id),
    )


def _tier(scope: PageScope, *, descending: bool) -> ExtraSort:
    return ExtraSort(
        func.coalesce(page_tier_levels.c.position, -1 if descending else TIER_LAST),
        lambda rows: rows.outerjoin(
            page_tier_levels,
            and_(
                page_tier_levels.c.id == project_pages.c.tier_id,
                page_tier_levels.c.workspace_id == scope.workspace_id,
            ),
        ),
    )


def _clicks(scope: PageScope, gsc: GscWindow | None) -> ExtraSort:
    """Google's clicks of the window; without a property or stored page days every page is 0,
    as the column shows nothing for it."""
    if gsc is None:
        return ExtraSort(literal(0), lambda rows: rows)
    integration_id, (start, end) = gsc
    totals = (
        select(gsc_page_daily.c.url_id, func.sum(gsc_page_daily.c.clicks).label("clicks"))
        .where(
            gsc_page_daily.c.workspace_id == scope.workspace_id,
            gsc_page_daily.c.project_id == scope.project_id,
            gsc_page_daily.c.integration_id == integration_id,
            gsc_page_daily.c.metric_date.between(start, end),
        )
        .group_by(gsc_page_daily.c.url_id)
        .subquery("page_clicks")
    )
    return ExtraSort(
        func.coalesce(totals.c.clicks, 0),
        lambda rows: rows.outerjoin(totals, totals.c.url_id == crawl_pages.c.url_id),
    )


def _title(*, descending: bool) -> ExtraSort:
    """Case-insensitive, in byte order; a page without a title sorts last."""
    sentinel = literal("" if descending else "\U0010ffff")
    key = func.coalesce(func.nullif(func.lower(crawl_pages.c.title), ""), sentinel)
    return ExtraSort(expression.collate(key, "C"), lambda rows: rows)


def extra_sort(scope: PageScope, sort: str, *, gsc: GscWindow | None = None) -> ExtraSort | None:
    """The sort for a key of `EXTRA_SORTS` (`-` first for descending), else None. `gsc` is the
    property and window the clicks are summed over, None when there are none to sum."""
    key = sort.lstrip("-")
    descending = sort.startswith("-")
    if key == "rank":
        return _rank(scope, descending=descending)
    if key == "citations":
        return _citations(scope)
    if key == "anchor":
        return _anchor(scope, descending=descending)
    if key == "tier":
        return _tier(scope, descending=descending)
    if key == "clicks":
        return _clicks(scope, gsc)
    if key == "title":
        return _title(descending=descending)
    return None
