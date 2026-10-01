"""DataForSEO answers in our terms (docs/06-dataforseo-seo-integration.md section 9)."""

from datetime import timedelta

import pytest

from sightline.domain.retries import ProviderErrorKind
from sightline.providers.contract import ProviderError
from sightline.providers.dataforseo.errors import (
    MESSAGE_MAX,
    Answer,
    parse_retry_after,
    read_http,
    read_status,
)

K = ProviderErrorKind


def _kind(code: int, *, sending: bool = False) -> ProviderErrorKind:
    error = read_status(code, "Some message.", sending=sending)
    assert isinstance(error, ProviderError), error
    return error.kind


@pytest.mark.parametrize(
    ("code", "answer"),
    [
        (20000, Answer.OK),
        (20100, Answer.OK),
        # Still in the queue or being worked on: not a failure, and not a result yet.
        (40601, Answer.NOT_READY),
        (40602, Answer.NOT_READY),
        # A finished search with no results: a result, which is kept like any other.
        (40102, Answer.NO_RESULTS),
    ],
)
@pytest.mark.parametrize("sending", [True, False])
def test_answers_that_are_not_errors(code: int, answer: Answer, sending: bool) -> None:
    assert read_status(code, "", sending=sending) is answer


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
        # The account refused, whatever the exact code: pause, never fail the tasks.
        (40100, K.AUTH),
        (40101, K.AUTH),
        (40104, K.AUTH),
        (40200, K.PAYMENT),
        (40201, K.PAYMENT),
        (40204, K.PAYMENT),
        (40207, K.PAYMENT),
        (40210, K.PAYMENT),
        # This request is wrong: its field, its path or its body.
        (40501, K.INVALID_REQUEST),
        (40502, K.INVALID_REQUEST),
        (40503, K.INVALID_REQUEST),
        # Anything else is tried again: reading again costs nothing, and a wrong failure
        # cannot be undone.
        (40001, K.PROVIDER_ERROR),
        (40400, K.PROVIDER_ERROR),
        (40402, K.PROVIDER_ERROR),
        (50000, K.PROVIDER_ERROR),
        (50401, K.PROVIDER_ERROR),
    ],
)
def test_every_error_code_has_a_kind(code: int, kind: ProviderErrorKind) -> None:
    error = read_status(code, "Some message.", sending=False)

    assert isinstance(error, ProviderError)
    assert (error.kind, error.provider_status, error.message) == (kind, code, "Some message.")


@pytest.mark.parametrize("code", [50000, 50401, 50402, 50999])
def test_a_failure_at_the_provider_while_sending_leaves_the_outcome_unknown(code: int) -> None:
    """The tasks may have been created and charged before the provider failed."""
    assert _kind(code, sending=True) is K.TIMEOUT
    assert _kind(code, sending=False) is K.PROVIDER_ERROR


def test_a_source_that_was_down_took_nothing_in() -> None:
    assert _kind(50301, sending=True) is K.UPSTREAM_UNAVAILABLE


@pytest.mark.parametrize(
    ("status", "kind"),
    [
        (401, K.AUTH),
        (403, K.AUTH),
        (402, K.PAYMENT),
        (429, K.RATE_LIMITED),
        (503, K.UPSTREAM_UNAVAILABLE),
        (400, K.INVALID_REQUEST),
        (413, K.INVALID_REQUEST),
        (422, K.INVALID_REQUEST),
        (404, K.PROVIDER_ERROR),
        (409, K.PROVIDER_ERROR),
        # A server error that refuses the request itself: it was not taken in.
        (501, K.PROVIDER_ERROR),
        (505, K.PROVIDER_ERROR),
    ],
)
def test_an_http_status_has_a_kind(status: int, kind: ProviderErrorKind) -> None:
    for sending in (True, False):
        error = read_http(status, "", sending=sending)
        assert error is not None
        assert (error.kind, error.provider_status, error.message) == (
            kind,
            status,
            f"HTTP {status}",
        )


@pytest.mark.parametrize("status", [408, 425, 500, 502, 504, 507, 520, 522, 524, 599])
def test_a_server_error_while_sending_leaves_the_outcome_unknown(status: int) -> None:
    """A gateway gave up waiting, or the service failed while answering (a proxy's 52x
    among them): the tasks may have been created and charged all the same."""
    sending = read_http(status, "", sending=True)
    reading = read_http(status, "", sending=False)

    assert sending is not None
    assert reading is not None
    assert (sending.kind, reading.kind) == (K.TIMEOUT, K.PROVIDER_ERROR)


def test_a_successful_http_status_leaves_the_body_to_say() -> None:
    assert read_http(200, "", sending=True) is None


def test_the_wait_asked_for_is_kept_for_a_rate_limit_and_an_outage() -> None:
    wait = timedelta(seconds=30)

    kept = [read_http(status, "", sending=False, retry_after=wait) for status in (429, 503)]
    dropped = read_http(500, "", sending=False, retry_after=wait)

    assert [error.retry_after for error in kept if error is not None] == [wait, wait]
    assert dropped is not None
    assert dropped.retry_after is None


def test_a_long_message_is_cut_and_an_empty_one_is_named() -> None:
    long = read_status(40501, "x" * 5000, sending=False)
    empty = read_status(40501, "", sending=False)
    long_http = read_http(500, "y" * 5000, sending=False)

    assert isinstance(long, ProviderError)
    assert isinstance(empty, ProviderError)
    assert long_http is not None
    assert (len(long.message), empty.message, len(long_http.message)) == (
        MESSAGE_MAX,
        "no message",
        MESSAGE_MAX,
    )


@pytest.mark.parametrize(
    ("header", "wait"),
    [
        ("30", timedelta(seconds=30)),
        (" 5 ", timedelta(seconds=5)),
        ("0", timedelta(0)),
        (None, None),
        ("-1", None),
        ("+5", None),
        ("1_000", None),
        ("soon", None),
        # Too large to be a wait, and too large for a duration.
        ("99999999999999999", None),
        ("Wed, 21 Oct 2026 07:28:00 GMT", None),
    ],
)
def test_a_retry_after_header_is_read_in_whole_seconds(
    header: str | None, wait: timedelta | None
) -> None:
    assert parse_retry_after(header) == wait
