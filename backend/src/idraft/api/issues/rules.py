"""The checks of the Issues page as SQL conditions (spec section 4).

A condition is true for a row of `seo.crawl_pages` (joined with `core.urls`, as `page_rows`
joins them) that the check found. The list of checks counts with it and the Pages list filters
with it, so a check has one definition. Words used: a page is *counted* when it is not a variant
of another crawled page, *live* when it is counted, answered 200 and is HTML, *redirected* when
it is counted and answered 3xx, *broken* when it is counted and answered 400 or more, except the
statuses that only refuse the crawler (`crawl/status.py`)."""

from __future__ import annotations

from typing import Any, Final, Protocol
from uuid import UUID

from sqlalchemy import ColumnElement, FromClause, Select, and_, exists, false, func, or_, select
from sqlalchemy.orm import aliased

from idraft.api.issues.catalogue import DEPTH_MAX, PATH_MAX, TITLE_MAX, TITLE_MIN
from idraft.crawl.status import BLOCKED_STATUSES
from idraft.db.tables import crawl_links, crawl_pages, urls


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


def title_key(page: FromClause) -> ColumnElement[str]:
    return func.lower(func.btrim(func.coalesce(page.c.title, "")))


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
TITLE_LENGTH: Final = func.char_length(func.btrim(func.coalesce(crawl_pages.c.title, "")))
NOFOLLOW_LINKS: Final = and_(
    crawl_links.c.workspace_id == crawl_pages.c.workspace_id,
    crawl_links.c.run_id == crawl_pages.c.run_id,
    crawl_links.c.source_url_id == crawl_pages.c.url_id,
    crawl_links.c.target_url_id != crawl_links.c.source_url_id,
    crawl_links.c.is_followed.is_(False),
    crawl_links.c.ignored.is_(False),
)


def _crawl_condition(check_id: str, crawl: CrawlRef) -> ColumnElement[bool] | None:
    page = crawl_pages
    status = page.c.status_code
    other_canonical = and_(
        _html_ok(page),
        page.c.canonical_url_id.is_not(None),
        page.c.canonical_url_id != page.c.url_id,
    )
    canonical_status = _target_status(page.c.canonical_url_id)
    redirect_status = _target_status(page.c.redirect_url_id)
    rules: dict[str, ColumnElement[bool]] = {
        "status-4xx": and_(_broken(page), status < 500),
        "status-5xx": and_(_broken(page), status >= 500),
        "redirect-broken": and_(_redirected(page), _is_broken(redirect_status)),
        "redirect-chain": and_(_redirected(page), _is_redirect(redirect_status)),
        "links-to-redirect": and_(_live(page), page.c.redirect_outlinks > 0),
        "redirect-pages": _redirected(page),
        "canonical-broken": and_(
            other_canonical, or_(_is_redirect(canonical_status), _is_broken(canonical_status))
        ),
        "noindex": and_(_live(page), page.c.non_indexable_reason.in_(("meta_tag", "http_header"))),
        "canonical-elsewhere": other_canonical,
        "sitemap-broken": and_(_unreachable(page), page.c.in_sitemap),
        "sitemap-nonindexable": and_(
            _html_ok(page), page.c.in_sitemap, page.c.is_indexable.is_(False)
        ),
        "not-in-sitemap": and_(_live(page), page.c.is_indexable, page.c.in_sitemap.is_(False)),
        "broken-internal-links": and_(_live(page), page.c.broken_outlinks > 0),
        "orphans": and_(_live(page), page.c.is_orphan),
        "editorial-orphans": and_(_live(page), page.c.is_editorial_orphan),
        "links-to-nonindexable": and_(_live(page), page.c.non_indexable_outlinks > 0),
        "deep-pages": and_(_live(page), page.c.click_depth > DEPTH_MAX),
        "nofollow-internal": and_(_live(page), exists().where(NOFOLLOW_LINKS)),
        "title-missing": and_(_live(page), title_key(page) == ""),
        "title-duplicate": and_(titled(page), title_key(page).in_(_shared_titles(crawl))),
        "title-long": and_(_live(page), TITLE_LENGTH > TITLE_MAX),
        "title-short": and_(_live(page), title_key(page) != "", TITLE_LENGTH < TITLE_MIN),
        "url-format": and_(_live(page), or_(HAS_CAPITALS, HAS_UNDERSCORES)),
        "url-long": and_(_live(page), func.char_length(urls.c.path) > PATH_MAX),
    }
    return rules.get(check_id)


def condition(check_id: str, crawl: CrawlRef) -> ColumnElement[bool]:
    """The condition of a check. A check that reads another source matches nothing until task 4
    gives this function the sources."""
    found = _crawl_condition(check_id, crawl)
    return false() if found is None else found
