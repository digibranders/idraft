"""Click depth and internal PageRank of one crawl (spec 6.4; plan decision D12).

Depth: breadth-first from the start URL over followed links of every placement; a redirect is a
hop to its target. The same search without auto-generated links finds pages that only
previous and next links reach. A start page that was not served has no links to walk from, so the
walk borrows the site's template links for it (`template_roots`).

PageRank: damping 0.85, until the largest change is under 1e-9 or for 200 rounds, over unique
(source, target) pairs. A source's out-degree counts every distinct target, followed or not, and
a nofollow pair's share is dropped. A redirect passes everything to its target. An error page
(4xx, 5xx) passes nothing and keeps what it gets: that is the equity lost to errors. A 200 page
with no link out spreads its value over every node. Shares are values over their sum.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Final

import numpy as np
from scipy.sparse import csr_matrix

from idraft.crawl.scopes import LinkScope

DAMPING: Final = 0.85
TOLERANCE: Final = 1e-9
# The error shrinks by 0.85 a round, so 1e-9 takes about 130 rounds; 100 stops short of it.
MAX_ROUNDS: Final = 200
# "Deep only through previous and next": more than this many clicks deeper without them.
DEEP_EXTRA: Final = 3


@dataclass(frozen=True, slots=True)
class Node:
    url_id: int
    # None for a URL that was linked but not crawled.
    status_code: int | None
    redirect_to: int | None = None

    @property
    def is_error(self) -> bool:
        return self.status_code is not None and self.status_code >= 400


@dataclass(frozen=True, slots=True)
class Link:
    source: int
    target: int
    scope: LinkScope
    followed: bool


@dataclass(frozen=True, slots=True)
class Equity:
    shares: dict[int, float]
    lost_to_errors: float
    rounds: int


def click_depths(
    start: int, nodes: Mapping[int, Node], links: Iterable[Link], *, without_auto: bool = False
) -> dict[int, int]:
    forward: dict[int, set[int]] = {}
    for link in links:
        if not link.followed or link.source == link.target:
            continue
        if without_auto and link.scope is LinkScope.AUTO_GENERATED:
            continue
        forward.setdefault(link.source, set()).add(link.target)
    for node in nodes.values():
        if node.redirect_to is not None and node.redirect_to != node.url_id:
            forward.setdefault(node.url_id, set()).add(node.redirect_to)
    depths = {start: 0}
    queue = deque([start])
    while queue:
        current = queue.popleft()
        for target in forward.get(current, ()):
            if target not in depths:
                depths[target] = depths[current] + 1
                queue.append(target)
    return depths


def template_roots(start: int, nodes: Mapping[int, Node], links: Iterable[Link]) -> frozenset[int]:
    """The targets a start page that cannot be read would link to, for the depth walk only.

    A site's template links (header, navigation, footer) are on every page, the start page
    included. When the start page was not served (a CDN answered the crawler 403) or has no
    links, the targets that more than half of the served pages carry as followed template links
    stand in for its links. A start page that redirects, or that has links, needs none."""
    start_node = nodes.get(start)
    if start_node is not None and start_node.redirect_to not in (None, start):
        return frozenset()
    served = {node.url_id for node in nodes.values() if node.status_code == 200} - {start}
    carried_by: dict[int, set[int]] = {}
    start_links = False
    for link in links:
        if link.source == start:
            start_links = True
        elif link.scope is LinkScope.TEMPLATE and link.followed and link.source in served:
            carried_by.setdefault(link.target, set()).add(link.source)
    if start_links and start_node is not None and start_node.status_code == 200:
        return frozenset()
    return frozenset(
        target for target, sources in carried_by.items() if 2 * len(sources) > len(served)
    )


def deep_only_through_auto(depth: int | None, depth_without_auto: int | None) -> bool:
    if depth is None:
        return False
    if depth_without_auto is None:
        return True
    return depth_without_auto - depth > DEEP_EXTRA


def _pairs(nodes: Mapping[int, Node], links: Iterable[Link]) -> dict[tuple[int, int], bool]:
    """Each distinct (source, target) and whether any of its links is followed."""
    pairs: dict[tuple[int, int], bool] = {}
    for link in links:
        source = nodes.get(link.source)
        if link.source == link.target or (
            source is not None and (source.is_error or source.redirect_to is not None)
        ):
            continue
        key = (link.source, link.target)
        pairs[key] = pairs.get(key, False) or link.followed
    for node in nodes.values():
        if node.redirect_to is not None and not node.is_error and node.redirect_to != node.url_id:
            pairs[(node.url_id, node.redirect_to)] = True
    return pairs


def pagerank(nodes: Mapping[int, Node], links: Iterable[Link]) -> Equity:
    pairs = _pairs(nodes, links)
    ids = sorted({*nodes, *(source for source, _ in pairs), *(target for _, target in pairs)})
    if not ids:
        return Equity(shares={}, lost_to_errors=0.0, rounds=0)
    index = {url_id: position for position, url_id in enumerate(ids)}
    size = len(ids)
    error = np.zeros(size, dtype=bool)
    for node in nodes.values():
        error[index[node.url_id]] = node.is_error
    out_degree = np.zeros(size)
    for source, _ in pairs:
        out_degree[index[source]] += 1
    followed = [(source, target) for (source, target), follows in pairs.items() if follows]
    matrix = csr_matrix(
        (
            [1.0 / out_degree[index[source]] for source, _ in followed],
            ([index[target] for _, target in followed], [index[source] for source, _ in followed]),
        ),
        shape=(size, size),
    )
    dangling = (out_degree == 0) & ~error
    rank = np.full(size, 1.0 / size)
    rounds = 0
    while rounds < MAX_ROUNDS:
        rounds += 1
        spread = DAMPING * float(rank[dangling].sum()) / size
        new = (1 - DAMPING) / size + DAMPING * (matrix @ rank) + spread
        change = float(np.abs(new - rank).max())
        rank = new
        if change < TOLERANCE:
            break
    shares = rank / float(rank.sum())
    return Equity(
        shares={url_id: float(shares[position]) for url_id, position in index.items()},
        lost_to_errors=float(shares[error].sum()),
        rounds=rounds,
    )
