"""Where a link sits (its placement) and the three scopes the screens filter by (spec section
4). `all` is a view of the three, never a scope a link has."""

from __future__ import annotations

from enum import StrEnum
from typing import Final


class LinkScope(StrEnum):
    EDITORIAL = "editorial"
    AUTO_GENERATED = "auto_generated"
    TEMPLATE = "template"
    ALL = "all"


EDGE_SCOPES: Final = (LinkScope.EDITORIAL, LinkScope.AUTO_GENERATED, LinkScope.TEMPLATE)
# `seo.crawl_links.placement` lists the same values (migration 0025); plan 01's `Placement`
# enum holds them too (tests/crawl/test_edges.py keeps the three equal).
PLACEMENTS: Final = (
    "content",
    "auto_generated",
    "navigation",
    "header",
    "footer",
    "sidebar",
    "breadcrumb",
)


def scope_of(placement: str) -> LinkScope:
    if placement == "content":
        return LinkScope.EDITORIAL
    if placement == "auto_generated":
        return LinkScope.AUTO_GENERATED
    if placement in PLACEMENTS:
        return LinkScope.TEMPLATE
    raise ValueError(f"not a placement: {placement!r}")


def in_scope(edge_scope: LinkScope, view: LinkScope) -> bool:
    """Whether a link of `edge_scope` shows when `view` is the scope in view."""
    return view is LinkScope.ALL or edge_scope is view
