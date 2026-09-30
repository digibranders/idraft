"""Rate limits on provider calls (docs/21-scheduler-workers.md section 7). Real Redis."""

import asyncio
import time
from datetime import timedelta

import pytest
from redis.asyncio import Redis

from sightline.providers.contract import GateUnavailableError, Limit
from sightline.worker.limiter import SLOW_FOR, RedisCallGate

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


async def _seconds_for(gate: RedisCallGate, turns: int) -> float:
    started = time.monotonic()
    for _ in range(turns):
        assert await gate.enter(None, within=SECOND)
    return time.monotonic() - started


def test_a_limit_refills_at_what_the_minute_leaves_after_its_burst() -> None:
    limit = Limit(per_minute=20, burst=2)
    assert limit.refill_per_minute == 18
    for burst, per_minute in ((0, 20), (20, 20), (21, 20)):
        with pytest.raises(ValueError, match="burst"):
            Limit(per_minute=per_minute, burst=burst)


async def test_a_burst_goes_through_at_once_and_then_calls_wait_their_turn(redis: Redis) -> None:
    gate = _gate(redis)

    assert await _taken(gate) == 5
    assert not await gate.enter(None, within=NOW)
    # 600 a minute less the burst: the next turn is about a tenth of a second away.
    assert await gate.enter(None, within=SECOND)


async def test_over_a_window_no_more_calls_go_through_than_the_limit(redis: Redis) -> None:
    gate = _gate(redis, per_minute=120, burst=4)
    finish = time.monotonic() + 2.0
    calls = 0
    while time.monotonic() < finish:
        if await gate.enter(None, within=timedelta(seconds=finish - time.monotonic())):
            calls += 1

    # The burst, and 116 a minute for at most two seconds: 4 + 3.87, so 7. Refilling at the
    # 120 a minute of the whole limit would let an eighth through.
    assert 5 <= calls <= 7


async def test_an_idle_bucket_holds_no_more_than_its_burst(redis: Redis) -> None:
    gate = _gate(redis, per_minute=600, burst=3)
    assert await _taken(gate) == 3

    # Idle for twice what refilling the burst takes: the tokens beyond it are not banked.
    await asyncio.sleep(0.6)

    assert await _taken(gate) == 3


async def test_a_call_that_would_wait_past_its_deadline_is_not_made(redis: Redis) -> None:
    gate = _gate(redis, per_minute=60, burst=1)
    assert await gate.enter(None, within=NOW)

    started = time.monotonic()
    assert not await gate.enter(None, within=timedelta(milliseconds=100))
    # It knew at once that no turn would come in time.
    # Waiting would take about a second; returning well before shows it did not wait.
    assert time.monotonic() - started < 0.5


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
    # The family's bucket was not touched by a call that was not made.
    assert await redis.hget("rl:fake:tasks_ready", "tokens") is None


async def test_a_family_with_no_limit_is_a_mistake(redis: Redis) -> None:
    with pytest.raises(KeyError, match="no limit for 'errors'"):
        await _gate(redis).enter("errors", within=NOW)


@pytest.mark.parametrize("family", ["all", "slow", "", "x:slow"])
async def test_a_family_cannot_take_the_name_of_another_key(redis: Redis, family: str) -> None:
    with pytest.raises(ValueError, match="cannot name a family"):
        RedisCallGate(
            redis,
            "fake",
            all_calls=Limit(per_minute=600, burst=5),
            families={family: Limit(per_minute=20, burst=2)},
        )


async def test_after_a_rate_limit_every_limit_is_halved_for_a_while(redis: Redis) -> None:
    gate = _gate(redis, per_minute=610, burst=10, tasks_ready=Limit(per_minute=20, burst=4))

    await gate.slow_down()

    # Half of each burst: the provider did not say which limit it meant.
    assert await _taken(gate, "tasks_ready") == 2
    assert await _taken(gate) == 3
    # And half the rate: turns come about every 200 ms instead of every 100 ms.
    slow = await _seconds_for(gate, 3)
    await redis.delete("rl:fake:slow")
    await _taken(gate)
    normal = await _seconds_for(gate, 3)
    assert slow > 1.5 * normal


async def test_the_slow_down_lapses_by_itself(redis: Redis) -> None:
    await _gate(redis).slow_down()

    left = await redis.pttl("rl:fake:slow")
    assert SLOW_FOR.total_seconds() * 1000 - 5_000 < left <= SLOW_FOR.total_seconds() * 1000


async def test_a_clock_that_stepped_back_does_not_stop_the_calls(redis: Redis) -> None:
    gate = _gate(redis)
    # A bucket last written a minute "later" than Redis's clock now says.
    (seconds, micros) = await redis.time()
    ahead = seconds * 1000 + micros // 1000 + 60_000
    await redis.hset("rl:fake:all", mapping={"tokens": "0", "at": str(ahead)})

    assert await gate.enter(None, within=SECOND)


async def test_a_limiter_that_cannot_be_reached_says_so(redis: Redis) -> None:
    unreachable = Redis(host="127.0.0.1", port=1, socket_connect_timeout=0.2)
    gate = _gate(unreachable)

    with pytest.raises(GateUnavailableError):
        await gate.enter(None, within=NOW)
    with pytest.raises(GateUnavailableError):
        await gate.slow_down()
    await unreachable.aclose()


async def test_the_limits_live_under_the_prefix_the_redis_user_may_write(redis: Redis) -> None:
    gate = _gate(redis, tasks_ready=Limit(per_minute=20, burst=2))
    await gate.enter("tasks_ready", within=NOW)
    await gate.slow_down()

    keys = sorted([key.decode() async for key in redis.scan_iter("*")])
    assert keys == ["rl:fake:all", "rl:fake:slow", "rl:fake:tasks_ready"]
    # Idle buckets do not stay for ever.
    assert 0 < await redis.pttl("rl:fake:all") <= 120_000
