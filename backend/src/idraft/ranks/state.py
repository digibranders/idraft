"""A keyword's state and how a check moves it (docs/09 sections 3 and 4).

`apply_check` is the whole transition: the previous check is the last successful one, held in the
state; the rank change is computed within the smaller depth of the two checks and is numeric only
when both ranks lie within it; a check older than the state's last one moves nothing.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
from typing import Final, Literal

from idraft.ranks.resolve import AioState

ChangeKind = Literal[
    "first_check", "numeric", "new", "lost", "unchanged_beyond", "consistent_beyond"
]

# The debounce counter is a smallint; a keyword out of range for years stops counting here.
MAX_CONSECUTIVE_BEYOND: Final = 1000


@dataclass(frozen=True, slots=True)
class Check:
    """The own side of one successful check, after resolution and with the URL stored."""

    snapshot_id: int
    observed_at: datetime
    depth_requested: int
    rank: int | None  # the best organic rank of the own entities; None beyond the depth
    absolute_rank: int | None
    url_id: int | None  # the ranking URL, set exactly when `rank` is
    feature_types: tuple[str, ...]
    owned_feature_types: tuple[str, ...]
    aio_state: AioState
    cited_in_ai_overview: bool | None
    aio_citation_position: int | None
    target_url_match: bool | None

    def __post_init__(self) -> None:
        if self.depth_requested < 1:
            raise ValueError(f"depth_requested must be at least 1, got {self.depth_requested}")
        if self.rank is not None and not 1 <= self.rank <= self.depth_requested:
            raise ValueError(f"rank {self.rank} is outside the depth {self.depth_requested}")
        if (self.rank is None) != (self.url_id is None):
            raise ValueError("a ranking URL is set exactly when the check ranks")
        if self.observed_at.tzinfo is None:
            raise ValueError("observed_at must be timezone-aware")

    @property
    def has_ai_overview(self) -> bool | None:
        if self.aio_state == "unknown":
            return None
        return self.aio_state != "absent"


@dataclass(frozen=True, slots=True)
class KeywordState:
    """`seo.tracked_keyword_state` without its identifiers."""

    last_snapshot_id: int | None = None
    last_observed_at: datetime | None = None
    current_rank: int | None = None
    current_absolute_rank: int | None = None
    current_url_id: int | None = None
    current_depth_requested: int | None = None
    previous_rank: int | None = None
    previous_observed_at: datetime | None = None
    previous_depth_requested: int | None = None
    rank_change: int | None = None
    best_rank: int | None = None
    best_rank_at: datetime | None = None
    worst_rank: int | None = None
    first_ranked_at: datetime | None = None
    feature_types_present: tuple[str, ...] = ()
    owned_feature_types: tuple[str, ...] = ()
    has_ai_overview: bool | None = None
    cited_in_ai_overview: bool | None = None
    aio_state: AioState | None = None
    aio_citation_position: int | None = None
    target_url_match: bool | None = None
    url_changed_at: datetime | None = None
    consecutive_failures: int = 0
    # Checks in a row that did not rank although they looked deep enough to have found the
    # keyword where it last was: the debounce of `new_ranking` and `lost_ranking`.
    consecutive_beyond: int = 0
    # The rank of the last check that ranked, at any depth: how deep a check must look to say
    # the keyword is gone.
    last_ranked_rank: int | None = None
    is_stale: bool = False


@dataclass(frozen=True, slots=True)
class RankChange:
    """How a check compares with the one before it, within `depth` (the smaller of the two)."""

    kind: ChangeKind
    delta: int | None  # previous rank minus current rank; positive = improved; numeric only
    depth: int | None  # the depth of the comparison; None for a first check


@dataclass(frozen=True, slots=True)
class Transition:
    state: KeywordState
    change: RankChange | None  # None when the check was not applied
    applied: bool


def classify_change(
    *,
    previous_rank: int | None,
    previous_depth: int | None,
    rank: int | None,
    depth: int,
    first: bool,
) -> RankChange:
    """The rank change of a check against the one before it (docs/09 section 4).

    Both checks are read within the smaller depth: a rank deeper than that is beyond it. Beyond
    is never imputed: the change is numeric only when both are ranked."""
    if first or previous_depth is None:
        return RankChange("first_check", None, None)
    compared = min(previous_depth, depth)
    before = previous_rank if previous_rank is not None and previous_rank <= compared else None
    now = rank if rank is not None and rank <= compared else None
    if before is not None and now is not None:
        return RankChange("numeric", before - now, compared)
    if before is None and now is not None:
        return RankChange("new", None, compared)
    if before is not None and now is None:
        return RankChange("lost", None, compared)
    # Both beyond the compared depth. When one of them was ranked deeper (a weekly deep check
    # against a daily one) nothing is inferred; otherwise neither ever showed.
    if previous_rank is not None or rank is not None:
        return RankChange("consistent_beyond", None, compared)
    return RankChange("unchanged_beyond", None, compared)


def apply_check(state: KeywordState | None, check: Check) -> Transition:
    """The state after a successful check.

    A check not newer than the state's last one is out of order and moves nothing: the state is
    the latest check's view, and an older payload processed late must not rewind it."""
    before = state or KeywordState()
    if before.last_observed_at is not None and check.observed_at <= before.last_observed_at:
        return Transition(before, None, applied=False)

    first = before.last_observed_at is None
    change = classify_change(
        previous_rank=before.current_rank,
        previous_depth=before.current_depth_requested,
        rank=check.rank,
        depth=check.depth_requested,
        first=first,
    )
    ranked = check.rank is not None
    url_changed = (
        before.current_url_id is not None
        and check.url_id is not None
        and before.current_url_id != check.url_id
    )
    after = replace(
        before,
        last_snapshot_id=check.snapshot_id,
        last_observed_at=check.observed_at,
        current_rank=check.rank,
        current_absolute_rank=check.absolute_rank,
        current_url_id=check.url_id,
        current_depth_requested=check.depth_requested,
        previous_rank=None if first else before.current_rank,
        previous_observed_at=before.last_observed_at,
        previous_depth_requested=before.current_depth_requested,
        rank_change=change.delta,
        best_rank=_best(before, check),
        best_rank_at=_best_at(before, check),
        worst_rank=check.rank
        if check.rank is not None and (before.worst_rank is None or check.rank > before.worst_rank)
        else before.worst_rank,
        first_ranked_at=before.first_ranked_at or (check.observed_at if ranked else None),
        feature_types_present=check.feature_types,
        owned_feature_types=check.owned_feature_types,
        has_ai_overview=check.has_ai_overview,
        cited_in_ai_overview=check.cited_in_ai_overview,
        aio_state=check.aio_state,
        aio_citation_position=check.aio_citation_position,
        target_url_match=check.target_url_match,
        url_changed_at=check.observed_at if url_changed else before.url_changed_at,
        consecutive_failures=0,
        consecutive_beyond=_consecutive_beyond(before, check, change),
        last_ranked_rank=check.rank if ranked else before.last_ranked_rank,
        is_stale=False,
    )
    return Transition(after, change, applied=True)


def _best(before: KeywordState, check: Check) -> int | None:
    if check.rank is None:
        return before.best_rank
    return check.rank if before.best_rank is None else min(before.best_rank, check.rank)


def _best_at(before: KeywordState, check: Check) -> datetime | None:
    if check.rank is not None and (before.best_rank is None or check.rank < before.best_rank):
        return check.observed_at
    return before.best_rank_at


def _consecutive_beyond(before: KeywordState, check: Check, change: RankChange) -> int:
    """The run of checks that did not rank.

    A check that ranks ends the run, unless it ranks deeper than the depth the earlier checks
    looked at (`consistent_beyond`), which says nothing about them. A check that does not rank
    extends the run only when it looked as deep as the keyword last ranked: a daily check at
    depth 20 cannot say a keyword seen at 45 last week is gone."""
    if check.rank is not None:
        return before.consecutive_beyond if change.kind == "consistent_beyond" else 0
    looked_deep_enough = (
        before.last_ranked_rank is None or before.last_ranked_rank <= check.depth_requested
    )
    if not looked_deep_enough:
        return before.consecutive_beyond
    return min(before.consecutive_beyond + 1, MAX_CONSECUTIVE_BEYOND)
