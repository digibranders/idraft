"""Keyword metric rules: material change (docs/06 section 7.2), trend and seasonality
(docs/08 section 6)."""

from __future__ import annotations

from collections.abc import Sequence

import pytest

from sightline.domain.keyword_metrics import (
    MetricsReading,
    Month,
    is_material_change,
    seasonality,
    trend_pct_per_month,
)


def _reading(
    volume: int | None = 1000, difficulty: int | None = 40, intent: str | None = "commercial"
) -> MetricsReading:
    return MetricsReading(search_volume=volume, keyword_difficulty=difficulty, intent_main=intent)


def _months(volumes: Sequence[int | None], start: tuple[int, int] = (2025, 9)) -> list[Month]:
    year, month = start
    found = []
    for volume in volumes:
        found.append(Month(year, month, volume))
        month += 1
        if month == 13:
            year, month = year + 1, 1
    return found


def test_a_first_reading_is_a_material_change() -> None:
    assert is_material_change(None, _reading())


@pytest.mark.parametrize(
    ("current", "material"),
    [
        (_reading(volume=1200), False),  # exactly 20%: not more than
        (_reading(volume=1201), True),
        (_reading(volume=799), True),
        (_reading(volume=1000, difficulty=45), False),
        (_reading(volume=1000, difficulty=46), True),
        (_reading(intent="informational"), True),
        (_reading(volume=None), True),  # a value appearing or vanishing
        (_reading(difficulty=None), True),
    ],
)
def test_volume_difficulty_and_intent_decide_a_material_change(
    current: MetricsReading, material: bool
) -> None:
    assert is_material_change(_reading(), current) is material


def test_a_small_volume_needs_more_than_ten_searches() -> None:
    # 50% more, but only 5 searches.
    assert not is_material_change(_reading(volume=10), _reading(volume=15))
    assert is_material_change(_reading(volume=10), _reading(volume=21))


def test_the_trend_is_the_regression_slope_over_the_mean() -> None:
    # 100, 110, ... 210: slope 10 a month, mean 155.
    trend = trend_pct_per_month(_months([100 + 10 * n for n in range(12)]))
    assert trend == pytest.approx(10 / 155 * 100)


def test_the_trend_reads_the_last_twelve_months_in_order() -> None:
    older = _months([5000] * 6, start=(2025, 3))
    recent = _months([100] * 12)
    shuffled = list(reversed(older + recent))
    assert trend_pct_per_month(shuffled) == pytest.approx(0.0)


@pytest.mark.parametrize(
    "volumes",
    [[None] * 12, [100, 200], [0] * 12],
)
def test_too_little_data_or_no_searches_has_no_trend(volumes: list[int | None]) -> None:
    assert trend_pct_per_month(_months(volumes)) is None


def test_seasonality_indexes_each_month_against_the_years_mean() -> None:
    volumes = [50] * 11 + [600]  # August 2026 is the peak
    index, seasonal = seasonality(_months(volumes))
    assert index[8] == pytest.approx(600 / (1150 / 12))
    assert index[9] == pytest.approx(50 / (1150 / 12))
    assert seasonal is True
    # A peak alone is not enough: the quiet months must also be low.
    assert seasonality(_months([100] * 11 + [300]))[1] is False


def test_a_flat_year_is_not_seasonal_and_a_short_one_is_unknown() -> None:
    assert seasonality(_months([100] * 12)) == (dict.fromkeys(range(1, 13), 1.0), False)
    assert seasonality(_months([100] * 11)) == ({}, None)
    assert seasonality(_months([0] * 12)) == ({}, None)
