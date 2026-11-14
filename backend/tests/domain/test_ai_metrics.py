"""When a weekly point of the prompts summary is pooled, and over which days (contract C2,
change log C-11). Pure: no database."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from idraft.domain.ai_metrics import POOL_BELOW_PROMPTS, POOL_WEEKS, pool_window, pools


def test_the_pooling_constants() -> None:
    assert POOL_BELOW_PROMPTS == 10
    assert POOL_WEEKS == 4


@pytest.mark.parametrize("prompts", [0, 1, 9, 10, 500])
def test_pools_a_prompt_row_always(prompts: int) -> None:
    assert pools(prompt_row=True, prompts=prompts) is True


def test_pools_a_topic_row_below_ten_prompts_and_not_at_ten() -> None:
    assert pools(prompt_row=False, prompts=0) is True
    assert pools(prompt_row=False, prompts=9) is True
    assert pools(prompt_row=False, prompts=10) is False
    assert pools(prompt_row=False, prompts=11) is False


def test_pool_window_is_the_trailing_four_weeks_clipped_to_the_window() -> None:
    # 2026-10-16 is a Friday and 2026-11-12 a Thursday: the weeks are the Mondays Oct 12, 19, 26,
    # Nov 2 and Nov 9.
    first, last = date(2026, 10, 16), date(2026, 11, 12)

    # The last week: four weeks back to Oct 19, and the window ends on the Thursday.
    assert pool_window(date(2026, 11, 9), first, last) == (
        date(2026, 10, 19),
        date(2026, 11, 12),
        4,
    )
    # The first week is cut at the window start and ends on its Sunday: one week.
    assert pool_window(date(2026, 10, 12), first, last) == (
        date(2026, 10, 16),
        date(2026, 10, 18),
        1,
    )
    # Four weeks back would be Oct 12, which the window opens inside: the Friday, still 4 weeks.
    assert pool_window(date(2026, 11, 2), first, last) == (date(2026, 10, 16), date(2026, 11, 8), 4)
    # The second week reaches back to the first one only.
    assert pool_window(date(2026, 10, 19), first, last) == (
        date(2026, 10, 16),
        date(2026, 10, 25),
        2,
    )


def test_pool_window_reaches_no_further_back_than_three_weeks_before_the_week() -> None:
    first, last = date(2026, 1, 1), date(2026, 12, 31)

    assert pool_window(date(2026, 11, 9), first, last) == (
        date(2026, 10, 19),
        date(2026, 11, 15),
        4,
    )


def test_pool_window_of_a_one_day_window_is_that_day() -> None:
    day = date(2026, 11, 12)

    assert pool_window(date(2026, 11, 9), day, day) == (day, day, 1)


def test_pool_window_stays_inside_the_calendar_at_both_ends() -> None:
    # The first and last days of the calendar are a Monday and a Friday: the weeks around them
    # reach past it, and the window is what bounds the pool.
    assert pool_window(date.min, date.min, date.min + timedelta(days=3)) == (
        date.min,
        date.min + timedelta(days=3),
        1,
    )
    monday = date.max - timedelta(days=date.max.weekday())
    assert pool_window(monday, monday - timedelta(days=2), date.max) == (
        monday - timedelta(days=2),
        date.max,
        2,
    )
