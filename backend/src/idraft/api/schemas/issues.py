"""Bodies and answers of the Issues page (spec 2026-11-26-issues-page-design, section 6)."""

from __future__ import annotations

from typing import Literal

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
