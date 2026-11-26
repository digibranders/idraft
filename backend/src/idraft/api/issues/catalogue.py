"""The checks of the Issues page (spec docs/superpowers/specs/2026-11-26-issues-page-design.md,
section 3): what each one is, with no SQL. The order is the order the API lists them in: by
tab, then by category. Names and help texts are the web's (`apps/web/messages/en.json`)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

from idraft.api.schemas.issues import CheckId

Tab = Literal["technical", "on_page"]
Severity = Literal["error", "warning", "notice"]
FoundBy = Literal["crawl", "ranks", "gsc", "ga4", "ai"]
# What a check needs besides the crawl's pages; without it the check does not run.
Need = Literal["sitemap", "links", "gsc", "ranks", "ai"]

TITLE_MAX: Final = 60
TITLE_MIN: Final = 30
PATH_MAX: Final = 115
DEPTH_MAX: Final = 3


@dataclass(frozen=True, slots=True)
class Check:
    id: CheckId
    tab: Tab
    category: str
    severity: Severity
    found_by: FoundBy = "crawl"
    need: Need | None = None


CHECKS: Final[tuple[Check, ...]] = (
    Check("status-4xx", "technical", "status", "error"),
    Check("status-5xx", "technical", "status", "error"),
    Check("clicks-page-broken", "technical", "earning_pages", "error", "gsc", "gsc"),
    Check("rank-page-broken", "technical", "earning_pages", "error", "ranks", "ranks"),
    Check("cited-page-broken", "technical", "earning_pages", "error", "ai", "ai"),
    Check("clicks-page-orphan", "technical", "earning_pages", "warning", "gsc", "gsc"),
    Check("redirect-broken", "technical", "redirects", "error"),
    Check("redirect-chain", "technical", "redirects", "warning"),
    Check("links-to-redirect", "technical", "redirects", "warning"),
    Check("redirect-pages", "technical", "redirects", "notice"),
    Check("canonical-broken", "technical", "indexing", "error"),
    Check("noindex", "technical", "indexing", "warning"),
    Check("canonical-elsewhere", "technical", "indexing", "notice"),
    Check("sitemap-broken", "technical", "sitemap", "error", need="sitemap"),
    Check("sitemap-nonindexable", "technical", "sitemap", "warning", need="sitemap"),
    Check("not-in-sitemap", "technical", "sitemap", "notice", need="sitemap"),
    Check("broken-internal-links", "technical", "links", "error"),
    Check("orphans", "technical", "links", "warning"),
    Check("editorial-orphans", "technical", "links", "warning"),
    Check("links-to-nonindexable", "technical", "links", "warning"),
    Check("deep-pages", "technical", "links", "notice"),
    Check("nofollow-internal", "technical", "links", "notice", need="links"),
    Check("title-missing", "on_page", "titles", "error"),
    Check("title-duplicate", "on_page", "titles", "warning"),
    Check("title-long", "on_page", "titles", "notice"),
    Check("title-short", "on_page", "titles", "notice"),
    Check("url-format", "on_page", "addresses", "notice"),
    Check("url-long", "on_page", "addresses", "notice"),
    Check("off-target", "on_page", "keywords", "warning", "ranks", "ranks"),
)
BY_ID: Final[dict[str, Check]] = {check.id: check for check in CHECKS}
