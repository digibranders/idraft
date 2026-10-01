"""Identity and timing of a collection task (docs/21-scheduler-workers.md sections 3.3 and 3.4)."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta

# The last fifth of a window is kept free for retries.
STAGGER_SHARE = 0.8
# Replicates of one prompt are asked this far apart, when the window has room for that.
REPLICATE_SPACING = timedelta(minutes=20)


def _part(value: str | int | None) -> str:
    """One field of a key. The length in front keeps a field that contains the separator from
    reading as two fields, and a missing field is not an empty one."""
    if value is None:
        return "-"
    text = str(value)
    return f"{len(text)}:{text}"


def idempotency_key(
    *,
    run_id: str,
    subject_type: str,
    subject_id: str,
    engine_code: str | None,
    location_id: int | None,
    replicate_index: int,
    depth: int | None,
) -> bytes:
    """What makes a task the same task. Planning a run a second time produces the same keys, so
    the ledger's unique constraint turns the second attempt into nothing."""
    parts = (run_id, subject_type, subject_id, engine_code, location_id, replicate_index, depth)
    return hashlib.sha256("|".join(_part(part) for part in parts).encode()).digest()


def partition_month(window_start: datetime) -> datetime:
    """The `created_at` of every task of a run: the first instant of the window's month (UTC).

    The ledger is partitioned by `created_at` and its unique constraint includes it, so a run's
    tasks must land in one partition whenever they are planned.
    """
    if window_start.tzinfo is None:
        # A naive time would be read in the zone of whatever machine runs this.
        raise ValueError("`window_start` must be an aware datetime")
    start = window_start.astimezone(UTC)
    return datetime(start.year, start.month, 1, tzinfo=UTC)


def _stagger_seconds(window_hours: int) -> int:
    if window_hours < 1:
        raise ValueError("a window is at least one hour long")
    return int(window_hours * 3600 * STAGGER_SHARE)


def replicate_spacing(*, window_hours: int, replicates: int) -> timedelta:
    """How far apart the replicates of one subject are asked: 20 minutes, or less when the
    window is too short to hold them all that far apart."""
    if replicates < 1:
        raise ValueError("a subject is asked at least once")
    fits = timedelta(seconds=_stagger_seconds(window_hours) // replicates)
    return min(REPLICATE_SPACING, fits)


def stagger_offset(
    *, subject_id: str, workload: str, window_hours: int, replicates: int = 1
) -> timedelta:
    """Where in its window a subject is first checked: the same place every run, so a keyword
    is checked at about the same local time every day and time of day stays out of its history.

    The place is chosen so that the last of the subject's replicates still falls inside the
    part of the window that tasks are spread over.
    """
    spacing = replicate_spacing(window_hours=window_hours, replicates=replicates)
    room = _stagger_seconds(window_hours) - (replicates - 1) * int(spacing.total_seconds())
    digest = hashlib.sha256(f"{subject_id}|{workload}".encode()).digest()
    return timedelta(seconds=int.from_bytes(digest[:4], "big") % room)


def scheduled_for(
    *,
    window_start: datetime,
    subject_id: str,
    workload: str,
    window_hours: int,
    replicate_index: int = 1,
    replicates: int = 1,
) -> datetime:
    """When replicate `replicate_index` of `replicates` is due."""
    if window_start.tzinfo is None:
        raise ValueError("`window_start` must be an aware datetime")
    if not 1 <= replicate_index <= replicates:
        raise ValueError("the replicate index is 1 to the number of replicates")
    offset = stagger_offset(
        subject_id=subject_id, workload=workload, window_hours=window_hours, replicates=replicates
    )
    spacing = replicate_spacing(window_hours=window_hours, replicates=replicates)
    return window_start + offset + (replicate_index - 1) * spacing
