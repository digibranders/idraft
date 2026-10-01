"""When a schedule's collection windows start (docs/21-scheduler-workers.md section 3).

A window starts at a local time in the schedule's zone, every day, every week on one weekday, or
every month on one day. Instants are UTC; only the rule is local. On the day clocks go forward a
local time that does not exist starts later by the size of the gap (02:30 becomes 03:30), and on
the day they go back a local time that occurs twice starts at its first occurrence.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from enum import StrEnum
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# A month has at least this many days, so a rule on a later day would have no window some months.
MONTH_DAY_MAX = 28


class Cadence(StrEnum):
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"


@dataclass(frozen=True, slots=True)
class ScheduleRule:
    cadence: Cadence
    timezone: str
    window_start_local: time
    # Weekly only. 0 is Sunday, as in `ops.schedules.weekday`.
    weekday: int | None = None
    # Monthly only, 1 to 28.
    month_day: int | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.cadence, Cadence):
            raise ValueError("the cadence is daily, weekly or monthly")
        if self.window_start_local.tzinfo is not None:
            raise ValueError("the window start is a local time and carries no zone")
        if (self.cadence is Cadence.WEEKLY) != (self.weekday is not None):
            raise ValueError("a weekly rule names its weekday, and no other rule does")
        if (self.cadence is Cadence.MONTHLY) != (self.month_day is not None):
            raise ValueError("a monthly rule names its day of the month, and no other rule does")
        if self.weekday is not None and not 0 <= self.weekday <= 6:
            raise ValueError("weekday is 0 (Sunday) to 6 (Saturday)")
        if self.month_day is not None and not 1 <= self.month_day <= MONTH_DAY_MAX:
            raise ValueError(f"the day of the month is 1 to {MONTH_DAY_MAX}")
        try:
            ZoneInfo(self.timezone)
        except (ZoneInfoNotFoundError, ValueError, OSError) as error:
            raise ValueError(f"unknown time zone {self.timezone!r}") from error


def _instant(rule: ScheduleRule, day: date) -> datetime:
    """The window start on this local day, as a UTC instant.

    `fold=0` is what gives the two clock-change rules: a time that does not exist is read with
    the offset from before the change, which lands after it, and a time that occurs twice is
    its first occurrence. A rule's own `fold` has no say in that.
    """
    at = rule.window_start_local.replace(fold=0)
    return datetime.combine(day, at, tzinfo=ZoneInfo(rule.timezone)).astimezone(UTC)


def _falls_on(rule: ScheduleRule, day: date) -> bool:
    if rule.cadence is Cadence.WEEKLY:
        # isoweekday: Monday is 1 and Sunday 7; ours: Sunday is 0.
        return day.isoweekday() % 7 == rule.weekday
    if rule.cadence is Cadence.MONTHLY:
        return day.day == rule.month_day
    return True


def next_occurrence(rule: ScheduleRule, after: datetime) -> datetime:
    """The first window start strictly after `after`."""
    if after.tzinfo is None:
        raise ValueError("`after` must be an aware datetime")
    # From the day before: where clocks go forward over midnight (23:00 becomes 00:00 in
    # Nuuk), a window late on one local day starts early on the next.
    day = after.astimezone(ZoneInfo(rule.timezone)).date() - timedelta(days=1)
    # A rule has a window at least every 31 days, so with the day before and the day of `after`
    # itself the window is within 33 days.
    for _ in range(33):
        if _falls_on(rule, day):
            instant = _instant(rule, day)
            if instant > after:
                return instant
        day += timedelta(days=1)
    raise AssertionError("a schedule rule has a window at least once a month")  # pragma: no cover


def _period(rule: ScheduleRule, instant: datetime) -> tuple[int, ...]:
    """The local day, week (ISO) or month an instant is in, by the rule's cadence."""
    day = instant.astimezone(ZoneInfo(rule.timezone)).date()
    if rule.cadence is Cadence.WEEKLY:
        year, week, _ = day.isocalendar()
        return (year, week)
    if rule.cadence is Cadence.MONTHLY:
        return (day.year, day.month)
    return (day.year, day.month, day.day)


def next_after_change(rule: ScheduleRule, now: datetime, last_window: datetime | None) -> datetime:
    """The first window start after `now` under a rule that was just changed, outside the
    period a window of the schedule already started in (`last_window`): moving today's window
    later does not collect today twice."""
    candidate = next_occurrence(rule, now)
    if last_window is None:
        return candidate
    done = _period(rule, last_window)
    while _period(rule, candidate) == done:
        candidate = next_occurrence(rule, candidate)
    return candidate


def occurrences_until(rule: ScheduleRule, first: datetime, now: datetime) -> list[datetime]:
    """The window starts from `first` up to `now`, oldest first. `first` is an occurrence itself
    (a schedule's `next_run_at`); the list is empty while it is still in the future."""
    found = []
    current = first
    while current <= now:
        found.append(current)
        current = next_occurrence(rule, current)
    return found
