"""What happens to a task after a provider error (docs/21-scheduler-workers.md section 6)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from enum import StrEnum
from typing import Literal


class ProviderErrorKind(StrEnum):
    """docs/05-provider-integrations.md section 3.3."""

    AUTH = "auth"
    PAYMENT = "payment"
    ACCOUNT_LIMIT = "account_limit"
    RATE_LIMITED = "rate_limited"
    CONCURRENCY = "concurrency"
    INVALID_REQUEST = "invalid_request"
    NOT_FOUND_EXPIRED = "not_found_expired"
    UPSTREAM_UNAVAILABLE = "upstream_unavailable"
    PROVIDER_ERROR = "provider_error"
    TIMEOUT = "timeout"
    SCHEMA_MISMATCH = "schema_mismatch"
    EMPTY_RESULT = "empty_result"


@dataclass(frozen=True, slots=True)
class RetryDecision:
    # `pending`: try again, after `delay` if there is one. `failed` and `dead` are final.
    status: Literal["pending", "failed", "dead"]
    delay: timedelta | None = None
    # The provider refuses everything (credentials, balance, account limit): stop calling it.
    pause_provider: bool = False
    # The provider asked us to slow down: halve the limiter for a while.
    reduce_rate: bool = False
    # Whether this failure counts as an attempt. A paused provider is not the task's failure.
    counts: bool = True


@dataclass(frozen=True, slots=True)
class _Backoff:
    first: timedelta
    cap: timedelta
    doubles: bool
    max_attempts: int
    exhausted: Literal["failed", "dead"]
    reduce_rate: bool = False


_MINUTE = timedelta(minutes=1)
_PROVIDER_TROUBLE = _Backoff(
    first=_MINUTE, cap=30 * _MINUTE, doubles=True, max_attempts=4, exhausted="dead"
)
_BACKOFF: dict[ProviderErrorKind, _Backoff] = {
    ProviderErrorKind.RATE_LIMITED: _Backoff(
        first=timedelta(seconds=30),
        cap=15 * _MINUTE,
        doubles=True,
        max_attempts=6,
        exhausted="failed",
        reduce_rate=True,
    ),
    ProviderErrorKind.CONCURRENCY: _Backoff(
        first=timedelta(seconds=5),
        cap=timedelta(seconds=5),
        doubles=False,
        max_attempts=10,
        exhausted="failed",
    ),
    ProviderErrorKind.UPSTREAM_UNAVAILABLE: _PROVIDER_TROUBLE,
    ProviderErrorKind.PROVIDER_ERROR: _PROVIDER_TROUBLE,
    ProviderErrorKind.TIMEOUT: _PROVIDER_TROUBLE,
}
_PAUSES_PROVIDER = frozenset(
    {ProviderErrorKind.AUTH, ProviderErrorKind.PAYMENT, ProviderErrorKind.ACCOUNT_LIMIT}
)
_NEVER_RETRIED = frozenset({ProviderErrorKind.INVALID_REQUEST, ProviderErrorKind.SCHEMA_MISMATCH})
# Added to a delay so tasks that failed together do not all come back together.
JITTER_SHARE = 0.2


def decide(
    kind: ProviderErrorKind, *, attempts: int, jitter: float, window_open: bool = True
) -> RetryDecision:
    """What to do with a task whose `attempts`-th attempt (counting this one) failed with `kind`.

    `jitter` is a number in [0, 1) the caller draws at random; it is a parameter so the rule
    stays a pure function. `window_open` says whether the task's run can still take new work.
    """
    if attempts < 1:
        raise ValueError("attempts counts the attempt that just failed, so it is at least 1")
    if not 0 <= jitter < 1:
        raise ValueError("jitter is in [0, 1)")
    if kind is ProviderErrorKind.EMPTY_RESULT:
        raise ValueError("an empty result is a result, not a failure")
    if kind in _PAUSES_PROVIDER:
        return RetryDecision(status="pending", pause_provider=True, counts=False)
    if kind in _NEVER_RETRIED:
        return RetryDecision(status="failed")
    if kind is ProviderErrorKind.NOT_FOUND_EXPIRED:
        # The provider dropped the result: submit once more, if the run is still collecting.
        if attempts <= 1 and window_open:
            return RetryDecision(status="pending")
        return RetryDecision(status="dead")
    backoff = _BACKOFF[kind]
    if attempts >= backoff.max_attempts:
        return RetryDecision(status=backoff.exhausted, reduce_rate=backoff.reduce_rate)
    base = backoff.first * (2 ** (attempts - 1)) if backoff.doubles else backoff.first
    delay = min(base, backoff.cap)
    return RetryDecision(
        status="pending", delay=delay * (1 + JITTER_SHARE * jitter), reduce_rate=backoff.reduce_rate
    )
