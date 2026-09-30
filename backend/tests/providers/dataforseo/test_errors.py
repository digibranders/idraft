"""DataForSEO answers in our error taxonomy (docs/06-dataforseo-seo-integration.md section 9)."""

from datetime import timedelta

import pytest

from sightline.domain.retries import ProviderErrorKind
from sightline.providers.dataforseo.errors import (
    MESSAGE_MAX,
    classify_http,
    classify_status,
    parse_retry_after,
)

K = ProviderErrorKind


@pytest.mark.parametrize("code", [20000, 20100])
def test_success_is_no_error(code: int) -> None:
    assert classify_status(code, "Ok.") is None


@pytest.mark.parametrize(
    ("code", "kind"),
    [
        # The documented codes (doc 06 section 9).
        (40006, K.INVALID_REQUEST),
        (40202, K.RATE_LIMITED),
        (40203, K.ACCOUNT_LIMIT),
        (40209, K.CONCURRENCY),
        (40403, K.NOT_FOUND_EXPIRED),
        (50301, K.UPSTREAM_UNAVAILABLE),
        (40102, K.EMPTY_RESULT),
        # Any other 40xxx is a request we got wrong; any other 50xxx is the provider's trouble.
        (40501, K.INVALID_REQUEST),
        (40001, K.INVALID_REQUEST),
        (50000, K.PROVIDER_ERROR),
        (50401, K.PROVIDER_ERROR),
        # Still being worked on: not a failure of the task, but not a result either.
        (40601, K.PROVIDER_ERROR),
        (40602, K.PROVIDER_ERROR),
    ],
)
def test_every_code_has_a_kind(code: int, kind: ProviderErrorKind) -> None:
    error = classify_status(code, "Some message.")

    assert error is not None
    assert (error.kind, error.provider_status, error.message) == (kind, code, "Some message.")


@pytest.mark.parametrize(
    ("status", "kind"),
    [
        (401, K.AUTH),
        (402, K.PAYMENT),
        (429, K.RATE_LIMITED),
        (404, K.INVALID_REQUEST),
        (400, K.INVALID_REQUEST),
        (500, K.PROVIDER_ERROR),
        (502, K.PROVIDER_ERROR),
        (503, K.PROVIDER_ERROR),
    ],
)
def test_an_http_status_has_a_kind(status: int, kind: ProviderErrorKind) -> None:
    error = classify_http(status, "")

    assert error is not None
    assert (error.kind, error.provider_status, error.message) == (kind, status, f"HTTP {status}")


def test_a_successful_http_status_leaves_the_body_to_say() -> None:
    assert classify_http(200, "") is None


def test_the_wait_asked_for_is_kept_only_for_a_rate_limit() -> None:
    wait = timedelta(seconds=30)

    limited = classify_http(429, "slow down", retry_after=wait)
    broken = classify_http(503, "down", retry_after=wait)

    assert limited is not None
    assert broken is not None
    assert (limited.retry_after, broken.retry_after) == (wait, None)


def test_a_long_message_is_cut_and_an_empty_one_is_named() -> None:
    long = classify_status(40501, "x" * 5000)
    empty = classify_status(40501, "")

    assert long is not None
    assert empty is not None
    assert (len(long.message), empty.message) == (MESSAGE_MAX, "no message")


@pytest.mark.parametrize(
    ("header", "wait"),
    [
        ("30", timedelta(seconds=30)),
        (" 5 ", timedelta(seconds=5)),
        ("0", timedelta(0)),
        (None, None),
        ("-1", None),
        ("soon", None),
        ("Wed, 21 Oct 2026 07:28:00 GMT", None),
    ],
)
def test_a_retry_after_header_is_read_in_seconds(
    header: str | None, wait: timedelta | None
) -> None:
    assert parse_retry_after(header) == wait
