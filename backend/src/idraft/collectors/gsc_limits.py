"""The Search Console call budgets of docs/18 section 4.5: one token bucket for the whole
installation, one per Google account and one per property. A call takes a token from all three.

shortcut: the buckets live in this process. They are exact while one worker process makes the
calls (V1, docs/03 section 6); with several processes each would spend the full budget, so move
them into Redis (as `worker/limiter.py` does for DataForSEO) before a second worker runs.

Time is read from `clock` and waited on with `sleep`, so a test drives both.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Final

type Clock = Callable[[], float]
type Sleep = Callable[[float], Awaitable[None]]

# Half the project and a quarter of the user and site quotas Google documents (1,200 QPM per
# site and per user, 40,000 QPM per project): the same Google account often runs other tools
# against the same properties.
PROJECT_PER_MINUTE: Final = 20_000.0
USER_PER_MINUTE: Final = 600.0
SITE_PER_MINUTE: Final = 300.0
# Ten seconds of a bucket's rate may be spent at once.
BURST_SECONDS: Final = 10.0
# After Google says the quota is exceeded, the property's bucket refills at half its rate for this
# long (docs/18 section 4.6).
SLOW_FOR_SECONDS: Final = 30 * 60.0
SLOW_FACTOR: Final = 0.5
# A token short by less than this is there: a wait smaller than the clock's resolution would
# not move it, and the call would wait for ever.
_TOLERANCE: Final = 1e-9


@dataclass(frozen=True, slots=True)
class Budgets:
    project_per_minute: float = PROJECT_PER_MINUTE
    user_per_minute: float = USER_PER_MINUTE
    site_per_minute: float = SITE_PER_MINUTE

    def __post_init__(self) -> None:
        if min(self.project_per_minute, self.user_per_minute, self.site_per_minute) <= 0:
            raise ValueError("a budget is a positive number of calls a minute")


class TokenBucket:
    """Tokens refill continuously up to `burst`; a call spends one."""

    def __init__(self, per_minute: float, clock: Clock) -> None:
        self._rate = per_minute / 60.0
        self._burst = max(1.0, self._rate * BURST_SECONDS)
        self._clock = clock
        self._tokens = self._burst
        self._at = clock()
        self._slow_until = 0.0

    def _refill(self) -> None:
        now = self._clock()
        rate = self._rate * (SLOW_FACTOR if now < self._slow_until else 1.0)
        # A clock that stepped back refills nothing, rather than a negative amount.
        self._tokens = min(self._burst, self._tokens + max(0.0, now - self._at) * rate)
        self._at = now

    def wait_for_token(self) -> float:
        """Seconds until a token is there: 0 when one is."""
        self._refill()
        if self._tokens >= 1.0 - _TOLERANCE:
            return 0.0
        rate = self._rate * (SLOW_FACTOR if self._clock() < self._slow_until else 1.0)
        return (1.0 - self._tokens) / rate

    def take(self) -> None:
        self._tokens -= 1.0

    def slow_down(self, seconds: float) -> None:
        self._refill()
        self._slow_until = max(self._slow_until, self._clock() + seconds)


class GscLimiter:
    def __init__(
        self,
        budgets: Budgets | None = None,
        *,
        clock: Clock = time.monotonic,
        sleep: Sleep = asyncio.sleep,
    ) -> None:
        self._budgets = budgets or Budgets()
        self._clock = clock
        self._sleep = sleep
        self._project = TokenBucket(self._budgets.project_per_minute, clock)
        self._users: dict[str, TokenBucket] = {}
        self._sites: dict[str, TokenBucket] = {}

    def _bucket(self, buckets: dict[str, TokenBucket], key: str, per_minute: float) -> TokenBucket:
        found = buckets.get(key)
        if found is None:
            found = buckets[key] = TokenBucket(per_minute, self._clock)
        return found

    async def acquire(self, *, user: str, site: str) -> None:
        """Wait until the project, the Google account and the property each have a token, then
        take one from each. No bucket is charged while another makes the call wait."""
        buckets = (
            self._project,
            self._bucket(self._users, user, self._budgets.user_per_minute),
            self._bucket(self._sites, site, self._budgets.site_per_minute),
        )
        while True:
            wait = max(bucket.wait_for_token() for bucket in buckets)
            if wait <= 0.0:
                for bucket in buckets:
                    bucket.take()
                return
            await self._sleep(wait)

    def quota_exceeded(self, *, site: str) -> None:
        """Google refused a call for quota: slow the property's bucket down for a while."""
        self._bucket(self._sites, site, self._budgets.site_per_minute).slow_down(SLOW_FOR_SECONDS)
