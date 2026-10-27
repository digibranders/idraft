"""Provider pauses in Redis (docs/21-scheduler-workers.md section 6)."""

import asyncio
from collections.abc import AsyncIterator
from datetime import timedelta

import pytest
from redis.asyncio import Redis

from idraft.providers.pauses import RedisPauses


@pytest.fixture
async def redis(redis_url: str) -> AsyncIterator[Redis]:
    """A client on an empty database: no pause of an earlier test."""
    client = Redis.from_url(redis_url)
    await client.flushdb()
    yield client
    await client.aclose()


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
