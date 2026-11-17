from __future__ import annotations

import pytest

from idraft.crawl.changes import (
    AlertSettings,
    alert_due,
    alert_settings,
    depth_change,
    equity_points,
    is_top,
    priority_of,
)


def test_priority_follows_the_target_tier_position() -> None:
    assert priority_of(1) == "lost_to_t1"
    assert priority_of(2) == "lost_to_t2"
    assert priority_of(3) == "lower"
    assert priority_of(None) == "lower"


def test_a_target_is_top_up_to_the_setting_and_untiered_never_is() -> None:
    assert is_top(1, 2)
    assert is_top(2, 2)
    assert not is_top(3, 2)
    assert not is_top(None, 2)


def test_equity_points_are_rounded_to_one_decimal_and_never_negative_zero() -> None:
    assert equity_points(0.0312, 0.0201) == 1.1
    assert equity_points(0.02, 0.02) == 0.0
    assert str(equity_points(0.02, 0.0200001)) == "0.0"
    assert equity_points(None, 0.5) == -50.0


@pytest.mark.parametrize(
    ("was", "now", "expected"),
    [
        (3, 5, (None, 2)),
        (5, 3, (None, -2)),
        (3, 3, (None, 0)),
        (None, 4, ("found", None)),
        (4, None, ("lost", None)),
        (None, None, (None, None)),
    ],
)
def test_depth_change(
    was: int | None, now: int | None, expected: tuple[str | None, int | None]
) -> None:
    assert depth_change(was, now) == expected


def test_settings_have_defaults_and_ignore_bad_stored_values() -> None:
    assert alert_settings(None) == AlertSettings(True, 2, 1, "app")
    stored = {"alerts": {"enabled": False, "max_position": 1, "threshold": 5, "channel": "slack"}}
    assert alert_settings(stored) == AlertSettings(False, 1, 5, "slack")
    assert alert_settings({"alerts": {"max_position": 99, "threshold": 0}}) == AlertSettings(
        True, 2, 1, "app"
    )
    assert alert_settings({"alerts": {"max_position": True, "threshold": True}}) == AlertSettings(
        True, 2, 1, "app"
    )


def test_an_alert_is_due_when_enabled_and_the_count_reaches_the_threshold() -> None:
    settings = AlertSettings(True, 2, 3, "app")
    assert not alert_due(2, settings)
    assert alert_due(3, settings)
    assert not alert_due(9, AlertSettings(False, 2, 1, "app"))
