"""The crawl-trap safety stop (spec 6.2; plan decision D13). A crawl ends at its ceiling as
`stopped_at_ceiling` and keeps what it found."""

from __future__ import annotations

from typing import Final

FLOOR: Final = 2_000
NO_SITEMAP: Final = 50_000
MULTIPLIER: Final = 3
RETRY_MAX: Final = 200_000


def crawl_ceiling(previous_sitemap_pages: int | None) -> int:
    """`previous_sitemap_pages`: the sitemap pages the last finished crawl found, or None when
    the project has none. The first crawl is a probe at the floor."""
    if previous_sitemap_pages is None:
        return FLOOR
    if previous_sitemap_pages < 0:
        raise ValueError("a sitemap page count is never negative")
    if previous_sitemap_pages == 0:
        return NO_SITEMAP
    return max(FLOOR, MULTIPLIER * previous_sitemap_pages)


def retry_ceiling(previous_ceiling: int, previous_sitemap_pages: int | None) -> int:
    """ "Crawl again with a higher limit": double the stopped crawl's ceiling, or what its
    sitemap asks for when that is higher."""
    wanted = max(2 * previous_ceiling, crawl_ceiling(previous_sitemap_pages))
    return min(RETRY_MAX, wanted)
