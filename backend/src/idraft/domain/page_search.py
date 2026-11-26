"""A page's Search Console numbers as the Search tab and Monitoring read them: the period, the
period compared with, the totals and the health verdict (`page_health_v1`, docs/32 section 6.1).

CTR is summed clicks over summed impressions. Average position is the sum of position times
impressions over the impressions of the rows that carry a position: Google's own definition,
never an average of days. Nothing here reads a clock or a database.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Final, Literal

MAX_DAYS: Final = 92
# A period given by its end alone is this long, as the window of the Clicks columns.
DEFAULT_DAYS: Final = 28
HEALTH_VERSION: Final = "page_health_v1"
LOST_MIN_CLICKS: Final = 25
LOW_CLICKS: Final = 30
LOW_IMPRESSIONS: Final = 300
MIN_CLICKS: Final = 25
MIN_IMPRESSIONS: Final = 500
SHARP_DROP: Final = -0.40
MOVE: Final = 0.10
CTR_FALL: Final = -0.15
POSITION_SHIFT: Final = 1.5
POSITION_MIN_IMPRESSIONS: Final = 100

type Compare = Literal["none", "previous_period", "previous_year"]
type Verdict = Literal[
    "no_data", "new", "lost", "low_data", "sharp_drop", "declining", "growing", "stable"
]
type Basis = Literal["clicks", "impressions"]


class WindowTooLargeError(ValueError):
    """A period of more than `MAX_DAYS` days."""


@dataclass(frozen=True, slots=True)
class Totals:
    clicks: int = 0
    impressions: int = 0
    position_sum: Decimal = Decimal(0)
    # The impressions of the rows that carried a position (rows stored before positions were
    # kept carry none).
    position_impressions: int = 0

    def __add__(self, other: Totals) -> Totals:
        return Totals(
            self.clicks + other.clicks,
            self.impressions + other.impressions,
            self.position_sum + other.position_sum,
            self.position_impressions + other.position_impressions,
        )

    @property
    def ctr(self) -> float | None:
        return self.clicks / self.impressions if self.impressions else None

    @property
    def position(self) -> float | None:
        if not self.position_impressions:
            return None
        return float(self.position_sum / self.position_impressions)


@dataclass(frozen=True, slots=True)
class Health:
    verdict: Verdict
    basis: Basis = "clicks"
    # The relative change of the basis metric per day; None where no change is stated.
    change: float | None = None
    # The difference of the basis metric, the compared period scaled to this one's length.
    absolute: float = 0.0
    # The change is 10% or more on numbers too small to count (docs/32 section 6.1).
    small: bool = False
    flags: tuple[str, ...] = ()


def days_of(first: date, last: date) -> int:
    return (last - first).days + 1


def last_full_month(final_through: date) -> tuple[date, date]:
    """The last calendar month that ends on or before the last final day."""
    if final_through.day == calendar.monthrange(final_through.year, final_through.month)[1]:
        return final_through.replace(day=1), final_through
    end = final_through.replace(day=1) - timedelta(days=1)
    return end.replace(day=1), end


def window_of(start: date | None, end: date | None, final_through: date) -> tuple[date, date]:
    """The period asked for, both days included, cut to the last final day. Neither date: the
    last full month. Raises `WindowTooLargeError` past `MAX_DAYS`, `ValueError` when the start
    is after the end."""
    if start is None and end is None:
        return last_full_month(final_through)
    last = min(end or final_through, final_through)
    first = start or last - timedelta(days=DEFAULT_DAYS - 1)
    if first > last:
        raise ValueError("the period starts after it ends")
    if days_of(first, last) > MAX_DAYS:
        raise WindowTooLargeError
    return first, last


def _is_calendar_month(first: date, last: date) -> bool:
    return (
        first.day == 1
        and (first.year, first.month) == (last.year, last.month)
        and last.day == calendar.monthrange(last.year, last.month)[1]
    )


def _year_before(day: date) -> date:
    try:
        return day.replace(year=day.year - 1)
    except ValueError:
        # 29 February of a leap year
        return day.replace(year=day.year - 1, day=28)


def compare_window(first: date, last: date, compare: Compare) -> tuple[date, date] | None:
    """The days compared with: a whole calendar month with the month before it, any other
    period with as many days just before it, or the same dates a year earlier."""
    if compare == "none":
        return None
    if compare == "previous_year":
        return _year_before(first), _year_before(last)
    if _is_calendar_month(first, last):
        end = first - timedelta(days=1)
        return end.replace(day=1), end
    return first - timedelta(days=days_of(first, last)), first - timedelta(days=1)


def _flags(cur: Totals, prev: Totals, cur_days: int, prev_days: int) -> tuple[str, ...]:
    if not cur.impressions or not prev.impressions:
        return ()
    flags: list[str] = []
    if prev.clicks:
        ctr = (cur.clicks / cur.impressions) / (prev.clicks / prev.impressions) - 1
        shown = (cur.impressions / cur_days) / (prev.impressions / prev_days) - 1
        if ctr <= CTR_FALL and shown >= MOVE:
            flags.append("ctr_fell_impressions_rose")
    now, before = cur.position, prev.position
    enough = min(cur.impressions, prev.impressions) >= POSITION_MIN_IMPRESSIONS
    if now is not None and before is not None and enough and abs(now - before) >= POSITION_SHIFT:
        flags.append("position_slipped" if now > before else "position_improved")
    return tuple(flags)


def health_of(cur: Totals, prev: Totals | None, cur_days: int, prev_days: int) -> Health:
    """The verdict, by the rules of docs/32 section 6.1 in their order."""
    if prev is None:
        return Health("stable" if cur.impressions else "no_data")
    if not cur.impressions and not prev.impressions:
        return Health("no_data")
    if not prev.impressions:
        return Health("new", absolute=float(cur.clicks))
    flags = _flags(cur, prev, cur_days, prev_days)
    if prev.clicks >= LOST_MIN_CLICKS and not cur.clicks:
        return Health("lost", change=-1.0, absolute=-float(prev.clicks), flags=flags)
    clicks = cur.clicks + prev.clicks
    if clicks < LOW_CLICKS and cur.impressions + prev.impressions < LOW_IMPRESSIONS:
        return Health("low_data", flags=flags)

    basis: Basis = "clicks" if clicks >= LOW_CLICKS else "impressions"
    minimum = MIN_CLICKS if basis == "clicks" else MIN_IMPRESSIONS
    now = cur.clicks if basis == "clicks" else cur.impressions
    before = prev.clicks if basis == "clicks" else prev.impressions
    change = (now / cur_days) / (before / prev_days) - 1 if before else 0.0
    absolute = now - before * cur_days / prev_days
    material = abs(absolute) >= minimum
    verdict: Verdict = "stable"
    small = False
    if material and change <= SHARP_DROP:
        verdict = "sharp_drop"
    elif material and change <= -MOVE:
        verdict = "declining"
    elif material and change >= MOVE:
        verdict = "growing"
    elif not material and abs(change) >= MOVE:
        verdict, small = "low_data", True
    return Health(verdict, basis, change, absolute, small, flags)
