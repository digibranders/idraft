"""Detection of alerts from stored facts, with no database (alerts plan, rule types)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from idraft.alerts.detect import (
    AnswerFact,
    MentionChange,
    MentionCount,
    RankEvent,
    mention_changes,
    rank_drops,
)

PROMPT = uuid.UUID(int=1)
OTHER_PROMPT = uuid.UUID(int=2)
RIVAL = uuid.UUID(int=10)
RIVAL_TWO = uuid.UUID(int=11)


def fact(
    *,
    mentioned: bool = False,
    valid: bool = True,
    rivals: frozenset[uuid.UUID] = frozenset(),
    prompt: uuid.UUID = PROMPT,
    engine: str = "chatgpt_web",
    version: int = 1,
) -> AnswerFact:
    return AnswerFact(prompt, engine, valid, mentioned, rivals, version)


def test_a_pair_derived_under_another_entity_configuration_is_not_compared() -> None:
    # A competitor was added between the runs: the new answers were read against more entities.
    before = [fact(version=1), fact(version=1, engine="gemini_web", mentioned=True)]
    after = [
        fact(version=2, rivals=frozenset({RIVAL})),
        fact(version=1, engine="gemini_web"),
    ]

    found = mention_changes(before, after)

    assert [(c.engine_code, c.kind) for c in found] == [("gemini_web", "ai_mention_lost")]


def test_a_pair_with_answers_of_two_configurations_in_one_run_is_not_compared() -> None:
    before = [fact(version=1, mentioned=True)]
    after = [fact(version=1), fact(version=2)]

    assert mention_changes(before, after) == []


def kinds(changes: list[MentionChange]) -> list[str]:
    return [change.kind for change in changes]


def test_a_brand_that_was_mentioned_and_no_longer_is_lost_with_the_counts_of_both_runs() -> None:
    before = [fact(mentioned=True), fact(mentioned=True), fact()]
    after = [fact(), fact(), fact()]

    [change] = mention_changes(before, after)

    assert change.kind == "ai_mention_lost"
    assert (change.prompt_id, change.engine_code, change.entity_id) == (PROMPT, "chatgpt_web", None)
    assert change.before == MentionCount(mentioning=2, valid=3)
    assert change.after == MentionCount(mentioning=0, valid=3)


def test_one_mentioning_answer_is_enough_for_the_brand_to_count_as_present() -> None:
    before = [fact(), fact()]
    after = [fact(), fact(mentioned=True)]

    assert kinds(mention_changes(before, after)) == ["ai_mention_gained"]


def test_no_change_in_presence_raises_nothing_even_when_the_counts_move() -> None:
    before = [fact(mentioned=True), fact()]
    after = [fact(mentioned=True), fact(mentioned=True)]

    assert mention_changes(before, after) == []


def test_unknown_is_never_zero_an_unusable_run_raises_nothing() -> None:
    mentioned = [fact(mentioned=True)]
    failed = [fact(valid=False), fact(valid=False, mentioned=True)]

    assert mention_changes(mentioned, failed) == []
    assert mention_changes(failed, mentioned) == []
    assert mention_changes(mentioned, []) == []


def test_an_invalid_answer_does_not_count_as_a_mention() -> None:
    before = [fact(valid=False, mentioned=True), fact()]
    after = [fact(mentioned=True)]

    assert kinds(mention_changes(before, after)) == ["ai_mention_gained"]


def test_each_prompt_and_platform_is_compared_alone() -> None:
    before = [
        fact(mentioned=True),
        fact(mentioned=True, engine="gemini"),
        fact(mentioned=True, prompt=OTHER_PROMPT),
    ]
    after = [
        fact(),
        fact(mentioned=True, engine="gemini"),
        fact(mentioned=True, prompt=OTHER_PROMPT),
    ]

    [change] = mention_changes(before, after)

    assert (change.prompt_id, change.engine_code) == (PROMPT, "chatgpt_web")


def test_a_competitor_that_was_absent_and_is_mentioned_now_appears_once_each() -> None:
    before = [fact(rivals=frozenset({RIVAL})), fact()]
    after = [fact(rivals=frozenset({RIVAL, RIVAL_TWO})), fact(rivals=frozenset({RIVAL_TWO}))]

    [change] = mention_changes(before, after)

    assert change.kind == "ai_competitor_appeared"
    assert change.entity_id == RIVAL_TWO
    assert change.before == MentionCount(mentioning=0, valid=2)
    assert change.after == MentionCount(mentioning=2, valid=2)


def test_a_competitor_that_stops_being_mentioned_raises_nothing() -> None:
    assert mention_changes([fact(rivals=frozenset({RIVAL}))], [fact()]) == []


def test_the_changes_come_in_a_fixed_order() -> None:
    before = [fact(), fact(engine="gemini")]
    after = [fact(rivals=frozenset({RIVAL_TWO, RIVAL})), fact(engine="gemini", mentioned=True)]

    found = mention_changes(before, after)

    assert [(c.engine_code, c.kind, c.entity_id) for c in found] == [
        ("chatgpt_web", "ai_competitor_appeared", RIVAL),
        ("chatgpt_web", "ai_competitor_appeared", RIVAL_TWO),
        ("gemini", "ai_mention_gained", None),
    ]


def _event(event_id: int, from_rank: int | None, to_rank: int | None) -> RankEvent:
    return RankEvent(
        id=event_id,
        tracked_keyword_id=uuid.UUID(int=event_id),
        occurred_at=datetime(2026, 11, 24, tzinfo=UTC),
        from_rank=from_rank,
        to_rank=to_rank,
    )


def test_a_fall_of_at_least_the_set_positions_is_a_drop_and_a_smaller_one_is_not() -> None:
    events = [_event(1, 4, 11), _event(2, 9, 13), _event(3, 3, 8)]

    found = rank_drops(events, positions=5)

    assert [(drop.event.id, drop.positions_lost) for drop in found] == [(1, 7), (3, 5)]


def test_a_rise_and_a_rank_that_is_missing_are_never_a_drop() -> None:
    events = [_event(1, 11, 4), _event(2, None, 9), _event(3, 9, None)]

    assert rank_drops(events, positions=1) == []
