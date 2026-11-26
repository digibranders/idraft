"""The checks of the Issues page as SQL conditions (spec section 4).

A condition is true for a row of `seo.crawl_pages` (joined with `core.urls`, as `page_rows`
joins them) that the check found. The list of checks counts with it and the Pages list filters
with it, so a check has one definition. Words used: a page is *counted* when it is not a variant
of another crawled page, *live* when it is counted, answered 200 and is HTML, *redirected* when
it is counted and answered 3xx, *broken* when it is counted and answered 400 or more, except the
statuses that only refuse the crawler (`crawl/status.py`)."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Final, Protocol
from uuid import UUID

from sqlalchemy import ColumnElement, FromClause, Select, and_, exists, false, func, or_, select
from sqlalchemy.orm import aliased

from idraft.api.issues.catalogue import BY_ID, DEPTH_MAX, PATH_MAX, TITLE_MAX, TITLE_MIN
from idraft.crawl.status import BLOCKED_STATUSES
from idraft.db.tables import crawl_links, crawl_pages, crawl_runs, urls


class CrawlRef(Protocol):
    @property
    def workspace_id(self) -> UUID: ...
    @property
    def project_id(self) -> UUID: ...
    @property
    def run_id(self) -> UUID: ...


def _counted(page: FromClause) -> ColumnElement[bool]:
    return page.c.variant_of_url_id.is_(None)


def _html_ok(page: FromClause) -> ColumnElement[bool]:
    return and_(page.c.status_code == 200, page.c.resource_type == "html")


def _live(page: FromClause) -> ColumnElement[bool]:
    return and_(_counted(page), _html_ok(page))


def _is_redirect(status: ColumnElement[int]) -> ColumnElement[bool]:
    return status.between(300, 399)


def _is_broken(status: ColumnElement[int]) -> ColumnElement[bool]:
    return and_(status >= 400, status.not_in(BLOCKED_STATUSES))


def _redirected(page: FromClause) -> ColumnElement[bool]:
    return and_(_counted(page), _is_redirect(page.c.status_code))


def _broken(page: FromClause) -> ColumnElement[bool]:
    return and_(_counted(page), _is_broken(page.c.status_code))


def _unreachable(page: FromClause) -> ColumnElement[bool]:
    return or_(_redirected(page), _broken(page))


def _target_status(column: ColumnElement[int]) -> ColumnElement[int]:
    """The status of the row of the same crawl that `column` (a URL id of this row) names."""
    target = aliased(crawl_pages)
    return (
        select(target.c.status_code)
        .where(
            target.c.workspace_id == crawl_pages.c.workspace_id,
            target.c.run_id == crawl_pages.c.run_id,
            target.c.url_id == column,
        )
        .correlate(crawl_pages)
        .scalar_subquery()
    )


# An explicit list, so a title is the same on every cluster whatever its locale.
_TRIMMED: Final = " \t\n\r\f\v" + chr(0xA0)
_EDGE_SPACE: Final = f"^[{_TRIMMED}]+|[{_TRIMMED}]+$"


def _trimmed_title(page: FromClause) -> ColumnElement[str]:
    """The title with its edge whitespace removed; empty when there is no title. The one
    expression that the key and the length of a title are both read from. It removes the
    space, tab, line feed, carriage return, form feed, vertical tab and the non-breaking
    space (U+00A0), and nothing else."""
    return func.regexp_replace(func.coalesce(page.c.title, ""), _EDGE_SPACE, "", "g")


def title_key(page: FromClause) -> ColumnElement[str]:
    return func.lower(_trimmed_title(page))


def title_length(page: FromClause) -> ColumnElement[int]:
    return func.char_length(_trimmed_title(page))


def titled(page: FromClause) -> ColumnElement[bool]:
    """A page whose title can be shared: live, indexable, with a title."""
    return and_(_live(page), page.c.is_indexable, title_key(page) != "")


def _shared_titles(crawl: CrawlRef) -> Select[Any]:
    other = aliased(crawl_pages)
    key = title_key(other)
    return (
        select(key)
        .where(
            other.c.workspace_id == crawl.workspace_id,
            other.c.run_id == crawl.run_id,
            titled(other),
        )
        .group_by(key)
        .having(func.count() > 1)
    )


_PATH_NO_ESCAPES: Final = func.regexp_replace(urls.c.path, "%[0-9A-Fa-f]{2}", "", "g")
HAS_CAPITALS: Final = _PATH_NO_ESCAPES.op("~")("[A-Z]")
HAS_UNDERSCORES: Final = func.strpos(urls.c.path, "_") > 0
NOFOLLOW_LINKS: Final = and_(
    crawl_links.c.workspace_id == crawl_pages.c.workspace_id,
    crawl_links.c.run_id == crawl_pages.c.run_id,
    crawl_links.c.source_url_id == crawl_pages.c.url_id,
    crawl_links.c.target_url_id != crawl_links.c.source_url_id,
    crawl_links.c.is_followed.is_(False),
    crawl_links.c.ignored.is_(False),
)

Rule = Callable[[CrawlRef], ColumnElement[bool]]


def _other_canonical() -> ColumnElement[bool]:
    page = crawl_pages
    return and_(
        _html_ok(page),
        page.c.canonical_url_id.is_not(None),
        page.c.canonical_url_id != page.c.url_id,
    )


def _canonical_broken() -> ColumnElement[bool]:
    status = _target_status(crawl_pages.c.canonical_url_id)
    return and_(_other_canonical(), or_(_is_redirect(status), _is_broken(status)))


def _redirect_target_is(check: Callable[[ColumnElement[int]], ColumnElement[bool]]) -> Rule:
    def rule(_: CrawlRef) -> ColumnElement[bool]:
        page = crawl_pages
        return and_(_redirected(page), check(_target_status(page.c.redirect_url_id)))

    return rule


def _title_duplicate(crawl: CrawlRef) -> ColumnElement[bool]:
    return and_(titled(crawl_pages), title_key(crawl_pages).in_(_shared_titles(crawl)))


# One builder per check: a check builds only its own condition.
_RULES: Final[dict[str, Rule]] = {
    "status-4xx": lambda _: and_(_broken(crawl_pages), crawl_pages.c.status_code < 500),
    "status-5xx": lambda _: and_(_broken(crawl_pages), crawl_pages.c.status_code >= 500),
    "redirect-broken": _redirect_target_is(_is_broken),
    "redirect-chain": _redirect_target_is(_is_redirect),
    "links-to-redirect": lambda _: and_(_live(crawl_pages), crawl_pages.c.redirect_outlinks > 0),
    "redirect-pages": lambda _: _redirected(crawl_pages),
    "canonical-broken": lambda _: _canonical_broken(),
    "noindex": lambda _: and_(
        _live(crawl_pages), crawl_pages.c.non_indexable_reason.in_(("meta_tag", "http_header"))
    ),
    "canonical-elsewhere": lambda _: _other_canonical(),
    "sitemap-broken": lambda _: and_(_unreachable(crawl_pages), crawl_pages.c.in_sitemap),
    "sitemap-nonindexable": lambda _: and_(
        _html_ok(crawl_pages), crawl_pages.c.in_sitemap, crawl_pages.c.is_indexable.is_(False)
    ),
    "not-in-sitemap": lambda _: and_(
        _live(crawl_pages), crawl_pages.c.is_indexable, crawl_pages.c.in_sitemap.is_(False)
    ),
    "broken-internal-links": lambda _: and_(_live(crawl_pages), crawl_pages.c.broken_outlinks > 0),
    "orphans": lambda _: and_(_live(crawl_pages), crawl_pages.c.is_orphan),
    "editorial-orphans": lambda _: and_(_live(crawl_pages), crawl_pages.c.is_editorial_orphan),
    "links-to-nonindexable": lambda _: and_(
        _live(crawl_pages), crawl_pages.c.non_indexable_outlinks > 0
    ),
    "deep-pages": lambda _: and_(_live(crawl_pages), crawl_pages.c.click_depth > DEPTH_MAX),
    "nofollow-internal": lambda _: and_(_live(crawl_pages), exists().where(NOFOLLOW_LINKS)),
    "title-missing": lambda _: and_(_live(crawl_pages), title_key(crawl_pages) == ""),
    "title-duplicate": _title_duplicate,
    "title-long": lambda _: and_(_live(crawl_pages), title_length(crawl_pages) > TITLE_MAX),
    "title-short": lambda _: and_(
        _live(crawl_pages), title_key(crawl_pages) != "", title_length(crawl_pages) < TITLE_MIN
    ),
    "url-format": lambda _: and_(_live(crawl_pages), or_(HAS_CAPITALS, HAS_UNDERSCORES)),
    "url-long": lambda _: and_(_live(crawl_pages), func.char_length(urls.c.path) > PATH_MAX),
}


def _sitemap_was_read(crawl: CrawlRef) -> ColumnElement[bool]:
    """True when the crawl found a sitemap: without one, a sitemap check has nothing to say."""
    return exists(
        select(1)
        .select_from(crawl_runs)
        .where(
            crawl_runs.c.workspace_id == crawl.workspace_id,
            crawl_runs.c.id == crawl.run_id,
            crawl_runs.c.sitemap_pages > 0,
        )
    )


def condition(check_id: str, crawl: CrawlRef) -> ColumnElement[bool]:
    """The condition of a check. A check that reads another source matches nothing until task 4
    gives this function the sources."""
    rule = _RULES.get(check_id)
    if rule is None:
        return false()
    found = rule(crawl)
    if BY_ID[check_id].need == "sitemap":
        return and_(_sitemap_was_read(crawl), found)
    return found
