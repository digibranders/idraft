"""What a DataForSEO answer means, in our error taxonomy (docs/06-dataforseo-seo-integration.md
section 9, docs/05-provider-integrations.md section 3.3).

DataForSEO answers most errors with HTTP 200 and puts the real status in `status_code`, once for
the whole call and once per task. Both are read. Codes 20000 and 20100 are success; a task that
is still being worked on is not an error either (see `TASK_NOT_READY`).
"""

from __future__ import annotations

from datetime import timedelta
from typing import Final

from sightline.domain.retries import ProviderErrorKind
from sightline.providers.contract import ProviderError

OK: Final = frozenset({20000, 20100})
# `task_get` for a task still in the provider's queue or being worked on.
TASK_NOT_READY: Final = frozenset({40601, 40602})
# The documented codes with their own meaning; any other 40xxx is a request we got wrong and
# any other 50xxx is the provider's trouble.
_CODES: Final[dict[int, ProviderErrorKind]] = {
    40006: ProviderErrorKind.INVALID_REQUEST,  # more than 100 tasks in one call: our bug
    40102: ProviderErrorKind.EMPTY_RESULT,  # no search results
    40202: ProviderErrorKind.RATE_LIMITED,
    40203: ProviderErrorKind.ACCOUNT_LIMIT,  # the account's own cost limit
    40209: ProviderErrorKind.CONCURRENCY,
    40403: ProviderErrorKind.NOT_FOUND_EXPIRED,
    50301: ProviderErrorKind.UPSTREAM_UNAVAILABLE,
}
_HTTP: Final[dict[int, ProviderErrorKind]] = {
    401: ProviderErrorKind.AUTH,
    402: ProviderErrorKind.PAYMENT,
    429: ProviderErrorKind.RATE_LIMITED,
}
# How much of the provider's message is kept. Its messages are short; the cap is for a body
# that is not what it should be.
MESSAGE_MAX: Final = 300


def classify_status(status_code: int, message: str) -> ProviderError | None:
    """The error a DataForSEO `status_code` stands for, or None when it is success."""
    if status_code in OK:
        return None
    kind = _CODES.get(status_code)
    if kind is None:
        if status_code in TASK_NOT_READY:
            # Not an error; a caller that meets it here asked too early.
            kind = ProviderErrorKind.PROVIDER_ERROR
        elif 40000 <= status_code < 50000:
            kind = ProviderErrorKind.INVALID_REQUEST
        else:
            kind = ProviderErrorKind.PROVIDER_ERROR
    return ProviderError(
        kind=kind, message=message[:MESSAGE_MAX] or "no message", provider_status=status_code
    )


def classify_http(
    status: int, message: str, *, retry_after: timedelta | None = None
) -> ProviderError | None:
    """The error an HTTP status stands for, or None when the body should be read for one."""
    if 200 <= status < 300:
        return None
    kind = _HTTP.get(status)
    if kind is None:
        kind = (
            ProviderErrorKind.INVALID_REQUEST
            if 400 <= status < 500
            else ProviderErrorKind.PROVIDER_ERROR
        )
    return ProviderError(
        kind=kind,
        message=message[:MESSAGE_MAX] or f"HTTP {status}",
        provider_status=status,
        retry_after=retry_after if kind is ProviderErrorKind.RATE_LIMITED else None,
    )


def parse_retry_after(value: str | None) -> timedelta | None:
    """The wait a `Retry-After` header names, in seconds. A date or a value that is not a
    number is ignored: the retry policy's own wait applies."""
    if value is None:
        return None
    try:
        seconds = int(value.strip())
    except ValueError:
        return None
    return timedelta(seconds=seconds) if seconds >= 0 else None
