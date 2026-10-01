"""Keyword metrics in the metric contract (docs/19-api-specification.md section 2.6), with the
trend and seasonality of docs/08-seo-keyword-system.md section 6."""

from __future__ import annotations

import calendar
from collections.abc import Mapping, Sequence
from datetime import date
from typing import Final

from sightline.api.keywords.repository import MetricsRecord, SnapshotRecord
from sightline.api.schemas.keywords import (
    CompetitionLevel,
    KeywordMetrics,
    KeywordMetricsHistory,
    MetricsSnapshot,
    MetricsSource,
    MonthIndex,
    MonthlySearches,
    Seasonality,
)
from sightline.api.schemas.metrics import MetricValue, MetricWindow
from sightline.domain.keyword_metrics import (
    SEASONALITY_METHOD,
    Month,
    seasonality,
    trend_pct_per_month,
    year_span,
)

# The sources `seo.keyword_metric_snapshots.source` allows, with the name `method` gives them.
_SOURCES: Final[Mapping[str, tuple[MetricsSource, str]]] = {
    "dataforseo_labs": ("dataforseo_labs", "DataForSEO Labs"),
    "dataforseo_google_ads": ("dataforseo_google_ads", "Google Ads through DataForSEO"),
    "dataforseo_clickstream": ("dataforseo_clickstream", "DataForSEO clickstream"),
}
_LEVELS: Final[Mapping[str, CompetitionLevel]] = {"LOW": "LOW", "MEDIUM": "MEDIUM", "HIGH": "HIGH"}
TREND_VALUE_METHOD: Final = (
    "Linear regression slope of the last 12 monthly search volumes, divided by their mean "
    "(a fraction a month); a fitted value, so no numerator or denominator"
)


def months_of(monthly: Sequence[Mapping[str, object]]) -> list[Month]:
    """The provider's monthly volumes, oldest first; an entry without a year and a month is
    left out."""
    found = []
    for entry in monthly:
        year, month, volume = entry.get("year"), entry.get("month"), entry.get("search_volume")
        if isinstance(year, int) and isinstance(month, int) and 1 <= month <= 12:
            found.append(Month(year, month, volume if isinstance(volume, int) else None))
    return sorted(found, key=lambda month: (month.year, month.month))


def _month_end(day: date) -> date:
    return day.replace(day=calendar.monthrange(day.year, day.month)[1])


def _window(months: Sequence[Month], fallback: date) -> MetricWindow:
    """The twelve calendar months the trend and seasonality read (`year_span`), else the
    fallback's month."""
    span = year_span(months)
    if span is None:
        start, end = fallback.replace(day=1), _month_end(fallback)
    else:
        (first_year, first_month), (last_year, last_month) = span
        start = date(first_year, first_month, 1)
        end = _month_end(date(last_year, last_month, 1))
    return MetricWindow(from_=start.isoformat(), to=end.isoformat(), timezone="UTC")


def _observations(months: Sequence[Month]) -> int:
    """The months with a volume within `year_span`."""
    span = year_span(months)
    if span is None:
        return 0
    first, last = span
    return len(
        {
            (month.year, month.month)
            for month in months
            if month.search_volume is not None and first <= (month.year, month.month) <= last
        }
    )


def _filters(location_id: int, language_code: str) -> dict[str, object]:
    return {"location_id": location_id, "language_code": language_code}


def search_volume(record: MetricsRecord) -> MetricValue:
    _, label = _SOURCES[record.source]
    return MetricValue(
        metric="seo.search_volume",
        value=None if record.search_volume is None else float(record.search_volume),
        numerator=None,
        denominator=None,
        unit="count",
        n_observations=1,
        n_keywords=1,
        window=_window(
            months_of(record.monthly_searches), record.data_month or record.fetched_at.date()
        ),
        filters=_filters(record.location_id, record.language_code),
        is_estimate=True,
        method=f"Provider-reported average monthly search volume ({label}), annual average",
        method_version=1,
        source=record.source,
    )


def keyword_metrics(record: MetricsRecord) -> KeywordMetrics:
    months = months_of(record.monthly_searches)
    _, is_seasonal = seasonality(months)
    source, _ = _SOURCES[record.source]
    return KeywordMetrics(
        source=source,
        location_id=record.location_id,
        language_code=record.language_code,
        fetched_at=record.fetched_at,
        data_month=record.data_month,
        search_volume=search_volume(record),
        cpc_usd=record.cpc_usd,
        competition=None if record.competition is None else float(record.competition),
        competition_level=None
        if record.competition_level is None
        else _LEVELS.get(record.competition_level),
        keyword_difficulty=record.keyword_difficulty,
        intent_main=record.intent_main,
        trend_pct_per_month=trend_pct_per_month(months),
        is_seasonal=is_seasonal,
    )


def history(
    snapshots: Sequence[SnapshotRecord],
    *,
    location_id: int,
    language_code: str,
    source: str,
    today: date,
) -> KeywordMetricsHistory:
    """The snapshots, oldest first, with the trend and seasonality of the latest one."""
    latest = snapshots[-1] if snapshots else None
    months = [] if latest is None else months_of(latest.monthly_searches)
    trend = trend_pct_per_month(months)
    index, is_seasonal = seasonality(months)
    fallback = today if latest is None else latest.data_month or latest.fetched_at.date()
    return KeywordMetricsHistory(
        snapshots=[
            MetricsSnapshot(
                snapshot_id=str(snapshot.id),
                fetched_at=snapshot.fetched_at,
                data_month=snapshot.data_month,
                search_volume=snapshot.search_volume,
                monthly_searches=[
                    MonthlySearches(
                        year=month.year, month=month.month, search_volume=month.search_volume
                    )
                    for month in months_of(snapshot.monthly_searches)
                ],
                cpc_usd=snapshot.cpc_usd,
                keyword_difficulty=snapshot.keyword_difficulty,
                is_material_change=snapshot.is_material_change,
            )
            for snapshot in snapshots
        ],
        trend=MetricValue(
            metric="seo.search_volume_trend",
            value=None if trend is None else trend / 100,
            numerator=None,
            denominator=None,
            unit="ratio",
            n_observations=_observations(months),
            n_keywords=1,
            window=_window(months, fallback),
            filters=_filters(location_id, language_code),
            is_estimate=True,
            method=TREND_VALUE_METHOD,
            method_version=1,
            source=source,
        ),
        seasonality=Seasonality(
            index_by_month=[
                MonthIndex(month=month, index=value) for month, value in sorted(index.items())
            ],
            is_seasonal=is_seasonal,
            method=SEASONALITY_METHOD,
        ),
    )
