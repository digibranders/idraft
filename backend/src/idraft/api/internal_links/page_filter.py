"""The Pages filter as SQL (API contract; reused by the bulk bodies and the read routes).

The rows are a crawl's pages, with their URL and, outer-joined, the project's tier row:
`crawl_pages AS cp`, `urls AS u`, `project_pages AS pp`. Every condition here is on those
three.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final
from uuid import UUID

from sqlalchemy import ColumnElement, Join, and_, distinct, exists, false, func, or_, select
from sqlalchemy.orm import aliased

from idraft.api.internal_links.inventory import view_condition
from idraft.api.internal_links.problems import LinksDroppedError
from idraft.api.internal_links.status_filter import status_classes
from idraft.api.schemas.internal_links import PageFilter
from idraft.crawl.anchors import GENERIC_MIN_LINKS
from idraft.db.tables import (
    crawl_link_changes,
    crawl_links,
    crawl_page_changes,
    crawl_pages,
    page_terms,
    page_tier_levels,
    project_pages,
    urls,
)

_FLAGS: Final = {
    "orphan": crawl_pages.c.is_orphan,
    "editorial_orphan": crawl_pages.c.is_editorial_orphan,
    "deep_only_through_auto": crawl_pages.c.deep_only_through_auto,
    "placement_unknown": crawl_pages.c.links_state == "from_provider",
    "has_broken_outlinks": crawl_pages.c.broken_outlinks > 0,
    "generic_anchors": and_(
        crawl_pages.c.editorial_anchors >= GENERIC_MIN_LINKS,
        crawl_pages.c.generic_anchors * 2 > crawl_pages.c.editorial_anchors,
    ),
    "variant": crawl_pages.c.variant_of_url_id.is_not(None),
}
# Under-linked T1 pages (spec 7.2): fewer than 3 editorial linking pages, deeper than 3 clicks,
# or in the lowest quarter of equity share.
UNDER_LINKED_PAGES: Final = 3
UNDER_LINKED_DEPTH: Final = 3
# A T1 page with at least this many editorial outlinks, more than half of them to weak targets.
WEAK_MIN_OUTLINKS: Final = 3


@dataclass(frozen=True, slots=True)
class PageScope:
    workspace_id: UUID
    project_id: UUID
    run_id: UUID
    # The crawl's 25th percentile of equity share among its 200 pages (`crawl_runs.equity_p25`).
    equity_p25: float | None
    links_dropped: bool = False
    # Tier positions 1 to this one count as important for the "lost to top tiers" worklist.
    alert_max_position: int = 2

    def require_links(self) -> None:
        if self.links_dropped:
            raise LinksDroppedError


def page_rows(scope: PageScope) -> Join:
    return (
        crawl_pages.join(urls, urls.c.id == crawl_pages.c.url_id)
        .outerjoin(
            project_pages,
            and_(
                project_pages.c.workspace_id == scope.workspace_id,
                project_pages.c.project_id == scope.project_id,
                project_pages.c.url_id == crawl_pages.c.url_id,
            ),
        )
        .outerjoin(
            crawl_page_changes,
            and_(
                crawl_page_changes.c.workspace_id == scope.workspace_id,
                crawl_page_changes.c.run_id == crawl_pages.c.run_id,
                crawl_page_changes.c.url_id == crawl_pages.c.url_id,
            ),
        )
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
        conditions.append(status_classes(crawl_pages.c.status_code, tuple(found.status)))
    if found.indexable is not None:
        conditions.append(crawl_pages.c.is_indexable.is_(found.indexable))
    for flag in found.flags or ():
        conditions.append(_FLAGS[flag])
    if found.view is not None:
        conditions.append(view_condition(found.view))
    # A variant is the same page under another address (plan 09): it does not count unless asked.
    if not (found.include_variants or "variant" in (found.flags or ()) or found.view == "variants"):
        conditions.append(crawl_pages.c.variant_of_url_id.is_(None))
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
    elif found.worklist == "lost_links_top":
        conditions += [
            exists().where(
                crawl_link_changes.c.workspace_id == scope.workspace_id,
                crawl_link_changes.c.run_id == scope.run_id,
                crawl_link_changes.c.change == "lost",
                crawl_link_changes.c.scope == "editorial",
                crawl_link_changes.c.target_url_id == crawl_pages.c.url_id,
            ),
            project_pages.c.tier_id.in_(
                select(page_tier_levels.c.id).where(
                    page_tier_levels.c.workspace_id == scope.workspace_id,
                    page_tier_levels.c.position <= scope.alert_max_position,
                )
            ),
        ]
    elif found.worklist == "weak_outlinks":
        # The link rows are the crawl's links: they are gone for a dropped crawl.
        scope.require_links()
        target = aliased(crawl_pages)
        target_tier = aliased(project_pages)
        weak_targets = (
            select(func.count(distinct(crawl_links.c.target_url_id)))
            .select_from(
                # Outer joins: a target the crawl never fetched, or has no row for, is weak, and
                # still counts in `outlinks_editorial`, the denominator.
                crawl_links.outerjoin(
                    target,
                    and_(
                        target.c.workspace_id == crawl_links.c.workspace_id,
                        target.c.run_id == crawl_links.c.run_id,
                        target.c.url_id == crawl_links.c.target_url_id,
                    ),
                ).outerjoin(
                    target_tier,
                    and_(
                        target_tier.c.workspace_id == scope.workspace_id,
                        target_tier.c.project_id == scope.project_id,
                        target_tier.c.url_id == crawl_links.c.target_url_id,
                    ),
                )
            )
            .where(
                crawl_links.c.run_id == scope.run_id,
                crawl_links.c.workspace_id == scope.workspace_id,
                crawl_links.c.source_url_id == crawl_pages.c.url_id,
                crawl_links.c.scope == "editorial",
                crawl_links.c.ignored.is_(False),
                crawl_links.c.target_url_id != crawl_links.c.source_url_id,
                or_(
                    target_tier.c.tier_id.is_(None),
                    target_tier.c.tier_id == tier_of_position(scope, 4),
                    target.c.status_code.is_distinct_from(200),
                    target.c.is_indexable.is_(False),
                ),
            )
            .correlate(crawl_pages)
            .scalar_subquery()
        )
        conditions += [
            crawl_pages.c.status_code == 200,
            project_pages.c.tier_id == tier_of_position(scope, 1),
            crawl_pages.c.outlinks_editorial >= WEAK_MIN_OUTLINKS,
            weak_targets * 2 > crawl_pages.c.outlinks_editorial,
        ]
    if found.q is not None:
        conditions.append(urls.c.path.ilike(_contains(found.q), escape="\\"))
    return conditions
