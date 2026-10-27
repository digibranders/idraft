"""Rate limits on provider calls, shared by every worker process (docs/21-scheduler-workers.md
section 7).

Each limit is a token bucket in Redis under `rl:<provider>:<scope>`. A call takes a token from
the provider's bucket for all calls and, when its endpoint family has a limit of its own, from
that one too, both in one script so a call never holds one and waits for the other. The time is
Redis's own, so every worker counts from the same clock.

When the provider says calls come too fast, every bucket of that provider refills at half its
rate and holds half its burst for ten minutes (`rl:<provider>:slow`). Which limit the provider
meant is not known, and another installation on the same account may be the cause, so all of
them are slowed.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Mapping
from datetime import timedelta
from typing import Final

from redis.asyncio import Redis

from idraft.providers.contract import GateUnavailableError, Limit

PREFIX: Final = "rl:"
ALL_CALLS: Final = "all"
SLOW: Final = "slow"
SLOW_FOR: Final = timedelta(minutes=10)
SLOW_FACTOR: Final = 0.5
# A bucket nobody used for this long is dropped, and comes back full: that is within the limit,
# because no call was made through it in the last minute.
_IDLE_EXPIRY_MS: Final = 120_000

# KEYS: the provider's slow-down key, then each bucket's key. ARGV: the idle expiry, then per
# bucket its burst and its refill per millisecond. Returns 0 when a token was taken from every
# bucket, or else the milliseconds until each has one, having taken none.
_TAKE: Final = """
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local factor = tonumber(redis.call('GET', KEYS[1]) or '1')
local wait = 0
local levels = {}
for i = 2, #KEYS do
  local burst = math.max(1, tonumber(ARGV[2 * i - 2]) * factor)
  local rate = tonumber(ARGV[2 * i - 1]) * factor
  local state = redis.call('HMGET', KEYS[i], 'tokens', 'at')
  local tokens = tonumber(state[1]) or burst
  local at = tonumber(state[2]) or now
  if at > now then
    -- The clock stepped back: count from now, or the bucket would refill nothing until the
    -- clock caught up.
    redis.call('HSET', KEYS[i], 'at', tostring(now))
    at = now
  end
  tokens = math.min(burst, tokens + (now - at) * rate)
  levels[i] = tokens
  if tokens < 1 then
    wait = math.max(wait, math.ceil((1 - tokens) / rate))
  end
end
if wait > 0 then
  return wait
end
for i = 2, #KEYS do
  redis.call('HSET', KEYS[i], 'tokens', tostring(levels[i] - 1), 'at', tostring(now))
  redis.call('PEXPIRE', KEYS[i], ARGV[1])
end
return 0
"""


class RedisCallGate:
    """The `CallGate` of one provider: its limit on all calls and its families' limits."""

    def __init__(
        self, redis: Redis, provider: str, *, all_calls: Limit, families: Mapping[str, Limit]
    ) -> None:
        for family in families:
            if family in (ALL_CALLS, SLOW) or not family or ":" in family:
                raise ValueError(f"{family!r} cannot name a family: it is a key of its own")
        self._redis = redis
        self._provider = provider
        self._limits = {ALL_CALLS: all_calls, **families}
        self._take_script = redis.register_script(_TAKE)

    def _key(self, scope: str) -> str:
        return f"{PREFIX}{self._provider}:{scope}"

    async def _take(self, scopes: tuple[str, ...]) -> int:
        keys = [self._key(SLOW)]
        arguments = [str(_IDLE_EXPIRY_MS)]
        for scope in scopes:
            limit = self._limits[scope]
            keys.append(self._key(scope))
            arguments += [str(limit.burst), repr(limit.refill_per_minute / 60_000)]
        wait: int = await self._take_script(keys=keys, args=arguments)
        return wait

    async def enter(self, family: str | None, *, within: timedelta) -> bool:
        if family is not None and family not in self._limits:
            raise KeyError(f"{self._provider} has no limit for {family!r}")
        scopes = (ALL_CALLS,) if family is None else (ALL_CALLS, family)
        deadline = time.monotonic() + within.total_seconds()
        while True:
            try:
                wait_ms = await self._take(scopes)
            except Exception as error:
                raise GateUnavailableError(type(error).__name__) from error
            if wait_ms == 0:
                return True
            if time.monotonic() + wait_ms / 1000 > deadline:
                return False
            await asyncio.sleep(wait_ms / 1000)

    async def slow_down(self) -> None:
        try:
            await self._redis.set(
                self._key(SLOW), repr(SLOW_FACTOR), px=int(SLOW_FOR.total_seconds() * 1000)
            )
        except Exception as error:
            raise GateUnavailableError(type(error).__name__) from error
