"""A keyword's state and the rank change (docs/09 sections 3 and 4)."""

from __future__ import annotations

from datetime import timedelta

import pytest

from idraft.ranks.state import (
    MAX_CONSECUTIVE_BEYOND,
    Check,
    KeywordState,
    apply_check,
    classify_change,
)
from tests.ranks.support import START, check


def run(*checks: Check) -> KeywordState:
    state: KeywordState | None = None
    for item in checks:
        state = apply_check(state, item).state
    assert state is not None
    return state


# The categorical change table.


@pytest.mark.parametrize(
    ("previous", "prev_depth", "current", "depth", "kind", "delta", "compared"),
    [
        (7, 20, 4, 20, "numeric", 3, 20),  # improved by three
        (4, 20, 9, 20, "numeric", -5, 20),
        (5, 20, 5, 20, "numeric", 0, 20),
        (None, 20, 12, 20, "new", None, 20),
        (12, 20, None, 20, "lost", None, 20),
        (None, 20, None, 20, "unchanged_beyond", None, 20),
        (45, 100, None, 20, "consistent_beyond", None, 20),  # a deep check, then a daily one
        (None, 20, 45, 100, "consistent_beyond", None, 20),  # a daily check, then a deep one
        (45, 100, 50, 100, "numeric", -5, 100),
        (45, 100, 15, 20, "new", None, 20),  # the daily depth sees what the deep check ranked low
        (15, 20, 45, 100, "lost", None, 20),
    ],
)
def test_the_change_is_read_within_the_smaller_depth(
    previous: int | None,
    prev_depth: int,
    current: int | None,
    depth: int,
    kind: str,
    delta: int | None,
    compared: int,
) -> None:
    change = classify_change(
        previous_rank=previous, previous_depth=prev_depth, rank=current, depth=depth, first=False
    )

    assert (change.kind, change.delta, change.depth) == (kind, delta, compared)


def test_a_first_check_has_no_change() -> None:
    change = classify_change(previous_rank=None, previous_depth=None, rank=3, depth=20, first=True)

    assert (change.kind, change.delta, change.depth) == ("first_check", None, None)


# The transition.


def test_the_first_check_sets_the_state() -> None:
    state = apply_check(None, check(rank=4, depth=20, url_id=7)).state

    assert (state.current_rank, state.current_url_id, state.current_depth_requested) == (4, 7, 20)
    assert (state.best_rank, state.worst_rank, state.first_ranked_at) == (4, 4, START)
    assert (state.previous_rank, state.previous_observed_at, state.rank_change) == (
        None,
        None,
        None,
    )
    assert state.last_snapshot_id == 1


def test_the_previous_check_is_the_last_successful_one() -> None:
    state = run(check(day=0, rank=7), check(day=1, rank=4), check(day=3, rank=6))

    assert (state.current_rank, state.previous_rank, state.rank_change) == (6, 4, -2)
    assert state.previous_observed_at == START + timedelta(days=1)
    assert state.previous_depth_requested == 20
    assert (state.best_rank, state.best_rank_at, state.worst_rank) == (
        4,
        START + timedelta(days=1),
        7,
    )


def test_the_best_rank_keeps_the_first_date_it_was_reached() -> None:
    state = run(check(day=0, rank=3), check(day=1, rank=5), check(day=2, rank=3))

    assert (state.best_rank, state.best_rank_at) == (3, START)


def test_a_check_not_newer_than_the_last_moves_nothing() -> None:
    state = run(check(day=2, rank=5, snapshot_id=2))

    for late in (check(day=1, rank=1, snapshot_id=1), check(day=2, rank=1, snapshot_id=3)):
        outcome = apply_check(state, late)

        assert outcome.applied is False
        assert outcome.change is None
        assert outcome.state is state


def test_a_state_with_only_failures_takes_its_first_check_as_a_first_check() -> None:
    failing = KeywordState(consecutive_failures=3, is_stale=True)

    outcome = apply_check(failing, check(rank=9))

    assert outcome.change is not None
    assert outcome.change.kind == "first_check"
    assert (outcome.state.consecutive_failures, outcome.state.is_stale) == (0, False)


def test_the_ranking_url_changes_only_between_two_ranked_checks_in_a_row() -> None:
    state = run(
        check(day=0, rank=4, url_id=1),
        check(day=1, rank=4, url_id=1),
        check(day=2, rank=5, url_id=2),
    )
    assert state.url_changed_at == START + timedelta(days=2)

    gap = run(
        check(day=0, rank=4, url_id=1),
        check(day=1, rank=None),
        check(day=2, rank=4, url_id=2),
    )
    assert gap.url_changed_at is None


def test_a_beyond_check_keeps_the_best_and_worst_and_clears_the_current() -> None:
    state = run(check(day=0, rank=8), check(day=1, rank=None))

    assert (state.current_rank, state.current_url_id, state.best_rank, state.worst_rank) == (
        None,
        None,
        8,
        8,
    )
    assert (state.previous_rank, state.rank_change) == (8, None)


# The debounce counter.


def test_the_run_of_beyond_checks_counts_and_a_ranked_check_ends_it() -> None:
    counts = []
    state: KeywordState | None = None
    for day, rank in enumerate([5, None, None, None, 6, None]):
        state = apply_check(state, check(day=day, rank=rank)).state
        counts.append(state.consecutive_beyond)

    assert counts == [0, 1, 2, 3, 0, 1]


def test_a_daily_check_that_only_cannot_see_a_deep_rank_does_not_extend_the_run() -> None:
    state = run(
        check(day=0, rank=45, depth=100),
        check(day=1, rank=None, depth=20),
    )

    assert state.consecutive_beyond == 0


def test_the_counter_stops_at_its_limit() -> None:
    state = KeywordState(
        last_observed_at=START,
        current_depth_requested=20,
        consecutive_beyond=MAX_CONSECUTIVE_BEYOND,
    )

    assert (
        apply_check(state, check(day=1, rank=None)).state.consecutive_beyond
        == MAX_CONSECUTIVE_BEYOND
    )


# Check validation.


@pytest.mark.parametrize("depth", [0, -1])
def test_a_check_needs_a_depth(depth: int) -> None:
    with pytest.raises(ValueError, match="depth_requested"):
        check(rank=None, depth=depth)


def test_a_rank_outside_the_depth_is_refused() -> None:
    with pytest.raises(ValueError, match="outside the depth"):
        check(rank=21, depth=20)
