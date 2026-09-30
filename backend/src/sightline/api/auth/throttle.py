"""Limits on sign-in attempts and on what the public auth routes will do per caller.

Redis holds the counters. Every change is one Lua script, so concurrent requests cannot slip past
a limit between a read and a write. If Redis cannot be reached the caller is told, and the auth
routes answer 503: a limiter that cannot count must not wave requests through.
"""

from __future__ import annotations

import hashlib

from redis.asyncio import Redis
from redis.exceptions import RedisError

WINDOW_SECONDS = 15 * 60
ACCOUNT_FAILURES = 5
IP_FAILURES = 20
LOCKOUT_SECONDS = 15 * 60
LOCKOUT_MAX_SECONDS = 24 * 60 * 60
LOCKOUT_MEMORY_SECONDS = 24 * 60 * 60
_REDIS_ERRORS = (RedisError, OSError, TimeoutError)

# KEYS: account failures, account lock, account lockout count, ip failures, ip lock
# ARGV: window, account limit, ip limit, first lockout, longest lockout, lockout memory
# Returns 1 when this failure started an account lockout.
_FAILURE = """
local started = 0
if redis.call('EXISTS', KEYS[2]) == 0 then
  local failures = redis.call('INCR', KEYS[1])
  if failures == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  if failures >= tonumber(ARGV[2]) then
    local lockouts = redis.call('INCR', KEYS[3])
    if lockouts == 1 then redis.call('EXPIRE', KEYS[3], ARGV[6]) end
    local seconds = math.min(tonumber(ARGV[4]) * 2 ^ (lockouts - 1), tonumber(ARGV[5]))
    redis.call('SET', KEYS[2], '1', 'EX', math.floor(seconds))
    redis.call('DEL', KEYS[1])
    started = 1
  end
end
if redis.call('EXISTS', KEYS[5]) == 0 then
  local attempts = redis.call('INCR', KEYS[4])
  if attempts == 1 then redis.call('EXPIRE', KEYS[4], ARGV[1]) end
  if attempts >= tonumber(ARGV[3]) then
    redis.call('SET', KEYS[5], '1', 'EX', ARGV[1])
    redis.call('DEL', KEYS[4])
  end
end
return started
"""

# KEYS: counter. ARGV: limit, window. Returns 1 while the caller is within the limit.
_ALLOW = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
if count > tonumber(ARGV[1]) then return 0 end
return 1
"""


class ThrottleUnavailableError(Exception):
    """Redis could not be reached, so nothing can be counted."""


def _digest(value: str) -> str:
    """Keys never hold an email address or anything else a person typed."""
    return hashlib.sha256(value.casefold().encode("utf-8", "surrogatepass")).hexdigest()[:32]


class LoginThrottle:
    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    async def check(self, *, email: str, ip: str) -> int | None:
        """Seconds the caller must wait, or None when an attempt is allowed."""
        try:
            remaining = await self._redis.mget(_lock_key("acct", email), _lock_key("ip", ip))
            if not any(value is not None for value in remaining):
                return None
            async with self._redis.pipeline(transaction=False) as pipe:
                pipe.ttl(_lock_key("acct", email))
                pipe.ttl(_lock_key("ip", ip))
                ttls = await pipe.execute()
        except _REDIS_ERRORS:
            raise ThrottleUnavailableError from None
        # A lock that expired between the two reads reports a negative time to live.
        wait = max((int(ttl) for ttl in ttls), default=0)
        return wait if wait > 0 else None

    async def failure(self, *, email: str, ip: str) -> bool:
        """Count a failed attempt. True when it locked the account."""
        try:
            started = await self._redis.eval(
                _FAILURE,
                5,
                _failures_key("acct", email),
                _lock_key("acct", email),
                f"throttle:login:lockouts:acct:{_digest(email)}",
                _failures_key("ip", ip),
                _lock_key("ip", ip),
                WINDOW_SECONDS,
                ACCOUNT_FAILURES,
                IP_FAILURES,
                LOCKOUT_SECONDS,
                LOCKOUT_MAX_SECONDS,
                LOCKOUT_MEMORY_SECONDS,
            )
        except _REDIS_ERRORS:
            raise ThrottleUnavailableError from None
        return bool(int(started) == 1)

    async def success(self, *, email: str) -> None:
        """A successful sign-in clears the account's failures. The IP keeps its count."""
        try:
            await self._redis.delete(_failures_key("acct", email))
        except _REDIS_ERRORS:
            raise ThrottleUnavailableError from None

    async def clear(self, *, email: str) -> None:
        """Lift an account lockout. For a user who has just proved they own the mailbox."""
        try:
            await self._redis.delete(_failures_key("acct", email), _lock_key("acct", email))
        except _REDIS_ERRORS:
            raise ThrottleUnavailableError from None

    async def allow(self, scope: str, subject: str, *, limit: int, window_seconds: int) -> bool:
        """Count one action by `subject` and say whether it is within `limit` per window."""
        try:
            allowed = await self._redis.eval(
                _ALLOW, 1, f"throttle:{scope}:{_digest(subject)}", limit, window_seconds
            )
        except _REDIS_ERRORS:
            raise ThrottleUnavailableError from None
        return bool(int(allowed) == 1)


def _failures_key(kind: str, subject: str) -> str:
    return f"throttle:login:failures:{kind}:{_digest(subject)}"


def _lock_key(kind: str, subject: str) -> str:
    return f"throttle:login:lock:{kind}:{_digest(subject)}"
