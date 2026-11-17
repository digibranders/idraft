"""The second placement pass over a crawl's stored links (spec 6.3; plan decision D19).

Ingest stores each page's edges as it reads the page, so the pass, which needs every page of
a folder at once, runs afterwards over the stored rows. The rule is plan 01's
`idraft.crawl.placement.place_links` (folder size, the 50% share, the same-targets coverage and
the steady-count guard, measured by spike S-17): this module only rebuilds its input from the
rows (the candidates: links the first pass called `content` or left open) and returns the links
it moved. The pass sees merged rows, not raw links: ingest stores one row per distinct
(container, target, anchor, kind, placement, open, rel) of a page (`idraft.crawl.edges`), so a
repeated link is one row. The steady-count guard of `place_links` therefore counts rows per
page in a block, not links in the HTML.

A row whose placement is `auto_generated` is taken as a link the first pass left open, so the
caller passes candidates only (`seo.crawl_links.template_candidate`).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from idraft.crawl.placement import FoundLink, Placement, place_links


@dataclass(frozen=True, slots=True)
class TemplateRow:
    link_id: int
    source_url: str
    target_url: str
    container: int
    # The first pass's placement: `content`, or `auto_generated` for a link it left open.
    placement: str


def template_placements(rows: Sequence[TemplateRow], pages: Sequence[str]) -> dict[int, str]:
    """The new placement of each link the pass moves, by link id. `pages` are the canonical
    URLs of every page whose HTML was classified, so folder sizes count pages without
    candidates too. Raises `ValueError` for a row whose placement is not a `Placement`."""
    by_page: dict[str, list[TemplateRow]] = {url: [] for url in pages}
    for row in rows:
        by_page.setdefault(row.source_url, []).append(row)
    found = {
        url: [
            FoundLink(
                href=row.target_url,
                anchor="",
                kind="text",
                rel=frozenset(),
                placement=Placement(row.placement),
                container=str(row.container),
                open=row.placement == Placement.AUTO_GENERATED,
            )
            for row in links
        ]
        for url, links in by_page.items()
    }
    placed = place_links(found)
    return {
        row.link_id: str(after.placement)
        for url, links in by_page.items()
        for row, after in zip(links, placed[url], strict=True)
        if str(after.placement) != row.placement
    }
