"""The shortest route from the start page to a page (spec 7.10, decision D14). The search runs
in the API one level at a time and keeps, for every page it reaches, the hop that reached it;
this module turns those hops into the route. Pure."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

# A site this deep in clicks is a crawl trap; the search stops here.
MAX_LEVELS: Final = 12


@dataclass(frozen=True, slots=True)
class Hop:
    """The link that reached a page. A redirect is a hop with `redirect` set (its anchor reads
    `301 redirect`); a real link with that text is not one."""

    source: int
    target: int
    anchor: str
    placement: str
    scope: str
    redirect: bool = False


@dataclass(frozen=True, slots=True)
class Step:
    url_id: int
    # None for the start page.
    hop: Hop | None


def rebuild_route(parents: Mapping[int, Hop], start: int, target: int) -> list[Step] | None:
    """From the start page to `target`, or None when the search did not reach it."""
    steps: list[Step] = []
    page = target
    for _ in range(MAX_LEVELS + 1):
        if page == start:
            steps.append(Step(start, None))
            return list(reversed(steps))
        hop = parents.get(page)
        if hop is None:
            return None
        steps.append(Step(page, hop))
        page = hop.source
    return None
