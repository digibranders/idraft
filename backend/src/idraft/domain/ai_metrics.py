"""When a weekly point of the AI prompts summary holds more than its own week, and which days it
holds (contract C2, change log C-11). Nothing here reads a clock or a database."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Final

# A point of a topic, total or country row pools when fewer prompts than this answered that week
# (owner decision D-04).
POOL_BELOW_PROMPTS: Final = 10
# A pooled point holds its own week and the weeks before it, this many in all.
POOL_WEEKS: Final = 4


def pools(*, prompt_row: bool, prompts: int) -> bool:
    """Whether a weekly point is pooled: always on a prompt row, and on a row of many prompts
    when too few of them answered that week."""
    return prompt_row or prompts < POOL_BELOW_PROMPTS


def pool_window(week: date, first: date, last: date) -> tuple[date, date, int]:
    """The days a pooled point holds, and how many weeks they touch: the Monday `week` and the
    `POOL_WEEKS - 1` before it, never before `first` nor after `last`, the days of the window."""
    try:
        start = max(first, week - timedelta(weeks=POOL_WEEKS - 1))
    except OverflowError:  # Before the first day of the calendar: the window opens inside it.
        start = first
    try:
        end = min(last, week + timedelta(days=6))
    except OverflowError:  # After the last day of the calendar: the window closes inside it.
        end = last
    return start, end, (week - (start - timedelta(days=start.weekday()))).days // 7 + 1
