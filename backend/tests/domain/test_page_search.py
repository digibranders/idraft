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
    assert health_of(totals(59, 5000), totals(100, 5000), 30, 30).verdict == "sharp_drop"
    assert health_of(totals(61, 5000), totals(100, 5000), 30, 30).verdict == "declining"
    assert health_of(totals(250, 5000), totals(275, 5000), 30, 30).verdict == "stable"
    assert health_of(totals(220, 5000), totals(250, 5000), 30, 30).verdict == "declining"
    # 20% down on 24 clicks of difference is under the minimum of 25: small numbers.
    assert health_of(totals(96, 5000), totals(120, 5000), 30, 30).small is True


@pytest.mark.parametrize(
    ("current", "previous", "days", "verdict"),
    [
        # exactly -40% (80 to 48): "at or below" is a sharp drop
        (totals(48, 5000), totals(80, 5000), (30, 30), "sharp_drop"),
        # exactly +10% on exactly 25 clicks of difference (250 to 275)
        (totals(275, 5000), totals(250, 5000), (30, 30), "growing"),
        # exactly -10% per day (300 over 30 days to 279 over 31 days)
        (totals(279, 5000), totals(300, 5000), (31, 30), "declining"),
        # exactly -10% (300 to 270)
        (totals(270, 5000), totals(300, 5000), (30, 30), "declining"),
        # exactly 25 clicks of difference is enough, 24 is not (small numbers)
        (totals(75, 5000), totals(100, 5000), (30, 30), "declining"),
        (totals(76, 5000), totals(100, 5000), (30, 30), "low_data"),
    ],
)
def test_a_threshold_met_exactly_counts(
    current: Totals, previous: Totals, days: tuple[int, int], verdict: str
) -> None:
    assert health_of(current, previous, *days).verdict == verdict


def test_a_page_with_no_clicks_before_is_not_stable_after_clicks_arrive() -> None:
    health = health_of(totals(500, 10000), totals(0, 5000), 30, 30)
    assert (health.verdict, health.basis, health.change, health.absolute, health.small) == (
        "growing",
        "clicks",
        None,
        500.0,
        False,
    )
    assert health_of(totals(30, 1000), totals(0, 500), 30, 30).verdict == "growing"


def test_flags_say_when_position_moved_and_when_fewer_people_clicked() -> None:
    slipped = health_of(totals(100, 1000, 5.9), totals(100, 1000, 3.8), 30, 30)
    assert slipped.flags == ("position_slipped",)
    improved = health_of(totals(100, 1000, 3.0), totals(100, 1000, 4.5), 30, 30)
    assert improved.flags == ("position_improved",)
    fewer = health_of(totals(150, 2400), totals(200, 2000), 30, 30)
    assert fewer.flags == ("ctr_fell_impressions_rose",)
    assert health_of(totals(100, 90, 9.0), totals(100, 90, 3.0), 30, 30).flags == ()


def test_a_click_rate_down_exactly_15_percent_with_impressions_up_exactly_10_is_flagged() -> None:
    # 200 of 2000 (10%) to 187 of 2200 (8.5%)
    health = health_of(totals(187, 2200), totals(200, 2000), 30, 30)
    assert health.flags == ("ctr_fell_impressions_rose",)


def test_a_position_shift_of_exactly_one_and_a_half_places_is_flagged() -> None:
    health = health_of(totals(100, 1000, 5.5), totals(100, 1000, 4.0), 30, 30)
    assert health.flags == ("position_slipped",)


def test_the_position_flag_needs_100_impressions_that_carried_a_position() -> None:
    few = Totals(100, 1000, Decimal("5.9") * 50, 50)
    assert health_of(few, totals(100, 1000, 3.8), 30, 30).flags == ()
    assert health_of(totals(100, 1000, 5.9), few, 30, 30).flags == ()


def test_no_flag_is_raised_on_a_verdict_of_low_data_or_lost() -> None:
    thin = health_of(totals(5, 100, 6.0), totals(5, 100, 3.0), 30, 30)
    assert (thin.verdict, thin.flags) == ("low_data", ())
    small = health_of(totals(4, 400, 6.0), totals(27, 400, 3.0), 30, 30)
    assert (small.verdict, small.small, small.flags) == ("low_data", True, ())
    lost = health_of(totals(0, 500, 6.0), totals(25, 900, 3.0), 30, 30)
    assert (lost.verdict, lost.flags) == ("lost", ())
