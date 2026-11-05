"""Where the Search Console pull of a property has got to, kept in `fp.integrations.
backfill_state["gsc"]` (docs/18 section 4.3).

The pull works in this order: the 28 final days that end on the latest final day, so the Rankings
columns fill within minutes; then the days before them, oldest first, because the oldest day
leaves Google's 16 months first and must be captured first (`history_next` walks forward to
`history_until`); and on later runs the trailing days that were not final yet. The same state
tells the reading side whether a window exists (`recent_done`) and where it ends (`window_end`).

Nothing here reads a clock or a database.
"""

from __future__ import annotations

import calendar
from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from typing import Any, Final

# Version 2 (2026-11-05): the numbers are pulled without the page dimension, so a state of version 1
# reads as a pull not begun and every day is fetched again in the new shape.
VERSION: Final = 2
# The `url_id` of every stored row: the numbers of a query over all the pages of the property, as
# Search Console counts them. With the page dimension a search that shows two pages of the site
# counts an impression for each page, so summing pages overstates impressions (verified 2026-11-05
# against `searchAnalytics.query`: one query summed to 330 by page and is 92 without it).
ALL_PAGES: Final = 0
# The Rankings columns sum this many final days (docs/18 section 4.9).
WINDOW_DAYS: Final = 28
# A later run looks this far back for days that have become final since the last one.
TRAILING_DAYS: Final = 10
# Search Console keeps 16 months. The oldest day we ask for is two days inside them, so a day that
# leaves the window between the probe and the call (and Pacific Time against UTC) is not asked for.
HISTORY_MONTHS: Final = 16
RANGE_MARGIN_DAYS: Final = 2
# Final data typically lands two to three days late (docs/18 section 4.4). Used only to place the
# window of a property that has no data at all, where every window sums to zero.
FINAL_LAG_DAYS: Final = 3
# A pass that failed is tried again by the planner after this long, doubling to the cap.
RETRY_MINUTES: Final = (15, 30, 60)


def history_start(today: date) -> date:
    """The oldest day the pull asks Search Console for."""
    index = today.year * 12 + (today.month - 1) - HISTORY_MONTHS
    year, month = divmod(index, 12)
    month += 1
    day = min(today.day, calendar.monthrange(year, month)[1])
    return date(year, month, day) + timedelta(days=RANGE_MARGIN_DAYS)


def window_of(end: date) -> tuple[date, date]:
    """The 28 days that end on `end`."""
    return end - timedelta(days=WINDOW_DAYS - 1), end


def _date(value: object) -> date | None:
    if isinstance(value, str):
        try:
            return date.fromisoformat(value)
        except ValueError:
            return None
    return None


def _time(value: object) -> datetime | None:
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError:
            return None
        return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)
    return None


def _count(value: object) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0


@dataclass(frozen=True, slots=True)
class PullState:
    # The 28 days that end on `window_end` are stored.
    recent_done: bool = False
    # The latest final day that the last complete pass reached.
    window_end: date | None = None
    # The next day of the oldest-first sweep, and the day it stops before.
    history_next: date | None = None
    history_until: date | None = None
    # The sweep has reached `history_until`.
    complete: bool = False
    days_stored: int = 0
    rows_stored: int = 0
    oldest_day: date | None = None
    # Passes that ended in an error since the last one that did not.
    failures: int = 0
    retry_after: datetime | None = None

    @classmethod
    def read(cls, backfill_state: Mapping[str, Any] | None) -> PullState:
        """The state in an integration's `backfill_state`. Anything that is not a state of this
        version reads as a pull not begun: the pull is idempotent, so it starts over."""
        found = (backfill_state or {}).get("gsc")
        if not isinstance(found, dict) or found.get("version") != VERSION:
            return cls()
        return cls(
            recent_done=found.get("recent_done") is True,
            window_end=_date(found.get("window_end")),
            history_next=_date(found.get("history_next")),
            history_until=_date(found.get("history_until")),
            complete=found.get("complete") is True,
            days_stored=_count(found.get("days_stored")),
            rows_stored=_count(found.get("rows_stored")),
            oldest_day=_date(found.get("oldest_day")),
            failures=_count(found.get("failures")),
            retry_after=_time(found.get("retry_after")),
        )

    def write(self, backfill_state: Mapping[str, Any] | None) -> dict[str, Any]:
        """`backfill_state` with this state in place of the old one; other keys are kept."""
        return {
            **(backfill_state or {}),
            "gsc": {
                "version": VERSION,
                "recent_done": self.recent_done,
                "window_end": None if self.window_end is None else self.window_end.isoformat(),
                "history_next": (
                    None if self.history_next is None else self.history_next.isoformat()
                ),
                "history_until": (
                    None if self.history_until is None else self.history_until.isoformat()
                ),
                "complete": self.complete,
                "days_stored": self.days_stored,
                "rows_stored": self.rows_stored,
                "oldest_day": None if self.oldest_day is None else self.oldest_day.isoformat(),
                "failures": self.failures,
                "retry_after": None if self.retry_after is None else self.retry_after.isoformat(),
            },
        }

    @property
    def window(self) -> tuple[date, date] | None:
        """The days the Rankings columns sum, once they are all stored."""
        if not self.recent_done or self.window_end is None:
            return None
        return window_of(self.window_end)

    def stored_day(self, day: date, *, replaced_rows: int, rows: int) -> PullState:
        """The state after one day was written, `replaced_rows` of an earlier write removed."""
        return replace(
            self,
            days_stored=self.days_stored + (1 if rows and not replaced_rows else 0),
            rows_stored=max(0, self.rows_stored + rows - replaced_rows),
            oldest_day=day if self.oldest_day is None else min(self.oldest_day, day),
        )

    def failed(self, now: datetime) -> PullState:
        failures = self.failures + 1
        minutes = RETRY_MINUTES[min(failures, len(RETRY_MINUTES)) - 1]
        return replace(self, failures=failures, retry_after=now + timedelta(minutes=minutes))

    def succeeded(self) -> PullState:
        return replace(self, failures=0, retry_after=None)

    def retry_due(self, now: datetime) -> bool:
        return self.retry_after is None or self.retry_after <= now
