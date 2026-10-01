"""Locks in Redis (docs/21-scheduler-workers.md section 3)."""

import asyncio
from datetime import timedelta

from redis.asyncio import Redis

from sightline.worker.locks import RedisLock

TTL = timedelta(seconds=5)


async def test_a_lock_has_one_holder(redis: Redis) -> None:
    first, second = RedisLock(redis, "planner", TTL), RedisLock(redis, "planner", TTL)

    assert await first.acquire()
    assert not await second.acquire()
    # Taking it again does not renew it either: only `extend` does.
    assert not await first.acquire()
    assert await RedisLock(redis, "dispatcher", TTL).acquire()
    assert 4000 < await redis.pttl("lock:planner") <= 5000


async def test_only_the_holder_releases_a_lock(redis: Redis) -> None:
    holder, other = RedisLock(redis, "planner", TTL), RedisLock(redis, "planner", TTL)
    assert await holder.acquire()

    await other.release()
    assert not await other.acquire()

    await holder.release()
    assert await other.acquire()


async def test_a_lock_expires_and_a_late_holder_cannot_touch_the_next_ones(redis: Redis) -> None:
    late = RedisLock(redis, "planner", timedelta(milliseconds=80))
    assert await late.acquire()
    await asyncio.sleep(0.15)

    current = RedisLock(redis, "planner", TTL)
    assert await current.acquire()
    # The first holder outlived its lock. It can neither extend nor release what is not its own.
    assert not await late.extend()
    await late.release()
    assert not await RedisLock(redis, "planner", TTL).acquire()


async def test_extending_starts_the_time_to_live_again(redis: Redis) -> None:
    lock = RedisLock(redis, "scheduler", timedelta(milliseconds=300))
    assert await lock.acquire()
    await asyncio.sleep(0.2)

    assert await lock.extend()
    await asyncio.sleep(0.2)

    # 400 ms after it was taken, and it is still held.
    assert not await RedisLock(redis, "scheduler", TTL).acquire()


async def test_the_key_holds_a_token_and_nothing_about_the_holder(redis: Redis) -> None:
    await RedisLock(redis, "planner", TTL).acquire()
    await RedisLock(redis, "other", TTL).acquire()

    planner, other = await redis.get("lock:planner"), await redis.get("lock:other")

    assert isinstance(planner, bytes)
    assert len(planner) == 32
    # A fresh random token per holder: nobody can guess one and release a lock they do not hold.
    assert planner != other
