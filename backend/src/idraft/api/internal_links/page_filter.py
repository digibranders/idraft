"""The Pages filter as SQL (API contract; reused by the bulk bodies and the read routes).

The rows are a crawl's pages, with their URL and, outer-joined, the project's tier row:
`crawl_pages AS cp`, `urls AS u`, `project_pages AS pp`. Every condition here is on those
three.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final
from uuid import UUID

from sqlalchemy import ColumnElement, Join, and_, exists, false, or_, select

from idraft.api.schemas.internal_links import PageFilter
from idraft.db.tables import crawl_pages, page_terms, page_tier_levels, project_pages, urls

_STATUS: Final = {"2xx": (200, 299), "3xx": (300, 399), "4xx": (400, 499), "5xx": (500, 599)}
_FLAGS: Final = {
    "orphan": crawl_pages.c.is_orphan,
    "editorial_orphan": crawl_pages.c.is_editorial_orphan,
    "deep_only_through_auto": crawl_pages.c.deep_only_through_auto,
    "placement_unknown": crawl_pages.c.links_state == "from_provider",
    "has_broken_outlinks": crawl_pages.c.broken_outlinks > 0,
}
# Under-linked T1 pages (spec 7.2): fewer than 3 editorial linking pages, deeper than 3 clicks,
# or in the lowest quarter of equity share.
UNDER_LINKED_PAGES: Final = 3
UNDER_LINKED_DEPTH: Final = 3


@dataclass(frozen=True, slots=True)
class PageScope:
    workspace_id: UUID
    project_id: UUID
    run_id: UUID
    # The crawl's 25th percentile of equity share among its 200 pages (`crawl_runs.equity_p25`).
    equity_p25: float | None


def page_rows(scope: PageScope) -> Join:
    return crawl_pages.join(urls, urls.c.id == crawl_pages.c.url_id).outerjoin(
        project_pages,
        and_(
            project_pages.c.workspace_id == scope.workspace_id,
            project_pages.c.project_id == scope.project_id,
            project_pages.c.url_id == crawl_pages.c.url_id,
        ),
    )


def tier_of_position(scope: PageScope, position: int) -> ColumnElement[UUID]:
    return (
        select(page_tier_levels.c.id)
        .where(
            page_tier_levels.c.workspace_id == scope.workspace_id,
            page_tier_levels.c.position == position,
        )
        .scalar_subquery()
    )


def _contains(text: str) -> str:
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def page_conditions(found: PageFilter, scope: PageScope) -> list[ColumnElement[bool]]:
    conditions: list[ColumnElement[bool]] = [
        crawl_pages.c.workspace_id == scope.workspace_id,
        crawl_pages.c.run_id == scope.run_id,
    ]
    if found.tier_ids is not None:
        ids = [tier for tier in found.tier_ids if isinstance(tier, UUID)]
        either: list[ColumnElement[bool]] = [project_pages.c.tier_id.in_(ids)] if ids else []
        if "none" in found.tier_ids:
            either.append(project_pages.c.tier_id.is_(None))
        conditions.append(or_(*either) if either else false())
    if found.tag_ids:
        conditions.append(
            exists().where(
                page_terms.c.workspace_id == scope.workspace_id,
                page_terms.c.project_id == scope.project_id,
                page_terms.c.url_id == crawl_pages.c.url_id,
                page_terms.c.term_id.in_(found.tag_ids),
            )
        )
    if found.status:
        conditions.append(
            or_(*(crawl_pages.c.status_code.between(*_STATUS[name]) for name in found.status))
        )
    if found.indexable is not None:
        conditions.append(crawl_pages.c.is_indexable.is_(found.indexable))
    for flag in found.flags or ():
        conditions.append(_FLAGS[flag])
    if found.worklist == "under_linked_t1":
        weak = [
            crawl_pages.c.linking_pages_editorial < UNDER_LINKED_PAGES,
            crawl_pages.c.click_depth > UNDER_LINKED_DEPTH,
        ]
        if scope.equity_p25 is not None:
            weak.append(crawl_pages.c.equity_share <= scope.equity_p25)
        conditions += [project_pages.c.tier_id == tier_of_position(scope, 1), or_(*weak)]
    elif found.worklist == "orphans":
        conditions.append(crawl_pages.c.is_orphan)
    elif found.worklist == "editorial_orphans":
        conditions.append(crawl_pages.c.is_editorial_orphan)
    elif found.worklist == "deep_only_through_auto":
        conditions.append(crawl_pages.c.deep_only_through_auto)
    if found.q is not None:
        conditions.append(urls.c.path.ilike(_contains(found.q), escape="\\"))
    return conditions
