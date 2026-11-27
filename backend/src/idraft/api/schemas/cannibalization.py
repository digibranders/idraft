"""Cannibalization and Switching: own pages competing for tracked keywords (docs/33)."""

from __future__ import annotations

from datetime import date
from typing import Final, Literal

from pydantic import BaseModel, Field

from idraft.ranks.cannibalization import MIN_CHECKS

METHOD_VERSION: Final = 2

DeviceName = Literal["desktop", "mobile"]
PeriodDays = Literal[14, 30, 90]
VerdictName = Literal["likely", "co_ranking", "unstable", "none", "unranked", "insufficient"]
# `conflicts` is likely, co-ranking and unstable together; `all` is every tracked keyword.
VerdictFilter = Literal[
    "conflicts", "all", "likely", "co_ranking", "unstable", "none", "unranked", "insufficient"
]
SwitchKind = Literal["all", "flip_flop", "improved", "dropped", "left_target"]
StripKindName = Literal["page", "none", "unreadable"]


class Meta(BaseModel):
    days: PeriodDays
    device: DeviceName
    method_version: int = METHOD_VERSION
    min_checks: int = MIN_CHECKS
    date_from: date
    date_to: date
    has_previous: bool = Field(
        description="True when at least one keyword has enough checks in the period before."
    )
    total: int = Field(description="Rows matching the filters, before `limit`.")


class PageFigures(BaseModel):
    url_id: str
    url: str
    path: str
    title: str | None
    letter: str = Field(description="A is the page to compare with; B to F follow; + for more.")
    is_primary: bool
    is_target: bool
    is_sub_result: bool = Field(description="Was nested under another own result on some checks.")
    ranked: int
    share: float
    best_count: int
    median: float
    best_ever: int
    last_date: date
    last_rank: int


class StripCell(BaseModel):
    date: date
    kind: StripKindName
    url_id: str | None
    rank: int | None
    together: bool


class SwitchEvent(BaseModel):
    date: date
    from_url_id: str
    to_url_id: str
    rank_before: int
    rank_after: int
    held_days: int
    is_flip_flop: bool


class KeywordConflict(BaseModel):
    tracked_keyword_id: str
    keyword: str
    group_ids: list[str]
    device: DeviceName
    volume: int | None
    verdict: VerdictName
    previous_verdict: VerdictName | None
    checks: int
    unreadable_checks: int
    ranked_checks: int
    pages: list[PageFigures]
    rank_gap: float
    switch_rate: float
    together_rate: float
    switches: list[SwitchEvent]
    one_check_changes: int
    flip_flops: int
    longest_hold_days: int
    held_now_days: int
    current_url_id: str | None
    current_rank: int | None
    target_url_id: str | None
    on_target: bool | None = Field(
        description="Null when no target page is set or no page ranks now."
    )
    strip: list[StripCell]


class Count(BaseModel):
    value: int
    before: int | None


class ConflictHeadline(BaseModel):
    ranked_keywords: int
    conflicts: Count
    likely: Count
    together: Count
    unstable: Count
    volume_at_risk: int
    volume_keywords: int
    typical_rank_gap: float | None


class VerdictCounts(BaseModel):
    all: int
    conflicts: int
    likely: int
    co_ranking: int
    unstable: int
    none: int
    unranked: int
    insufficient: int


class ConflictList(BaseModel):
    meta: Meta
    headline: ConflictHeadline
    counts: VerdictCounts
    items: list[KeywordConflict]


class ConflictListResponse(BaseModel):
    data: ConflictList


class PairPage(BaseModel):
    url_id: str
    url: str
    path: str
    title: str | None


class PagePair(BaseModel):
    a: PairPage
    b: PairPage
    keywords: int
    likely: int
    volume: int
    a_leads: int
    b_leads: int
    title_overlap: float | None
    tracked_keyword_ids: list[str]


class PairList(BaseModel):
    meta: Meta
    items: list[PagePair]


class PairListResponse(BaseModel):
    data: PairList


class SwitchRow(BaseModel):
    tracked_keyword_id: str
    keyword: str
    volume: int | None
    event: SwitchEvent
    rank_change: int = Field(description="Places gained (positive) or lost (negative).")
    left_target: bool
    from_title: str | None
    to_title: str | None
    from_url: str
    to_url: str


class SwitchHeadline(BaseModel):
    ranked_keywords: int
    switches: Count
    keywords: int
    flip_flop_keywords: int
    left_target: int
    improved: int
    dropped: int
    one_check_changes: int


class WeekBucket(BaseModel):
    starts_on: date
    improved: int
    same: int
    dropped: int


class SwitchList(BaseModel):
    meta: Meta
    headline: SwitchHeadline
    weeks: list[WeekBucket]
    items: list[SwitchRow]


class SwitchListResponse(BaseModel):
    data: SwitchList


class CheckRank(BaseModel):
    url_id: str
    rank: int


class KeywordCheck(BaseModel):
    date: date
    readable: bool
    ranks: list[CheckRank]
    sub_results: list[str]


class UrlRef(BaseModel):
    url_id: str
    url: str
    path: str
    title: str | None


class KeywordDetail(BaseModel):
    meta: Meta
    keyword: KeywordConflict
    urls: list[UrlRef]
    checks: list[KeywordCheck]


class KeywordDetailResponse(BaseModel):
    data: KeywordDetail
