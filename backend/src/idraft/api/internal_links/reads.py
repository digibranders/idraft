"""Reads of a crawl for the Pages, Links, Journey and Tier flow screens (spec 7 and 8;
decisions D10, D11 and D20).

Rows are a crawl's pages and edges with today's tiers (tiers belong to the URL, not to the
crawl). Counts in a scope are the stored per-page columns; "linked from tiers", "outlinks to
T1", reciprocal pairs and the journey's group counts are computed for the rows being read.

`core.urls` is shared by every workspace, so a URL id proves nothing: every read starts from a
row of this crawl (`seo.crawl_pages` or `seo.crawl_links` of the run, which is checked against
the project and the workspace first) and reaches a URL only through it.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from typing import Any, Final, Literal
from uuid import UUID

from sqlalchemy import (
    ARRAY,
    BigInteger,
    ColumnElement,
    FromClause,
    Integer,
    Row,
    Text,
    and_,
    any_,
    case,
    cast,
    distinct,
    exists,
    false,
    func,
    literal,
    or_,
    select,
    tuple_,
)
from sqlalchemy.dialects.postgresql import aggregate_order_by
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import aliased

from idraft.api.ai.engine_service import live_project
from idraft.api.internal_links.csv_export import EXPORT_ROWS_MAX, csv_text
from idraft.api.internal_links.extras import (
    NO_CITATIONS,
    anchor_summary,
    anchors_of,
    changes_of,
    citations_of,
    empty_anchors,
    gsc_of,
    gsc_window,
    keyword_rows,
    keywords_of,
    summarize_keywords,
)
from idraft.api.internal_links.page_filter import PageScope, page_conditions, page_rows
from idraft.api.internal_links.page_sort import GscWindow, extra_sort
from idraft.api.internal_links.page_tiers import crawl_scope
from idraft.api.internal_links.status_filter import status_classes
from idraft.api.pagination import decode_cursor, encode_cursor, invalid_cursor
from idraft.api.problems import NotFoundError
from idraft.api.schemas.common import UserRef
from idraft.api.schemas.internal_links import (
    AnchorCount,
    EdgePage,
    EdgeRow,
    Neighbor,
    NeighborFocus,
    NeighborMeta,
    PageDetail,
    PageDetailExtras,
    PageExtras,
    PageFilter,
    PageRow,
    PageTagRef,
    PlacementCount,
    ScopeCount,
    TierCount,
    TierFlow,
    TierFlowCell,
    TierRef,
    TierStat,
    Worklists,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.collectors.crawl_store import INLINE_FLOW_LINKS, flow_rows, latest_run
from idraft.crawl.anchors import mostly_generic
from idraft.crawl.scopes import LinkScope
from idraft.crawl.status import BLOCKED_STATUSES, is_blocked, is_error
from idraft.crawl.tiers import tier_code
from idraft.db.engine import workspace_transaction
from idraft.db.tables import (
    crawl_links,
    crawl_page_changes,
    crawl_pages,
    crawl_runs,
    crawl_tier_flow,
    crawl_tier_stats,
    page_terms,
    page_tier_levels,
    project_pages,
    taxonomy_terms,
    urls,
    users,
)

DETAIL_LIST: Final = 25
_DEPTH_LAST: Final = 2_147_483_647
_INT_MIN: Final = -(2**31)
_LINKING: Final = {
    LinkScope.EDITORIAL: crawl_pages.c.linking_pages_editorial,
    LinkScope.AUTO_GENERATED: crawl_pages.c.linking_pages_auto,
    LinkScope.TEMPLATE: crawl_pages.c.linking_pages_template,
    LinkScope.ALL: crawl_pages.c.linking_pages_all,
}
_OUTLINKS: Final = {
    LinkScope.EDITORIAL: crawl_pages.c.outlinks_editorial,
    LinkScope.AUTO_GENERATED: crawl_pages.c.outlinks_auto,
    LinkScope.TEMPLATE: crawl_pages.c.outlinks_template,
    LinkScope.ALL: crawl_pages.c.outlinks_all,
}
_SCOPE_RANK: Final = {"template": 0, "auto_generated": 1, "editorial": 2}
Direction = Literal["in", "out"]


async def read_scope(
    db: AsyncSession, access: WorkspaceAccess, project_id: UUID, run: UUID | None
) -> PageScope:
    """The crawl a read is about. A project that is not in the workspace is `404 not_found`, as
    on every project route, and not `404 no_crawl`, which says the project has no crawl yet."""
    await live_project(db, access, project_id)
    return await crawl_scope(db, access, project_id, run)


def _in_view(view: LinkScope, table: Any = crawl_links) -> ColumnElement[bool]:
    """The links in a scope that count: links the variants fold left out are `ignored` (plan 09)."""
    counted = table.c.ignored.is_(False)
    return counted if view is LinkScope.ALL else and_(counted, table.c.scope == view.value)


@dataclass(frozen=True, slots=True)
class Tiers:
    """The workspace's tiers by id, read once per request."""

    refs: dict[UUID, TierRef]
    positions: dict[UUID, int]

    def ref(self, tier_id: UUID | None) -> TierRef | None:
        return None if tier_id is None else self.refs.get(tier_id)

    def label(self, tier_id: UUID | None) -> str | None:
        ref = self.ref(tier_id)
        return None if ref is None else f"{ref.code} {ref.name}"


async def load_tiers(db: AsyncSession, workspace_id: UUID) -> Tiers:
    rows = (
        await db.execute(
            select(page_tier_levels.c.id, page_tier_levels.c.position, page_tier_levels.c.name)
            .where(page_tier_levels.c.workspace_id == workspace_id)
            .order_by(page_tier_levels.c.position)
        )
    ).all()
    return Tiers(
        refs={
            row.id: TierRef(tier_id=row.id, code=tier_code(row.position), name=row.name)
            for row in rows
        },
        positions={row.id: row.position for row in rows},
    )


def _flags(row: Row[Any]) -> list[str]:
    flags = []
    if row.is_orphan:
        flags.append("orphan")
    if row.is_editorial_orphan:
        flags.append("editorial_orphan")
    if row.deep_only_through_auto:
        flags.append("deep_only_through_auto")
    if row.links_state == "from_provider":
        flags.append("placement_unknown")
    status = row.status_code or 0
    if is_blocked(status):
        flags.append("blocked")
    elif is_error(status):
        flags.append("broken")
    elif 300 <= status < 400:
        flags.append("redirect")
    if not row.is_indexable:
        flags.append("non_indexable")
    if mostly_generic(row.editorial_anchors, row.generic_anchors):
        flags.append("generic_anchors")
    if row.variant_of_url_id is not None:
        flags.append("variant")
    return flags


def _sort_column(name: str, view: LinkScope) -> ColumnElement[Any]:
    """The column a list sorts by. A null sorts as a value (last when ascending for depth, first
    when ascending for equity share and status), so the keyset comparison never meets a null."""
    key = name.lstrip("-")
    if key == "path":
        return urls.c.path
    if key == "click_depth":
        return func.coalesce(crawl_pages.c.click_depth, _DEPTH_LAST)
    if key == "linking_pages":
        return _LINKING[view]
    if key == "outlinks":
        return _OUTLINKS[view]
    if key == "equity_share":
        return func.coalesce(crawl_pages.c.equity_share, -1.0)
    if key == "change":
        return func.coalesce(crawl_page_changes.c.editorial_in_delta, 0)
    if key == "indexable":
        return cast(crawl_pages.c.is_indexable, Integer)
    if key == "in_sitemap":
        return cast(crawl_pages.c.in_sitemap, Integer)
    return func.coalesce(crawl_pages.c.status_code, 0)


@dataclass(frozen=True, slots=True)
class _Sorter:
    """What a list is sorted by: the value, and the rows it is read from (joined with the
    subquery of a rank, citation or anchor sort)."""

    sort: str
    column: ColumnElement[Any]
    source: FromClause


async def _sorter(db: AsyncSession, scope: PageScope, view: LinkScope, sort: str) -> _Sorter:
    gsc: GscWindow | None = None
    if sort.lstrip("-") == "clicks":
        state = await gsc_window(db, scope)
        if state.integration_id is not None and state.window is not None:
            gsc = (state.integration_id, state.window)
    extra = extra_sort(scope, sort, gsc=gsc)
    if extra is None:
        return _Sorter(sort, _sort_column(sort, view), page_rows(scope))
    return _Sorter(sort, extra.column, extra.join(page_rows(scope)))


def _page_order(sorter: _Sorter) -> tuple[ColumnElement[Any], ColumnElement[Any]]:
    """The list's order and the CSV's: the sort column, then the id, both the way `sort` says."""
    if sorter.sort.startswith("-"):
        return sorter.column.desc(), crawl_pages.c.url_id.desc()
    return sorter.column, crawl_pages.c.url_id


def _cursor_value(name: str, raw: str) -> object:
    """The sort value a cursor holds, as the database can compare it. A cursor is not signed, so
    anything it holds that the column could not take is `400 invalid_cursor`, never a 500."""
    key = name.lstrip("-")
    try:
        if key in ("path", "anchor", "title"):
            return raw
        if key == "equity_share":
            number = float(raw)
            if not math.isfinite(number):
                raise invalid_cursor()
            return number
        whole = int(raw)
    except ValueError:
        raise invalid_cursor() from None
    if not _INT_MIN <= whole <= _DEPTH_LAST:
        raise invalid_cursor()
    return whole


def _page_select(view: LinkScope, sorter: _Sorter) -> Any:
    return select(
        crawl_pages,
        urls.c.canonical_url,
        urls.c.path,
        project_pages.c.tier_id,
        project_pages.c.tier_source,
        project_pages.c.rule_id,
        project_pages.c.set_by,
        project_pages.c.set_at,
        _LINKING[view].label("in_view_linking"),
        _OUTLINKS[view].label("in_view_outlinks"),
        sorter.column.label("sort_key"),
    ).select_from(sorter.source)


async def _page_rows(
    db: AsyncSession, scope: PageScope, view: LinkScope, tiers: Tiers, rows: Sequence[Row[Any]]
) -> list[PageRow]:
    """Rows of the Pages list with what is computed for them alone: one statement for each of
    "linked from tiers", "outlinks to T1", tags, the redirect and canonical URLs and the people
    who set tiers, whatever the number of rows."""
    ids = [row.url_id for row in rows]
    if not ids:
        return []
    linked: dict[int, list[TierCount]] = {}
    sources = aliased(project_pages)
    for target, tier_id, pages in await db.execute(
        select(
            crawl_links.c.target_url_id,
            sources.c.tier_id,
            func.count(distinct(crawl_links.c.source_url_id)),
        )
        .select_from(
            crawl_links.outerjoin(
                sources,
                and_(
                    sources.c.workspace_id == scope.workspace_id,
                    sources.c.project_id == scope.project_id,
                    sources.c.url_id == crawl_links.c.source_url_id,
                ),
            )
        )
        .where(
            crawl_links.c.run_id == scope.run_id,
            crawl_links.c.target_url_id.in_(ids),
            crawl_links.c.source_url_id != crawl_links.c.target_url_id,
            _in_view(view),
        )
        .group_by(crawl_links.c.target_url_id, sources.c.tier_id)
    ):
        linked.setdefault(target, []).append(TierCount(tier=tiers.ref(tier_id), pages=pages))
    t1 = next((tier for tier, position in tiers.positions.items() if position == 1), None)
    to_t1: dict[int, int] = {}
    if t1 is not None:
        targets = aliased(project_pages)
        to_t1 = dict(
            (
                await db.execute(
                    select(
                        crawl_links.c.source_url_id,
                        func.count(distinct(crawl_links.c.target_url_id)),
                    )
                    .join(
                        targets,
                        and_(
                            targets.c.workspace_id == scope.workspace_id,
                            targets.c.project_id == scope.project_id,
                            targets.c.url_id == crawl_links.c.target_url_id,
                        ),
                    )
                    .where(
                        crawl_links.c.run_id == scope.run_id,
                        crawl_links.c.source_url_id.in_(ids),
                        targets.c.tier_id == t1,
                        _in_view(view),
                    )
                    .group_by(crawl_links.c.source_url_id)
                )
            ).all()
        )
    tags: dict[int, list[PageTagRef]] = {}
    for url_id, term_id, name in await db.execute(
        select(page_terms.c.url_id, taxonomy_terms.c.id, taxonomy_terms.c.name)
        .join(taxonomy_terms, taxonomy_terms.c.id == page_terms.c.term_id)
        .where(
            page_terms.c.workspace_id == scope.workspace_id,
            page_terms.c.project_id == scope.project_id,
            page_terms.c.url_id.in_(ids),
        )
        .order_by(taxonomy_terms.c.name, taxonomy_terms.c.id)
    ):
        tags.setdefault(url_id, []).append(PageTagRef(term_id=term_id, name=name))
    other_ids = {
        url_id
        for row in rows
        for url_id in (row.redirect_url_id, row.canonical_url_id)
        if url_id is not None
    }
    other_urls: dict[int, str] = {}
    if other_ids:
        other_urls = dict(
            (
                await db.execute(
                    select(urls.c.id, urls.c.canonical_url).where(urls.c.id.in_(other_ids))
                )
            ).all()
        )
    setters = {row.set_by for row in rows if row.set_by is not None}
    people: dict[UUID, UserRef] = {}
    if setters:
        people = {
            row.id: UserRef(user_id=row.id, name=row.name, email=row.email)
            for row in await db.execute(
                select(users.c.id, users.c.name, users.c.email).where(users.c.id.in_(setters))
            )
        }
    return [
        PageRow(
            url_id=str(row.url_id),
            url=row.canonical_url,
            path=row.path,
            title=row.title,
            status_code=row.status_code,
            resource_type=row.resource_type,
            redirect_url=other_urls.get(row.redirect_url_id),
            is_indexable=row.is_indexable,
            non_indexable_reason=row.non_indexable_reason,
            canonical_url=other_urls.get(row.canonical_url_id),
            in_sitemap=row.in_sitemap,
            click_depth=row.click_depth,
            depth_without_auto=row.depth_without_auto,
            equity_share=row.equity_share,
            linking_pages=row.in_view_linking,
            linking_pages_all=row.linking_pages_all,
            outlinks=row.in_view_outlinks,
            outlinks_all=row.outlinks_all,
            linked_from_tiers=sorted(
                linked.get(row.url_id, []),
                key=lambda count: tiers.positions.get(count.tier.tier_id, 99) if count.tier else 99,
            ),
            outlinks_to_t1=to_t1.get(row.url_id, 0),
            broken_outlinks=row.broken_outlinks,
            redirect_outlinks=row.redirect_outlinks,
            non_indexable_outlinks=row.non_indexable_outlinks,
            top_anchor=row.top_anchor,
            tier=tiers.ref(row.tier_id),
            tier_source=row.tier_source,
            tier_rule_id=row.rule_id,
            tier_set_by=people.get(row.set_by),
            tier_set_at=row.set_at,
            tags=tags.get(row.url_id, []),
            flags=_flags(row),
        )
        for row in rows
    ]


_PAGE_CSV_HEADER: Final = (
    "url",
    "path",
    "title",
    "tier",
    "status_code",
    "indexable",
    "click_depth",
    "linking_pages",
    "linking_pages_all",
    "outlinks",
    "in_sitemap",
    "top_anchor",
    "flags",
)
_EDGE_CSV_HEADER: Final = (
    "source_url",
    "source_tier",
    "target_url",
    "target_tier",
    "anchor",
    "placement",
    "scope",
    "rel",
    "target_status",
    "target_indexable",
    "occurrences",
)


@dataclass(frozen=True, slots=True)
class PageList:
    rows: list[PageRow]
    total: int
    next_cursor: str | None
    run_id: UUID
    links_dropped: bool


@dataclass(frozen=True, slots=True)
class NeighborPage:
    rows: list[Neighbor]
    meta: NeighborMeta


@dataclass(frozen=True, slots=True)
class EdgeList:
    rows: list[EdgeRow]
    total: int
    next_cursor: str | None
    run_id: UUID
    links_dropped: bool


_SOURCE_URL = aliased(urls)
_TARGET_URL = aliased(urls)


@dataclass(frozen=True, slots=True)
class EdgeQuery:
    view: LinkScope = LinkScope.ALL
    source_tiers: tuple[UUID | None, ...] | None = None
    target_tiers: tuple[UUID | None, ...] | None = None
    tag_ids: tuple[UUID, ...] = ()
    placements: tuple[str, ...] = ()
    target_status: tuple[str, ...] = ()
    source: int | None = None
    target: int | None = None
    worklist: str | None = None
    q_source: str | None = None
    q_target: str | None = None

    def key(self) -> str:
        return repr(self)


def _edge_rows(scope: PageScope) -> Any:
    """The edges and the two URLs of each. Nothing else is joined: on a crawl without statistics
    (a fresh partition) the planner would pick a nested loop over a materialized page list for any
    further join, thousands of times slower. The tier and the status of the pages of the rows
    returned are read afterwards by `_edge_facts`, and filters on them look the page up for each
    edge by its primary key (a scalar subquery, which the planner cannot turn into a join)."""
    return crawl_links.join(_SOURCE_URL, _SOURCE_URL.c.id == crawl_links.c.source_url_id).join(
        _TARGET_URL, _TARGET_URL.c.id == crawl_links.c.target_url_id
    )


def _target_value(scope: PageScope, column: str) -> Any:
    """One column of the crawl's row of the edge's target; null when it was not crawled."""
    return (
        select(crawl_pages.c[column])
        .where(
            crawl_pages.c.workspace_id == scope.workspace_id,
            crawl_pages.c.run_id == scope.run_id,
            crawl_pages.c.url_id == crawl_links.c.target_url_id,
        )
        .scalar_subquery()
    )


def _tier_condition(
    scope: PageScope, url_id: ColumnElement[int], wanted: tuple[UUID | None, ...]
) -> ColumnElement[bool]:
    """The page `url_id` is on one of the tiers wanted; `None` is no tier, which is also a page
    with no row of its own. The tier is looked up for each edge by the primary key (a scalar
    subquery, so no join for the planner to get wrong and no row of the edges multiplied)."""
    tier = (
        select(project_pages.c.tier_id)
        .where(
            project_pages.c.workspace_id == scope.workspace_id,
            project_pages.c.project_id == scope.project_id,
            project_pages.c.url_id == url_id,
        )
        .scalar_subquery()
    )
    ids = [tier_id for tier_id in wanted if tier_id is not None]
    either = [tier.in_(ids)] if ids else []
    if None in wanted:
        either.append(tier.is_(None))
    return or_(*either) if either else false()


@dataclass(frozen=True, slots=True)
class _TargetPage:
    status_code: int | None
    is_indexable: bool | None
    redirect_url: str | None


@dataclass(frozen=True, slots=True)
class _EdgeFacts:
    """What the edges returned say of their pages: tiers (by URL id) and the crawl's own view of
    the targets. A page that is not here has no tier, or was not crawled."""

    tier_of: Mapping[int, UUID]
    targets: Mapping[int, _TargetPage]


_NOT_CRAWLED: Final = _TargetPage(status_code=None, is_indexable=None, redirect_url=None)


async def _edge_facts(db: AsyncSession, scope: PageScope, rows: Sequence[Row[Any]]) -> _EdgeFacts:
    """Two statements whatever the number of rows (the CSV's 100,000 too, so the ids go as one
    array, not as one parameter each)."""
    sources = {row.source_url_id for row in rows}
    targets = {row.target_url_id for row in rows}
    if not rows:
        return _EdgeFacts({}, {})
    redirect = aliased(urls)
    tiers = await db.execute(
        select(project_pages.c.url_id, project_pages.c.tier_id).where(
            project_pages.c.workspace_id == scope.workspace_id,
            project_pages.c.project_id == scope.project_id,
            project_pages.c.url_id == any_(literal(sorted(sources | targets), ARRAY(BigInteger))),
            project_pages.c.tier_id.is_not(None),
        )
    )
    pages = await db.execute(
        select(
            crawl_pages.c.url_id,
            crawl_pages.c.status_code,
            crawl_pages.c.is_indexable,
            redirect.c.canonical_url,
        )
        .select_from(
            crawl_pages.outerjoin(redirect, redirect.c.id == crawl_pages.c.redirect_url_id)
        )
        .where(
            crawl_pages.c.workspace_id == scope.workspace_id,
            crawl_pages.c.run_id == scope.run_id,
            crawl_pages.c.url_id == any_(literal(sorted(targets), ARRAY(BigInteger))),
        )
    )
    return _EdgeFacts(
        tier_of={row.url_id: row.tier_id for row in tiers},
        targets={
            row.url_id: _TargetPage(row.status_code, row.is_indexable, row.canonical_url)
            for row in pages
        },
    )


def _like(text: str) -> str:
    return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _edge_conditions(scope: PageScope, query: EdgeQuery) -> list[ColumnElement[bool]]:
    conditions: list[ColumnElement[bool]] = [
        crawl_links.c.workspace_id == scope.workspace_id,
        crawl_links.c.run_id == scope.run_id,
        _in_view(query.view),
    ]
    if query.source_tiers is not None:
        conditions.append(_tier_condition(scope, crawl_links.c.source_url_id, query.source_tiers))
    if query.target_tiers is not None:
        conditions.append(_tier_condition(scope, crawl_links.c.target_url_id, query.target_tiers))
    if query.tag_ids:
        tagged = select(page_terms.c.url_id).where(
            page_terms.c.workspace_id == scope.workspace_id,
            page_terms.c.project_id == scope.project_id,
            page_terms.c.term_id.in_(query.tag_ids),
        )
        conditions.append(
            or_(crawl_links.c.source_url_id.in_(tagged), crawl_links.c.target_url_id.in_(tagged))
        )
    if query.placements:
        conditions.append(crawl_links.c.placement.in_(query.placements))
    if query.target_status:
        conditions.append(status_classes(_target_value(scope, "status_code"), query.target_status))
    if query.source is not None:
        conditions.append(crawl_links.c.source_url_id == query.source)
    if query.target is not None:
        conditions.append(crawl_links.c.target_url_id == query.target)
    if query.worklist == "broken_and_redirected":
        # A page that refused the crawler is unknown, not broken: it is no work for the owner.
        status = _target_value(scope, "status_code")
        conditions.append(and_(status >= 300, status.not_in(BLOCKED_STATUSES)))
    elif query.worklist == "links_to_non_indexable":
        conditions.append(_target_value(scope, "is_indexable").is_(False))
    if query.q_source:
        conditions.append(_SOURCE_URL.c.path.ilike(_like(query.q_source), escape="\\"))
    if query.q_target:
        conditions.append(_TARGET_URL.c.path.ilike(_like(query.q_target), escape="\\"))
    return conditions


def _edge_select(scope: PageScope) -> Any:
    return select(
        crawl_links,
        _SOURCE_URL.c.canonical_url.label("source_url"),
        _SOURCE_URL.c.path.label("source_path"),
        _TARGET_URL.c.canonical_url.label("target_url"),
        _TARGET_URL.c.path.label("target_path"),
    ).select_from(_edge_rows(scope))


def _edge_order() -> tuple[ColumnElement[Any], ColumnElement[Any], ColumnElement[Any]]:
    """Template links first, then auto-generated, then editorial; then the target's path."""
    return case(_SCOPE_RANK, value=crawl_links.c.scope), _TARGET_URL.c.path, crawl_links.c.id


def _edge_row(row: Row[Any], tiers: Tiers, facts: _EdgeFacts) -> EdgeRow:
    tier_of = facts.tier_of
    target = facts.targets.get(row.target_url_id, _NOT_CRAWLED)
    return EdgeRow(
        link_id=str(row.id),
        source=EdgePage(
            url_id=str(row.source_url_id),
            url=row.source_url,
            path=row.source_path,
            tier=tiers.ref(tier_of.get(row.source_url_id)),
            status_code=None,
            redirect_url=None,
            is_indexable=None,
        ),
        target=EdgePage(
            url_id=str(row.target_url_id),
            url=row.target_url,
            path=row.target_path,
            tier=tiers.ref(tier_of.get(row.target_url_id)),
            status_code=target.status_code,
            redirect_url=target.redirect_url,
            is_indexable=target.is_indexable,
        ),
        anchor=row.anchor,
        kind=row.kind,
        placement=row.placement,
        scope=row.scope,
        rel=list(row.rel),
        is_followed=row.is_followed,
        occurrences=row.occurrences,
    )


def _edge_cursor(cursor: str, scope: Mapping[str, object]) -> tuple[int, str, int]:
    key = decode_cursor(cursor, scope=scope)
    if len(key) != 3:
        raise invalid_cursor()
    rank, path, link_id = key
    if not (isinstance(rank, int) and isinstance(path, str) and isinstance(link_id, int)):
        raise invalid_cursor()
    if not 0 <= rank < len(_SCOPE_RANK):
        raise invalid_cursor()
    return rank, path, link_id


def _page_cursor(cursor: str, scope: Mapping[str, object], sort: str) -> tuple[object, int]:
    key = decode_cursor(cursor, scope=scope)
    if len(key) != 2 or not isinstance(key[1], int):
        raise invalid_cursor()
    return _cursor_value(sort, str(key[0])), key[1]


async def neighbor_page(
    db: AsyncSession,
    scope: PageScope,
    tiers: Tiers,
    url_id: int,
    direction: Direction,
    view: LinkScope,
    limit: int,
    offset: int,
) -> NeighborPage:
    """One journey step (spec 8): the pages on one side of the focus in the scope in view, with
    the link between, tier, metrics, `has_children` and `reciprocal`, sorted by tier then
    equity share (then path, so a tie keeps its place between two reads); and the pages of the
    other scopes as counts for the group cards. The canvas decides "new", "back link" and "seen
    elsewhere" itself."""
    focus = (
        await db.execute(
            select(crawl_pages.c.status_code, crawl_pages.c.redirect_url_id).where(
                crawl_pages.c.workspace_id == scope.workspace_id,
                crawl_pages.c.run_id == scope.run_id,
                crawl_pages.c.url_id == url_id,
            )
        )
    ).one_or_none()
    if focus is None:
        raise NotFoundError
    mine, theirs = (
        (crawl_links.c.source_url_id, crawl_links.c.target_url_id)
        if direction == "out"
        else (crawl_links.c.target_url_id, crawl_links.c.source_url_id)
    )
    on_side = and_(
        crawl_links.c.workspace_id == scope.workspace_id,
        crawl_links.c.run_id == scope.run_id,
        mine == url_id,
        theirs != url_id,
        crawl_links.c.ignored.is_(False),
    )
    redirect_child = direction == "out" and focus.redirect_url_id is not None
    if redirect_child:
        # A redirect has one child, its target (spec 7.5); it is not a link of the page.
        grouped = select(
            literal(focus.redirect_url_id, BigInteger).label("url_id"),
            literal(0).label("links"),
            literal(1).label("occurrences"),
            literal(True).label("followed"),
            literal(None, Text).label("anchor"),
            literal(None, Text).label("placement"),
            literal(None, Text).label("scope"),
            literal("", Text).label("rel"),
        ).subquery()
    else:

        def first(column: Any) -> Any:
            ordered = aggregate_order_by(column, crawl_links.c.occurrences.desc(), crawl_links.c.id)
            return func.array_agg(ordered)[1]

        grouped = (
            select(
                theirs.label("url_id"),
                func.count().label("links"),
                func.sum(crawl_links.c.occurrences).label("occurrences"),
                func.bool_or(crawl_links.c.is_followed).label("followed"),
                first(crawl_links.c.anchor).label("anchor"),
                first(crawl_links.c.placement).label("placement"),
                first(crawl_links.c.scope).label("scope"),
                first(func.array_to_string(crawl_links.c.rel, " ")).label("rel"),
            )
            .where(on_side, _in_view(view))
            .group_by(theirs)
            .subquery()
        )
    page = aliased(crawl_pages)
    tier = aliased(project_pages)
    level = aliased(page_tier_levels)
    reverse = aliased(crawl_links)
    back = and_(
        reverse.c.run_id == scope.run_id,
        reverse.c.source_url_id == (grouped.c.url_id if direction == "out" else url_id),
        reverse.c.target_url_id == (url_id if direction == "out" else grouped.c.url_id),
        _in_view(view, reverse),
    )
    side = _OUTLINKS if direction == "out" else _LINKING
    children = getattr(page.c, side[view].name)
    rows = (
        await db.execute(
            select(
                grouped,
                urls.c.canonical_url,
                urls.c.path,
                page.c.title,
                page.c.status_code,
                page.c.redirect_url_id,
                page.c.click_depth,
                page.c.equity_share,
                getattr(page.c, _LINKING[view].name).label("in_view_linking"),
                page.c.linking_pages_all,
                tier.c.tier_id,
                (func.coalesce(children, 0) > 0).label("has_children"),
                exists().where(back).label("reciprocal"),
            )
            .select_from(
                grouped.join(urls, urls.c.id == grouped.c.url_id)
                .outerjoin(
                    page, and_(page.c.run_id == scope.run_id, page.c.url_id == grouped.c.url_id)
                )
                .outerjoin(
                    tier,
                    and_(
                        tier.c.workspace_id == scope.workspace_id,
                        tier.c.project_id == scope.project_id,
                        tier.c.url_id == grouped.c.url_id,
                    ),
                )
                .outerjoin(level, level.c.id == tier.c.tier_id)
            )
            .order_by(
                level.c.position.asc().nulls_last(),
                page.c.equity_share.desc().nulls_last(),
                urls.c.path,
                grouped.c.url_id,
            )
            .limit(limit)
            .offset(offset)
        )
    ).all()
    total = (await db.execute(select(func.count()).select_from(grouped))).scalar_one()
    others: list[ScopeCount] = []
    if view is not LinkScope.ALL and not redirect_child:
        others = [
            ScopeCount(scope=edge_scope, pages=pages)
            for edge_scope, pages in await db.execute(
                select(crawl_links.c.scope, func.count(distinct(theirs)))
                .where(on_side, crawl_links.c.scope != view.value)
                .group_by(crawl_links.c.scope)
                .order_by(crawl_links.c.scope)
            )
        ]
    neighbors = [
        Neighbor(
            url_id=str(row.url_id),
            url=row.canonical_url,
            path=row.path,
            title=row.title,
            status_code=row.status_code,
            redirect_url_id=None if row.redirect_url_id is None else str(row.redirect_url_id),
            tier=tiers.ref(row.tier_id),
            click_depth=row.click_depth,
            linking_pages=row.in_view_linking or 0,
            linking_pages_all=row.linking_pages_all or 0,
            equity_share=row.equity_share,
            anchor=row.anchor,
            placement=row.placement,
            scope=row.scope,
            is_followed=row.followed,
            rel=row.rel.split() if row.rel else [],
            occurrences=int(row.occurrences),
            links=int(row.links),
            has_children=bool(row.has_children),
            reciprocal=bool(row.reciprocal),
        )
        for row in rows
    ]
    meta = NeighborMeta(
        run_id=scope.run_id,
        url_id=str(url_id),
        direction=direction,
        scope=view.value,
        total=total,
        other_scopes=others,
        focus=NeighborFocus(
            url_id=str(url_id),
            status_code=focus.status_code,
            redirect_url_id=None if focus.redirect_url_id is None else str(focus.redirect_url_id),
        ),
    )
    return NeighborPage(rows=neighbors, meta=meta)


async def attach_extras(
    db: AsyncSession, scope: PageScope, rows: list[PageRow], include: set[str]
) -> None:
    """Fills `row.extras` for the parts asked for, one grouped query per part."""
    ids = [int(row.url_id) for row in rows]
    if not ids:
        return
    changes = await changes_of(db, scope, ids) if "changes" in include else None
    keywords = await keywords_of(db, scope, ids) if include & {"keywords", "anchors"} else {}
    citations = await citations_of(db, scope, ids) if "citations" in include else {}
    anchors = (
        await anchors_of(db, scope, ids, keywords)
        if "anchors" in include and not scope.links_dropped
        else {}
    )
    gsc = await gsc_of(db, scope, ids) if "gsc" in include else {}
    for row in rows:
        url = int(row.url_id)
        row.extras = PageExtras(
            change=None if changes is None else changes.get(url),
            keywords=summarize_keywords(keywords.get(url, [])) if "keywords" in include else None,
            citations=citations.get(url, NO_CITATIONS) if "citations" in include else None,
            # A crawl without its links keeps no anchor list: the column shows nothing.
            anchors=(
                anchor_summary(anchors.get(url) or empty_anchors(keywords.get(url, [])))
                if "anchors" in include and not scope.links_dropped
                else None
            ),
            gsc=gsc.get(url),
        )


class LinkReadService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        # One snapshot for the page, its counts and its total.
        return workspace_transaction(
            self._sessions,
            access.workspace_id,
            user_id=access.user_id,
            isolation_level="REPEATABLE READ",
        )

    async def pages(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        run: UUID | None,
        view: LinkScope,
        found: PageFilter,
        sort: str,
        cursor: str | None,
        limit: int,
        include: Sequence[str] = (),
    ) -> PageList:
        async with self._transaction(access) as db:
            scope = await read_scope(db, access, project_id, run)
            tiers = await load_tiers(db, access.workspace_id)
            conditions = page_conditions(found, scope)
            total = (
                await db.execute(
                    select(func.count()).select_from(page_rows(scope)).where(*conditions)
                )
            ).scalar_one()
            sorter = await _sorter(db, scope, view, sort)
            column = sorter.column
            descending = sort.startswith("-")
            cursor_scope = {
                "run": str(scope.run_id),
                "view": view.value,
                "sort": sort,
                "filter": found.model_dump(mode="json"),
            }
            statement = _page_select(view, sorter).where(*conditions)
            if cursor is not None:
                value, after_id = _page_cursor(cursor, cursor_scope, sort)
                after = tuple_(column, crawl_pages.c.url_id)
                bound = tuple_(literal(value), literal(after_id, BigInteger))
                statement = statement.where(after < bound if descending else after > bound)
            order = _page_order(sorter)
            rows = (await db.execute(statement.order_by(*order).limit(limit + 1))).all()
            more = len(rows) > limit
            rows = rows[:limit]
            next_cursor = (
                encode_cursor([str(rows[-1].sort_key), rows[-1].url_id], scope=cursor_scope)
                if more
                else None
            )
            page_rows_out = await _page_rows(db, scope, view, tiers, rows)
            if include:
                await attach_extras(db, scope, page_rows_out, set(include))
            return PageList(
                rows=page_rows_out,
                total=total,
                next_cursor=next_cursor,
                run_id=scope.run_id,
                links_dropped=scope.links_dropped,
            )

    async def pages_csv(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        run: UUID | None,
        view: LinkScope,
        found: PageFilter,
        sort: str,
    ) -> str:
        async with self._transaction(access) as db:
            scope = await read_scope(db, access, project_id, run)
            tiers = await load_tiers(db, access.workspace_id)
            sorter = await _sorter(db, scope, view, sort)
            rows = (
                await db.execute(
                    _page_select(view, sorter)
                    .where(*page_conditions(found, scope))
                    .order_by(*_page_order(sorter))
                    .limit(EXPORT_ROWS_MAX)
                )
            ).all()
        return csv_text(
            _PAGE_CSV_HEADER,
            (
                (
                    row.canonical_url,
                    row.path,
                    row.title,
                    tiers.label(row.tier_id),
                    row.status_code,
                    row.is_indexable,
                    row.click_depth,
                    row.in_view_linking,
                    row.linking_pages_all,
                    row.in_view_outlinks,
                    row.in_sitemap,
                    row.top_anchor,
                    " ".join(_flags(row)),
                )
                for row in rows
            ),
        )

    async def neighbors(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        run: UUID | None,
        url_id: int,
        direction: Direction,
        view: LinkScope,
        limit: int,
        offset: int,
    ) -> NeighborPage:
        async with self._transaction(access) as db:
            scope = await read_scope(db, access, project_id, run)
            scope.require_links()
            tiers = await load_tiers(db, access.workspace_id)
            return await neighbor_page(db, scope, tiers, url_id, direction, view, limit, offset)

    async def page_detail(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        run: UUID | None,
        url_id: int,
        view: LinkScope,
    ) -> PageDetail:
        async with self._transaction(access) as db:
            scope = await read_scope(db, access, project_id, run)
            tiers = await load_tiers(db, access.workspace_id)
            rows = (
                await db.execute(
                    _page_select(view, await _sorter(db, scope, view, "path")).where(
                        crawl_pages.c.workspace_id == scope.workspace_id,
                        crawl_pages.c.run_id == scope.run_id,
                        crawl_pages.c.url_id == url_id,
                    )
                )
            ).all()
            if not rows:
                raise NotFoundError
            (page,) = await _page_rows(db, scope, view, tiers, rows)
            by_placement = [
                PlacementCount(placement=placement, pages=pages)
                for placement, pages in await db.execute(
                    select(
                        crawl_links.c.placement, func.count(distinct(crawl_links.c.source_url_id))
                    )
                    .where(
                        crawl_links.c.run_id == scope.run_id,
                        crawl_links.c.target_url_id == url_id,
                        crawl_links.c.source_url_id != url_id,
                        _in_view(view),
                    )
                    .group_by(crawl_links.c.placement)
                    .order_by(crawl_links.c.placement)
                )
            ]
            anchors = [
                AnchorCount(anchor=anchor, links=int(uses))
                for anchor, uses in await db.execute(
                    select(crawl_links.c.anchor, func.sum(crawl_links.c.occurrences).label("uses"))
                    .where(
                        crawl_links.c.run_id == scope.run_id,
                        crawl_links.c.target_url_id == url_id,
                        crawl_links.c.anchor != "",
                        _in_view(view),
                    )
                    .group_by(crawl_links.c.anchor)
                    .order_by(func.sum(crawl_links.c.occurrences).desc(), crawl_links.c.anchor)
                    .limit(5)
                )
            ]
            linking = await neighbor_page(db, scope, tiers, url_id, "in", view, DETAIL_LIST, 0)
            outlinks = await neighbor_page(db, scope, tiers, url_id, "out", view, DETAIL_LIST, 0)
            url = int(page.url_id)
            kw = (await keywords_of(db, scope, [url])).get(url, [])
            anchor_detail = (await anchors_of(db, scope, [url], {url: kw})).get(url)
            changed = await changes_of(db, scope, [url])
            return PageDetail(
                page=page,
                linking_by_tier=page.linked_from_tiers,
                linking_by_placement=by_placement,
                top_anchors=anchors,
                linking_pages=linking.rows,
                outlinks=outlinks.rows,
                linking_pages_total=linking.meta.total,
                outlinks_total=outlinks.meta.total,
                links_available=not scope.links_dropped,
                extras=PageDetailExtras(
                    change=None if changed is None else changed.get(url),
                    keywords=keyword_rows(kw),
                    citations=(await citations_of(db, scope, [url])).get(url, NO_CITATIONS),
                    anchors=anchor_detail or empty_anchors(kw),
                    gsc=(await gsc_of(db, scope, [url]))[url],
                ),
            )

    async def tier_flow(
        self, access: WorkspaceAccess, project_id: UUID, *, run: UUID | None, view: LinkScope
    ) -> TierFlow:
        async with self._transaction(access) as db:
            scope = await read_scope(db, access, project_id, run)
            tiers = await load_tiers(db, access.workspace_id)
            stale: bool = (
                await db.execute(
                    select(crawl_runs.c.tier_flow_stale).where(
                        crawl_runs.c.workspace_id == access.workspace_id,
                        crawl_runs.c.id == scope.run_id,
                    )
                )
            ).scalar_one()
            latest = await latest_run(db, access.workspace_id, project_id)
            links_stored: int = (
                await db.execute(
                    select(crawl_runs.c.links_stored).where(
                        crawl_runs.c.workspace_id == access.workspace_id,
                        crawl_runs.c.id == scope.run_id,
                    )
                )
            ).scalar_one()
            if (
                scope.run_id != latest
                and not scope.links_dropped
                and links_stored <= INLINE_FLOW_LINKS
            ):
                # An older crawl follows today's tiers: its stored rows are those of the day it
                # was the latest (plan 04 D15).
                live_cells, live_stats = await flow_rows(
                    db,
                    workspace_id=access.workspace_id,
                    project_id=project_id,
                    run_id=scope.run_id,
                )
                strip_by_tier = {row.tier_id: row for row in live_stats}
                return TierFlow(
                    run_id=scope.run_id,
                    scope=view.value,
                    stale=False,
                    cells=[
                        TierFlowCell(
                            from_tier=tiers.ref(cell.from_tier_id),
                            to_tier=tiers.ref(cell.to_tier_id),
                            links=cell.links,
                        )
                        for cell in live_cells
                        if cell.scope == view.value
                    ],
                    tiers=[
                        TierStat(
                            tier=ref,
                            pages=0 if (live := strip_by_tier.get(tier_id)) is None else live.pages,
                            equity_share=0.0 if live is None else live.equity_share,
                            average_depth=None if live is None else live.average_depth,
                        )
                        for tier_id, ref in [*tiers.refs.items(), (None, None)]
                    ],
                )
            # Stored rows of an older crawl are those of the day it was the latest (D15).
            stale = stale or scope.run_id != latest
            cells = [
                TierFlowCell(
                    from_tier=tiers.ref(row.from_tier_id),
                    to_tier=tiers.ref(row.to_tier_id),
                    links=row.links,
                )
                for row in await db.execute(
                    select(crawl_tier_flow).where(
                        crawl_tier_flow.c.run_id == scope.run_id,
                        crawl_tier_flow.c.scope == view.value,
                    )
                )
            ]
            stats = {
                row.tier_id: row
                for row in await db.execute(
                    select(crawl_tier_stats).where(crawl_tier_stats.c.run_id == scope.run_id)
                )
            }
            strip = [
                TierStat(
                    tier=ref,
                    pages=0 if (row := stats.get(tier_id)) is None else row.pages,
                    equity_share=0.0 if row is None else row.equity_share,
                    average_depth=None if row is None else row.average_depth,
                )
                for tier_id, ref in [*tiers.refs.items(), (None, None)]
            ]
            return TierFlow(
                run_id=scope.run_id, scope=view.value, stale=stale, cells=cells, tiers=strip
            )

    async def worklists(
        self, access: WorkspaceAccess, project_id: UUID, *, run: UUID | None
    ) -> Worklists:
        async with self._transaction(access) as db:
            scope = await read_scope(db, access, project_id, run)

            async def pages(worklist: str) -> int:
                found = PageFilter.model_validate({"worklist": worklist})
                return (
                    await db.execute(
                        select(func.count())
                        .select_from(page_rows(scope))
                        .where(*page_conditions(found, scope))
                    )
                ).scalar_one()

            async def links(worklist: str) -> int:
                return (
                    await db.execute(
                        select(func.count())
                        .select_from(_edge_rows(scope))
                        .where(*_edge_conditions(scope, EdgeQuery(worklist=worklist)))
                    )
                ).scalar_one()

            return Worklists(
                run_id=scope.run_id,
                under_linked_t1=await pages("under_linked_t1"),
                orphans=await pages("orphans"),
                editorial_orphans=await pages("editorial_orphans"),
                deep_only_through_auto=await pages("deep_only_through_auto"),
                lost_links_top=await pages("lost_links_top"),
                # The filter answers 410 for a crawl whose links are gone; the count is 0.
                weak_outlinks=0 if scope.links_dropped else await pages("weak_outlinks"),
                broken_and_redirected=await links("broken_and_redirected"),
                links_to_non_indexable=await links("links_to_non_indexable"),
                may_be_incomplete=bool(
                    (
                        await db.execute(
                            select(crawl_runs.c.pages_blocked).where(
                                crawl_runs.c.workspace_id == access.workspace_id,
                                crawl_runs.c.id == scope.run_id,
                            )
                        )
                    ).scalar_one_or_none()
                ),
            )

    async def edges(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        run: UUID | None,
        query: EdgeQuery,
        cursor: str | None,
        limit: int,
    ) -> EdgeList:
        async with self._transaction(access) as db:
            scope = await read_scope(db, access, project_id, run)
            scope.require_links()
            tiers = await load_tiers(db, access.workspace_id)
            conditions = _edge_conditions(scope, query)
            total = (
                await db.execute(
                    select(func.count()).select_from(_edge_rows(scope)).where(*conditions)
                )
            ).scalar_one()
            order = _edge_order()
            statement = _edge_select(scope).where(*conditions)
            cursor_scope = {"run": str(scope.run_id), "query": query.key()}
            if cursor is not None:
                place, path, link_id = _edge_cursor(cursor, cursor_scope)
                statement = statement.where(
                    tuple_(*order)
                    > tuple_(literal(place), literal(path, Text), literal(link_id, BigInteger))
                )
            rows = (await db.execute(statement.order_by(*order).limit(limit + 1))).all()
            more = len(rows) > limit
            rows = rows[:limit]
            facts = await _edge_facts(db, scope, rows)
            next_cursor = (
                encode_cursor(
                    [_SCOPE_RANK[rows[-1].scope], rows[-1].target_path, rows[-1].id],
                    scope=cursor_scope,
                )
                if more
                else None
            )
            return EdgeList(
                rows=[_edge_row(row, tiers, facts) for row in rows],
                total=total,
                next_cursor=next_cursor,
                run_id=scope.run_id,
                links_dropped=scope.links_dropped,
            )

    async def edges_csv(
        self, access: WorkspaceAccess, project_id: UUID, *, run: UUID | None, query: EdgeQuery
    ) -> str:
        async with self._transaction(access) as db:
            scope = await read_scope(db, access, project_id, run)
            scope.require_links()
            tiers = await load_tiers(db, access.workspace_id)
            rows = (
                await db.execute(
                    _edge_select(scope)
                    .where(*_edge_conditions(scope, query))
                    .order_by(*_edge_order())
                    .limit(EXPORT_ROWS_MAX)
                )
            ).all()
            facts = await _edge_facts(db, scope, rows)
        return csv_text(
            _EDGE_CSV_HEADER,
            (
                (
                    row.source_url,
                    tiers.label(facts.tier_of.get(row.source_url_id)),
                    row.target_url,
                    tiers.label(facts.tier_of.get(row.target_url_id)),
                    row.anchor,
                    row.placement,
                    row.scope,
                    " ".join(row.rel),
                    facts.targets.get(row.target_url_id, _NOT_CRAWLED).status_code,
                    facts.targets.get(row.target_url_id, _NOT_CRAWLED).is_indexable,
                    row.occurrences,
                )
                for row in rows
            ),
        )
