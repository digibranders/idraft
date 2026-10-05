"""The shape of a rank history (docs/19 section 4.2), built from observations with no database in
sight.

One point is one successful check, on the project-local date it happened; a check that failed for
good is a point of its own (`failed`). A rank is known within the depth that was checked:
`beyond_depth` never has a rank and is never drawn through (docs/09 section 3). Runs of
beyond-depth checks at one depth are bands, so a chart can shade them.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import date, datetime
from typing import Final
from uuid import UUID
from zoneinfo import ZoneInfo

from sightline.api.ranks.repository import EventRow, Observation
from sightline.api.schemas.entities import EntityRef
from sightline.api.schemas.metrics import MetricValue, MetricWindow
from sightline.api.schemas.ranks import (
    HistoryBand,
    HistoryColumns,
    HistoryConfig,
    HistoryEvent,
    HistoryPoint,
    HistorySummary,
    VersionBoundary,
)

WINDOW_MAX_DAYS: Final = 400
WINDOWS: Final[Mapping[str, int]] = {
    "last_7d": 7,
    "last_30d": 30,
    "last_90d": 90,
    "last_180d": 180,
    "last_365d": 365,
}


def point_of(
    observation: Observation, zone: ZoneInfo, *, absolute: bool, with_url: bool
) -> HistoryPoint:
    ranked = observation.organic_rank is not None
    return HistoryPoint(
        date=observation.observed_at.astimezone(zone).date(),
        observed_at=observation.observed_at,
        state="ranked" if ranked else "beyond_depth",
        rank=observation.organic_rank,
        absolute_rank=observation.absolute_rank if absolute and ranked else None,
        depth_requested=observation.depth_requested,
        url_id=str(observation.ranking_url_id) if with_url and observation.ranking_url_id else None,
        serp_snapshot_id=str(observation.snapshot_id),
    )


def failed_point(scheduled_for: datetime, zone: ZoneInfo) -> HistoryPoint:
    return HistoryPoint(
        date=scheduled_for.astimezone(zone).date(),
        observed_at=None,
        state="failed",
        rank=None,
        absolute_rank=None,
        depth_requested=None,
        url_id=None,
        serp_snapshot_id=None,
    )


def series_points(
    observations: Sequence[Observation],
    failed: Sequence[datetime],
    zone: ZoneInfo,
    *,
    absolute: bool,
    with_url: bool,
) -> list[HistoryPoint]:
    """One entity's points in time order, the failed checks among them."""
    timed = [
        (obs.observed_at, point_of(obs, zone, absolute=absolute, with_url=with_url))
        for obs in observations
    ]
    timed += [(when, failed_point(when, zone)) for when in failed]
    return [point for _, point in sorted(timed, key=lambda pair: pair[0])]


def columns_of(entity: EntityRef, points: Sequence[HistoryPoint]) -> HistoryColumns:
    return HistoryColumns(
        entity=entity,
        t=[p.observed_at for p in points],
        state=[p.state for p in points],
        rank=[p.rank for p in points],
        absolute_rank=[p.absolute_rank for p in points],
        depth_requested=[p.depth_requested for p in points],
        url_id=[p.url_id for p in points],
        serp_snapshot_id=[p.serp_snapshot_id for p in points],
    )


def bands_of(entity_id: UUID, points: Sequence[HistoryPoint]) -> list[HistoryBand]:
    """Runs of consecutive beyond-depth checks at one depth."""
    bands: list[HistoryBand] = []
    run: list[HistoryPoint] = []

    def close() -> None:
        if run and run[0].depth_requested is not None:
            depth = run[0].depth_requested
            bands.append(
                HistoryBand(
                    entity_id=str(entity_id),
                    from_=run[0].date,
                    to=run[-1].date,
                    kind="beyond_depth",
                    depth_requested=depth,
                    label=f"not in top {depth}",
                )
            )
        run.clear()

    for point in points:
        if point.state == "beyond_depth" and (
            not run or run[0].depth_requested == point.depth_requested
        ):
            run.append(point)
            continue
        close()
        if point.state == "beyond_depth":
            run.append(point)
    close()
    return bands


def events_of(rows: Sequence[EventRow]) -> list[HistoryEvent]:
    return [
        HistoryEvent(
            rank_event_id=str(row.id),
            occurred_at=row.occurred_at,
            event_type=row.event_type,
            entity_id=str(row.entity_id),
            from_rank=row.from_rank,
            to_rank=row.to_rank,
        )
        for row in rows
    ]


def summary_of(
    points: Sequence[HistoryPoint], window: tuple[date, date], timezone: str
) -> HistorySummary:
    """The counts of the first series (the project's own site) and its average rank over the
    ranked checks. Beyond-depth checks are counted, never given a rank."""
    ranked = [p.rank for p in points if p.rank is not None]
    beyond = sum(1 for p in points if p.state == "beyond_depth")
    failed = sum(1 for p in points if p.state == "failed")
    average = None
    if ranked:
        average = MetricValue(
            metric="seo.average_rank",
            value=sum(ranked) / len(ranked),
            numerator=float(sum(ranked)),
            denominator=float(len(ranked)),
            unit="rank",
            n_observations=len(ranked) + beyond,
            n_keywords=1,
            window=MetricWindow(
                from_=window[0].isoformat(), to=window[1].isoformat(), timezone=timezone
            ),
            filters={"entity": "own"},
            is_estimate=False,
            method="Mean organic rank over ranked checks only; beyond-depth checks excluded and "
            "counted",
            method_version=1,
        )
    return HistorySummary(
        average_rank=average,
        checks=len(ranked) + beyond,
        ranked_checks=len(ranked),
        beyond_depth_checks=beyond,
        failed_checks=failed,
    )


def version_boundaries(
    config: Sequence[HistoryConfig], since: datetime, until: datetime
) -> list[VersionBoundary]:
    return [
        VersionBoundary(
            at=entry.valid_from,
            component="tracked_keyword_config",
            from_=entry.config_version - 1,
            to=entry.config_version,
        )
        for entry in config
        if entry.config_version > 1 and since <= entry.valid_from < until
    ]
