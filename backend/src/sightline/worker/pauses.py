"""Provider pauses, kept in Redis (docs/21-scheduler-workers.md section 6).

A provider that refuses everyone (bad credentials, no balance, its own cost limit reached) is
sent nothing for a while. The pause ends by itself: the next batch after it tries again, and if
the provider still refuses, pauses it again. Whoever fixes the account does not also have to
resume collection. A pause lost with Redis costs one refused call.
"""

from __future__ import annotations

from collections.abc import Collection
from datetime import timedelta

from redis.asyncio import Redis

PAUSE_FOR = timedelta(minutes=15)
_PREFIX = "rl:paused:"


class RedisPauses:
    def __init__(self, redis: Redis, *, pause_for: timedelta = PAUSE_FOR) -> None:
        self._redis = redis
        self._pause_for = pause_for

    async def paused(self, providers: Collection[str]) -> frozenset[str]:
        codes = sorted(providers)
        if not codes:
            return frozenset()
        reasons = await self._redis.mget([_PREFIX + code for code in codes])
        return frozenset(code for code, reason in zip(codes, reasons, strict=True) if reason)

    async def pause(self, provider: str, *, reason: str) -> None:
        await self._redis.set(
            _PREFIX + provider, reason, px=int(self._pause_for.total_seconds() * 1000)
        )
