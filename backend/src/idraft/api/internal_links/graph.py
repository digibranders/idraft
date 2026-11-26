"""The Link map's graph from a crawl's stored pages and links (plan 10). Pure: no database.

A node is a live page that counts (status 200, not a variant). A link to a redirect is a link to
the page the redirect leads to. One edge per page pair. Menu and footer links are never edges:
they are a count on the page they point to, kept only when at least half the pages have it."""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Final
from uuid import UUID

SITEWIDE_SHARE: Final = 0.5
REDIRECT_HOPS: Final = 5


@dataclass(frozen=True, slots=True)
class GraphPage:
    url_id: int
    path: str
    title: str | None
    status_code: int | None
    redirect_url_id: int | None
    is_variant: bool
    tier_id: UUID | None


@dataclass(frozen=True, slots=True)
class GraphLink:
    """Links from one page to another in the scopes drawn; `links` is how many."""

    source: int
    target: int
    links: int


@dataclass(frozen=True, slots=True)
class TemplateLinks:
    """How many pages link to `target` from a menu, header, footer, sidebar or breadcrumb."""

    target: int
    sources: int


@dataclass(frozen=True, slots=True)
class BuiltNode:
    url_id: int
    path: str
    title: str | None
    tier_id: UUID | None
    links_in: int
    links_out: int
    sitewide_from: int


@dataclass(frozen=True, slots=True)
class BuiltGraph:
    pages_total: int
    truncated: bool
    home_url_id: int | None
    nodes: list[BuiltNode]
    edges: list[GraphLink]


def build_graph(
    pages: Sequence[GraphPage],
    links: Iterable[GraphLink],
    template: Iterable[TemplateLinks],
    *,
    home_url_id: int | None,
    max_pages: int,
) -> BuiltGraph:
    by_id = {page.url_id: page for page in pages}
    live = {page.url_id for page in pages if page.status_code == 200 and not page.is_variant}

    def resolve(url_id: int | None) -> int | None:
        """The node a url id stands for: itself, or the page its redirects lead to."""
        for _ in range(REDIRECT_HOPS + 1):
            if url_id is None or url_id in live:
                return url_id
            page = by_id.get(url_id)
            url_id = None if page is None else page.redirect_url_id
        return None

    edges: Counter[tuple[int, int]] = Counter()
    for link in links:
        target = resolve(link.target)
        if link.source in live and target is not None and target != link.source:
            edges[(link.source, target)] += link.links

    links_in: Counter[int] = Counter(target for _, target in edges)
    links_out: Counter[int] = Counter(source for source, _ in edges)

    template_sources: Counter[int] = Counter()
    for row in template:
        target = resolve(row.target)
        if target is not None:
            template_sources[target] += row.sources
    floor = SITEWIDE_SHARE * len(live)

    ranked = sorted(live, key=lambda url_id: (-(links_in[url_id] + links_out[url_id]), url_id))
    kept = ranked[:max_pages]
    kept_set = set(kept)
    nodes = [
        BuiltNode(
            url_id=url_id,
            path=by_id[url_id].path,
            title=by_id[url_id].title,
            tier_id=by_id[url_id].tier_id,
            links_in=links_in[url_id],
            links_out=links_out[url_id],
            # A redirect and its target can both be in a menu: never more pages than there are
            sitewide_from=(
                min(template_sources[url_id], len(live)) if template_sources[url_id] >= floor else 0
            ),
        )
        for url_id in kept
    ]
    return BuiltGraph(
        pages_total=len(live),
        truncated=len(live) > len(kept),
        home_url_id=resolve(home_url_id),
        nodes=nodes,
        edges=[
            GraphLink(source, target, count)
            for (source, target), count in sorted(edges.items())
            if source in kept_set and target in kept_set
        ],
    )
