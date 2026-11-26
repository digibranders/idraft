"""Where the GA4 pull of a property has got to, and which days the next run asks for
(docs/18 section 7.2)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest

from idraft.domain.ga4_pull import FIRST_PULL_DAYS, TRAILING_DAYS, VERSION, Ga4PullState

TODAY = date(2026, 11, 26)
YESTERDAY = date(2026, 11, 25)
NOW = datetime(2026, 11, 26, 14, 0, tzinfo=UTC)


def test_the_first_run_pulls_ninety_days_that_end_yesterday() -> None:
    start, end = Ga4PullState().window(TODAY)

    # today is partial and is never asked for
    assert end == YESTERDAY
    assert (end - start).days + 1 == FIRST_PULL_DAYS == 90


def test_a_run_that_has_not_finished_a_pull_asks_for_ninety_days_again() -> None:
    failed_first = Ga4PullState().failed(NOW)

    assert failed_first.window(TODAY) == Ga4PullState().window(TODAY)


def test_a_complete_state_without_a_day_is_a_pull_not_begun() -> None:
    assert Ga4PullState(complete=True, through=None).window(TODAY) == Ga4PullState().window(TODAY)


def test_a_later_run_pulls_only_the_trailing_three_days() -> None:
    state = Ga4PullState().succeeded(YESTERDAY - timedelta(days=1))

    start, end = state.window(TODAY)

    assert end == YESTERDAY
    assert (end - start).days + 1 == TRAILING_DAYS == 3


def test_a_run_after_a_gap_starts_where_the_last_one_ended_and_not_later() -> None:
    state = Ga4PullState().succeeded(YESTERDAY - timedelta(days=10))

    start, end = state.window(TODAY)

    # the last day that was pulled is read again, since GA4 restates it
    assert start == YESTERDAY - timedelta(days=11)
    assert end == YESTERDAY


def test_a_gap_longer_than_the_first_pull_is_cut_to_the_first_pull() -> None:
    state = Ga4PullState().succeeded(YESTERDAY - timedelta(days=200))

    assert state.window(TODAY) == Ga4PullState().window(TODAY)


def test_succeeding_clears_the_failures_and_keeps_the_day() -> None:
    state = Ga4PullState().failed(NOW).failed(NOW).succeeded(YESTERDAY)

    assert state == Ga4PullState(through=YESTERDAY, complete=True)


def test_a_failure_keeps_the_day_and_the_wait_grows_to_a_cap() -> None:
    state = Ga4PullState().succeeded(YESTERDAY)
    waits: list[timedelta] = []
    for _ in range(5):
        state = state.failed(NOW)
        assert state.retry_at is not None
        waits.append(state.retry_at - NOW)

    assert [wait.total_seconds() / 60 for wait in waits] == [15, 30, 60, 60, 60]
    assert (state.through, state.complete, state.failures) == (YESTERDAY, True, 5)


def test_a_retry_is_due_once_its_wait_is_over() -> None:
    state = Ga4PullState().failed(NOW)

    assert not state.retry_due(NOW)
    assert not state.retry_due(NOW + timedelta(minutes=14))
    assert state.retry_due(NOW + timedelta(minutes=15))
    assert Ga4PullState().retry_due(NOW)


def test_the_state_is_written_under_its_own_key_and_other_keys_stay() -> None:
    state = Ga4PullState().failed(NOW).succeeded(YESTERDAY).failed(NOW)

    written = state.write({"gsc": {"version": 2}, "other": 1})

    assert written["gsc"] == {"version": 2}
    assert written["other"] == 1
    assert written["ga4"] == {
        "version": VERSION,
        "through": "2026-11-25",
        "complete": True,
        "failures": 1,
        "retry_at": (NOW + timedelta(minutes=15)).isoformat(),
    }
    assert Ga4PullState.read(written) == state


def test_a_state_that_is_missing_of_another_version_or_unreadable_is_a_pull_not_begun() -> None:
    cases: list[dict[str, Any] | None] = [
        None,
        {},
        {"gsc": {"version": 2}},
        {"ga4": "complete"},
        {"ga4": {"version": VERSION + 1, "through": "2026-11-25", "complete": True}},
        {"ga4": {"through": "2026-11-25", "complete": True}},
    ]

    for backfill_state in cases:
        assert Ga4PullState.read(backfill_state) == Ga4PullState()


@pytest.mark.parametrize(
    ("found", "expected"),
    [
        ({"through": "not a day", "complete": True}, Ga4PullState(complete=True)),
        ({"through": 20261125, "complete": "yes"}, Ga4PullState()),
        ({"failures": -3, "retry_at": "tomorrow"}, Ga4PullState()),
        ({"failures": True}, Ga4PullState()),
    ],
)
def test_a_field_that_is_not_what_was_written_reads_as_not_set(
    found: dict[str, Any], expected: Ga4PullState
) -> None:
    assert Ga4PullState.read({"ga4": {"version": VERSION, **found}}) == expected


def test_a_retry_time_without_a_zone_is_read_as_utc() -> None:
    state = Ga4PullState.read(
        {"ga4": {"version": VERSION, "failures": 1, "retry_at": "2026-11-26T14:15:00"}}
    )

    assert state.retry_at == datetime(2026, 11, 26, 14, 15, tzinfo=UTC)
