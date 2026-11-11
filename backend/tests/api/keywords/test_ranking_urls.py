"""Which of the project's pages rank for a keyword, and in what order (the popup by its name)."""

from __future__ import annotations

from idraft.api.keywords.rank_repository import RANKING_URLS_MAX, ordered_ranking_urls


def test_pages_are_listed_best_rank_first() -> None:
    assert ordered_ranking_urls([(11, 9), (12, 4), (13, 30)]) == [
        (12, 4, False),
        (11, 9, False),
        (13, 30, False),
    ]


def test_a_page_keeps_its_best_rank_when_it_is_stored_twice() -> None:
    assert ordered_ranking_urls([(11, 9), (12, 4), (11, 5)]) == [(12, 4, False), (11, 5, False)]


def test_a_page_that_shares_a_rank_with_another_is_a_sub_result_of_the_first() -> None:
    # A sitelink is stored right after the page it sits under, at the same rank
    assert ordered_ranking_urls([(11, 3), (12, 3), (13, 3), (14, 8)]) == [
        (11, 3, False),
        (12, 3, True),
        (13, 3, True),
        (14, 8, False),
    ]


def test_ties_keep_the_order_the_pages_were_stored_in() -> None:
    assert [url for url, _, _ in ordered_ranking_urls([(21, 6), (22, 6)])] == [21, 22]


def test_no_page_gives_an_empty_list() -> None:
    assert ordered_ranking_urls([]) == []


def test_the_list_is_cut_at_the_most_a_row_carries() -> None:
    pages = ordered_ranking_urls([(index, index) for index in range(1, RANKING_URLS_MAX + 6)])
    assert len(pages) == RANKING_URLS_MAX
    assert pages[-1][1] == RANKING_URLS_MAX
