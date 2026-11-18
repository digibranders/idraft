"""Bodies and answers of slices 2 and 3 of the internal link tracker (plan 04, API contract)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from idraft.api.schemas.common import Body
from idraft.api.schemas.internal_links import PlacementName, TierRef, UrlId, UrlIdText

AlertChannel = Literal["app", "email", "slack"]
DeliveryState = Literal["shown_in_app", "channel_unavailable"]
LostPriority = Literal["lost_to_t1", "lost_to_t2", "lower", "none"]


class ChangePage(BaseModel):
    url_id: UrlIdText
    url: str
    path: str
    tier: TierRef | None = Field(description="null is Untiered.")


class ChangeAlert(BaseModel):
    lost_links: int
    max_position: int
    threshold: int
    channel: AlertChannel
    delivery_state: DeliveryState


class ChangesSummary(BaseModel):
    run_id: UUID
    previous_run_id: UUID | None
    previous_finished_at: datetime | None
    state: Literal["first_crawl", "pending", "ready", "unavailable"] = Field(
        description="`pending` until the crawl's changes are worked out, `unavailable` when "
        "enrichment failed before that."
    )
    editorial_lost: int
    editorial_added: int
    all_lost: int
    all_added: int
    lost_to_top: int = Field(description="Editorial links lost to the important tiers.")
    important_max_position: int
    pages_added: int
    pages_lost: int
    alert: ChangeAlert | None


class ChangesSummaryResponse(BaseModel):
    data: ChangesSummary


class ChangeLink(BaseModel):
    source: ChangePage
    target: ChangePage
    anchor: str
    placement: PlacementName
    priority: LostPriority
    still_linked_by: PlacementName | None = Field(
        description="Another link that still joins the pair in this crawl (editorial scope)."
    )


class ChangeLinkMeta(BaseModel):
    run_id: UUID
    previous_run_id: UUID | None
    change: Literal["lost", "added"]
    link_scope: Literal["editorial", "all"]
    only: Literal["top", "all"]
    total: int
    truncated: bool = Field(description="The stored changes were cut at 200,000 rows.")


class ChangeLinkPage(BaseModel):
    data: list[ChangeLink]
    meta: ChangeLinkMeta


class MovedPage(BaseModel):
    page: ChangePage
    editorial_in: int
    editorial_in_delta: int | None
    equity_points: float | None
    depth: int | None
    depth_state: Literal["lost", "found"] | None
    depth_delta: int | None


class MovedPageMeta(BaseModel):
    run_id: UUID
    previous_run_id: UUID | None


class MovedPageList(BaseModel):
    data: list[MovedPage]
    meta: MovedPageMeta


class AlertSettings(BaseModel):
    enabled: bool = True
    max_position: int = Field(
        default=2, ge=1, le=8, description="Tier positions 1 to this one are important."
    )
    threshold: int = Field(default=1, ge=1, le=50, description="Lost links that raise an alert.")
    channel: AlertChannel = "app"


OpportunityStatus = Literal["open", "accepted", "dismissed"]


class Opportunity(BaseModel):
    key: str = Field(description='"{source_url_id}>{target_url_id}".')
    source: ChangePage
    target: ChangePage
    phrase: str
    context: str
    anchor: str = Field(description="The words to link: the phrase as written in the text.")
    source_equity_share: float | None
    status: OpportunityStatus
    origin: Literal["keyword", "anchor"]


class OpportunityCounts(BaseModel):
    open: int
    accepted: int
    dismissed: int


class OpportunityMeta(BaseModel):
    run_id: UUID
    total: int
    counts: OpportunityCounts


class OpportunityPage(BaseModel):
    data: list[Opportunity]
    meta: OpportunityMeta


class OpportunityPair(Body):
    source_url_id: UrlId
    target_url_id: UrlId


class OpportunityDecisions(Body):
    items: list[OpportunityPair] = Field(min_length=1, max_length=500)
    status: OpportunityStatus


class DecisionResult(BaseModel):
    matched: int
    changed: int


class DecisionResponse(BaseModel):
    data: DecisionResult
