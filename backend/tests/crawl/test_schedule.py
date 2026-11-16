"""When a scheduled crawl is due (plan decision D4)."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from idraft.crawl.schedule import (
    NIGHT_HOURS,
    SLOT_LENGTH,
    CrawlSchedule,
    crawl_due,
    slot_offset,
)

PROJECT = uuid.UUID("00000000-0000-0000-0000-000000000000")  # slot at 01:00 sharp
LONDON = "Europe/London"


def _at(day: int, hour: int, minute: int = 0) -> datetime:
    # November: London is on UTC.
    return datetime(2026, 11, day, hour, minute, tzinfo=UTC)


def test_the_slot_is_inside_the_night_and_stable_per_project() -> None:
    other = uuid.uuid4()
    assert slot_offset(PROJECT) == timedelta(0)
    assert slot_offset(other) == slot_offset(other)
    assert timedelta(0) <= slot_offset(other) <= timedelta(hours=NIGHT_HOURS) - SLOT_LENGTH


def _first_crawl_due(now: datetime) -> bool:
    return crawl_due(
        schedule=CrawlSchedule.WEEKLY,
        last_started=None,
        timezone=LONDON,
        project_id=PROJECT,
        now=now,
    )


def test_a_project_with_no_crawl_is_due_in_its_next_slot_only() -> None:
    assert _first_crawl_due(_at(17, 1, 10))
    assert not _first_crawl_due(_at(17, 0, 59))
    assert not _first_crawl_due(_at(17, 2, 0))


@pytest.mark.parametrize(
    ("schedule", "days_since", "due"),
    [
        (CrawlSchedule.WEEKLY, 7, True),
        (CrawlSchedule.WEEKLY, 6, True),  # a day of slack keeps the same night each week
        (CrawlSchedule.WEEKLY, 5, False),
        (CrawlSchedule.EVERY_TWO_WEEKS, 13, True),
        (CrawlSchedule.EVERY_TWO_WEEKS, 12, False),
        (CrawlSchedule.MONTHLY, 27, True),
        (CrawlSchedule.MONTHLY, 26, False),
        (CrawlSchedule.OFF, 400, False),
    ],
)
def test_the_interval_since_the_last_crawl(
    schedule: CrawlSchedule, days_since: int, due: bool
) -> None:
    now = _at(30, 1, 5)
    assert (
        crawl_due(
            schedule=schedule,
            last_started=now - timedelta(days=days_since, minutes=5),
            timezone=LONDON,
            project_id=PROJECT,
            now=now,
        )
        is due
    )


def test_the_slot_is_read_in_the_project_time_zone() -> None:
    # 01:05 in New York is 06:05 UTC in November.
    now = datetime(2026, 11, 17, 6, 5, tzinfo=UTC)
    assert crawl_due(
        schedule=CrawlSchedule.WEEKLY,
        last_started=None,
        timezone="America/New_York",
        project_id=PROJECT,
        now=now,
    )


def test_a_naive_time_is_refused() -> None:
    with pytest.raises(ValueError, match="aware"):
        crawl_due(
            schedule=CrawlSchedule.WEEKLY,
            last_started=None,
            timezone=LONDON,
            project_id=PROJECT,
            now=datetime(2026, 11, 17, 1, 5),
        )
