"""Rate limits on provider calls (docs/21-scheduler-workers.md section 7). Real Redis."""

import asyncio
import time
from datetime import timedelta

import pytest
from redis.asyncio import Redis

from sightline.providers.contract import Limit
from sightline.worker import limiter
from sightline.worker.limiter import RedisCallGate

NOW = timedelta(0)
SECOND = timedelta(seconds=1)


def _gate(
    redis: Redis, *, per_minute: int = 600, burst: int = 5, **families: Limit
) -> RedisCallGate:
    return RedisCallGate(
        redis, "fake", all_calls=Limit(per_minute=per_minute, burst=burst), families=families
    )


async def _taken(gate: RedisCallGate, family: str | None = None) -> int:
    """How many calls get a turn at once, without waiting."""
    count = 0
    while await gate.enter(family, within=NOW):
        count += 1
    return count


def test_a_limit_refills_at_what_the_minute_leaves_after_its_burst() -> None:
    limit = Limit(per_minute=20, burst=2)
    assert limit.refill_per_minute == 18
    for burst, per_minute in ((0, 20), (20, 20), (21, 20)):
        with pytest.raises(ValueError, match="burst"):
            Limit(per_minute=per_minute, burst=burst)


async def test_a_burst_goes_through_at_once_and_then_calls_wait_their_turn(redis: Redis) -> None:
    # 600 a minute with a burst of 5: then one every tenth of a second or so.
    gate = _gate(redis)

    assert await _taken(gate) == 5
    started = time.monotonic()
    assert await gate.enter(None, within=SECOND)
    waited = time.monotonic() - started
    assert 0.05 < waited < 0.5


async def test_over_a_window_no_more_calls_go_through_than_the_limit(redis: Redis) -> None:
    gate = _gate(redis, per_minute=120, burst=4)
    finish = time.monotonic() + 2.0
    calls = 0
    while time.monotonic() < finish:
        if await gate.enter(None, within=timedelta(seconds=finish - time.monotonic())):
            calls += 1

    # The burst, and 116 a minute for two seconds: about 7 or 8, never the 120 a minute
    # would allow if the burst were not taken from it.
    assert 5 <= calls <= 4 + 116 * 2 / 60 + 1


async def test_a_call_that_would_wait_past_its_deadline_is_not_made(redis: Redis) -> None:
    gate = _gate(redis, per_minute=60, burst=1)
    assert await gate.enter(None, within=NOW)

    started = time.monotonic()
    assert not await gate.enter(None, within=timedelta(milliseconds=100))
    # It knew at once that no turn would come in time.
    assert time.monotonic() - started < 0.1


async def test_workers_share_one_limit(redis: Redis) -> None:
    first, second = _gate(redis, burst=6), _gate(redis, burst=6)

    assert await _taken(first) + await _taken(second) == 6


async def test_a_family_has_its_own_limit_and_takes_from_the_one_on_all_calls(
    redis: Redis,
) -> None:
    gate = _gate(redis, burst=5, tasks_ready=Limit(per_minute=20, burst=2))

    # The family's burst of two, taken from the five of all calls too.
    assert await _taken(gate, "tasks_ready") == 2
    assert await _taken(gate) == 3


async def test_a_family_waits_for_both_limits_and_takes_from_neither_while_it_waits(
    redis: Redis,
) -> None:
    gate = _gate(redis, burst=2, tasks_ready=Limit(per_minute=20, burst=2))
    assert await _taken(gate) == 2

    assert not await gate.enter("tasks_ready", within=NOW)
    # The family's own tokens were not spent on a call that was not made.
    state = await redis.hget("rl:fake:tasks_ready", "tokens")
    assert state is None or float(state) >= 1


async def test_a_family_with_no_limit_is_a_mistake(redis: Redis) -> None:
    with pytest.raises(KeyError, match="no limit for 'errors'"):
        await _gate(redis).enter("errors", within=NOW)


async def test_after_a_rate_limit_calls_come_at_half_the_rate_for_a_while(
    redis: Redis, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(limiter, "SLOW_FOR", timedelta(milliseconds=600))
    gate = _gate(redis, per_minute=610, burst=10)
    await _taken(gate)

    await gate.slow_down()
    started = time.monotonic()
    assert await gate.enter(None, within=SECOND)
    slow = time.monotonic() - started
    assert 0.15 < slow < 0.4

    await asyncio.sleep(0.7)
    await _taken(gate)
    started = time.monotonic()
    assert await gate.enter(None, within=SECOND)
    # Back to the full rate: about a tenth of a second a call.
    assert time.monotonic() - started < 0.15


async def test_the_limits_live_under_the_prefix_the_redis_user_may_write(redis: Redis) -> None:
    gate = _gate(redis, tasks_ready=Limit(per_minute=20, burst=2))
    await gate.enter("tasks_ready", within=NOW)
    await gate.slow_down()

    keys = sorted([key.decode() async for key in redis.scan_iter("*")])
    assert keys == ["rl:fake:all", "rl:fake:all:slow", "rl:fake:tasks_ready"]
    # Idle buckets do not stay for ever.
    assert 0 < await redis.pttl("rl:fake:all") <= 120_000
