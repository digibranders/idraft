"""The rank events a check causes (docs/09 section 4.1)."""

from __future__ import annotations

import pytest

from sightline.ranks.events import EventDraft, overtake_events, own_events
from sightline.ranks.state import Check, KeywordState, apply_check
from tests.ranks.support import OTHER_RIVAL, RIVAL, check


def history(*checks: Check) -> tuple[KeywordState | None, list[tuple[EventDraft, ...]]]:
    """The state after the checks and the events each of them caused."""
    state: KeywordState | None = None
    emitted: list[tuple[EventDraft, ...]] = []
    for item in checks:
        transition = apply_check(state, item)
        emitted.append(own_events(state, item, transition))
        state = transition.state
    return state, emitted


def types(events: tuple[EventDraft, ...]) -> list[str]:
    return [event.event_type for event in events]


def last(*checks: Check) -> tuple[EventDraft, ...]:
    return history(*checks)[1][-1]


def test_a_first_check_causes_no_event() -> None:
    assert last(check(rank=2, aio="present_cited", cited=True, owned=("video",))) == ()


def test_an_unchanged_rank_causes_no_event() -> None:
    assert last(check(day=0, rank=5), check(day=1, rank=5)) == ()


def test_a_check_that_was_not_applied_causes_no_event() -> None:
    state = apply_check(None, check(day=3, rank=5)).state
    old = check(day=1, rank=1)
    transition = apply_check(state, old)

    assert own_events(state, old, transition) == ()


@pytest.mark.parametrize(
    ("before", "after", "expected"),
    [
        (12, 8, ["entered_top_10", "rank_gain"]),
        (4, 2, ["entered_top_3", "rank_gain"]),
        (30, 2, ["entered_top_3", "entered_top_10", "entered_top_20", "rank_gain"]),
        (8, 12, ["lost_top_10", "rank_drop"]),
        (2, 4, ["lost_top_3", "rank_drop"]),
        (6, 7, ["rank_drop"]),
        (7, 6, ["rank_gain"]),
    ],
)
def test_buckets_and_movement_within_a_depth_that_covers_them(
    before: int, after: int, expected: list[str]
) -> None:
    events = last(check(day=0, rank=before, depth=100), check(day=1, rank=after, depth=100))

    assert types(events) == expected


def test_a_bucket_the_smaller_depth_does_not_cover_is_not_compared() -> None:
    # The deep check ranked it at 50, the daily check at 15: top 20 is covered by both, top 100 is
    # not covered by the daily check, so there is no top 100 event either way.
    events = last(check(day=0, rank=50, depth=100), check(day=1, rank=15, depth=20))

    assert "entered_top_20" in types(events)
    assert not any(name.endswith("_100") for name in types(events))


def test_rank_gain_and_drop_carry_ranks_and_urls() -> None:
    (event,) = [
        e
        for e in last(check(day=0, rank=9, url_id=1), check(day=1, rank=6, url_id=1))
        if e.event_type == "rank_gain"
    ]

    assert (event.from_rank, event.to_rank, event.from_url_id, event.to_url_id) == (9, 6, 1, 1)


def test_a_url_change_between_two_ranked_checks_is_an_event() -> None:
    events = last(check(day=0, rank=4, url_id=1), check(day=1, rank=4, url_id=2))

    (event,) = events
    assert (event.event_type, event.from_url_id, event.to_url_id) == ("url_changed", 1, 2)


def test_the_same_url_causes_no_url_event() -> None:
    assert last(check(day=0, rank=4, url_id=1), check(day=1, rank=4, url_id=1)) == ()


def test_no_url_event_across_a_check_that_did_not_rank() -> None:
    events = history(
        check(day=0, rank=4, url_id=1), check(day=1, rank=None), check(day=2, rank=4, url_id=2)
    )[1]

    assert all("url_changed" not in types(step) for step in events)


# new_ranking and lost_ranking, debounced over two checks.


def test_lost_ranking_waits_for_a_second_beyond_check() -> None:
    steps = history(
        check(day=0, rank=5),
        check(day=1, rank=None),
        check(day=2, rank=None),
        check(day=3, rank=None),
    )[1]

    assert [types(step) for step in steps] == [
        [],
        ["lost_top_10", "lost_top_20"],
        ["lost_ranking"],
        [],
    ]


def test_new_ranking_waits_for_two_beyond_checks_before_it() -> None:
    steps = history(
        check(day=0, rank=None),
        check(day=1, rank=None),
        check(day=2, rank=15),
    )[1]

    assert types(steps[2]) == ["entered_top_20", "new_ranking"]


def test_one_beyond_check_before_a_return_is_not_a_new_ranking() -> None:
    steps = history(check(day=0, rank=None), check(day=1, rank=15))[1]

    assert "new_ranking" not in types(steps[1])
    assert "entered_top_20" in types(steps[1])


def test_a_ranked_keyword_that_blinks_out_for_one_check_is_not_lost() -> None:
    steps = history(check(day=0, rank=19), check(day=1, rank=None), check(day=2, rank=18))[1]

    assert all("lost_ranking" not in types(step) for step in steps)
    assert all("new_ranking" not in types(step) for step in steps)


def test_a_never_ranked_keyword_is_never_lost() -> None:
    steps = history(*(check(day=d, rank=None) for d in range(5)))[1]

    assert all(step == () for step in steps)


def test_a_deeper_rank_seen_earlier_stops_a_shallow_check_from_confirming_a_loss() -> None:
    # A weekly deep check saw it at 45; two daily depth-20 checks that miss it prove nothing.
    steps = history(
        check(day=0, rank=45, depth=100),
        check(day=1, rank=None, depth=20),
        check(day=2, rank=None, depth=20),
        check(day=3, rank=None, depth=20),
    )[1]

    assert all("lost_ranking" not in types(step) for step in steps)


def test_a_deep_check_that_finds_what_the_daily_depth_cannot_see_is_not_new() -> None:
    steps = history(
        *(check(day=d, rank=None, depth=20) for d in range(4)),
        check(day=4, rank=45, depth=100),
    )[1]

    assert steps[-1] == ()


def test_a_keyword_seen_deep_once_is_still_lost_when_it_later_ranks_shallow_and_leaves() -> None:
    steps = history(
        check(day=0, rank=45, depth=100),
        *(check(day=d, rank=5, depth=20) for d in range(1, 30)),
        check(day=30, rank=None, depth=20),
        check(day=31, rank=None, depth=20),
        check(day=32, rank=None, depth=20),
    )[1]

    assert [types(step) for step in steps[-3:]] == [
        ["lost_top_10", "lost_top_20"],
        ["lost_ranking"],
        [],
    ]
    assert steps[-2][0].from_rank == 5


def test_a_loss_deep_in_the_results_is_confirmed_by_deep_checks_only() -> None:
    steps = history(
        check(day=0, rank=98, depth=100),
        *(check(day=d, rank=None, depth=20) for d in range(1, 7)),
        check(day=7, rank=None, depth=100),
        *(check(day=d, rank=None, depth=20) for d in range(8, 14)),
        check(day=14, rank=None, depth=100),
    )[1]

    written = [(i, types(step)) for i, step in enumerate(steps) if "lost_ranking" in types(step)]
    assert written == [(14, ["lost_ranking"])]
    assert steps[14][0].from_rank == 98


def test_a_deep_rank_between_unranked_daily_checks_does_not_hide_a_return_to_the_top() -> None:
    steps = history(
        *(check(day=d, rank=None, depth=20) for d in range(4)),
        check(day=4, rank=45, depth=100),
        check(day=5, rank=15, depth=20),
    )[1]

    assert types(steps[4]) == []
    assert types(steps[5]) == ["entered_top_20", "new_ranking"]


# Features and the AI Overview.


def test_owned_features_are_gained_and_lost_by_type() -> None:
    steps = history(
        check(day=0, rank=3, owned=("video",)),
        check(day=1, rank=3, owned=("featured_snippet", "video")),
        check(day=2, rank=3, owned=("featured_snippet",)),
    )[1]

    assert [(e.event_type, e.feature_type) for e in steps[1]] == [
        ("feature_gained", "featured_snippet")
    ]
    assert [(e.event_type, e.feature_type) for e in steps[2]] == [("feature_lost", "video")]


def test_an_ai_overview_appears_and_disappears() -> None:
    steps = history(
        check(day=0, rank=3, aio="absent"),
        check(day=1, rank=3, aio="present_not_cited", cited=False),
        check(day=2, rank=3, aio="absent"),
    )[1]

    assert types(steps[1]) == ["aio_appeared"]
    assert types(steps[2]) == ["aio_disappeared"]


def test_a_citation_is_compared_only_when_the_block_is_loaded_in_both_checks() -> None:
    steps = history(
        check(day=0, rank=3, aio="present_not_cited", cited=False),
        check(day=1, rank=3, aio="present_cited", cited=True),
        check(day=2, rank=3, aio="not_loaded", cited=None),
        check(day=3, rank=3, aio="present_not_cited", cited=False),
    )[1]

    assert types(steps[1]) == ["aio_citation_gained"]
    assert types(steps[2]) == []
    assert types(steps[3]) == []


# Overtakes.

A, B = RIVAL, OTHER_RIVAL


def test_a_competitor_that_passes_us_overtakes() -> None:
    (event,) = overtake_events(
        own_before=4,
        own_now=6,
        competitors_before={A: 8},
        competitors_now={A: 5},
        depth=20,
    )

    assert (event.event_type, event.other_entity_id, event.from_rank, event.to_rank) == (
        "overtaken_by",
        A,
        4,
        6,
    )


def test_we_pass_a_competitor() -> None:
    (event,) = overtake_events(
        own_before=9, own_now=3, competitors_before={A: 5}, competitors_now={A: 4}, depth=20
    )

    assert (event.event_type, event.other_entity_id) == ("overtook", A)


def test_a_competitor_already_ahead_does_not_overtake_again() -> None:
    assert (
        overtake_events(
            own_before=9, own_now=10, competitors_before={A: 5}, competitors_now={A: 4}, depth=20
        )
        == ()
    )


def test_a_competitor_that_starts_ranking_above_a_site_that_just_stopped_overtakes() -> None:
    (event,) = overtake_events(
        own_before=15,
        own_now=None,
        competitors_before={A: None},
        competitors_now={A: 12},
        depth=20,
    )

    assert event.event_type == "overtaken_by"


def test_nothing_is_passed_when_the_own_site_ranks_in_neither_check() -> None:
    assert (
        overtake_events(
            own_before=None,
            own_now=None,
            competitors_before={A: 21},
            competitors_now={A: 19},
            depth=20,
        )
        == ()
    )


def test_we_do_not_pass_a_competitor_that_ranks_in_neither_check() -> None:
    assert (
        overtake_events(
            own_before=None,
            own_now=5,
            competitors_before={A: None},
            competitors_now={A: None},
            depth=20,
        )
        == ()
    )


def test_ranks_beyond_the_compared_depth_count_as_beyond() -> None:
    assert (
        overtake_events(
            own_before=None,
            own_now=None,
            competitors_before={A: None},
            competitors_now={A: 45},
            depth=20,
        )
        == ()
    )


def test_a_competitor_without_a_previous_row_is_not_compared() -> None:
    assert (
        overtake_events(
            own_before=3, own_now=9, competitors_before={}, competitors_now={A: 5}, depth=20
        )
        == ()
    )


def test_overtakes_come_in_competitor_order() -> None:
    events = overtake_events(
        own_before=5,
        own_now=9,
        competitors_before={B: 8, A: 7},
        competitors_now={B: 4, A: 3},
        depth=20,
    )

    assert [e.other_entity_id for e in events] == sorted([A, B])
