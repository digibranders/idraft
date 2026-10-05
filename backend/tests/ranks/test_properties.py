"""Properties of the rank rules over any sequence of checks (docs/26-testing-quality.md s. 4)."""

from __future__ import annotations

from hypothesis import given
from hypothesis import strategies as st

from sightline.ranks.events import TOP_BUCKETS, EventDraft, own_events
from sightline.ranks.state import Check, KeywordState, apply_check, classify_change
from tests.ranks.support import check

depths = st.sampled_from([20, 100])


@st.composite
def checks(draw: st.DrawFn) -> list[Check]:
    """Checks on consecutive days; each ranks within its depth or does not rank."""
    steps = draw(st.lists(st.tuples(depths, st.booleans(), st.integers(1, 100)), max_size=25))
    built: list[Check] = []
    for day, (depth, ranked, value) in enumerate(steps):
        rank = min(value, depth) if ranked else None
        built.append(check(day=day, rank=rank, depth=depth, url_id=1 + value % 3))
    return built


def replay(sequence: list[Check]) -> tuple[KeywordState | None, list[tuple[EventDraft, ...]]]:
    state: KeywordState | None = None
    emitted: list[tuple[EventDraft, ...]] = []
    for item in sequence:
        transition = apply_check(state, item)
        emitted.append(own_events(state, item, transition))
        state = transition.state
    return state, emitted


@given(checks())
def test_the_state_stays_consistent_through_any_sequence(sequence: list[Check]) -> None:
    state: KeywordState | None = None
    for item in sequence:
        state = apply_check(state, item).state

        assert state.last_observed_at == item.observed_at
        assert (state.current_rank is None) == (state.current_url_id is None)
        assert state.consecutive_beyond >= 0
        if state.current_rank is not None:
            assert state.consecutive_beyond == 0
            assert state.best_rank is not None
            assert state.worst_rank is not None
            assert state.best_rank <= state.current_rank <= state.worst_rank
        if state.rank_change is not None:
            assert state.previous_rank is not None
            assert state.current_rank is not None


@given(checks())
def test_a_first_check_never_causes_an_event(sequence: list[Check]) -> None:
    if sequence:
        assert replay(sequence[:1])[1] == [()]


@given(checks())
def test_events_only_name_buckets_both_checks_cover(sequence: list[Check]) -> None:
    state: KeywordState | None = None
    for item in sequence:
        transition = apply_check(state, item)
        depth = None if transition.change is None else transition.change.depth
        for event in own_events(state, item, transition):
            if event.event_type.startswith(("entered_top_", "lost_top_")):
                bucket = int(event.event_type.rsplit("_", 1)[1])
                assert bucket in TOP_BUCKETS
                assert depth is not None
                assert bucket <= depth
        state = transition.state


@given(checks())
def test_a_loss_or_a_new_ranking_is_written_once_per_run_of_beyond_checks(
    sequence: list[Check],
) -> None:
    _, emitted = replay(sequence)
    lost_since_ranked = 0
    for item, events in zip(sequence, emitted, strict=True):
        names = [event.event_type for event in events]
        if item.rank is not None:
            lost_since_ranked = 0
        lost_since_ranked += names.count("lost_ranking")
        assert lost_since_ranked <= 1
        assert names.count("new_ranking") <= 1


@given(checks(), st.data())
def test_a_check_that_is_not_newer_moves_nothing(
    sequence: list[Check], data: st.DataObject
) -> None:
    state, _ = replay(sequence)
    if state is None:
        return
    late = data.draw(st.sampled_from(sequence))

    outcome = apply_check(state, late)

    assert outcome.applied is False
    assert outcome.state == state


@given(
    st.integers(1, 100),
    st.integers(1, 100),
    depths,
)
def test_a_numeric_change_reverses_when_the_checks_do(first: int, second: int, depth: int) -> None:
    a, b = min(first, depth), min(second, depth)

    forward = classify_change(
        previous_rank=a, previous_depth=depth, rank=b, depth=depth, first=False
    )
    back = classify_change(previous_rank=b, previous_depth=depth, rank=a, depth=depth, first=False)

    assert forward.kind == back.kind == "numeric"
    assert forward.delta == a - b
    assert back.delta == -(forward.delta or 0)


@given(
    st.none() | st.integers(1, 100),
    depths,
    st.none() | st.integers(1, 100),
    depths,
)
def test_a_change_is_numeric_exactly_when_both_ranks_lie_within_the_smaller_depth(
    previous: int | None, prev_depth: int, current: int | None, depth: int
) -> None:
    previous = None if previous is None else min(previous, prev_depth)
    current = None if current is None else min(current, depth)
    compared = min(prev_depth, depth)

    change = classify_change(
        previous_rank=previous, previous_depth=prev_depth, rank=current, depth=depth, first=False
    )

    both = (
        previous is not None
        and current is not None
        and previous <= compared
        and current <= compared
    )
    assert (change.kind == "numeric") == both
    assert (change.delta is not None) == both
    assert change.depth == compared
