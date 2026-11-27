"""The words of the Pages spec section 4 as SQL, once.

Every number the Pages screens show and every list they open is built from these predicates, so a
number and the list behind it cannot disagree. The rows are `crawl_pages AS cp` joined to `urls`.
A view is a name for one predicate (`view_condition`)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Final, get_args

from sqlalchemy import ColumnElement, and_, case, false, func, not_, or_, select, true

from idraft.api.schemas.internal_links import PageView
from idraft.crawl.status import BLOCKED_STATUSES
from idraft.db.tables import crawl_pages, urls

if TYPE_CHECKING:
    # `page_filter` imports this module, so the scope is named for the checker only.
    from idraft.api.internal_links.page_filter import PageScope

# The sections the Overview lists; the rest are only counted.
SECTIONS_MAX: Final = 50
# The Overview's depth rows: 0 to 6 clicks, the last one is "6 and more".
DEPTH_ROWS: Final = 7

_STATUS: Final = crawl_pages.c.status_code


def _counted() -> ColumnElement[bool]:
    return crawl_pages.c.variant_of_url_id.is_(None)


def _variant() -> ColumnElement[bool]:
    return crawl_pages.c.variant_of_url_id.is_not(None)


def _live() -> ColumnElement[bool]:
    # Never null, so "not live" also holds for a page with no status.
    return and_(
        _counted(), func.coalesce(_STATUS == 200, false()), crawl_pages.c.resource_type == "html"
    )


def _redirected() -> ColumnElement[bool]:
    return and_(_counted(), _STATUS.between(300, 399))


def _blocked() -> ColumnElement[bool]:
    return and_(_counted(), _STATUS.in_(BLOCKED_STATUSES))


def _client_error() -> ColumnElement[bool]:
    return and_(_counted(), _STATUS.between(400, 499), _STATUS.not_in(BLOCKED_STATUSES))


def _server_error() -> ColumnElement[bool]:
    return and_(_counted(), _STATUS.between(500, 599))


def _other() -> ColumnElement[bool]:
    # A page with no status makes every test below null, which is "other": coalesce the whole test.
    none_of_them = not_(or_(_live(), _redirected(), _blocked(), _client_error(), _server_error()))
    return and_(_counted(), func.coalesce(none_of_them, true()))


def _indexable() -> ColumnElement[bool]:
    return and_(_live(), crawl_pages.c.is_indexable)


def _reachable() -> ColumnElement[bool]:
    return and_(_live(), crawl_pages.c.click_depth.is_not(None))


def section_of() -> ColumnElement[str]:
    """The first folder of the path (C3 of the plan, spec section 4): `/blog/` for `/blog/post`,
    `/` for a page with one segment or none."""
    first = func.split_part(urls.c.path, "/", 2)
    deeper = func.split_part(urls.c.path, "/", 3) != ""
    return case((deeper, "/" + first + "/"), else_="/")


def depth_bucket() -> ColumnElement[int]:
    """`least(click_depth, 6)`: the row 6 is 6 clicks and more."""
    return func.least(crawl_pages.c.click_depth, 6)


def view_condition(view: PageView) -> ColumnElement[bool]:
    """The predicate of one view of the Pages list (plan contract C2)."""
    match view:
        case "live":
            return _live()
        case "indexable":
            return _indexable()
        case "not_indexable":
            return and_(_live(), not_(crawl_pages.c.is_indexable))
        case "redirects":
            return _redirected()
        case "errors":
            return or_(_client_error(), _server_error())
        case "client_errors":
            return _client_error()
        case "server_errors":
            return _server_error()
        case "blocked":
            return _blocked()
        case "other":
            return _other()
        case "variants":
            return _variant()
        case "in_sitemap_indexable":
            return and_(_indexable(), crawl_pages.c.in_sitemap)
        case "not_in_sitemap":
            return and_(_indexable(), not_(crawl_pages.c.in_sitemap))
        case "sitemap_not_live":
            return and_(_counted(), crawl_pages.c.in_sitemap, not_(_live()))
        case "sitemap_not_indexable":
            return and_(_live(), crawl_pages.c.in_sitemap, not_(crawl_pages.c.is_indexable))
        case "reachable":
            return _reachable()
        case "unreachable":
            return and_(_live(), crawl_pages.c.click_depth.is_(None))


def overview_statement(scope: PageScope) -> Any:
    """One row: `addresses`, one count per view of `PageView` (labelled with the view id),
    `orphans`, and `depth_0` to `depth_6`. Every count is a `FILTER` of the one pass."""
    counts = [func.count().filter(view_condition(view)).label(view) for view in get_args(PageView)]
    depths = [
        func.count().filter(and_(_reachable(), depth_bucket() == clicks)).label(f"depth_{clicks}")
        for clicks in range(DEPTH_ROWS)
    ]
    return (
        select(
            func.count().label("addresses"),
            *counts,
            func.count().filter(and_(_counted(), crawl_pages.c.is_orphan)).label("orphans"),
            *depths,
        )
        .select_from(crawl_pages.join(urls, urls.c.id == crawl_pages.c.url_id))
        .where(
            crawl_pages.c.workspace_id == scope.workspace_id, crawl_pages.c.run_id == scope.run_id
        )
    )
