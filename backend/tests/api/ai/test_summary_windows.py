"""The windows of the prompts summary that need no database: the weeks of a series."""

from __future__ import annotations

from datetime import date, timedelta

from idraft.api.ai.summary import summary_weeks


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


def test_the_longest_window_touches_at_most_14_weeks() -> None:
    for offset in range(7):
        first = date(2026, 1, 1) + timedelta(days=offset)
        assert len(summary_weeks(first, first + timedelta(days=91))) <= 14


def test_the_last_week_of_the_calendar_does_not_overflow() -> None:
    monday = date.max - timedelta(days=date.max.weekday())
    assert summary_weeks(date.max - timedelta(days=2), date.max) == [monday]
