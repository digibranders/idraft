"""Identity and timing of a collection task (docs/21-scheduler-workers.md sections 3.3 and 3.4)."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta

# The last fifth of a window is kept free for retries.
STAGGER_SHARE = 0.8
# Replicates of one prompt are asked this far apart.
REPLICATE_SPACING = timedelta(minutes=20)


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
    parts = (
        run_id,
        subject_type,
        subject_id,
        engine_code or "",
        "" if location_id is None else str(location_id),
        str(replicate_index),
        "" if depth is None else str(depth),
    )
    # The separator cannot occur in an id, an engine code or a number, so no two tuples collide.
    return hashlib.sha256("|".join(parts).encode()).digest()


def partition_month(window_start: datetime) -> datetime:
    """The `created_at` of every task of a run: the first instant of the window's month (UTC).

    The ledger is partitioned by `created_at` and its unique constraint includes it, so a run's
    tasks must land in one partition whenever they are planned.
    """
    start = window_start.astimezone(UTC)
    return datetime(start.year, start.month, 1, tzinfo=UTC)


def stagger_offset(*, subject_id: str, workload: str, window_hours: int) -> timedelta:
    """Where in its window a subject is checked: the same place every run, so a keyword is
    checked at about the same local time every day and time of day stays out of its history."""
    digest = hashlib.sha256(f"{subject_id}|{workload}".encode()).digest()
    span = int(window_hours * 3600 * STAGGER_SHARE)
    return timedelta(seconds=int.from_bytes(digest[:4], "big") % span)


def scheduled_for(
    *,
    window_start: datetime,
    subject_id: str,
    workload: str,
    window_hours: int,
    replicate_index: int = 1,
) -> datetime:
    offset = stagger_offset(subject_id=subject_id, workload=workload, window_hours=window_hours)
    return window_start + offset + (replicate_index - 1) * REPLICATE_SPACING
