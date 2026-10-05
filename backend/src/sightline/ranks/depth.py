"""How deep a tracked keyword is checked on a given day (docs/06 section 2.2).

The profile, not a single depth, drives the planner. The daily profiles check a shallow depth
every day and a deep check of the top 100 on the project's deep-check weekday, where it replaces
the daily check (it contains the top 20); the weekly profiles check on that weekday only.
"""

from __future__ import annotations

from typing import Final

DEEP: Final = 100
# profile -> (daily depth, depth on the deep-check weekday); None is no check that day.
_PROFILES: Final[dict[str, tuple[int | None, int | None]]] = {
    "light": (10, DEEP),
    "standard": (20, DEEP),
    "deep": (50, DEEP),
    "full": (DEEP, DEEP),
    "weekly": (None, DEEP),
    "weekly_light": (None, 20),
}
# Not offered yet: it needs `stop_crawl_on_match`, which the adapter does not send (docs/06
# section 2.3). The API refuses it; a keyword that has it anyway is not planned.
UNAVAILABLE: Final = frozenset({"until_own_match_100"})


def depth_for(profile: str, *, deep_day: bool) -> int | None:
    """The depth to check at, or None when the profile has no check today. Raises `ValueError`
    for a profile this planner does not know, so a new one is not silently skipped."""
    try:
        daily, deep = _PROFILES[profile]
    except KeyError:
        if profile in UNAVAILABLE:
            return None
        raise ValueError(f"unknown depth profile {profile!r}") from None
    return deep if deep_day else daily


def pages(depth: int) -> int:
    """How many result pages of ten a depth is billed as."""
    return -(-depth // 10)
