"""Hourly and daily allowances for actions that cost something: mail, quotas, provider spend."""

from __future__ import annotations

from sightline.api.auth.throttle import LoginThrottle, ThrottleUnavailableError
from sightline.api.problems import RateLimitedError, ServiceUnavailableError


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
        raise ServiceUnavailableError("Try again in a moment.") from None
    if not allowed:
        raise RateLimitedError(
            "Too many requests. Try again later.",
            headers={"Retry-After": str(window_seconds)},
            retry_after_seconds=window_seconds,
        )
