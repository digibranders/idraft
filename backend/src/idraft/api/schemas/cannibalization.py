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


class CannMeta(BaseModel):
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


class CannPage(BaseModel):
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


class CannStripCell(BaseModel):
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


class CannKeyword(BaseModel):
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
    pages: list[CannPage]
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
    strip: list[CannStripCell]


class CannCount(BaseModel):
    value: int
    before: int | None


class ConflictHeadline(BaseModel):
    ranked_keywords: int
    conflicts: CannCount
    likely: CannCount
    together: CannCount
    unstable: CannCount
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
    meta: CannMeta
    headline: ConflictHeadline
    counts: VerdictCounts
    items: list[CannKeyword]


class ConflictListResponse(BaseModel):
    data: ConflictList


class CannPairPage(BaseModel):
    url_id: str
    url: str
    path: str
    title: str | None


class CannPair(BaseModel):
    a: CannPairPage
    b: CannPairPage
    keywords: int
    likely: int
    volume: int
    a_leads: int
    b_leads: int
    title_overlap: float | None
    tracked_keyword_ids: list[str]


class PairList(BaseModel):
    meta: CannMeta
    items: list[CannPair]


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
    switches: CannCount
    keywords: int
    flip_flop_keywords: int
    left_target: int
    improved: int
    dropped: int
    one_check_changes: int


class CannWeek(BaseModel):
    starts_on: date
    improved: int
    same: int
    dropped: int


class SwitchList(BaseModel):
    meta: CannMeta
    headline: SwitchHeadline
    weeks: list[CannWeek]
    items: list[SwitchRow]


class SwitchListResponse(BaseModel):
    data: SwitchList


class CannCheckRank(BaseModel):
    url_id: str
    rank: int


class CannCheck(BaseModel):
    date: date
    readable: bool
    ranks: list[CannCheckRank]
    sub_results: list[str]


class CannUrl(BaseModel):
    url_id: str
    url: str
    path: str
    title: str | None


class CannKeywordDetail(BaseModel):
    meta: CannMeta
    keyword: CannKeyword
    urls: list[CannUrl]
    checks: list[CannCheck]


class CannKeywordDetailResponse(BaseModel):
    data: CannKeywordDetail
