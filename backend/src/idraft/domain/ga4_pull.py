"""Where the GA4 pull of a property has got to, kept in `fp.integrations.backfill_state["ga4"]`
(docs/18 section 7.2), and which days the next run asks for.

The first run reads the last 90 days. Every later run reads the last 3 days again, because GA4
restates recent days; after a gap (the worker was down, the property failed for days) it starts at
the last day it had pulled, so no day between is left out. A run always ends yesterday: today is
partial.

Nothing here reads a clock or a database.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from typing import Any, Final

VERSION: Final = 1
FIRST_PULL_DAYS: Final = 90
TRAILING_DAYS: Final = 3
# A run that failed is tried again by the planner after this long, growing to the last value.
RETRY_MINUTES: Final = (15, 30, 60)


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
class Ga4PullState:
    # The last day of the window of the last run that stored its numbers.
    through: date | None = None
    # A run has stored its window, so later runs need only the trailing days.
    complete: bool = False
    # Runs that ended in an error since the last one that did not.
    failures: int = 0
    retry_at: datetime | None = None

    @classmethod
    def read(cls, backfill_state: Mapping[str, Any] | None) -> Ga4PullState:
        """The state in an integration's `backfill_state`. Anything that is not a state of this
        version reads as a pull not begun: a run replaces its window, so it can start over."""
        found = (backfill_state or {}).get("ga4")
        if not isinstance(found, dict) or found.get("version") != VERSION:
            return cls()
        return cls(
            through=_date(found.get("through")),
            complete=found.get("complete") is True,
            failures=_count(found.get("failures")),
            retry_at=_time(found.get("retry_at")),
        )

    def write(self, backfill_state: Mapping[str, Any] | None) -> dict[str, Any]:
        """`backfill_state` with this state in place of the old one; other keys are kept."""
        return {
            **(backfill_state or {}),
            "ga4": {
                "version": VERSION,
                "through": None if self.through is None else self.through.isoformat(),
                "complete": self.complete,
                "failures": self.failures,
                "retry_at": None if self.retry_at is None else self.retry_at.isoformat(),
            },
        }

    def window(self, today: date) -> tuple[date, date]:
        """The first and last day the next run asks for, `today` being the property's date."""
        end = today - timedelta(days=1)
        first = end - timedelta(days=FIRST_PULL_DAYS - 1)
        if not self.complete or self.through is None:
            return first, end
        # Normally `through` is the day before `end`, which gives the trailing days; after a gap
        # the run starts one day before the last day it had, since GA4 restates it.
        start = min(end - timedelta(days=TRAILING_DAYS - 1), self.through - timedelta(days=1))
        return max(start, first), end

    def succeeded(self, through: date) -> Ga4PullState:
        return replace(self, through=through, complete=True, failures=0, retry_at=None)

    def failed(self, now: datetime) -> Ga4PullState:
        failures = self.failures + 1
        minutes = RETRY_MINUTES[min(failures, len(RETRY_MINUTES)) - 1]
        return replace(self, failures=failures, retry_at=now + timedelta(minutes=minutes))

    def retry_due(self, now: datetime) -> bool:
        return self.retry_at is None or self.retry_at <= now
