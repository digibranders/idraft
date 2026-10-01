"""When a schedule's windows start (docs/21-scheduler-workers.md section 3)."""

from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from hypothesis import given
from hypothesis import strategies as st

from sightline.domain.schedules import (
    MONTH_DAY_MAX,
    Cadence,
    ScheduleRule,
    next_occurrence,
    occurrences_until,
)

ZONES = ["UTC", "Asia/Kolkata", "America/New_York", "Europe/Berlin", "Australia/Lord_Howe"]
instants = st.datetimes(
    min_value=datetime(2024, 1, 1), max_value=datetime(2030, 12, 31), timezones=st.just(UTC)
)
local_times = st.times(min_value=time(0, 0), max_value=time(23, 59)).map(
    lambda value: value.replace(second=0, microsecond=0)
)


@st.composite
def rules(draw: st.DrawFn) -> ScheduleRule:
    cadence = draw(st.sampled_from(list(Cadence)))
    return ScheduleRule(
        cadence=cadence,
        timezone=draw(st.sampled_from(ZONES)),
        window_start_local=draw(local_times),
        weekday=draw(st.integers(0, 6)) if cadence is Cadence.WEEKLY else None,
        month_day=draw(st.integers(1, MONTH_DAY_MAX)) if cadence is Cadence.MONTHLY else None,
    )


def _daily(zone: str, at: time) -> ScheduleRule:
    return ScheduleRule(cadence=Cadence.DAILY, timezone=zone, window_start_local=at)


def _utc(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=UTC)


@given(rule=rules(), after=instants)
def test_the_next_window_is_after_the_instant_and_none_lies_between(
    rule: ScheduleRule, after: datetime
) -> None:
    found = next_occurrence(rule, after)

    assert found > after
    assert found.tzinfo is UTC
    # Nothing was skipped: asking again from just before it gives the same window.
    assert next_occurrence(rule, found - timedelta(seconds=1)) == found
    # The longest wait is a full period plus the hour a clock change can add in these zones.
    limit = {Cadence.DAILY: 1, Cadence.WEEKLY: 7, Cadence.MONTHLY: 31}[rule.cadence]
    assert found - after <= timedelta(days=limit, hours=1)


@given(rule=rules(), after=instants)
def test_a_window_starts_on_the_day_and_at_the_time_the_rule_names(
    rule: ScheduleRule, after: datetime
) -> None:
    local = next_occurrence(rule, after).astimezone(ZoneInfo(rule.timezone))

    if rule.cadence is Cadence.WEEKLY:
        assert local.isoweekday() % 7 == rule.weekday
    if rule.cadence is Cadence.MONTHLY:
        assert local.day == rule.month_day
    # At the local time, or later by the size of a clock change (at most an hour here).
    wanted = local.replace(hour=rule.window_start_local.hour, minute=rule.window_start_local.minute)
    assert (
        timedelta(0)
        <= local.replace(tzinfo=None) - wanted.replace(tzinfo=None)
        <= timedelta(hours=1)
    )


@given(rule=rules(), first=instants, days=st.integers(0, 70))
def test_the_windows_up_to_now_are_in_order_and_complete(
    rule: ScheduleRule, first: datetime, days: int
) -> None:
    start = next_occurrence(rule, first)
    now = start + timedelta(days=days)

    found = occurrences_until(rule, start, now)

    assert found[0] == start
    assert found == sorted(set(found))
    assert found[-1] <= now < next_occurrence(rule, found[-1])
    assert occurrences_until(rule, start, start - timedelta(seconds=1)) == []


def test_a_daily_window_in_india_is_the_same_utc_time_every_day() -> None:
    rule = _daily("Asia/Kolkata", time(2, 0))
    first = next_occurrence(rule, _utc("2026-09-30T00:00:00"))
    assert first == _utc("2026-09-30T20:30:00")
    assert next_occurrence(rule, first) == _utc("2026-10-01T20:30:00")
    # An instant that is exactly a window start is not "after" itself.
    assert next_occurrence(rule, first - timedelta(microseconds=1)) == first


def test_a_window_keeps_its_local_time_across_a_clock_change() -> None:
    rule = _daily("America/New_York", time(1, 0))
    # Clocks go back on 2026-11-01: 01:00 happens twice, and the window is the first.
    before = next_occurrence(rule, _utc("2026-10-31T06:00:00"))
    after = next_occurrence(rule, before)
    assert (before, after) == (_utc("2026-11-01T05:00:00"), _utc("2026-11-02T06:00:00"))
    assert after - before == timedelta(hours=25)


def test_a_local_time_that_a_clock_change_skips_starts_later_by_the_gap() -> None:
    rule = _daily("America/New_York", time(2, 30))
    # Clocks go forward on 2026-03-08: 02:30 does not exist that day.
    days = occurrences_until(rule, _utc("2026-03-07T07:30:00"), _utc("2026-03-09T12:00:00"))
    local = [day.astimezone(ZoneInfo("America/New_York")).strftime("%d %H:%M") for day in days]
    assert local == ["07 02:30", "08 03:30", "09 02:30"]


def test_the_fold_of_the_rules_time_has_no_say_in_a_clock_change() -> None:
    """A `time` can carry `fold=1`. The rule for skipped and repeated times is the schedule's,
    not the value's."""
    skipped = _daily("America/New_York", time(2, 30, fold=1))
    repeated = _daily("America/New_York", time(1, 0, fold=1))
    # 02:30 does not exist on 2026-03-08: the window is at 03:30 EDT.
    assert next_occurrence(skipped, _utc("2026-03-08T05:00:00")) == _utc("2026-03-08T07:30:00")
    # 01:00 happens twice on 2026-11-01: the window is the first, in EDT.
    assert next_occurrence(repeated, _utc("2026-11-01T04:00:00")) == _utc("2026-11-01T05:00:00")


def test_a_window_that_a_clock_change_moves_past_midnight_is_not_lost() -> None:
    """In Nuuk clocks go from 23:00 on Saturday 2026-03-28 to 00:00 on Sunday. A window at
    23:30 that Saturday starts at 00:30 on Sunday, local time."""
    rule = _daily("America/Nuuk", time(23, 30))
    nuuk = ZoneInfo("America/Nuuk")

    moved = next_occurrence(rule, _utc("2026-03-28T12:00:00"))
    assert moved.astimezone(nuuk).strftime("%d %H:%M") == "29 00:30"
    # Asked from Sunday, ten minutes after midnight: Saturday's window is still ahead.
    assert next_occurrence(rule, _utc("2026-03-29T01:10:00")) == moved
    following = next_occurrence(rule, moved)
    assert following.astimezone(nuuk).strftime("%d %H:%M") == "29 23:30"


def test_a_weekly_window_falls_on_its_weekday_with_sunday_as_zero() -> None:
    sunday = ScheduleRule(
        cadence=Cadence.WEEKLY, timezone="UTC", window_start_local=time(1, 0), weekday=0
    )
    thursday = ScheduleRule(
        cadence=Cadence.WEEKLY, timezone="UTC", window_start_local=time(1, 0), weekday=4
    )
    # 2026-09-30 is a Wednesday.
    assert next_occurrence(sunday, _utc("2026-09-30T00:00:00")) == _utc("2026-10-04T01:00:00")
    assert next_occurrence(thursday, _utc("2026-09-30T00:00:00")) == _utc("2026-10-01T01:00:00")
    assert next_occurrence(thursday, _utc("2026-10-01T01:00:00")) == _utc("2026-10-08T01:00:00")


def test_a_monthly_window_falls_on_its_day_in_every_month() -> None:
    rule = ScheduleRule(
        cadence=Cadence.MONTHLY, timezone="UTC", window_start_local=time(3, 0), month_day=20
    )
    found = occurrences_until(rule, _utc("2026-01-20T03:00:00"), _utc("2026-04-25T00:00:00"))
    assert [day.strftime("%m-%d") for day in found] == ["01-20", "02-20", "03-20", "04-20"]


@pytest.mark.parametrize(
    ("fields", "reason"),
    [
        ({"cadence": Cadence.WEEKLY}, "a weekly rule names its weekday"),
        ({"cadence": Cadence.DAILY, "weekday": 1}, "a weekly rule names its weekday"),
        ({"cadence": Cadence.WEEKLY, "weekday": 7}, "weekday is 0"),
        ({"cadence": Cadence.MONTHLY}, "a monthly rule names its day"),
        ({"cadence": Cadence.DAILY, "month_day": 5}, "a monthly rule names its day"),
        # A month may have no 29th, so the rule would have no window that month.
        ({"cadence": Cadence.MONTHLY, "month_day": 29}, "the day of the month is 1 to 28"),
        ({"cadence": Cadence.MONTHLY, "month_day": 0}, "the day of the month is 1 to 28"),
        ({"cadence": Cadence.DAILY, "timezone": "Mars/Olympus"}, "unknown time zone"),
        ({"cadence": Cadence.DAILY, "timezone": ""}, "unknown time zone"),
        ({"cadence": Cadence.DAILY, "timezone": "../etc/passwd"}, "unknown time zone"),
        (
            {"cadence": Cadence.DAILY, "window_start_local": time(2, 0, tzinfo=UTC)},
            "carries no zone",
        ),
        # `ops.schedules.cadence` also allows `cron`, which has no rule here yet.
        ({"cadence": "cron"}, "the cadence is daily, weekly or monthly"),
        ({"cadence": "daily"}, "the cadence is daily, weekly or monthly"),
    ],
)
def test_a_rule_that_makes_no_sense_is_refused(fields: dict[str, object], reason: str) -> None:
    values: dict[str, object] = {"timezone": "UTC", "window_start_local": time(2, 0), **fields}
    with pytest.raises(ValueError, match=reason):
        ScheduleRule(**values)  # type: ignore[arg-type]


def test_the_instant_asked_about_must_carry_a_zone() -> None:
    with pytest.raises(ValueError, match="aware"):
        next_occurrence(_daily("UTC", time(2, 0)), datetime(2026, 9, 30))
