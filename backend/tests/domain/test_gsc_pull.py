"""The state of a Search Console pull, as it is kept in `backfill_state` (docs/18 section 4.3)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from idraft.domain.countries import ISO2_OF, ISO3_OF, iso2_of
from idraft.domain.gsc_pull import PullState, window_of

END = date(2026, 11, 2)


def test_the_window_is_the_28_days_that_end_on_the_latest_final_day() -> None:
    start, end = window_of(END)

    assert (start, end) == (date(2026, 10, 6), END)
    assert (end - start).days + 1 == 28


def test_a_state_survives_the_round_trip_and_keeps_the_other_keys() -> None:
    state = PullState(
        recent_done=True,
        window_end=END,
        history_next=date(2025, 7, 7),
        history_until=date(2026, 10, 6),
        days_stored=12,
        rows_stored=300,
        oldest_day=date(2025, 7, 7),
        failures=2,
        retry_after=datetime(2026, 11, 3, 4, 5, tzinfo=UTC),
    )

    written = state.write({"other": {"kept": True}})

    assert written["other"] == {"kept": True}
    assert PullState.read(written) == state
    assert state.window == (date(2026, 10, 6), END)


def test_a_state_not_begun_has_no_window() -> None:
    assert PullState.read({}).window is None
    assert PullState.read(None).window is None
    assert PullState(recent_done=False, window_end=END).window is None
    assert PullState(recent_done=True).window is None


def test_a_state_that_is_not_of_this_version_reads_as_not_begun() -> None:
    for junk in (
        {"gsc": "x"},
        {"gsc": {"version": 2, "recent_done": True}},
        {"gsc": {"version": 1, "window_end": "not a date", "days_stored": -4, "failures": True}},
    ):
        state = PullState.read(junk)
        assert state.window_end is None
        assert (state.days_stored, state.failures) == (0, 0)


def test_a_day_is_counted_once_however_often_it_is_replaced() -> None:
    state = PullState()

    first = state.stored_day(END, replaced_rows=0, rows=5)
    again = first.stored_day(END, replaced_rows=5, rows=7)
    empty = again.stored_day(END - timedelta(days=1), replaced_rows=0, rows=0)

    assert (first.days_stored, first.rows_stored) == (1, 5)
    assert (again.days_stored, again.rows_stored) == (1, 7)
    assert (empty.days_stored, empty.rows_stored) == (1, 7)
    assert empty.oldest_day == END - timedelta(days=1)


def test_a_failed_pass_waits_longer_each_time_up_to_an_hour_and_success_forgets_it() -> None:
    now = datetime(2026, 11, 5, 12, 0, tzinfo=UTC)
    state = PullState()

    waits = []
    for _ in range(5):
        state = state.failed(now)
        assert state.retry_after is not None
        waits.append((state.retry_after - now).total_seconds() / 60)

    assert waits == [15, 30, 60, 60, 60]
    assert not state.retry_due(now)
    assert state.retry_due(now + timedelta(minutes=61))
    assert state.succeeded().retry_due(now)
    assert state.succeeded().failures == 0


def test_every_iso_country_has_a_three_letter_code_and_back() -> None:
    assert len(ISO3_OF) == len(set(ISO3_OF.values())) == 249
    assert all(ISO2_OF[iso3] == iso2 for iso2, iso3 in ISO3_OF.items())
    assert [iso2_of(code) for code in ("usa", "GBR", "deu", "ARE", "xkk")] == [
        "US",
        "GB",
        "DE",
        "AE",
        "XK",
    ]
    # Search Console's unknown region has no country
    assert iso2_of("zzz") is None
