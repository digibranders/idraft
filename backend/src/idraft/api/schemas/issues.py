"""Bodies and answers of the Issues page (spec 2026-11-26-issues-page-design, section 6)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

CheckId = Literal[
    "status-4xx",
    "status-5xx",
    "clicks-page-broken",
    "rank-page-broken",
    "cited-page-broken",
    "clicks-page-orphan",
    "redirect-broken",
    "redirect-chain",
    "links-to-redirect",
    "redirect-pages",
    "canonical-broken",
    "noindex",
    "canonical-elsewhere",
    "sitemap-broken",
    "sitemap-nonindexable",
    "not-in-sitemap",
    "broken-internal-links",
    "orphans",
    "editorial-orphans",
    "links-to-nonindexable",
    "deep-pages",
    "nofollow-internal",
    "title-missing",
    "title-duplicate",
    "title-long",
    "title-short",
    "url-format",
    "url-long",
    "off-target",
]

NotRunReason = Literal["source_not_connected", "not_collected", "no_sitemap", "links_dropped"]


class IssueCheck(BaseModel):
    id: CheckId
    tab: Literal["technical", "on_page"]
    category: str
    severity: Literal["error", "warning", "notice"]
    found_by: Literal["crawl", "ranks", "gsc", "ga4", "ai"]
    state: Literal["ran", "not_run"]
    reason: NotRunReason | None = Field(description="Why the check did not run; null when it ran.")
    pages: int | None = Field(description="Pages the check found; null when it did not run.")
    clicks: int | None = Field(
        description="Search Console clicks of those pages in the window; null when the check "
        "did not run or `meta.gsc.state` is not `ok`."
    )
    example_path: str | None = Field(
        description="The first path in byte order among the check's pages; null when none."
    )


class IssueDetail(BaseModel):
    """What a check found on one page (spec section 4, last column). The web writes the sentence."""

    target_path: str | None = None
    target_status: int | None = None
    count: int | None = None
    reason: str | None = None


class IssueSummary(BaseModel):
    pages_crawled: int = Field(description="Every address of the crawl, variants included.")
    pages_with_issue: int
    pages_with_error: int
    pages_with_warning: int
    pages_with_notice: int
    checks_ran: int
    checks_passed: int


class IssueGsc(BaseModel):
    state: Literal["ok", "pending", "not_connected"]
    window_start: date | None
    window_end: date | None


class IssueMeta(BaseModel):
    run_id: UUID
    crawled_at: datetime | None
    links_available: bool
    gsc: IssueGsc


class IssueListResponse(BaseModel):
    data: list[IssueCheck]
    summary: IssueSummary
    meta: IssueMeta
