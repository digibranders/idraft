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
    # Not sent: our own limiter gave no turn in time or could not be reached, or no connection
    # to the provider could be opened. The provider never saw the call, so it is not an
    # attempt, and says nothing about the provider's rate. A network outage of minutes must
    # not end the tasks that fell due in it.
    NOT_SENT = "not_sent"


RetryStatus = Literal["pending", "failed", "dead"]


@dataclass(frozen=True, slots=True)
class RetryDecision:
    # `pending`: try again, after `delay` if there is one. `failed` and `dead` are final.
    status: RetryStatus
    delay: timedelta | None = None
    # The provider refuses everything (credentials, balance, account limit): stop calling it.
    pause_provider: bool = False
    # The provider asked us to slow down: halve the limiter for a while.
    reduce_rate: bool = False
    # Whether this failure counts as an attempt. A paused provider, or a call our own limiter
    # held back, is not the task's failure.
    counts: bool = True


@dataclass(frozen=True, slots=True)
class Backoff:
    first: timedelta
    cap: timedelta
    doubles: bool
    max_attempts: int
    exhausted: Literal["failed", "dead"]
    reduce_rate: bool = False

    def wait(self, attempts: int) -> timedelta:
        """The wait after the `attempts`-th try failed, before jitter: `first` after the first
        failure, doubling from there if the policy doubles, and never more than `cap`."""
        if not self.doubles:
            return min(self.first, self.cap)
        # In seconds, as a float: doubled often enough a duration itself would overflow.
        doubled = self.first.total_seconds() * 2.0 ** min(attempts - 1, _DOUBLINGS_MAX)
        return timedelta(seconds=min(doubled, self.cap.total_seconds()))


_MINUTE = timedelta(minutes=1)
# 2 to this power times any first wait is past any cap, and still a number.
_DOUBLINGS_MAX = 64
_PROVIDER_TROUBLE = Backoff(
    first=_MINUTE, cap=30 * _MINUTE, doubles=True, max_attempts=4, exhausted="dead"
)
# With these limits no wait reaches its cap (the longest are 8 and 4 minutes). The caps are the
# bound that holds if a limit is ever raised.
_BACKOFF: dict[ProviderErrorKind, Backoff] = {
    ProviderErrorKind.RATE_LIMITED: Backoff(
        first=timedelta(seconds=30),
        cap=15 * _MINUTE,
        doubles=True,
        max_attempts=6,
        exhausted="failed",
        reduce_rate=True,
    ),
    ProviderErrorKind.CONCURRENCY: Backoff(
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
# A call not made waits about as long as the limiter was willing to wait for a turn.
NOT_SENT_WAIT = timedelta(seconds=30)
# Added to a delay so tasks that failed together do not all come back together.
JITTER_SHARE = 0.2


def decide(
    kind: ProviderErrorKind,
    *,
    attempts: int,
    jitter: float,
    window_open: bool = True,
    retry_after: timedelta | None = None,
) -> RetryDecision:
    """What to do with a task whose `attempts`-th attempt (counting this one) failed with `kind`.

    `attempts` counts every try of the task that counted, whatever each one failed with: the
    ledger keeps one number. A kind's limit is therefore the number of tries after which a task
    that fails with that kind is ended, not the number of failures of that kind. A task that
    waited on concurrency four times and then times out is `dead` at once, and a result that
    expired is asked for again only if the task had been submitted once.

    `jitter` is a number in [0, 1) the caller draws at random; it is a parameter so the rule
    stays a pure function. `window_open` says whether the task's run can still take new work.
    `retry_after` is the wait the provider asked for, if it named one: the task waits at least
    that long, up to the cap of the kind's policy, and spread by the same jitter. What a
    provider says does not park a task for longer than we would ever wait.
    """
    kind = ProviderErrorKind(kind)
    if attempts < 1:
        raise ValueError("attempts counts the attempt that just failed, so it is at least 1")
    if not 0 <= jitter < 1:
        raise ValueError("jitter is in [0, 1)")
    if kind is ProviderErrorKind.EMPTY_RESULT:
        raise ValueError("an empty result is a result, not a failure")
    if kind in _PAUSES_PROVIDER:
        return RetryDecision(status="pending", pause_provider=True, counts=False)
    if kind is ProviderErrorKind.NOT_SENT:
        # Not counted, so never ended for it: a task held back for long enough is ended by
        # its run's window like any task still waiting.
        spread = 1 + JITTER_SHARE * jitter
        return RetryDecision(status="pending", delay=NOT_SENT_WAIT * spread, counts=False)
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
    spread = 1 + JITTER_SHARE * jitter
    delay = backoff.wait(attempts) * spread
    if retry_after is not None:
        # Spread as well: tasks told the same wait would otherwise all come back together.
        delay = max(delay, min(retry_after, backoff.cap) * spread)
    return RetryDecision(status="pending", delay=delay, reduce_rate=backoff.reduce_rate)
