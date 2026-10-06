"""The rank blocks of a tracked keyword row, as the API shows them (docs/19 section 3.6.1; plan
decisions R23 and R24). The change label is not stored: it is derived from the stored ranks and
depths by the rule the worker uses (`ranks.state.classify_change`), so a client sees what the
rank rules decided."""

from __future__ import annotations

from collections.abc import Sequence

from sightline.api.keywords.rank_repository import (
    CompetitorRank as CompetitorRankRecord,
)
from sightline.api.keywords.rank_repository import (
    FeatureRecord,
    SparkPoint,
    StateRecord,
)
from sightline.api.keywords.repository import CompetitorRecord, UrlRecord
from sightline.api.schemas.entities import EntityRef
from sightline.api.schemas.keywords import (
    AioCitations,
    AioStateInfo,
    CompetitorRank,
    FeatureOnPage,
    RankCell,
    RankChange,
    Sparkline,
    SparklinePoint,
    TrackedKeywordState,
    UrlRef,
)
from sightline.ranks.state import classify_change

_NOT_CHECKED = RankCell(
    state="not_checked",
    rank=None,
    absolute_rank=None,
    depth_requested=None,
    url=None,
    observed_at=None,
    serp_snapshot_id=None,
)


def url_ref(record: UrlRecord | None) -> UrlRef | None:
    if record is None:
        return None
    return UrlRef(
        url_id=str(record.url_id),
        canonical_url=record.canonical_url,
        host=record.host,
        registrable_domain=record.registrable_domain,
        path=record.path,
    )


def _change(
    *,
    previous_rank: int | None,
    previous_depth: int | None,
    previous_at: object,
    rank: int | None,
    depth: int | None,
) -> RankChange:
    if depth is None:
        return RankChange(
            value=None, label="first_check", previous_rank=None, previous_observed_at=None
        )
    found = classify_change(
        previous_rank=previous_rank,
        previous_depth=previous_depth,
        rank=rank,
        depth=depth,
        first=previous_depth is None,
    )
    return RankChange.model_validate(
        {
            "value": found.delta,
            "label": found.kind,
            "previous_rank": previous_rank if found.kind != "first_check" else None,
            "previous_observed_at": previous_at if found.kind != "first_check" else None,
        }
    )


def state_view(record: StateRecord | None) -> TrackedKeywordState:
    """The keyword's state; a keyword with none, or never checked, is `not_checked`."""
    if record is None:
        return TrackedKeywordState(
            current=_NOT_CHECKED,
            change=_change(
                previous_rank=None, previous_depth=None, previous_at=None, rank=None, depth=None
            ),
            best_rank=None,
            best_rank_at=None,
            worst_rank=None,
            first_ranked_at=None,
            feature_types_present=[],
            owned_feature_types=[],
            aio=AioStateInfo(state="unknown", citation_position=None, observation_id=None),
            target_url_match=None,
            url_changed_at=None,
            consecutive_failures=0,
            is_stale=False,
            last_observed_at=None,
            ranking_url_count=0,
        )
    checked = record.last_observed_at is not None
    if not checked:
        current = _NOT_CHECKED.model_copy(
            update={"state": "failed" if record.consecutive_failures > 0 else "not_checked"}
        )
    else:
        current = RankCell.model_validate(
            {
                "state": "ranked" if record.current_rank is not None else "beyond_depth",
                "rank": record.current_rank,
                "absolute_rank": record.current_absolute_rank,
                "depth_requested": record.current_depth_requested,
                "url": url_ref(record.current_url),
                "observed_at": record.last_observed_at,
                "serp_snapshot_id": None
                if record.last_snapshot_id is None
                else str(record.last_snapshot_id),
            }
        )
    return TrackedKeywordState(
        current=current,
        change=_change(
            previous_rank=record.previous_rank,
            previous_depth=record.previous_depth_requested,
            previous_at=record.previous_observed_at,
            rank=record.current_rank,
            depth=record.current_depth_requested if checked else None,
        ),
        best_rank=record.best_rank,
        best_rank_at=record.best_rank_at,
        worst_rank=record.worst_rank,
        first_ranked_at=record.first_ranked_at,
        feature_types_present=record.feature_types_present,
        owned_feature_types=record.owned_feature_types,
        aio=AioStateInfo.model_validate(
            {
                "state": record.aio_state or "unknown",
                "citation_position": record.aio_citation_position,
                "observation_id": None
                if record.aio_observation_id is None
                else str(record.aio_observation_id),
            }
        ),
        target_url_match=record.target_url_match,
        url_changed_at=record.url_changed_at,
        consecutive_failures=record.consecutive_failures,
        is_stale=record.is_stale,
        last_observed_at=record.last_observed_at,
        ranking_url_count=record.ranking_url_count,
    )


def sparkline_view(points: Sequence[SparkPoint]) -> Sparkline:
    return Sparkline(
        points=[
            SparklinePoint(
                t=point.observed_at,
                rank=point.rank,
                depth=point.depth,
                state="ranked" if point.rank is not None else "beyond_depth",
            )
            for point in points
        ]
    )


def _entity(record: CompetitorRecord) -> EntityRef:
    return EntityRef.model_validate(
        {
            "entity_id": record.entity_id,
            "canonical_name": record.canonical_name,
            "entity_type": record.entity_type,
            "role": record.role,
            "color_index": record.color_index,
        }
    )


def competitor_view(record: CompetitorRankRecord) -> CompetitorRank:
    return CompetitorRank(
        entity=_entity(record.entity),
        current=RankCell.model_validate(
            {
                "state": "ranked" if record.rank is not None else "beyond_depth",
                "rank": record.rank,
                "absolute_rank": record.absolute_rank,
                "depth_requested": record.depth_requested,
                "url": url_ref(record.url),
                "observed_at": record.observed_at,
                "serp_snapshot_id": str(record.snapshot_id),
            }
        ),
        change=_change(
            previous_rank=record.previous_rank,
            previous_depth=record.previous_depth_requested,
            previous_at=record.previous_observed_at,
            rank=record.rank,
            depth=record.depth_requested,
        ),
    )


def features_view(records: Sequence[FeatureRecord]) -> list[FeatureOnPage]:
    return [
        FeatureOnPage(
            feature_type=record.feature_type,
            ordinal=record.ordinal,
            rank_absolute=record.rank_absolute,
            owned_by_project=record.owned_by_project,
            owned_position=record.owned_position,
        )
        for record in records
    ]


def aio_view(state: StateRecord | None, cited: Sequence[UrlRecord]) -> AioCitations:
    return AioCitations.model_validate(
        {
            "state": "unknown" if state is None else state.aio_state or "unknown",
            "citation_position": None if state is None else state.aio_citation_position,
            "cited_urls": [url_ref(url) for url in cited],
        }
    )
