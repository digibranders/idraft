"""The windows of the prompts summary that need no database: the weeks of a series, and the
window compared with (contract C2, change log C-1)."""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from fastapi.exceptions import RequestValidationError

from idraft.api.ai.summary import (
    compare_dates,
    previous_dates,
    previous_year_dates,
    summary_weeks,
)
from idraft.api.problems import WindowTooLargeError

TODAY = date(2026, 11, 13)


def _problem(error: pytest.ExceptionInfo[RequestValidationError]) -> tuple[tuple[str, ...], str]:
    """The place and the code of the one error a refusal holds."""
    (found,) = error.value.errors()
    return tuple(str(part) for part in found["loc"]), str(found["type"])


def test_the_weeks_are_the_mondays_the_days_touch() -> None:
    # 2026-10-16 is a Friday, 2026-11-12 a Thursday, 2026-11-15 a Sunday.
    assert summary_weeks(date(2026, 10, 16), date(2026, 11, 12)) == [
        date(2026, 10, 12),
        date(2026, 10, 19),
        date(2026, 10, 26),
        date(2026, 11, 2),
        date(2026, 11, 9),
    ]
    assert summary_weeks(date(2026, 11, 9), date(2026, 11, 15)) == [date(2026, 11, 9)]
    # A window ending on a Monday has that Monday's week, a day long.
    assert summary_weeks(date(2026, 11, 2), date(2026, 11, 9)) == [
        date(2026, 11, 2),
        date(2026, 11, 9),
    ]


def test_a_one_day_window_touches_the_week_of_that_day() -> None:
    # 2026-11-12 is a Thursday, 2026-11-09 a Monday, 2026-11-15 a Sunday.
    assert summary_weeks(date(2026, 11, 12), date(2026, 11, 12)) == [date(2026, 11, 9)]
    assert summary_weeks(date(2026, 11, 9), date(2026, 11, 9)) == [date(2026, 11, 9)]
    assert summary_weeks(date(2026, 11, 15), date(2026, 11, 15)) == [date(2026, 11, 9)]


def test_the_longest_window_touches_at_most_14_weeks() -> None:
    for offset in range(7):
        first = date(2026, 1, 1) + timedelta(days=offset)
        assert len(summary_weeks(first, first + timedelta(days=91))) <= 14


def test_the_last_week_of_the_calendar_does_not_overflow() -> None:
    monday = date.max - timedelta(days=date.max.weekday())
    assert summary_weeks(date.max - timedelta(days=2), date.max) == [monday]


def test_the_previous_period_is_as_many_days_just_before() -> None:
    assert previous_dates(date(2026, 11, 1), date(2026, 11, 28)) == (
        date(2026, 10, 4),
        date(2026, 10, 31),
    )
    assert previous_dates(date(2026, 11, 12), date(2026, 11, 12)) == (
        date(2026, 11, 11),
        date(2026, 11, 11),
    )
    assert compare_dates(
        date(2026, 11, 1), date(2026, 11, 28), "previous_period", None, None, TODAY
    ) == (date(2026, 10, 4), date(2026, 10, 31))


def test_the_previous_year_keeps_the_days_and_29_february_becomes_the_28th() -> None:
    assert previous_year_dates(date(2026, 10, 17), date(2026, 11, 13)) == (
        date(2025, 10, 17),
        date(2025, 11, 13),
    )
    # 2024 is a leap year, 2023 is not: the 29th has no day a year earlier.
    assert previous_year_dates(date(2024, 2, 29), date(2024, 3, 5)) == (
        date(2023, 2, 28),
        date(2023, 3, 5),
    )
    assert previous_year_dates(date(2024, 2, 1), date(2024, 2, 29)) == (
        date(2023, 2, 1),
        date(2023, 2, 28),
    )
    # From a common year to a leap year the same dates exist.
    assert previous_year_dates(date(2025, 2, 28), date(2025, 3, 1)) == (
        date(2024, 2, 28),
        date(2024, 3, 1),
    )
    assert compare_dates(
        date(2024, 2, 29), date(2024, 3, 5), "previous_year", None, None, TODAY
    ) == (date(2023, 2, 28), date(2023, 3, 5))


def test_a_custom_compare_window_overrides_compare_and_needs_both_dates() -> None:
    first, last = date(2026, 10, 17), date(2026, 11, 13)
    custom = (date(2026, 1, 5), date(2026, 1, 10))

    for compare in ("none", "previous_period", "previous_year"):
        assert compare_dates(first, last, compare, *custom, TODAY) == custom
    # Any position and length: after the window, one day long, as long as the longest window.
    assert compare_dates(first, last, "none", date(2027, 1, 1), date(2027, 1, 1), TODAY) == (
        date(2027, 1, 1),
        date(2027, 1, 1),
    )
    assert compare_dates(first, last, "none", date(2026, 1, 1), date(2026, 4, 2), TODAY) == (
        date(2026, 1, 1),
        date(2026, 4, 2),
    )
    assert compare_dates(first, last, "none", None, None, TODAY) is None

    with pytest.raises(RequestValidationError) as alone:
        compare_dates(first, last, "previous_period", custom[0], None, TODAY)
    assert _problem(alone) == (("query", "compare_to"), "missing")
    with pytest.raises(RequestValidationError) as other:
        compare_dates(first, last, "none", None, custom[1], TODAY)
    assert _problem(other) == (("query", "compare_from"), "missing")
    with pytest.raises(RequestValidationError) as reversed_window:
        compare_dates(first, last, "none", custom[1], custom[0], TODAY)
    assert _problem(reversed_window) == (("query", "compare_from"), "range_invalid")
    with pytest.raises(WindowTooLargeError):
        compare_dates(first, last, "none", date(2026, 1, 1), date(2026, 4, 3), TODAY)


def test_a_compare_window_before_the_calendar_is_out_of_range() -> None:
    with pytest.raises(RequestValidationError) as period:
        previous_dates(date(1, 1, 1), date(1, 1, 10))
    with pytest.raises(RequestValidationError) as year:
        previous_year_dates(date(1, 1, 1), date(1, 1, 10))

    assert _problem(period) == (("query", "from"), "out_of_range")
    assert _problem(year) == (("query", "from"), "out_of_range")
