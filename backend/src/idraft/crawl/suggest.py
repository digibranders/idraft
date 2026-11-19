"""Suggested tiers from Search Console clicks and tracked keyword ranks (spec 7.10). Pure; the
mock's `tierSuggestions` is the reference. Nothing here writes: a person accepts a suggestion
and the usual manual tier change applies it (decision D13)."""

from __future__ import annotations

import math
from collections.abc import Sequence
from collections.abc import Set as AbstractSet
from dataclasses import dataclass
from typing import Final, Literal

BUSIEST_SHARE: Final = 0.2
RANK_MAX: Final = 5
VOLUME_MIN: Final = 2_000
THIRD_TIER_CLICKS: Final = 50


@dataclass(frozen=True, slots=True)
class KeywordHit:
    keyword: str
    rank: int | None
    volume: int | None


@dataclass(frozen=True, slots=True)
class SuggestPage:
    """A live, indexable page of the crawl. `tier_position` is None when Untiered; `manual`
    is true when a person chose the tier (or Untiered)."""

    url_id: int
    tier_position: int | None
    manual: bool
    clicks: int
    hits: Sequence[KeywordHit]


@dataclass(frozen=True, slots=True)
class Reason:
    kind: Literal["clicks", "rank"]
    clicks: int | None = None
    rank: int | None = None
    keyword: str | None = None
    volume: int | None = None


@dataclass(frozen=True, slots=True)
class TierSuggestion:
    url_id: int
    to_position: int
    reasons: list[Reason]


def suggest_tiers(
    pages: Sequence[SuggestPage], *, tiers: int, dismissed: AbstractSet[int]
) -> list[TierSuggestion]:
    """Pages in the top fifth by clicks, or ranking 1 to 5 for a keyword with 2,000 or more
    searches, that are T3 or lower, get T2; Untiered pages with 50 or more clicks get T3. A
    workspace with fewer than two tiers has no T2 to suggest."""
    if tiers < 2:
        return []
    busiest_count = math.ceil(len(pages) * BUSIEST_SHARE)
    ranked = sorted(pages, key=lambda item: item.clicks, reverse=True)[:busiest_count]
    busiest = {item.url_id for item in ranked if item.clicks > 0}
    found: list[TierSuggestion] = []
    for item in pages:
        if item.manual or item.url_id in dismissed:
            continue
        position = item.tier_position or math.inf
        reasons: list[Reason] = []
        if position >= 3 and item.url_id in busiest:
            reasons.append(Reason("clicks", clicks=item.clicks))
        best = sorted(
            (
                hit
                for hit in item.hits
                if hit.rank is not None and hit.rank <= RANK_MAX and (hit.volume or 0) >= VOLUME_MIN
            ),
            key=lambda hit: hit.rank or 0,
        )
        if position >= 3 and best:
            reasons.append(
                Reason("rank", rank=best[0].rank, keyword=best[0].keyword, volume=best[0].volume)
            )
        if reasons:
            found.append(TierSuggestion(item.url_id, 2, reasons))
        elif tiers >= 3 and item.tier_position is None and item.clicks >= THIRD_TIER_CLICKS:
            found.append(TierSuggestion(item.url_id, 3, [Reason("clicks", clicks=item.clicks)]))
    return found
