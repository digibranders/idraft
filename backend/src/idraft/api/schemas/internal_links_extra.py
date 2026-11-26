"""Bodies and answers of slices 2 and 3 of the internal link tracker (plan 04, API contract)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from idraft.api.schemas.common import Body
from idraft.api.schemas.internal_links import PlacementName, TierCount, TierRef, UrlId, UrlIdText

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
    links_compared: bool = Field(
        description="False when the link counts were not worked out: the links of this crawl or "
        "of the one before were dropped. The counts are then zero, not measured."
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


class OverviewStatus(BaseModel):
    live: int
    variant: int
    redirected: int
    client_error: int
    server_error: int
    blocked: int
    other: int


class OverviewSitemap(BaseModel):
    state: Literal["read", "no_sitemap"]
    indexable_in_sitemap: int | None
    indexable_missing: int | None
    listed_not_live: int | None
    listed_not_indexable: int | None


class OverviewDepth(BaseModel):
    clicks: int = Field(description="0 to 6; 6 is 6 clicks and more.")
    pages: int


class OverviewSection(BaseModel):
    section: str = Field(description="The first folder of the path, `/` for a top-level page.")
    pages: int


class PagesOverview(BaseModel):
    run_id: UUID
    crawled_at: datetime | None
    addresses: int
    status: OverviewStatus
    indexable: int
    not_indexable: int
    reachable: int
    unreachable: int
    orphans: int
    sitemap: OverviewSitemap
    depth: list[OverviewDepth]
    tiers: list[TierCount]
    sections: list[OverviewSection]
    sections_total: int


class PagesOverviewResponse(BaseModel):
    data: PagesOverview


class PageSearchDay(BaseModel):
    date: date
    clicks: int
    impressions: int


class PageSearchDaily(BaseModel):
    state: Literal["ok", "pending", "not_connected"]
    window_start: date | None
    window_end: date | None
    clicks: int | None
    impressions: int | None
    days: list[PageSearchDay] = Field(
        description="One row per day of the window with `ok`, a day without a stored row as "
        "zeros; empty otherwise."
    )


class PageSearchDailyResponse(BaseModel):
    data: PageSearchDaily


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
    equity_points: float | None = Field(
        description="Link strength change in points since the previous crawl."
    )
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
    source_equity_share: float | None = Field(
        description="Link strength of the page that would carry the link: its share of the "
        "whole site's, 0 to 1."
    )
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


class SuggestionReason(BaseModel):
    kind: Literal["clicks", "rank"]
    clicks: int | None
    rank: int | None
    keyword: str | None
    volume: int | None


class TierSuggestionRow(BaseModel):
    url_id: UrlIdText
    url: str
    path: str
    title: str | None
    from_tier: TierRef | None
    to_tier: TierRef
    reasons: list[SuggestionReason]


class TierSuggestionMeta(BaseModel):
    run_id: UUID
    gsc_state: Literal["ok", "pending", "not_connected"] = Field(
        description="`ok`: clicks were used with the ranks; otherwise only ranks were."
    )


class TierSuggestionList(BaseModel):
    data: list[TierSuggestionRow]
    meta: TierSuggestionMeta


class SuggestionSelection(Body):
    url_ids: list[UrlId] | None = Field(default=None, min_length=1, max_length=500)
    all: Literal[True] | None = None

    @model_validator(mode="after")
    def _one_of(self) -> SuggestionSelection:
        if (self.url_ids is None) == (self.all is None):
            raise ValueError("give `url_ids` or `all`, not both and not neither")
        return self


class RouteStep(BaseModel):
    page: ChangePage
    status_code: int | None
    anchor: str | None = Field(description="The words of the link that reached this page.")
    placement: PlacementName | None
    scope: Literal["editorial", "auto_generated", "template"] | None
    via_redirect: bool


class Route(BaseModel):
    clicks: int
    steps: list[RouteStep]


class Routes(BaseModel):
    target: ChangePage
    any: Route | None = Field(description="Over every followed link; null when not reachable.")
    editorial: Route | None = Field(description="Over editorial links (and redirects) only.")


class RoutesResponse(BaseModel):
    data: Routes
