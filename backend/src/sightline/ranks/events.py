"""The rank events a check causes (docs/09 section 4.1).

Events compare the new check with the state before it, within the smaller depth of the two. They
describe the project's own side (the own side is one); the ingest writer attributes them to the
project's primary own entity, and writes none for a project without one. Thresholds belong to the
alert rules: `rank_gain` and `rank_drop` are written for every numeric change.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

from sightline.ranks.state import Check, KeywordState, Transition

TOP_BUCKETS: Final = (3, 10, 20, 100)
# A run of beyond-depth checks must be this long before a ranking is new or lost.
DEBOUNCE_CHECKS: Final = 2


@dataclass(frozen=True, slots=True)
class EventDraft:
    event_type: str
    from_rank: int | None = None
    to_rank: int | None = None
    from_url_id: int | None = None
    to_url_id: int | None = None
    other_entity_id: uuid.UUID | None = None
    feature_type: str | None = None  # set exactly for feature_gained and feature_lost


def own_events(
    before: KeywordState | None, check: Check, transition: Transition
) -> tuple[EventDraft, ...]:
    """The events of the own side for one applied check, in a fixed order. A first check, and a
    check that was not applied, cause none."""
    change = transition.change
    if not transition.applied or change is None or change.kind == "first_check":
        return ()
    previous = before or KeywordState()
    drafts: list[EventDraft] = []
    drafts.extend(_top_events(previous, check, change.depth))
    drafts.extend(_ranking_events(previous, check, transition))
    drafts.extend(_movement_events(previous, check, transition))
    drafts.extend(_feature_events(previous, check))
    drafts.extend(_aio_events(previous, check))
    return tuple(drafts)


def overtake_events(
    *,
    own_before: int | None,
    own_now: int | None,
    competitors_before: Mapping[uuid.UUID, int | None],
    competitors_now: Mapping[uuid.UUID, int | None],
    depth: int,
) -> tuple[EventDraft, ...]:
    """`overtaken_by` and `overtook` for the competitors that had a rank in the previous check.

    All four ranks are read within `depth`, the smaller depth of the two checks; a competitor
    without a previous rank row has nothing to be compared with."""
    own_prev = _within(own_before, depth)
    own_cur = _within(own_now, depth)
    if own_prev is None and own_cur is None:
        # A rival cannot pass or be passed by a site that ranks in neither check: it would
        # flap with every rival rank at the edge of the depth.
        return ()
    drafts: list[EventDraft] = []
    for competitor in sorted(competitors_before.keys() & competitors_now.keys()):
        rival_prev = _within(competitors_before[competitor], depth)
        rival_cur = _within(competitors_now[competitor], depth)
        if rival_prev is None and rival_cur is None:
            continue  # nothing to pass or be passed by
        if _ahead(rival_cur, own_cur) and not _ahead(rival_prev, own_prev):
            drafts.append(
                EventDraft("overtaken_by", own_before, own_now, other_entity_id=competitor)
            )
        elif _ahead(own_cur, rival_cur) and not _ahead(own_prev, rival_prev):
            drafts.append(EventDraft("overtook", own_before, own_now, other_entity_id=competitor))
    return tuple(drafts)


def _within(rank: int | None, depth: int) -> int | None:
    return rank if rank is not None and rank <= depth else None


def _ahead(rank: int | None, other: int | None) -> bool:
    """Whether `rank` is better than `other`; a rank beats none, and none beats nothing."""
    return rank is not None and (other is None or rank < other)


def _top_events(previous: KeywordState, check: Check, depth: int | None) -> list[EventDraft]:
    if depth is None:
        return []
    before = _within(previous.current_rank, depth)
    now = _within(check.rank, depth)
    drafts: list[EventDraft] = []
    for bucket in TOP_BUCKETS:
        if bucket > depth:
            continue  # a bucket the smaller depth does not cover is not compared
        was_in = before is not None and before <= bucket
        is_in = now is not None and now <= bucket
        if is_in and not was_in:
            drafts.append(EventDraft(f"entered_top_{bucket}", before, now))
        elif was_in and not is_in:
            drafts.append(EventDraft(f"lost_top_{bucket}", before, now))
    return drafts


def _ranking_events(
    previous: KeywordState, check: Check, transition: Transition
) -> list[EventDraft]:
    change = transition.change
    assert change is not None
    run = transition.state.consecutive_beyond
    if check.rank is not None:
        # New after a run of beyond-depth checks, and only when this check's comparison says so:
        # a weekly deep check that finds a keyword the daily depth cannot see is not new.
        if change.kind == "new" and previous.consecutive_beyond >= DEBOUNCE_CHECKS:
            return [EventDraft("new_ranking", None, check.rank)]
        return []
    # Written once, by the check that makes the run exactly long enough, for a keyword that has
    # ranked before; the run only grows on checks that looked deep enough to see it.
    if (
        run != DEBOUNCE_CHECKS
        or previous.consecutive_beyond != DEBOUNCE_CHECKS - 1
        or previous.last_ranked_rank is None
    ):
        return []
    return [EventDraft("lost_ranking", previous.last_ranked_rank, None)]


def _movement_events(
    previous: KeywordState, check: Check, transition: Transition
) -> list[EventDraft]:
    change = transition.change
    assert change is not None
    drafts: list[EventDraft] = []
    if change.kind == "numeric" and change.delta:
        event_type = "rank_gain" if change.delta > 0 else "rank_drop"
        drafts.append(
            EventDraft(
                event_type,
                previous.current_rank,
                check.rank,
                previous.current_url_id,
                check.url_id,
            )
        )
    if transition.state.url_changed_at == check.observed_at:
        drafts.append(
            EventDraft(
                "url_changed",
                previous.current_rank,
                check.rank,
                previous.current_url_id,
                check.url_id,
            )
        )
    return drafts


def _feature_events(previous: KeywordState, check: Check) -> list[EventDraft]:
    gained = sorted(set(check.owned_feature_types) - set(previous.owned_feature_types))
    lost = sorted(set(previous.owned_feature_types) - set(check.owned_feature_types))
    return [EventDraft("feature_gained", feature_type=name) for name in gained] + [
        EventDraft("feature_lost", feature_type=name) for name in lost
    ]


def _aio_events(previous: KeywordState, check: Check) -> list[EventDraft]:
    drafts: list[EventDraft] = []
    was, now = previous.has_ai_overview, check.has_ai_overview
    if was is not None and now is not None and was != now:
        drafts.append(EventDraft("aio_appeared" if now else "aio_disappeared"))
    # A citation is compared only where the block was there and loaded in both checks.
    cited_was, cited_now = previous.cited_in_ai_overview, check.cited_in_ai_overview
    if cited_was is not None and cited_now is not None and cited_was != cited_now:
        drafts.append(EventDraft("aio_citation_gained" if cited_now else "aio_citation_lost"))
    return drafts
