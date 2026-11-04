"""How deep a tracked keyword is checked on a given day (docs/06 section 2.2).

The profile, not a single depth, drives the planner. Every check looks at the top 100, so a
rank is a number up to 100 and beyond that it is "over 100", never "over 20" or any other
shallow answer (decision of 2026-11-04). The daily profiles check every day; the weekly profile
checks on the project's deep-check weekday only. The profile names stay so keywords and
settings that carry them keep working.
"""

from __future__ import annotations

from typing import Final

DEEP: Final = 100
# profile -> (daily depth, depth on the deep-check weekday); None is no check that day.
_PROFILES: Final[dict[str, tuple[int | None, int | None]]] = {
    "light": (DEEP, DEEP),
    "standard": (DEEP, DEEP),
    "deep": (DEEP, DEEP),
    "full": (DEEP, DEEP),
    "weekly": (None, DEEP),
    "weekly_light": (None, DEEP),
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
