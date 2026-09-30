"""Rate limits on provider calls, shared by every worker process (docs/21-scheduler-workers.md
section 7).

Each limit is a token bucket in Redis under `rl:<provider>:<scope>`. A call takes a token from
the provider's bucket for all calls and, when its endpoint family has a limit of its own, from
that one too, both in one script so a call never holds one and waits for the other. The time is
Redis's own, so every worker counts from the same clock.

When the provider says calls come too fast, the rate of its bucket for all calls is halved for
ten minutes (`<bucket>:slow`); the bucket then refills at the lower rate until the key expires.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Mapping
from datetime import timedelta
from typing import Final

from redis.asyncio import Redis

from sightline.providers.contract import Limit

PREFIX: Final = "rl:"
ALL_CALLS: Final = "all"
SLOW_FOR: Final = timedelta(minutes=10)
SLOW_FACTOR: Final = 0.5
# A bucket nobody used for this long is dropped; it would be full again by then anyway.
_IDLE_EXPIRY_MS: Final = 120_000

# KEYS: per bucket, its key and its slow-down key. ARGV: per bucket, its burst and its refill
# per millisecond. Returns 0 when a token was taken from every bucket, or else the
# milliseconds until each has one, having taken none.
_TAKE: Final = """
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local wait = 0
local levels = {}
for i = 1, #KEYS, 2 do
  local slot = (i + 1) / 2
  local burst = tonumber(ARGV[2 * slot - 1])
  local rate = tonumber(ARGV[2 * slot]) * tonumber(redis.call('GET', KEYS[i + 1]) or '1')
  local state = redis.call('HMGET', KEYS[i], 'tokens', 'at')
  local tokens = tonumber(state[1]) or burst
  local at = tonumber(state[2]) or now
  tokens = math.min(burst, tokens + math.max(0, now - at) * rate)
  levels[slot] = tokens
  if tokens < 1 then
    wait = math.max(wait, math.ceil((1 - tokens) / rate))
  end
end
if wait > 0 then
  return wait
end
for i = 1, #KEYS, 2 do
  local slot = (i + 1) / 2
  redis.call('HSET', KEYS[i], 'tokens', tostring(levels[slot] - 1), 'at', tostring(now))
  redis.call('PEXPIRE', KEYS[i], ARGV[#ARGV])
end
return 0
"""


class RedisCallGate:
    """The `CallGate` of one provider: its limit on all calls and its families' limits."""

    def __init__(
        self, redis: Redis, provider: str, *, all_calls: Limit, families: Mapping[str, Limit]
    ) -> None:
        self._redis = redis
        self._provider = provider
        self._limits = {ALL_CALLS: all_calls, **families}

    def _key(self, scope: str) -> str:
        return f"{PREFIX}{self._provider}:{scope}"

    async def _take(self, scopes: tuple[str, ...]) -> int:
        keys: list[str] = []
        arguments: list[str] = []
        for scope in scopes:
            limit = self._limits[scope]
            keys += [self._key(scope), f"{self._key(scope)}:slow"]
            arguments += [str(limit.burst), repr(limit.refill_per_minute / 60_000)]
        arguments.append(str(_IDLE_EXPIRY_MS))
        wait: int = await self._redis.eval(_TAKE, len(keys), *keys, *arguments)
        return wait

    async def enter(self, family: str | None, *, within: timedelta) -> bool:
        if family is not None and family not in self._limits:
            raise KeyError(f"{self._provider} has no limit for {family!r}")
        scopes = (ALL_CALLS,) if family is None else (ALL_CALLS, family)
        deadline = time.monotonic() + within.total_seconds()
        while True:
            wait_ms = await self._take(scopes)
            if wait_ms == 0:
                return True
            if time.monotonic() + wait_ms / 1000 > deadline:
                return False
            await asyncio.sleep(wait_ms / 1000)

    async def slow_down(self) -> None:
        await self._redis.set(
            f"{self._key(ALL_CALLS)}:slow",
            repr(SLOW_FACTOR),
            px=int(SLOW_FOR.total_seconds() * 1000),
        )
