"""Response and request models of the page search and Monitoring routes (spec
docs/superpowers/specs/2026-11-26-page-search-and-monitoring-design.md section 7).

A number that was not collected is null, never 0. Verdicts and flags are codes: the web words
them."""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, model_validator

from idraft.api.schemas.common import Body
from idraft.api.schemas.internal_links import UrlId, UrlIdText

SearchState = Literal["ok", "pending", "not_connected", "reauth_required", "no_access"]
HealthVerdict = Literal[
    "no_data", "new", "lost", "low_data", "sharp_drop", "declining", "growing", "stable"
]
TrackOutcomeCode = Literal[
    "added", "ok", "already_tracked", "invalid_url", "wrong_host", "not_crawled", "over_limit"
]
TRACK_INPUTS_MAX = 500
UNTRACK_MAX = 200
URL_MAX = 2_048


class PageNumbers(BaseModel):
    clicks: int = Field(description="Clicks in the period.")
    impressions: int = Field(description="Impressions in the period.")
    ctr: float | None = Field(
        description="Clicks over impressions of the period; null when there were no impressions."
    )
    position: float | None = Field(
        description="Average position: the sum of position times impressions over the "
        "impressions, never an average of days. Null when no stored row carries a position."
    )


class PageHealth(BaseModel):
    verdict: HealthVerdict = Field(description="The health verdict of the page for the period.")
    basis: Literal["clicks", "impressions"] = Field(
        description="The metric the verdict was decided on."
    )
    change: float | None = Field(
        description="The relative change of the basis metric per day against the compared "
        "period; null when no change is stated."
    )
    absolute: float = Field(
        description="The difference of the basis metric, the compared period scaled to the "
        "length of this one."
    )
    small: bool = Field(
        description="The change is 10 percent or more on numbers too small to count."
    )
    flags: list[str] = Field(
        description="Extra signals: `ctr_fell_impressions_rose`, `position_slipped`, "
        "`position_improved`."
    )


class SearchWindow(BaseModel):
    from_: date = Field(
        alias="from",
        serialization_alias="from",
        description="First day, Pacific Time, included.",
    )
    to: date = Field(description="Last day, Pacific Time, included.")
    days: int = Field(description="Number of days in the period.")

    model_config = {"populate_by_name": True}


class SearchMeta(BaseModel):
    state: SearchState = Field(
        description="`ok`; `pending` (connected, the first 28 days are not stored yet); "
        "`not_connected`; `reauth_required` (stored numbers are served, Google is not called); "
        "`no_access` (Google refused the property, stored numbers are served)."
    )
    property: str | None = Field(description="The Search Console property; null when none.")
    final_through: date | None = Field(
        description="The last final day stored. Null with `not_connected` and `pending`."
    )
    window: SearchWindow | None = Field(
        description="The period the numbers are for. Null with `not_connected` and `pending`."
    )
    compare_window: SearchWindow | None = Field(
        description="The period compared with. Null with `compare=none`, `not_connected` and "
        "`pending`."
    )


class PageQueries(BaseModel):
    value: int = Field(
        description="The number of different queries that gave the page an impression, as "
        "Google reports them. It leaves out anonymized queries, so the real number is higher."
    )
    previous: int | None = Field(
        description="The same count for the compared period. Null with `compare=none`, when it "
        "is not stored, or when it was capped."
    )
    capped: bool = Field(
        description="True when Google returned its row limit of 25,000, so `value` is a lower "
        "bound."
    )


class PageCannibalization(BaseModel):
    keywords: int = Field(
        description="Tracked keywords on which the page competes with another page of the site."
    )
    likely: int = Field(description="Of those, the keywords with the verdict likely.")
    co_ranking: int = Field(description="Of those, the keywords with the verdict co-ranking.")
    unstable: int = Field(description="Of those, the keywords with the verdict unstable.")


class TrackedPageRow(BaseModel):
    url_id: UrlIdText
    url: str = Field(description="The canonical address of the page.")
    path: str = Field(description="The path of the page.")
    title: str | None = Field(
        description="The title of the page in the latest finished crawl; null when it has none."
    )
    tier_id: UUID | None = Field(description="The page's tier; null for Untiered.")
    added_at: datetime = Field(description="When the page began to be tracked.")
    history: Literal["ready", "loading"] = Field(
        description="`ready` once the page's daily history is stored; `loading` until then. A "
        "loading row has no `current`, `previous`, `health` or `trend`."
    )
    current: PageNumbers | None = Field(description="The numbers of the period.")
    previous: PageNumbers | None = Field(
        description="The numbers of the compared period. Null with `compare=none`, or when the "
        "compared period starts before the page's first stored day."
    )
    health: PageHealth | None = Field(description="The health verdict of the period.")
    queries: PageQueries | None = Field(
        description="The number of queries of the page in the period, from stored counts only. "
        "Null when the period has none stored, which is not 0."
    )
    # Filled by the list route from `CannibalizationService.page_conflicts` (spec D22).
    cannibalization: PageCannibalization | None = Field(
        default=None,
        description="The number of tracked keywords on which this page competes with another "
        "page of the site, split by verdict. Null for a page no conflict names.",
    )
    trend: list[int] | None = Field(
        description="The clicks of each day of the period, oldest first; 0 for a day without a row."
    )


class TrackedPagesMeta(SearchMeta):
    limit: int = Field(description="The most pages a project can track.")
    tracked: int = Field(description="The pages the project tracks now.")


class TrackedPagesResponse(BaseModel):
    data: list[TrackedPageRow]
    meta: TrackedPagesMeta


class TrackedIdsMeta(BaseModel):
    limit: int = Field(description="The most pages a project can track.")


class TrackedIdsResponse(BaseModel):
    data: list[UrlIdText] = Field(description="The url ids of the tracked pages.")
    meta: TrackedIdsMeta


class TrackPagesRequest(Body):
    urls: list[Annotated[str, StringConstraints(max_length=URL_MAX)]] = Field(
        default_factory=list,
        max_length=TRACK_INPUTS_MAX,
        description="Addresses, or paths read against the project's website. Never fetched.",
    )
    url_ids: list[UrlId] = Field(
        default_factory=list,
        max_length=TRACK_INPUTS_MAX,
        description="Ids of pages of the project, as strings.",
    )
    dry_run: bool = Field(
        default=False, description="Check every input and report `ok` for the ones that fit."
    )

    @model_validator(mode="after")
    def _something_to_track(self) -> TrackPagesRequest:
        if not self.urls and not self.url_ids:
            raise ValueError("give `urls`, `url_ids` or both")
        return self


class TrackOutcome(BaseModel):
    input: str = Field(description="The address, path or id as it was sent.")
    outcome: TrackOutcomeCode = Field(
        description="`added` (`ok` with `dry_run`), `already_tracked`, `invalid_url`, "
        "`wrong_host`, `not_crawled` (not a page of the project), `over_limit` (the limit is "
        "full; inputs are taken in order)."
    )
    url_id: UrlIdText | None = Field(description="The page; null when the input named none.")
    path: str | None = Field(description="The path of the page; null when the input named none.")
    clicks_28d: int | None = Field(
        description="Clicks in the 28 final days that end on the last final day, from stored "
        "rows; null when none are stored."
    )


class TrackPagesMeta(BaseModel):
    limit: int = Field(description="The most pages a project can track.")
    tracked: int = Field(description="The pages the project tracks after this request.")
    added: int = Field(description="The pages this request began to track; 0 with `dry_run`.")


class TrackPagesResponse(BaseModel):
    data: list[TrackOutcome]
    meta: TrackPagesMeta


class UntrackRequest(Body):
    url_ids: list[UrlId] = Field(
        min_length=1,
        max_length=UNTRACK_MAX,
        description="Ids of the pages to stop tracking, as strings.",
    )


class UntrackResult(BaseModel):
    removed: int = Field(description="The pages that were tracked and are not now.")


class UntrackResponse(BaseModel):
    data: UntrackResult


class SuggestionRow(BaseModel):
    url_id: UrlIdText
    url: str = Field(description="The canonical address of the page.")
    path: str = Field(description="The path of the page.")
    title: str | None = Field(description="The title in the latest finished crawl.")
    clicks_28d: int = Field(description="Clicks in the last 28 final days.")
    impressions_28d: int = Field(description="Impressions in the last 28 final days.")


class SuggestionsMeta(BaseModel):
    state: SearchState = Field(description="The Search Console state of the project.")


class SuggestionsResponse(BaseModel):
    data: list[SuggestionRow]
    meta: SuggestionsMeta


Day = date  # a field named `date` would hide the type in its own class body


class SeriesPoint(BaseModel):
    date: Day = Field(description="The day, Pacific Time.")
    clicks: int = Field(description="Clicks that day; 0 for a day without a stored row.")
    impressions: int = Field(description="Impressions that day; 0 for a day without a stored row.")
    position: float | None = Field(
        description="Average position that day; null for a day without a stored row or position."
    )


class PageSearchData(BaseModel):
    url_id: UrlIdText
    url: str = Field(description="The canonical address of the page.")
    path: str = Field(description="The path of the page.")
    title: str | None = Field(
        description="The title of the page in the latest finished crawl; null when it has none."
    )
    tier_id: UUID | None = Field(description="The page's tier; null for Untiered.")
    tracked: bool = Field(description="Whether the project tracks the page.")
    current: PageNumbers | None = Field(
        description="The numbers of the period. Null until the page's history is stored."
    )
    previous: PageNumbers | None = Field(
        description="The numbers of the compared period. Null with `compare=none`, before the "
        "history is stored, or when the compared period starts before the page's first stored day."
    )
    health: PageHealth | None = Field(
        description="The health verdict of the period. Null until the page's history is stored."
    )
    series: list[SeriesPoint] = Field(
        description="One point for every day of the period; empty until the history is stored."
    )
    previous_series: list[SeriesPoint] = Field(
        description="One point for every day of the compared period, on its own dates; empty "
        "when `previous` is null."
    )


class PageSearchMeta(SearchMeta):
    history_from: date | None = Field(
        description="The first day the page's history covers; null before it was fetched."
    )
    retry_after: int | None = Field(
        description="Seconds to wait before asking again, when the history could not be "
        "fetched because this installation's budget is spent. Null otherwise."
    )


class PageSearchResponse(BaseModel):
    data: PageSearchData
    meta: PageSearchMeta


class BreakdownRow(BaseModel):
    key: str = Field(
        description="The query text, the three-letter country code or the device in capitals."
    )
    current: PageNumbers | None = Field(
        description="The numbers of the period; null for a key outside its stored rows."
    )
    previous: PageNumbers | None = Field(
        description="The numbers of the compared period; null for a key outside its stored rows."
    )


class PageBreakdownMeta(SearchMeta):
    dimension: Literal["query", "country", "device"] = Field(description="What the rows are by.")
    row_limit: int = Field(description="The most rows kept for a period: 100 queries.")
    truncated: bool = Field(
        description="More rows came back from Google than were kept. False before a fetch."
    )
    coverage: float | None = Field(
        description="The stored rows' clicks over the page's clicks in the period, at most 1; "
        "the rest are rows Google does not report or past the limit. Null when the page had "
        "no clicks or nothing was fetched."
    )
    fetched_at: datetime | None = Field(
        description="When the period's rows were fetched; null before a fetch."
    )


class PageBreakdownResponse(BaseModel):
    data: list[BreakdownRow] = Field(
        description="The union of both periods' keys, most clicks first."
    )
    meta: PageBreakdownMeta
