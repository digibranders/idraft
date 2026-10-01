"""What a DataForSEO answer means, in our terms (docs/06-dataforseo-seo-integration.md section 9,
docs/05-provider-integrations.md section 3.3).

DataForSEO answers most errors with HTTP 200 and puts the real status in `status_code`, once for
the whole call and once per task. Both are read.

Two rules shape the table. A task that is refused as `invalid_request` fails for good, so only
answers that certainly mean "this request is wrong" are that; an unknown code is the provider's
trouble, which is tried again. And when a call was sending tasks, a server error may have come
after the tasks were created and charged (a gateway gave up waiting, the service failed while
answering): that is `timeout`, the outcome is unknown, and the tasks are not sent again blind.
Only the errors that say the request was not taken in (503, and 501 and 505, which refuse the
request itself) are anything else.
"""

from __future__ import annotations

import re
from datetime import timedelta
from enum import Enum
from typing import Final

from sightline.domain.retries import ProviderErrorKind
from sightline.providers.contract import ProviderError

K = ProviderErrorKind


class Answer(Enum):
    """An answer that is not an error."""

    OK = "ok"
    # `task_get` for a task still in the provider's queue or being worked on.
    NOT_READY = "not_ready"
    # A finished task whose search had no results: a result, and an empty one.
    NO_RESULTS = "no_results"


_ANSWERS: Final[dict[int, Answer]] = {
    20000: Answer.OK,
    20100: Answer.OK,
    40601: Answer.NOT_READY,
    40602: Answer.NOT_READY,
    40102: Answer.NO_RESULTS,
}
# The codes with a meaning of their own.
_CODES: Final[dict[int, ProviderErrorKind]] = {
    40006: K.INVALID_REQUEST,  # more than 100 tasks in one call: our bug
    40202: K.RATE_LIMITED,
    40203: K.ACCOUNT_LIMIT,  # the account's own cost limit
    40209: K.CONCURRENCY,
    40403: K.NOT_FOUND_EXPIRED,
    50301: K.UPSTREAM_UNAVAILABLE,
}
# How much of the provider's message is kept. Its messages are short; the cap is for a body
# that is not what it should be.
MESSAGE_MAX: Final = 300
_SECONDS: Final = re.compile(r"\d{1,9}")


def _code_kind(code: int, *, sending: bool) -> ProviderErrorKind:
    kind = _CODES.get(code)
    if kind is not None:
        return kind
    family = code // 100
    if family == 401:  # not authorized, not activated, blocked
        return K.AUTH
    if family == 402:  # balance and payment
        return K.PAYMENT
    if family == 405:  # an invalid field, path or body: this request is wrong
        return K.INVALID_REQUEST
    if code // 10_000 == 5:  # the provider's own failure: tasks may have been created
        return K.TIMEOUT if sending else K.PROVIDER_ERROR
    return K.PROVIDER_ERROR


def read_status(code: int, message: str, *, sending: bool) -> Answer | ProviderError:
    """What a DataForSEO `status_code` means. `sending`: the call was posting tasks."""
    answer = _ANSWERS.get(code)
    if answer is not None:
        return answer
    return ProviderError(
        kind=_code_kind(code, sending=sending),
        message=message[:MESSAGE_MAX] or "no message",
        provider_status=code,
    )


# Statuses that may come after the provider did the work: a gateway gave up waiting, or the
# request was cut off. Any server error but those in `_NOT_TAKEN` is read the same way.
_MAYBE_DONE: Final = frozenset({408, 425})
# Server errors that say the request was not taken in.
_NOT_TAKEN: Final = frozenset({501, 503, 505})
_HTTP: Final[dict[int, ProviderErrorKind]] = {
    401: K.AUTH,
    403: K.AUTH,
    402: K.PAYMENT,
    429: K.RATE_LIMITED,
    503: K.UPSTREAM_UNAVAILABLE,
    400: K.INVALID_REQUEST,
    413: K.INVALID_REQUEST,
    422: K.INVALID_REQUEST,
}


def read_http(
    status: int, message: str, *, sending: bool, retry_after: timedelta | None = None
) -> ProviderError | None:
    """The error an HTTP status stands for, or None when the body should be read for one."""
    if 200 <= status < 300:
        return None
    if status in _MAYBE_DONE or (500 <= status < 600 and status not in _NOT_TAKEN):
        kind = K.TIMEOUT if sending else K.PROVIDER_ERROR
    else:
        kind = _HTTP.get(status, K.PROVIDER_ERROR)
    keeps_wait = kind in (K.RATE_LIMITED, K.UPSTREAM_UNAVAILABLE)
    return ProviderError(
        kind=kind,
        message=message[:MESSAGE_MAX] or f"HTTP {status}",
        provider_status=status,
        retry_after=retry_after if keeps_wait else None,
    )


def parse_retry_after(value: str | None) -> timedelta | None:
    """The wait a `Retry-After` header names, in whole seconds. A date, or anything that is
    not a plain number of seconds, is ignored: the retry policy's own wait applies."""
    if value is None or not _SECONDS.fullmatch(value.strip()):
        return None
    return timedelta(seconds=int(value.strip()))
