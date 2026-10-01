"""Work done on an interval (docs/21-scheduler-workers.md sections 3, 4 and 12)."""

import asyncio
import io
import json
from datetime import timedelta
from itertools import pairwise

import pytest
from redis.asyncio import Redis

from sightline.config.logging import configure_logging
from sightline.worker.ticks import Tick, run_tick
from tests.worker.conftest import eventually

FAST = timedelta(milliseconds=60)


async def _run_for(seconds: float, *ticks: Tick, redis: Redis) -> None:
    stop = asyncio.Event()
    running = [asyncio.create_task(run_tick(tick, redis, stop)) for tick in ticks]
    await asyncio.sleep(seconds)
    stop.set()
    await asyncio.gather(*running)


async def test_a_tick_runs_on_its_interval_until_asked_to_stop(redis: Redis) -> None:
    runs: list[float] = []

    async def action() -> None:
        runs.append(asyncio.get_running_loop().time())

    await _run_for(0.5, Tick(name="beat", interval=FAST, action=action), redis=redis)

    assert 5 <= len(runs) <= 9
    # Never sooner than the interval. How much later depends on how busy the machine is.
    gaps = [later - earlier for earlier, later in pairwise(runs)]
    assert all(gap >= 0.055 for gap in gaps), gaps
    count = len(runs)
    await asyncio.sleep(0.15)
    assert len(runs) == count


async def test_a_slow_run_does_not_shift_the_next_one_later_each_time(redis: Redis) -> None:
    runs: list[float] = []

    async def action() -> None:
        runs.append(asyncio.get_running_loop().time())
        await asyncio.sleep(0.04)

    await _run_for(0.5, Tick(name="beat", interval=FAST, action=action), redis=redis)

    # The interval is from start to start: about eight runs in half a second, not five.
    assert len(runs) >= 7


async def test_a_run_that_raises_is_logged_and_the_next_one_still_happens(redis: Redis) -> None:
    stream = io.StringIO()
    configure_logging(service="worker", version="test", level="info", stream=stream)
    runs = 0

    async def action() -> None:
        nonlocal runs
        runs += 1
        if runs == 1:
            raise RuntimeError("the database went away")

    await _run_for(0.3, Tick(name="planner", interval=FAST, action=action), redis=redis)

    assert runs >= 3
    (line,) = [json.loads(line) for line in stream.getvalue().splitlines() if "tick failed" in line]
    assert (line["tick"], line["level"], line["err"]["type"]) == (
        "planner",
        "error",
        "RuntimeError",
    )


async def test_with_two_processes_each_interval_has_one_run(redis: Redis) -> None:
    runs = {"a": 0, "b": 0}
    overlap = 0
    running = 0

    def action(who: str):  # type: ignore[no-untyped-def]
        async def run() -> None:
            nonlocal overlap, running
            running += 1
            overlap = max(overlap, running)
            runs[who] += 1
            await asyncio.sleep(0.01)
            running -= 1

        return run

    interval, ttl = timedelta(milliseconds=100), timedelta(milliseconds=90)
    await _run_for(
        0.55,
        Tick(name="planner", interval=interval, action=action("a"), lock_ttl=ttl),
        Tick(name="planner", interval=interval, action=action("b"), lock_ttl=ttl),
        redis=redis,
    )

    assert overlap == 1
    # Six intervals began in 0.55 s. Two unlocked runners would have made twelve runs.
    assert 5 <= runs["a"] + runs["b"] <= 7


async def test_the_lock_is_kept_after_a_run_and_released_when_the_process_stops(
    redis: Redis,
) -> None:
    stop = asyncio.Event()
    ran = asyncio.Event()

    async def action() -> None:
        ran.set()

    tick = Tick(
        name="planner", interval=timedelta(seconds=5), action=action, lock_ttl=timedelta(seconds=4)
    )
    running = asyncio.create_task(run_tick(tick, redis, stop))
    await asyncio.wait_for(ran.wait(), timeout=2)
    await asyncio.sleep(0.05)

    # The run is over and the lock is still there: a second process must not run this interval.
    assert await redis.exists("lock:planner")
    stop.set()
    await running
    # Released on the way out, so a restarted worker does not wait for it to expire.
    assert not await redis.exists("lock:planner")


async def test_stopping_does_not_wait_for_the_interval(redis: Redis) -> None:
    stop = asyncio.Event()
    ran = asyncio.Event()

    async def action() -> None:
        ran.set()

    running = asyncio.create_task(
        run_tick(Tick(name="beat", interval=timedelta(minutes=5), action=action), redis, stop)
    )
    await asyncio.wait_for(ran.wait(), timeout=2)

    stop.set()
    await asyncio.wait_for(running, timeout=1)


async def test_a_tick_without_redis_keeps_trying(redis_url: str) -> None:
    stream = io.StringIO()
    configure_logging(service="worker", version="test", level="info", stream=stream)
    unreachable = Redis.from_url("redis://127.0.0.1:1/0", socket_connect_timeout=0.05)
    runs = 0

    async def action() -> None:
        nonlocal runs
        runs += 1

    tick = Tick(name="planner", interval=FAST, action=action, lock_ttl=FAST / 2)
    await _run_for(0.25, tick, redis=unreachable)
    await unreachable.aclose()

    # It could not take the lock, so it did not run, and it did not end either.
    assert runs == 0
    assert stream.getvalue().count("tick failed") >= 2


def test_a_lock_must_expire_before_the_next_run() -> None:
    async def action() -> None: ...

    with pytest.raises(ValueError, match="expire before"):
        Tick(name="planner", interval=FAST, action=action, lock_ttl=FAST)


async def test_the_helper_used_by_these_tests_fails_when_nothing_happens() -> None:
    with pytest.raises(AssertionError, match="not true"):
        await eventually(lambda: False, within=0.05)
