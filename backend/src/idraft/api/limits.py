"""Hourly and daily allowances for actions that cost something: mail, quotas, provider spend."""

from __future__ import annotations

from collections.abc import Sequence

from idraft.api.auth.throttle import LoginThrottle, ThrottleUnavailableError
from idraft.api.problems import RateLimitedError, ServiceUnavailableError


def _refused(window_seconds: int) -> RateLimitedError:
    return RateLimitedError(
        "Too many requests. Try again later.",
        headers={"Retry-After": str(window_seconds)},
        retry_after_seconds=window_seconds,
    )


def _cannot_count() -> ServiceUnavailableError:
    return ServiceUnavailableError("Try again in a moment.")


async def enforce(
    throttle: LoginThrottle, scope: str, subject: object, *, limit: int, window_seconds: int
) -> None:
    """Count one action by `subject` and refuse it past `limit` per window.

    When Redis cannot count, the action is refused: an allowance that fails open is no allowance.
    """
    try:
        allowed = await throttle.allow(
            scope, str(subject), limit=limit, window_seconds=window_seconds
        )
    except ThrottleUnavailableError:
        raise _cannot_count() from None
    if not allowed:
        raise _refused(window_seconds)


async def enforce_all(
    throttle: LoginThrottle, allowances: Sequence[tuple[str, object, int]], *, window_seconds: int
) -> None:
    """Count one action against several allowances, each a (scope, subject, limit), and refuse
    it when any is used up. A refused action is counted against none of them."""
    try:
        allowed = await throttle.allow_all(
            [(scope, str(subject), limit) for scope, subject, limit in allowances],
            window_seconds=window_seconds,
        )
    except ThrottleUnavailableError:
        raise _cannot_count() from None
    if not allowed:
        raise _refused(window_seconds)
