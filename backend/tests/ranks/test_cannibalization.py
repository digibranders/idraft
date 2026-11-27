"""The cannibalization rules (docs/33 section 6): classes, confirmed switches, grouped results."""

from __future__ import annotations

from collections.abc import Sequence

from idraft.ranks.cannibalization import (
    FLIP_DAYS,
    MIN_CHECKS,
    Check,
    analyse,
    check_from_observation,
)

A, B, C = 1, 2, 3


def one(day: int, page: int, rank: int = 5) -> Check:
    return Check(day=day, readable=True, ranks=((page, rank),))


def series(pages: Sequence[int], rank: int = 5) -> list[Check]:
    return [one(day, page, rank) for day, page in enumerate(pages)]


def test_no_ranked_check_is_unranked() -> None:
    result = analyse([Check(day=d, readable=True, ranks=()) for d in range(12)])
    assert result.verdict == "unranked"
    assert result.ranked_checks == 0


def test_nine_ranked_checks_is_insufficient_and_ten_is_enough() -> None:
    assert analyse(series([A] * (MIN_CHECKS - 1))).verdict == "insufficient"
    assert analyse(series([A] * MIN_CHECKS)).verdict == "none"


def test_unreadable_checks_are_not_ranked_checks() -> None:
    checks = series([A] * MIN_CHECKS)
    checks[0] = Check(day=0, readable=False, ranks=())
    result = analyse(checks)
    assert result.verdict == "insufficient"
    assert result.unreadable == 1
    assert result.strip[0].kind == "unreadable"


def test_one_odd_reading_between_equal_ones_is_a_flicker_not_a_switch() -> None:
    result = analyse(series([A, A, A, A, B, A, A, A, A, A, A, A]))
    assert result.events == ()
    assert result.flickers == 1


def test_a_page_that_holds_the_next_check_is_a_confirmed_switch() -> None:
    result = analyse(series([A] * 6 + [B] * 6))
    assert [(e.from_page, e.to_page, e.day) for e in result.events] == [(A, B, 6)]
    assert result.events[0].held_days == 6
    assert result.events[0].revert is False


def test_the_return_of_the_replaced_page_within_the_window_is_a_flip_flop() -> None:
    pages = [A] * 4 + [B] * 3 + [A] * 5
    result = analyse(series(pages))
    assert [e.revert for e in result.events] == [False, True]
    assert result.reverts == 1


def test_a_return_after_the_window_is_not_a_flip_flop() -> None:
    pages = [A] * 3 + [B] * (FLIP_DAYS + 2) + [A] * 3
    result = analyse(series(pages))
    assert [e.revert for e in result.events] == [False, False]


def test_a_grouped_sub_result_is_not_co_ranking() -> None:
    checks = [
        Check(day=d, readable=True, ranks=((A, 4),), grouped=(B,)) for d in range(MIN_CHECKS + 2)
    ]
    result = analyse(checks)
    assert result.co_rate == 0
    assert result.verdict == "none"
    assert result.grouped_pages == (B,)


def test_two_pages_in_the_top_twenty_on_half_the_checks_is_co_ranking() -> None:
    checks = [Check(day=d, readable=True, ranks=((A, 4), (B, 9))) for d in range(MIN_CHECKS)]
    result = analyse(checks)
    assert result.verdict == "co_ranking"
    assert result.co_rate == 1.0


def test_a_second_page_below_rank_twenty_does_not_count_as_together() -> None:
    checks = [Check(day=d, readable=True, ranks=((A, 4), (B, 40))) for d in range(MIN_CHECKS)]
    assert analyse(checks).co_rate == 0


def test_swapping_pages_with_a_worse_rank_for_the_other_is_likely() -> None:
    checks: list[Check] = []
    for day in range(20):
        # The page that ranks well holds first, then the weaker page takes over: 5 against 12
        on_a = (day // 3) % 2 == 0
        checks.append(one(day, A if on_a else B, 5 if on_a else 12))
    result = analyse(checks)
    assert result.verdict == "likely"
    assert result.primary == A
    assert result.rank_gap == 7


def test_swapping_pages_at_the_same_rank_is_unstable() -> None:
    checks = [one(day, A if (day // 4) % 2 == 0 else B, 6) for day in range(20)]
    result = analyse(checks)
    assert result.verdict == "unstable"
    assert result.rank_gap == 0


def test_the_rank_gap_is_never_negative() -> None:
    # The gap is measured from the page with the best median rank
    checks = [
        one(day, A if (day // 4) % 2 == 0 else B, 12 if (day // 4) % 2 == 0 else 3)
        for day in range(20)
    ]
    result = analyse(checks)
    assert result.primary == B
    assert result.rank_gap >= 0


def test_the_page_to_compare_with_is_the_best_median_not_the_most_frequent() -> None:
    pages = [A] * 12 + [B] * 4
    checks = [one(d, p, 20 if p == A else 3) for d, p in enumerate(pages)]
    result = analyse(checks)
    assert result.primary == B


def test_per_page_figures() -> None:
    result = analyse(series([A] * 6 + [B] * 6))
    by_page = {p.page: p for p in result.pages}
    assert by_page[A].ranked == 6
    assert by_page[A].best_count == 6
    assert by_page[B].median == 5
    assert abs(by_page[B].share - 0.5) < 1e-9


def test_current_page_and_held_now() -> None:
    result = analyse(series([A] * 6 + [B] * 6))
    assert result.current == B
    assert result.current_rank == 5
    assert result.held_now == 5


def test_strip_has_one_cell_per_check() -> None:
    checks = series([A] * 6 + [B] * 6)
    result = analyse(checks)
    assert len(result.strip) == len(checks)
    assert result.strip[0].kind == "page"
    assert result.strip[0].page == A


def test_observation_arrays_become_a_check_with_grouped_pages_apart() -> None:
    check = check_from_observation(
        day=3, is_valid=True, depth_requested=100, ranks=[4, 4, 9], url_ids=[A, B, C]
    )
    assert check.readable
    assert check.ranks == ((A, 4), (C, 9))
    assert check.grouped == (B,)


def test_a_light_depth_check_is_not_readable() -> None:
    check = check_from_observation(day=0, is_valid=True, depth_requested=10, ranks=[3], url_ids=[A])
    assert not check.readable


def test_an_invalid_check_is_not_readable() -> None:
    check = check_from_observation(day=0, is_valid=False, depth_requested=100, ranks=[], url_ids=[])
    assert not check.readable


def test_same_page_at_two_ranks_keeps_the_best_rank_only() -> None:
    check = check_from_observation(
        day=0, is_valid=True, depth_requested=100, ranks=[6, 2], url_ids=[A, A]
    )
    assert check.ranks == ((A, 2),)
