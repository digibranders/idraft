"""How deep a keyword is checked on a day (docs/06 section 2.2)."""

from __future__ import annotations

import pytest

from idraft.ranks.depth import depth_for, pages


@pytest.mark.parametrize(
    ("profile", "daily", "deep_day"),
    [
        ("light", 100, 100),
        ("standard", 100, 100),
        ("deep", 100, 100),
        ("full", 100, 100),
        ("weekly", None, 100),
        ("weekly_light", None, 100),
    ],
)
def test_each_profile_has_its_daily_and_its_deep_weekday_depth(
    profile: str, daily: int | None, deep_day: int
) -> None:
    assert depth_for(profile, deep_day=False) == daily
    assert depth_for(profile, deep_day=True) == deep_day


def test_no_profile_ever_checks_shallower_than_the_top_100() -> None:
    """A rank is a number up to 100 and beyond that "over 100": never "over 20" (2026-11-04)."""
    for profile in ("light", "standard", "deep", "full", "weekly", "weekly_light"):
        for deep_day in (False, True):
            depth = depth_for(profile, deep_day=deep_day)
            assert depth in (None, 100)


def test_the_deep_check_contains_the_daily_one() -> None:
    for profile in ("light", "standard", "deep", "full"):
        daily = depth_for(profile, deep_day=False)
        deep = depth_for(profile, deep_day=True)
        assert daily is not None
        assert deep is not None
        assert deep >= daily


def test_a_profile_that_is_not_offered_has_no_check() -> None:
    assert depth_for("until_own_match_100", deep_day=True) is None


def test_an_unknown_profile_is_an_error_not_a_skip() -> None:
    with pytest.raises(ValueError, match="unknown depth profile"):
        depth_for("hourly", deep_day=False)


@pytest.mark.parametrize(
    ("depth", "billed"), [(1, 1), (10, 1), (11, 2), (20, 2), (50, 5), (100, 10)]
)
def test_pages_are_billed_by_the_ten(depth: int, billed: int) -> None:
    assert pages(depth) == billed
