"""What changed between two runs, from stored facts only (no database, no provider call).

Per prompt and platform, an entity is present in a run when at least one valid answer mentions
it. A prompt and platform need a valid answer on both sides, read under the same entity
configuration, or nothing is said: unknown is never zero.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final, Literal

type MentionKind = Literal["ai_mention_gained", "ai_mention_lost", "ai_competitor_appeared"]

MENTION_KINDS: Final[tuple[MentionKind, ...]] = (
    "ai_mention_gained",
    "ai_mention_lost",
    "ai_competitor_appeared",
)


@dataclass(frozen=True, slots=True)
class AnswerFact:
    """One answer of a run, as stored in `ai.observation_facts`."""

    prompt_id: uuid.UUID
    engine_code: str
    is_valid: bool
    own_mentioned: bool
    competitor_mentions: frozenset[uuid.UUID]
    # `ai.derivations.entity_config_version` the facts were read under: after a competitor or
    # alias is added, answers are read against other entities and cannot be compared with older.
    config_version: int = 0


@dataclass(frozen=True, slots=True)
class MentionCount:
    """Answers that mention the entity, out of the valid answers of the run."""

    mentioning: int
    valid: int


@dataclass(frozen=True, slots=True)
class MentionChange:
    kind: MentionKind
    prompt_id: uuid.UUID
    engine_code: str
    # The competitor of `ai_competitor_appeared`; None for the own brand.
    entity_id: uuid.UUID | None
    before: MentionCount
    after: MentionCount


@dataclass(frozen=True, slots=True)
class RankEvent:
    """A `rank_drop` or `rank_gain` row of `seo.rank_events`."""

    id: int
    tracked_keyword_id: uuid.UUID
    occurred_at: datetime
    from_rank: int | None
    to_rank: int | None


@dataclass(frozen=True, slots=True)
class RankDrop:
    event: RankEvent
    positions_lost: int


def _valid_by_pair(facts: Sequence[AnswerFact]) -> dict[tuple[uuid.UUID, str], list[AnswerFact]]:
    grouped: dict[tuple[uuid.UUID, str], list[AnswerFact]] = defaultdict(list)
    for answer in facts:
        if answer.is_valid:
            grouped[(answer.prompt_id, answer.engine_code)].append(answer)
    return grouped


def _own(answers: Sequence[AnswerFact]) -> MentionCount:
    return MentionCount(sum(a.own_mentioned for a in answers), len(answers))


def _rival(answers: Sequence[AnswerFact], rival: uuid.UUID) -> MentionCount:
    return MentionCount(sum(rival in a.competitor_mentions for a in answers), len(answers))


def mention_changes(
    previous: Sequence[AnswerFact], current: Sequence[AnswerFact]
) -> list[MentionChange]:
    """Brand gained, brand lost and competitor appeared, in prompt, platform, kind order."""
    before_by_pair = _valid_by_pair(previous)
    after_by_pair = _valid_by_pair(current)
    changes: list[MentionChange] = []
    for pair in sorted(
        before_by_pair.keys() & after_by_pair.keys(), key=lambda p: (str(p[0]), p[1])
    ):
        before, after = before_by_pair[pair], after_by_pair[pair]
        versions = {a.config_version for a in before} | {a.config_version for a in after}
        if len(versions) != 1:
            continue
        prompt_id, engine_code = pair
        was, now = _own(before), _own(after)
        if now.mentioning and not was.mentioning:
            changes.append(
                MentionChange("ai_mention_gained", prompt_id, engine_code, None, was, now)
            )
        elif was.mentioning and not now.mentioning:
            changes.append(MentionChange("ai_mention_lost", prompt_id, engine_code, None, was, now))
        seen_before = set().union(*(a.competitor_mentions for a in before))
        seen_now = set().union(*(a.competitor_mentions for a in after))
        for rival in sorted(seen_now - seen_before, key=str):
            changes.append(
                MentionChange(
                    "ai_competitor_appeared",
                    prompt_id,
                    engine_code,
                    rival,
                    _rival(before, rival),
                    _rival(after, rival),
                )
            )
    return changes


def rank_drops(events: Sequence[RankEvent], positions: int) -> list[RankDrop]:
    """The events whose rank fell by at least `positions` in one check. A larger rank number is
    a worse place; an event without both ranks (new or lost ranking) is not a drop."""
    drops: list[RankDrop] = []
    for event in events:
        if event.from_rank is None or event.to_rank is None:
            continue
        lost = event.to_rank - event.from_rank
        if lost >= positions:
            drops.append(RankDrop(event, lost))
    return drops
