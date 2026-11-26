"""Periods, totals and the health verdict of a page's Search Console numbers
(docs/superpowers/specs/2026-11-26-page-search-and-monitoring-design.md, D7, D12, D13)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from idraft.domain.page_search import (
    Totals,
    WindowTooLargeError,
    compare_window,
    health_of,
    last_full_month,
    window_of,
)


def totals(clicks: int, impressions: int, position: float | None = None) -> Totals:
    if position is None:
        return Totals(clicks, impressions)
    return Totals(clicks, impressions, Decimal(str(position)) * impressions, impressions)


def test_ctr_is_clicks_over_impressions_and_position_is_weighted_by_impressions() -> None:
    both = totals(10, 100, 2.0) + totals(0, 300, 6.0)
    assert both.ctr == pytest.approx(0.025)
    assert both.position == pytest.approx(5.0)


def test_nothing_shown_has_no_ctr_and_no_position() -> None:
    assert Totals().ctr is None
    assert Totals().position is None


def test_rows_without_a_position_do_not_pull_the_average() -> None:
    both = totals(1, 100, 4.0) + Totals(1, 900)
    assert both.impressions == 1000
    assert both.position == pytest.approx(4.0)


def test_the_last_full_month_ends_on_or_before_the_last_final_day() -> None:
    assert last_full_month(date(2026, 11, 22)) == (date(2026, 10, 1), date(2026, 10, 31))
    assert last_full_month(date(2026, 11, 30)) == (date(2026, 11, 1), date(2026, 11, 30))
    assert last_full_month(date(2026, 1, 3)) == (date(2025, 12, 1), date(2025, 12, 31))


def test_a_window_defaults_to_the_last_full_month_and_never_passes_the_last_final_day() -> None:
    final = date(2026, 11, 22)
    assert window_of(None, None, final) == (date(2026, 10, 1), date(2026, 10, 31))
    assert window_of(date(2026, 11, 1), date(2026, 11, 30), final) == (date(2026, 11, 1), final)
    assert window_of(None, date(2026, 11, 10), final) == (date(2026, 10, 14), date(2026, 11, 10))


def test_a_window_is_at_most_92_days_and_its_start_is_not_after_its_end() -> None:
    final = date(2026, 11, 22)
    assert window_of(date(2026, 8, 23), final, final) == (date(2026, 8, 23), final)
    with pytest.raises(WindowTooLargeError):
        window_of(date(2026, 8, 22), final, final)
    with pytest.raises(ValueError, match="after"):
        window_of(date(2026, 11, 10), date(2026, 11, 1), final)


def test_a_calendar_month_compares_with_the_month_before_other_ranges_with_as_many_days() -> None:
    assert compare_window(date(2026, 10, 1), date(2026, 10, 31), "previous_period") == (
        date(2026, 9, 1),
        date(2026, 9, 30),
    )
    assert compare_window(date(2026, 10, 5), date(2026, 10, 11), "previous_period") == (
        date(2026, 9, 28),
        date(2026, 10, 4),
    )
    assert compare_window(date(2026, 10, 1), date(2026, 10, 31), "none") is None


def test_the_same_period_last_year_keeps_the_dates_and_a_leap_day_falls_back() -> None:
    assert compare_window(date(2026, 10, 1), date(2026, 10, 31), "previous_year") == (
        date(2025, 10, 1),
        date(2025, 10, 31),
    )
    assert compare_window(date(2028, 2, 1), date(2028, 2, 29), "previous_year") == (
        date(2027, 2, 1),
        date(2027, 2, 28),
    )


@pytest.mark.parametrize(
    ("current", "previous", "days", "verdict", "basis", "small"),
    [
        (totals(0, 0), totals(0, 0), (30, 30), "no_data", "clicks", False),
        (totals(3, 10), totals(0, 0), (30, 30), "new", "clicks", False),
        (totals(0, 50), totals(25, 900), (30, 30), "lost", "clicks", False),
        (totals(5, 100), totals(5, 100), (30, 30), "low_data", "clicks", False),
        (totals(4, 400), totals(27, 400), (30, 30), "low_data", "clicks", True),
        (totals(100, 5000), totals(200, 5000), (30, 30), "sharp_drop", "clicks", False),
        (totals(317, 41200), totals(412, 39600), (31, 30), "declining", "clicks", False),
        (totals(150, 5000), totals(100, 5000), (30, 30), "growing", "clicks", False),
        (totals(105, 5000), totals(100, 5000), (30, 30), "stable", "clicks", False),
        (totals(10, 2000), totals(10, 1000), (30, 30), "growing", "impressions", False),
    ],
)
def test_the_verdict_table(
    current: Totals, previous: Totals, days: tuple[int, int], verdict: str, basis: str, small: bool
) -> None:
    health = health_of(current, previous, *days)
    assert (health.verdict, health.basis, health.small) == (verdict, basis, small)


def test_a_change_is_per_day_when_the_periods_differ_in_length() -> None:
    health = health_of(totals(317, 41200), totals(412, 39600), 31, 30)
    assert health.change == pytest.approx(-0.2554, abs=0.0001)
    assert health.absolute == pytest.approx(-108.73, abs=0.01)


def test_without_a_compared_period_a_page_is_stable_or_has_no_data() -> None:
    assert health_of(totals(3, 40), None, 30, 30).verdict == "stable"
    assert health_of(totals(0, 0), None, 30, 30).verdict == "no_data"


def test_the_thresholds_sit_where_the_document_puts_them() -> None:
    # Values just off each boundary: a boundary itself would rest on float rounding.
    assert health_of(totals(59, 5000), totals(100, 5000), 30, 30).verdict == "sharp_drop"
    assert health_of(totals(61, 5000), totals(100, 5000), 30, 30).verdict == "declining"
    assert health_of(totals(250, 5000), totals(275, 5000), 30, 30).verdict == "stable"
    assert health_of(totals(220, 5000), totals(250, 5000), 30, 30).verdict == "declining"
    # 20% down on 24 clicks of difference is under the minimum of 25: small numbers.
    assert health_of(totals(96, 5000), totals(120, 5000), 30, 30).small is True


def test_flags_say_when_position_moved_and_when_fewer_people_clicked() -> None:
    slipped = health_of(totals(100, 1000, 5.9), totals(100, 1000, 3.8), 30, 30)
    assert slipped.flags == ("position_slipped",)
    improved = health_of(totals(100, 1000, 3.0), totals(100, 1000, 4.5), 30, 30)
    assert improved.flags == ("position_improved",)
    fewer = health_of(totals(50, 2000), totals(60, 1000), 30, 30)
    assert fewer.flags == ("ctr_fell_impressions_rose",)
    assert health_of(totals(100, 90, 9.0), totals(100, 90, 3.0), 30, 30).flags == ()
