"""What a crawl changed against the one before it (spec 7.10), and the alert for links lost to
important pages. Pure; the mock's `linkChanges`, `lostToTop`, `alertsFor` and `pageDelta` are
the reference."""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Final, Literal

type Priority = Literal["lost_to_t1", "lost_to_t2", "lower"]
type DepthState = Literal["lost", "found"]
CHANNELS: Final = ("app", "email", "slack")
# A crawl's stored changes stop here per scope; the API says so when a list was cut.
CHANGES_MAX: Final = 200_000


def priority_of(position: int | None) -> Priority:
    """The Priority cell of a lost link, from the tier position of its target (None is
    Untiered)."""
    if position == 1:
        return "lost_to_t1"
    if position == 2:
        return "lost_to_t2"
    return "lower"


def is_top(position: int | None, max_position: int) -> bool:
    """A target that counts as important: tier position 1 up to `max_position`."""
    return position is not None and 1 <= position <= max_position


def equity_points(now: float | None, before: float | None) -> float:
    """Change of equity share in points, one decimal (0.0312 against 0.0201 is 1.1)."""
    # Half rounds up, as the mock's Math.round does; Python's round() goes to the even number.
    points = math.floor(((now or 0.0) - (before or 0.0)) * 1000 + 0.5) / 10
    return points + 0.0  # turns -0.0 into 0.0


def depth_change(was: int | None, now: int | None) -> tuple[DepthState | None, int | None]:
    """(state, levels). A page one crawl reaches and the other does not has a state and no
    number; otherwise the number of levels deeper (positive) or shallower (negative)."""
    if was is None and now is None:
        return None, None
    if was is None:
        return "found", None
    if now is None:
        return "lost", None
    return None, now - was


@dataclass(frozen=True, slots=True)
class AlertSettings:
    enabled: bool
    max_position: int
    threshold: int
    channel: str


def _bounded(value: object, low: int, high: int, default: int) -> int:
    """`value` when it is a whole number in range; a JSON `true` is not one."""
    if isinstance(value, int) and not isinstance(value, bool) and low <= value <= high:
        return value
    return default


def alert_settings(stored: Mapping[str, Any] | None) -> AlertSettings:
    """The project's `internal_links.alerts` with defaults; a bad stored value falls back to
    its default, so a hand-edited setting never stops an evaluation."""
    found = stored.get("alerts") if isinstance(stored, Mapping) else None
    given: Mapping[str, Any] = found if isinstance(found, Mapping) else {}
    channel = given.get("channel")
    return AlertSettings(
        enabled=given.get("enabled") is not False,
        max_position=_bounded(given.get("max_position"), 1, 8, 2),
        threshold=_bounded(given.get("threshold"), 1, 50, 1),
        channel=channel if channel in CHANNELS else "app",
    )


def alert_due(lost_to_top: int, settings: AlertSettings) -> bool:
    return settings.enabled and lost_to_top >= settings.threshold
