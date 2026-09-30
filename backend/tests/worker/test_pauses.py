"""Provider pauses in Redis (docs/21-scheduler-workers.md section 6)."""

import asyncio
from datetime import timedelta

from redis.asyncio import Redis

from sightline.worker.pauses import RedisPauses


async def test_a_paused_provider_is_paused_until_the_pause_runs_out(redis: Redis) -> None:
    pauses = RedisPauses(redis, pause_for=timedelta(milliseconds=300))

    assert await pauses.paused(["fake", "dataforseo"]) == frozenset()
    await pauses.pause("dataforseo", reason="payment")

    assert await pauses.paused(["fake", "dataforseo"]) == {"dataforseo"}
    assert await redis.get("rl:paused:dataforseo") == b"payment"
    await asyncio.sleep(0.4)
    # Over by itself: the next batch tries again.
    assert await pauses.paused(["dataforseo"]) == frozenset()


async def test_a_pause_lasts_a_quarter_of_an_hour_and_asking_about_nothing_costs_nothing(
    redis: Redis,
) -> None:
    pauses = RedisPauses(redis)
    await pauses.pause("dataforseo", reason="auth")

    assert 14 * 60_000 < await redis.pttl("rl:paused:dataforseo") <= 15 * 60_000
    assert await pauses.paused([]) == frozenset()
