"""Locks in Redis, so one of several worker processes does a job at a time.

A lock is a key holding a random token, set only if absent and with a time to live. Only the
holder's token can extend or release it, so a process that lost the lock to expiry cannot release
the next holder's. A lock is not a guarantee: a holder that outlives the time to live runs
alongside the next one. Everything done under a lock is therefore safe to do twice.
"""

from __future__ import annotations

import secrets
from datetime import timedelta

from redis.asyncio import Redis

PREFIX = "lock:"

# KEYS: the lock. ARGV: the holder's token. Deletes the lock only if this holder still has it.
_RELEASE = """
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
"""
# KEYS: the lock. ARGV: token, time to live in milliseconds.
_EXTEND = """
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
return 0
"""


class RedisLock:
    def __init__(self, redis: Redis, name: str, ttl: timedelta) -> None:
        self._redis = redis
        self._key = PREFIX + name
        self._ttl_ms = int(ttl.total_seconds() * 1000)
        self._token = secrets.token_hex(16)

    async def acquire(self) -> bool:
        """Take the lock if nobody holds it. Never waits."""
        return bool(await self._redis.set(self._key, self._token, nx=True, px=self._ttl_ms))

    async def extend(self) -> bool:
        """Start the time to live again. False when the lock is no longer this holder's."""
        return bool(await self._redis.eval(_EXTEND, 1, self._key, self._token, self._ttl_ms))

    async def release(self) -> None:
        """Give the lock up, if it is still this holder's."""
        await self._redis.eval(_RELEASE, 1, self._key, self._token)
