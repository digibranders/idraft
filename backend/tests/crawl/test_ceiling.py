"""The crawl-trap safety stop (spec 6.2; plan decision D13)."""

import pytest

from idraft.crawl.ceiling import FLOOR, NO_SITEMAP, RETRY_MAX, crawl_ceiling, retry_ceiling


@pytest.mark.parametrize(
    ("sitemap_pages", "ceiling"),
    [(None, FLOOR), (0, NO_SITEMAP), (1, FLOOR), (666, FLOOR), (667, 2001), (2000, 6000)],
)
def test_three_times_the_sitemap_and_never_under_the_floor(
    sitemap_pages: int | None, ceiling: int
) -> None:
    assert crawl_ceiling(sitemap_pages) == ceiling


def test_a_retry_doubles_or_follows_the_sitemap_whichever_is_higher() -> None:
    assert retry_ceiling(2000, None) == 4000
    assert retry_ceiling(2000, 5000) == 15000
    assert retry_ceiling(150_000, 1) == RETRY_MAX


def test_a_negative_count_is_a_bug() -> None:
    with pytest.raises(ValueError, match="sitemap"):
        crawl_ceiling(-1)
