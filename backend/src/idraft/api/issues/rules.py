"""The checks of the Issues page as SQL conditions (spec section 4).

A condition is true for a row of `seo.crawl_pages` (joined with `core.urls`, as `page_rows`
joins them) that the check found. The list of checks counts with it and the Pages list filters
with it, so a check has one definition. Words used: a page is *counted* when it is not a variant
of another crawled page, *live* when it is counted, answered 200 and is HTML, *redirected* when
it is counted and answered 3xx, *broken* when it is counted and answered 400 or more, except the
statuses that only refuse the crawler (`crawl/status.py`)."""

from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta
from typing import TYPE_CHECKING, Any, Final, Protocol
from uuid import UUID

from sqlalchemy import (
    ColumnElement,
    FromClause,
    Select,
    Subquery,
    and_,
    exists,
    false,
    func,
    or_,
    select,
)
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.orm import aliased

from idraft.api.issues.catalogue import BY_ID, DEPTH_MAX, PATH_MAX, TITLE_MAX, TITLE_MIN
from idraft.crawl.status import BLOCKED_STATUSES
from idraft.db.tables import (
    ai_citations,
    ai_observations,
    crawl_links,
    crawl_pages,
    crawl_runs,
    gsc_page_daily,
    tracked_keyword_state,
    tracked_keywords,
    urls,
)

if TYPE_CHECKING:
    from idraft.api.issues.sources import Sources


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
PATH_LENGTH: Final = func.char_length(urls.c.path)
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
    "url-long": lambda _: and_(_live(crawl_pages), PATH_LENGTH > PATH_MAX),
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


# The tracked keywords of the project that are in use, with the state of their last check.
KEYWORD_ROWS: Final = tracked_keywords.join(
    tracked_keyword_state,
    and_(
        tracked_keyword_state.c.tracked_keyword_id == tracked_keywords.c.id,
        tracked_keyword_state.c.workspace_id == tracked_keywords.c.workspace_id,
    ),
)
# An answer and the pages it cites, as the answer counts for the Pages list (decision D9).
# `own_citations` below, `extras._CITATIONS` and `page_sort._citations` state the same rule
# (own domain, last 28 days, answer not superseded) and must change together.
CITATION_ROWS: Final = ai_citations.join(
    ai_observations,
    and_(
        ai_observations.c.id == ai_citations.c.observation_id,
        ai_observations.c.observed_at == ai_citations.c.observed_at,
        ai_observations.c.workspace_id == ai_citations.c.workspace_id,
    ),
)


def active_keywords(crawl: CrawlRef) -> list[ColumnElement[bool]]:
    """Over `KEYWORD_ROWS`: the keywords of this project that are active and not deleted."""
    return [
        tracked_keywords.c.workspace_id == crawl.workspace_id,
        tracked_keywords.c.project_id == crawl.project_id,
        tracked_keywords.c.is_active,
        tracked_keywords.c.deleted_at.is_(None),
    ]


def ranked_keywords(crawl: CrawlRef) -> list[ColumnElement[bool]]:
    """Over `KEYWORD_ROWS`: active keywords that have a rank."""
    return [*active_keywords(crawl), tracked_keyword_state.c.current_rank.is_not(None)]


def own_citations(crawl: CrawlRef) -> list[ColumnElement[bool]]:
    """Over `CITATION_ROWS`: citations of the project's own domain in the last 28 days, in
    answers that were not superseded."""
    return [
        ai_citations.c.workspace_id == crawl.workspace_id,
        ai_citations.c.project_id == crawl.project_id,
        ai_citations.c.domain_role == "own",
        ai_citations.c.observed_at >= func.now() - timedelta(days=28),
        ai_observations.c.superseded_by.is_(None),
    ]


def _has_clicks(crawl: CrawlRef, sources: Sources) -> ColumnElement[bool]:
    """The page has clicks above 0 in the stored window of the property."""
    gsc = sources.gsc
    if gsc.state != "ok" or gsc.integration_id is None or gsc.window is None:
        return false()
    return exists().where(
        gsc_page_daily.c.workspace_id == crawl.workspace_id,
        gsc_page_daily.c.project_id == crawl.project_id,
        gsc_page_daily.c.integration_id == gsc.integration_id,
        gsc_page_daily.c.metric_date.between(*gsc.window),
        gsc_page_daily.c.url_id == crawl_pages.c.url_id,
        gsc_page_daily.c.clicks > 0,
    )


def ranked_pages(crawl: CrawlRef) -> Select[Any]:
    """The URL ids that a tracked keyword with a rank ranks with. It does not depend on the
    page, so PostgreSQL builds it once and not once per page."""
    return (
        select(tracked_keyword_state.c.current_url_id)
        .select_from(KEYWORD_ROWS)
        .where(*ranked_keywords(crawl), tracked_keyword_state.c.current_url_id.is_not(None))
    )


def off_target_keywords(crawl: CrawlRef) -> Subquery:
    """The keywords that rank away from their target page, as `keyword_id` and `target_url_id`.
    Decision D8: the rows of one keyword (devices, locations) count once, by the row with the
    best rank (the lowest id on a tie). That row is off target when it ranks with another page;
    a null on either side makes the comparison null, so it never matches."""
    best = (
        select(
            tracked_keywords.c.keyword_id,
            tracked_keywords.c.target_url_id,
            tracked_keyword_state.c.current_url_id,
        )
        .select_from(KEYWORD_ROWS)
        .where(*ranked_keywords(crawl))
        .ext(distinct_on(tracked_keywords.c.keyword_id))
        .order_by(
            tracked_keywords.c.keyword_id,
            tracked_keyword_state.c.current_rank,
            tracked_keywords.c.id,
        )
        .subquery("best_rows")
    )
    return (
        select(best.c.keyword_id, best.c.target_url_id)
        .where(best.c.current_url_id != best.c.target_url_id)
        .subquery("off_target_keywords")
    )


def cited_pages(crawl: CrawlRef) -> Select[Any]:
    """The URL ids that an answer of the last 28 days cites as the project's own page."""
    return (
        select(ai_citations.c.url_id)
        .select_from(CITATION_ROWS)
        .where(*own_citations(crawl), ai_citations.c.url_id.is_not(None))
    )


# Each of the three rules below tests a page against a set that does not depend on the page, so
# the database hashes the set once. A correlated EXISTS would run once per page.
def _ranks_with_page(crawl: CrawlRef, sources: Sources) -> ColumnElement[bool]:
    """Unreachable, and a keyword that has a rank ranks with this page."""
    if not sources.ranks:
        return false()
    return and_(_unreachable(crawl_pages), crawl_pages.c.url_id.in_(ranked_pages(crawl)))


def _off_target(crawl: CrawlRef, sources: Sources) -> ColumnElement[bool]:
    """Counted, and a keyword that targets this page ranks best with another page."""
    if not sources.ranks:
        return false()
    off = off_target_keywords(crawl)
    return and_(_counted(crawl_pages), crawl_pages.c.url_id.in_(select(off.c.target_url_id)))


def _cited(crawl: CrawlRef, sources: Sources) -> ColumnElement[bool]:
    """Unreachable, and an answer of the last 28 days cites this page as the project's own."""
    if not sources.ai:
        return false()
    return and_(_unreachable(crawl_pages), crawl_pages.c.url_id.in_(cited_pages(crawl)))


SourceRule = Callable[[CrawlRef, "Sources"], ColumnElement[bool]]
# The checks that join another source. Each one is false when its source is not there.
_SOURCE_RULES: Final[dict[str, SourceRule]] = {
    "clicks-page-broken": lambda crawl, sources: and_(
        _unreachable(crawl_pages), _has_clicks(crawl, sources)
    ),
    "clicks-page-orphan": lambda crawl, sources: and_(
        _live(crawl_pages), crawl_pages.c.is_orphan, _has_clicks(crawl, sources)
    ),
    "rank-page-broken": _ranks_with_page,
    "off-target": _off_target,
    "cited-page-broken": _cited,
}


def condition(
    check_id: str, crawl: CrawlRef, sources: Sources | None = None
) -> ColumnElement[bool]:
    """The condition of a check. A check that reads another source matches nothing without
    `sources`, or when that source is not there."""
    source_rule = _SOURCE_RULES.get(check_id)
    if source_rule is not None:
        return false() if sources is None else source_rule(crawl, sources)
    rule = _RULES.get(check_id)
    if rule is None:
        return false()
    found = rule(crawl)
    if BY_ID[check_id].need == "sitemap":
        return and_(_sitemap_was_read(crawl), found)
    return found
