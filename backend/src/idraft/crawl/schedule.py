"""When a scheduled crawl is due (plan decision D4).

At night in the project's time zone: the night runs from 01:00 for four hours, and each project
has its own one-hour slot in it, picked from its id, so crawls spread out. A crawl is due in its
slot once the interval since the last crawl started has passed, less a day, so the crawl falls
on the same night each time. A project that has never been crawled is due in its next slot.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, time, timedelta
from enum import StrEnum
from types import MappingProxyType
from typing import Final
from uuid import UUID
from zoneinfo import ZoneInfo


class CrawlSchedule(StrEnum):
    WEEKLY = "weekly"
    EVERY_TWO_WEEKS = "every_two_weeks"
    MONTHLY = "monthly"
    OFF = "off"


INTERVALS: Final[Mapping[CrawlSchedule, timedelta]] = MappingProxyType(
    {
        CrawlSchedule.WEEKLY: timedelta(days=7),
        CrawlSchedule.EVERY_TWO_WEEKS: timedelta(days=14),
        CrawlSchedule.MONTHLY: timedelta(days=28),
    }
)
NIGHT_START: Final = time(1, 0)
NIGHT_HOURS: Final = 4
SLOT_LENGTH: Final = timedelta(hours=1)
_SLACK: Final = timedelta(days=1)
_SLOT_MINUTES: Final = int((timedelta(hours=NIGHT_HOURS) - SLOT_LENGTH).total_seconds() // 60)


def slot_offset(project_id: UUID) -> timedelta:
    """Where in the night the project's slot starts: 0 to 3 hours after NIGHT_START."""
    return timedelta(minutes=project_id.int % (_SLOT_MINUTES + 1))


def crawl_due(
    *,
    schedule: CrawlSchedule,
    last_started: datetime | None,
    timezone: str,
    project_id: UUID,
    now: datetime,
) -> bool:
    if now.tzinfo is None or (last_started is not None and last_started.tzinfo is None):
        raise ValueError("times must be aware")
    interval = INTERVALS.get(schedule)
    if interval is None:
        return False
    if last_started is not None and now - last_started < interval - _SLACK:
        return False
    local = now.astimezone(ZoneInfo(timezone))
    start = datetime.combine(local.date(), NIGHT_START, tzinfo=local.tzinfo) + slot_offset(
        project_id
    )
    return start <= local < start + SLOT_LENGTH
