"""Identity and timing of a task (docs/21-scheduler-workers.md sections 3.3 and 3.4)."""

from datetime import UTC, datetime, timedelta, timezone
from itertools import pairwise

import pytest
from hypothesis import given
from hypothesis import strategies as st

from sightline.domain.tasks import (
    REPLICATE_SPACING,
    STAGGER_SHARE,
    idempotency_key,
    partition_month,
    replicate_spacing,
    scheduled_for,
    stagger_offset,
)

IDENTITY: dict[str, object] = {
    "run_id": "0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11",
    "subject_type": "tracked_keyword",
    "subject_id": "0192f0a1-3c44-7e10-8a51-000000000001",
    "engine_code": None,
    "location_id": 2356,
    "replicate_index": 1,
    "depth": 20,
}
OTHER: dict[str, object] = {
    "run_id": "0192f0a1-3c44-7e10-8a51-2b7d9c0e4f12",
    "subject_type": "prompt_version",
    "subject_id": "0192f0a1-3c44-7e10-8a51-000000000002",
    "engine_code": "chatgpt_web",
    "location_id": 2840,
    "replicate_index": 2,
    "depth": 100,
}


def _key(**changes: object) -> bytes:
    return idempotency_key(**{**IDENTITY, **changes})  # type: ignore[arg-type]


def test_the_same_task_has_the_same_key_every_time() -> None:
    assert _key() == _key()
    assert len(_key()) == 32


def test_every_field_of_a_tasks_identity_changes_its_key() -> None:
    keys = {_key()} | {_key(**{field: value}) for field, value in OTHER.items()}
    assert len(keys) == 1 + len(OTHER)


def test_a_missing_field_is_not_the_same_as_an_empty_or_zero_one() -> None:
    # No engine and no location are part of the identity, not confused with their neighbours.
    assert _key(engine_code=None, location_id=1) != _key(engine_code="1", location_id=None)
    assert _key(location_id=None, replicate_index=12) != _key(location_id=1, replicate_index=2)
    assert _key(depth=None) != _key(depth=0)
    assert _key(location_id=None) != _key(location_id=0)
    assert _key(engine_code=None) != _key(engine_code="")


def test_a_separator_inside_a_field_does_not_make_two_tasks_one() -> None:
    """A subject id is free text. Whatever it contains, it stays one field."""
    assert _key(subject_id="x|y", engine_code=None) != _key(subject_id="x", engine_code="y|")
    assert _key(subject_id="x|1:y", engine_code=None) != _key(subject_id="x", engine_code="y")
    assert _key(subject_type="a", subject_id="bc") != _key(subject_type="ab", subject_id="c")


@given(
    when=st.datetimes(
        min_value=datetime(2024, 1, 1),
        max_value=datetime(2030, 12, 31),
        timezones=st.sampled_from([UTC, timezone(timedelta(hours=5, minutes=30))]),
    )
)
def test_a_runs_tasks_are_created_in_the_month_its_window_starts(when: datetime) -> None:
    month = partition_month(when)
    in_utc = when.astimezone(UTC)
    assert month.tzinfo is UTC
    assert (month.year, month.month, month.day) == (in_utc.year, in_utc.month, 1)
    assert (month.hour, month.minute, month.second, month.microsecond) == (0, 0, 0, 0)
    assert month <= when


def test_the_month_is_the_utc_month_at_a_boundary() -> None:
    india = timezone(timedelta(hours=5, minutes=30))
    # 02:00 on the first in India is still the last day of the previous month in UTC.
    assert partition_month(datetime(2026, 10, 1, 2, 0, tzinfo=india)) == datetime(
        2026, 9, 1, tzinfo=UTC
    )


def test_a_time_without_a_zone_is_refused() -> None:
    """It would be read in the zone of the machine, and a run's month would depend on it."""
    with pytest.raises(ValueError, match="aware"):
        partition_month(datetime(2026, 10, 1, 2, 0))
    with pytest.raises(ValueError, match="aware"):
        scheduled_for(
            window_start=datetime(2026, 10, 1, 2, 0),
            subject_id="keyword-1",
            workload="seo_rank",
            window_hours=6,
        )


@given(subject=st.uuids().map(str), hours=st.integers(1, 24))
def test_a_subject_is_checked_at_the_same_place_in_every_window(subject: str, hours: int) -> None:
    offset = stagger_offset(subject_id=subject, workload="seo_rank", window_hours=hours)
    again = stagger_offset(subject_id=subject, workload="seo_rank", window_hours=hours)
    assert offset == again
    # The last fifth of the window is kept free for retries.
    assert timedelta(0) <= offset < timedelta(hours=hours) * 0.8


def test_subjects_are_spread_over_the_window_and_workloads_differ() -> None:
    offsets = [
        stagger_offset(subject_id=f"keyword-{number}", workload="seo_rank", window_hours=6)
        for number in range(2000)
    ]
    span = 6 * 3600 * 0.8
    quarters = [0, 0, 0, 0]
    for offset in offsets:
        quarters[int(offset.total_seconds() // (span / 4))] += 1
    assert all(400 <= count <= 600 for count in quarters), quarters
    # The spread reaches the end of the four fifths and stops there.
    assert STAGGER_SHARE == 0.8
    assert 0.79 * 6 * 3600 < max(offsets).total_seconds() < span
    assert stagger_offset(subject_id="k", workload="seo_rank", window_hours=6) != stagger_offset(
        subject_id="k", workload="ai_mode_keyword", window_hours=6
    )


def test_replicates_of_one_subject_are_twenty_minutes_apart() -> None:
    start = datetime(2026, 9, 30, 1, 0, tzinfo=UTC)
    times = [
        scheduled_for(
            window_start=start,
            subject_id="prompt-1",
            workload="ai_prompt",
            window_hours=8,
            replicate_index=index,
            replicates=3,
        )
        for index in (1, 2, 3)
    ]
    assert times[0] == start + stagger_offset(
        subject_id="prompt-1", workload="ai_prompt", window_hours=8, replicates=3
    )
    assert [later - earlier for earlier, later in pairwise(times)] == [
        REPLICATE_SPACING,
        REPLICATE_SPACING,
    ]
    assert timedelta(minutes=20) == REPLICATE_SPACING


def test_replicates_move_closer_when_the_window_is_short() -> None:
    # Six replicates 20 minutes apart need 100 minutes; an hour's window has 48 to spread over.
    assert replicate_spacing(window_hours=1, replicates=6) == timedelta(minutes=8)
    assert replicate_spacing(window_hours=1, replicates=2) == timedelta(minutes=20)
    assert replicate_spacing(window_hours=8, replicates=6) == REPLICATE_SPACING


@given(
    subject=st.uuids().map(str),
    hours=st.integers(1, 24),
    replicates=st.integers(1, 12),
)
def test_every_replicate_is_due_inside_the_part_of_the_window_tasks_are_spread_over(
    subject: str, hours: int, replicates: int
) -> None:
    start = datetime(2026, 9, 30, 1, 0, tzinfo=UTC)
    times = [
        scheduled_for(
            window_start=start,
            subject_id=subject,
            workload="ai_prompt",
            window_hours=hours,
            replicate_index=index,
            replicates=replicates,
        )
        for index in range(1, replicates + 1)
    ]
    assert times == sorted(set(times))
    assert start <= times[0]
    # The last fifth stays free for retries, however many replicates there are.
    assert times[-1] < start + timedelta(hours=hours) * STAGGER_SHARE


@pytest.mark.parametrize(
    ("arguments", "reason"),
    [
        ({"window_hours": 0}, "at least one hour"),
        ({"window_hours": -1}, "at least one hour"),
        ({"replicates": 0}, "the replicate index is 1 to"),
        ({"replicate_index": 0}, "the replicate index is 1 to"),
        ({"replicate_index": 4, "replicates": 3}, "the replicate index is 1 to"),
    ],
)
def test_a_window_or_a_replicate_that_cannot_be_is_refused(
    arguments: dict[str, int], reason: str
) -> None:
    values: dict[str, int] = {"window_hours": 6, "replicate_index": 1, "replicates": 1}
    with pytest.raises(ValueError, match="asked at least once"):
        replicate_spacing(window_hours=6, replicates=0)
    with pytest.raises(ValueError, match=reason):
        scheduled_for(
            window_start=datetime(2026, 9, 30, 1, 0, tzinfo=UTC),
            subject_id="prompt-1",
            workload="ai_prompt",
            **{**values, **arguments},
        )
