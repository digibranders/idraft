"""Keyword metric rules: when a new reading is a material change (docs/06-dataforseo-seo-
integration.md section 7.2), and the trend and seasonality of a year of monthly volumes
(docs/08-seo-keyword-system.md section 6)."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

# docs/06 section 7.2.
VOLUME_SHARE: Final = 0.20
VOLUME_SEARCHES: Final = 10
DIFFICULTY_POINTS: Final = 5
# docs/08 section 6.
TREND_MONTHS: Final = 12
TREND_MONTHS_MIN: Final = 3
SEASONAL_HIGH: Final = 1.5
SEASONAL_LOW: Final = 0.67
TREND_METHOD: Final = (
    "Linear regression slope of the last 12 monthly search volumes, divided by their mean "
    "(percent per month)"
)
SEASONALITY_METHOD: Final = (
    "Each month's search volume divided by the mean of the last 12 months; seasonal when the "
    "highest index is above 1.5 and the lowest below 0.67"
)


@dataclass(frozen=True, slots=True)
class MetricsReading:
    search_volume: int | None
    keyword_difficulty: int | None
    intent_main: str | None


@dataclass(frozen=True, slots=True)
class Month:
    year: int
    month: int
    search_volume: int | None


def is_material_change(previous: MetricsReading | None, current: MetricsReading) -> bool:
    """A keyword's first reading is material; after that, a volume move of more than 20% and
    more than 10 searches, a difficulty move of more than 5 points, or another main intent. A
    value that appears or disappears is a change too."""
    if previous is None:
        return True
    if (previous.search_volume is None) != (current.search_volume is None):
        return True
    if previous.search_volume is not None and current.search_volume is not None:
        moved = abs(current.search_volume - previous.search_volume)
        if moved > VOLUME_SEARCHES and moved > VOLUME_SHARE * previous.search_volume:
            return True
    if (previous.keyword_difficulty is None) != (current.keyword_difficulty is None):
        return True
    if (
        previous.keyword_difficulty is not None
        and current.keyword_difficulty is not None
        and abs(current.keyword_difficulty - previous.keyword_difficulty) > DIFFICULTY_POINTS
    ):
        return True
    return previous.intent_main != current.intent_main


def _last_year(months: Sequence[Month]) -> list[Month]:
    """The latest twelve months with a volume, oldest first."""
    known = sorted(
        (month for month in months if month.search_volume is not None),
        key=lambda month: (month.year, month.month),
    )
    return known[-TREND_MONTHS:]


def trend_pct_per_month(months: Sequence[Month]) -> float | None:
    """The least-squares slope of the latest twelve volumes over their mean, in percent a month.
    None with fewer than three months or a mean of zero."""
    year = _last_year(months)
    if len(year) < TREND_MONTHS_MIN:
        return None
    volumes = [float(month.search_volume or 0) for month in year]
    mean = sum(volumes) / len(volumes)
    if mean == 0:
        return None
    positions = range(len(volumes))
    middle = (len(volumes) - 1) / 2
    covariance = sum((x - middle) * (y - mean) for x, y in zip(positions, volumes, strict=True))
    variance = sum((x - middle) ** 2 for x in positions)
    return covariance / variance / mean * 100


def seasonality(months: Sequence[Month]) -> tuple[dict[int, float], bool | None]:
    """Each calendar month's index over the latest twelve months, and whether the keyword is
    seasonal. Empty and None without twelve months of volume, or with none at all."""
    year = _last_year(months)
    if len(year) < TREND_MONTHS:
        return {}, None
    mean = sum(month.search_volume or 0 for month in year) / TREND_MONTHS
    if mean == 0:
        return {}, None
    index = {month.month: (month.search_volume or 0) / mean for month in year}
    return index, max(index.values()) > SEASONAL_HIGH and min(index.values()) < SEASONAL_LOW
