"""Bodies of the rank history and SERP routes (docs/19-api-specification.md section 3.6.4 and
example 4.2; plan Task 8)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from sightline.api.pagination import CursorPageInfo
from sightline.api.schemas.entities import EntityRef
from sightline.api.schemas.keywords import AioState, RankCell, UrlRef
from sightline.api.schemas.metrics import MetricValue, Usd

HistoryState = Literal["ranked", "beyond_depth", "failed"]
HistoryInclude = Literal["absolute", "url", "events"]
HistoryFormat = Literal["points", "columns"]
AioSnapshotState = Literal["absent", "present", "present_async_loaded", "present_not_loaded"]
TitlesSource = Literal["domain_rank_observations", "serp_current_results", "unavailable"]


class HistoryWindow(BaseModel):
    from_: date = Field(serialization_alias="from")
    to: date
    timezone: str

    model_config = {"populate_by_name": True}


class HistoryConfig(BaseModel):
    config_version: int
    depth_profile: str
    valid_from: datetime
    valid_to: datetime | None


class HistoryPoint(BaseModel):
    date: date
    observed_at: datetime | None
    state: HistoryState
    rank: int | None = Field(description="Null unless `state` is `ranked`.")
    absolute_rank: int | None = Field(description="`include=absolute`.")
    depth_requested: int | None = Field(description="Null for a failed check.")
    url_id: str | None = Field(description="`include=url`; a key of `urls`.")
    serp_snapshot_id: str | None


class HistorySeries(BaseModel):
    entity: EntityRef
    points: list[HistoryPoint]


class HistoryColumns(BaseModel):
    """`format=columns`: the points of one entity as parallel arrays."""

    entity: EntityRef
    t: list[datetime | None]
    state: list[HistoryState]
    rank: list[int | None]
    absolute_rank: list[int | None]
    depth_requested: list[int | None]
    url_id: list[str | None]
    serp_snapshot_id: list[str | None]


class HistoryBand(BaseModel):
    entity_id: str
    from_: date = Field(serialization_alias="from")
    to: date
    kind: Literal["beyond_depth"]
    depth_requested: int
    label: str

    model_config = {"populate_by_name": True}


class HistoryEvent(BaseModel):
    rank_event_id: str
    occurred_at: datetime
    event_type: str
    entity_id: str
    from_rank: int | None
    to_rank: int | None


class VersionBoundary(BaseModel):
    at: datetime
    component: Literal["tracked_keyword_config"]
    from_: int = Field(serialization_alias="from")
    to: int

    model_config = {"populate_by_name": True}


class HistorySummary(BaseModel):
    average_rank: MetricValue | None
    checks: int
    ranked_checks: int
    beyond_depth_checks: int
    failed_checks: int


class RankHistory(BaseModel):
    tracked_keyword_id: str
    window: HistoryWindow
    deep_check_weekday: int
    config_history: list[HistoryConfig]
    urls: dict[str, UrlRef]
    series: list[HistorySeries] | None = Field(description="`format=points`.")
    columns: list[HistoryColumns] | None = Field(description="`format=columns`.")
    bands: list[HistoryBand]
    events: list[HistoryEvent] | None = Field(description="`include=events`.")
    summary: HistorySummary
    version_boundaries: list[VersionBoundary]


class RankHistoryResponse(BaseModel):
    data: RankHistory


class SerpSnapshotSummary(BaseModel):
    serp_snapshot_id: str
    observed_at: datetime
    observed_date: date
    config_version: int
    provider_code: str
    provider_endpoint: str
    se_domain: str | None
    location_id: int
    language_code: str
    device: str
    os: str | None
    depth_requested: int
    depth_returned: int
    se_results_count: int | None
    item_types: list[str]
    has_ai_overview: bool
    ai_overview_state: AioSnapshotState | None
    has_ai_mode_link: bool | None
    served_from_cache: bool
    cost_usd: Usd | None
    own: RankCell


class SerpSnapshotPageInfo(CursorPageInfo):
    pass


class SerpSnapshotPage(BaseModel):
    data: list[SerpSnapshotSummary]
    page: SerpSnapshotPageInfo


class SerpDomain(BaseModel):
    domain_id: int
    host: str
    registrable_domain: str


class SerpResult(BaseModel):
    organic_rank: int
    absolute_rank: int | None
    url: UrlRef
    domain: SerpDomain
    title: str | None
    snippet: str | None
    entity: EntityRef | None = Field(
        description="The own or competitor entity the result belongs to at the last check."
    )


class SerpCurrent(BaseModel):
    serp_snapshot_id: str | None
    observed_at: datetime | None
    results: list[SerpResult]


class SerpCurrentResponse(BaseModel):
    data: SerpCurrent


class SerpFeatureOut(BaseModel):
    feature_type: str
    ordinal: int
    rank_absolute: int | None
    source_urls: list[UrlRef]
    owned_by_project: bool
    owned_position: int | None
    competitor_entity_ids: list[str]
    payload: dict[str, object] | None


class SerpOrganicItem(BaseModel):
    organic_rank: int
    absolute_rank: int | None
    url: UrlRef
    domain: SerpDomain
    entity: EntityRef | None
    title: str | None
    snippet: str | None


class SerpProvenance(BaseModel):
    raw_payload_id: str
    parser_version: int
    canonicalizer_version: int
    provider_task_id: str | None
    collection_task_id: str | None


class SerpSnapshotDetail(SerpSnapshotSummary):
    organic: list[SerpOrganicItem]
    titles_source: TitlesSource
    features: list[SerpFeatureOut]
    ai_overview_observation_id: str | None
    provenance: SerpProvenance


class SerpSnapshotDetailResponse(BaseModel):
    data: SerpSnapshotDetail


class FeatureCheck(BaseModel):
    observed_at: datetime
    serp_snapshot_id: str
    depth_requested: int
    features: list[SerpFeatureOut]


class FeaturePresence(BaseModel):
    feature_type: str
    presence_rate: MetricValue
    own_ownership_rate: MetricValue


class SerpFeatureHistory(BaseModel):
    checks: list[FeatureCheck]
    presence: list[FeaturePresence]


class SerpFeatureHistoryResponse(BaseModel):
    data: SerpFeatureHistory


class AioHistoryItem(BaseModel):
    observed_at: datetime
    serp_snapshot_id: str
    device: str
    location_id: int
    ai_overview_state: AioState
    own_cited: bool | None
    own_citation_position: int | None
    competitors_cited: list[EntityRef]
    source_count: int
    organic_rank: RankCell
    observation_id: str | None


class AioHistoryResponse(BaseModel):
    data: list[AioHistoryItem]


class RankEventOut(BaseModel):
    rank_event_id: str
    occurred_at: datetime
    tracked_keyword_id: str
    keyword: str
    entity: EntityRef
    event_type: str
    feature_type: str | None
    from_rank: int | None
    to_rank: int | None
    from_url: UrlRef | None
    to_url: UrlRef | None
    other_entity: EntityRef | None
    serp_snapshot_id: str


class RankEventPage(BaseModel):
    data: list[RankEventOut]
    page: CursorPageInfo
