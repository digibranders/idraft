"""What happens to a task after a provider error (docs/21-scheduler-workers.md section 6)."""

from datetime import timedelta

import pytest
from hypothesis import given
from hypothesis import strategies as st

from sightline.domain.retries import (
    JITTER_SHARE,
    Backoff,
    ProviderErrorKind,
    RetryDecision,
    decide,
)

K = ProviderErrorKind


def _delays(kind: ProviderErrorKind, attempts: range) -> list[float | None]:
    found = []
    for attempt in attempts:
        decision = decide(kind, attempts=attempt, jitter=0.0)
        found.append(None if decision.delay is None else decision.delay.total_seconds())
    return found


def test_a_rate_limit_backs_off_from_thirty_seconds_and_gives_up_as_failed() -> None:
    assert _delays(K.RATE_LIMITED, range(1, 6)) == [30, 60, 120, 240, 480]
    last = decide(K.RATE_LIMITED, attempts=6, jitter=0.0)
    assert (last.status, last.delay) == ("failed", None)
    # The provider asked us to slow down, whether or not the task is tried again.
    assert decide(K.RATE_LIMITED, attempts=1, jitter=0.0).reduce_rate
    assert last.reduce_rate


def test_a_wait_doubles_from_the_first_and_stops_at_its_cap() -> None:
    """With today's limits no wait reaches its cap, so the cap is shown on a policy that
    allows more tries."""
    patient = Backoff(
        first=timedelta(seconds=30),
        cap=timedelta(minutes=15),
        doubles=True,
        max_attempts=20,
        exhausted="failed",
    )
    waits = [patient.wait(attempts).total_seconds() for attempts in range(1, 9)]
    assert waits == [30, 60, 120, 240, 480, 900, 900, 900]
    # However often: the doubling does not outgrow what a duration can hold.
    assert patient.wait(5000) == timedelta(minutes=15)
    steady = Backoff(
        first=timedelta(seconds=5),
        cap=timedelta(seconds=5),
        doubles=False,
        max_attempts=10,
        exhausted="failed",
    )
    assert {steady.wait(attempts) for attempts in range(1, 9)} == {timedelta(seconds=5)}


def test_a_task_waits_at_least_as_long_as_the_provider_asks_up_to_the_cap() -> None:
    def wait(retry_after: timedelta) -> timedelta | None:
        return decide(K.RATE_LIMITED, attempts=1, jitter=0.0, retry_after=retry_after).delay

    assert wait(timedelta(seconds=90)) == timedelta(seconds=90)
    # A shorter wait than our own does not shorten ours.
    assert wait(timedelta(seconds=1)) == timedelta(seconds=30)
    assert wait(timedelta(seconds=-5)) == timedelta(seconds=30)
    # A provider cannot park a task for a day.
    assert wait(timedelta(days=1)) == timedelta(minutes=15)
    # Tasks told the same wait do not all come back in the same second.
    spread = decide(K.RATE_LIMITED, attempts=1, jitter=0.5, retry_after=timedelta(seconds=90)).delay
    assert spread == timedelta(seconds=99)
    # A task that is not tried again has no wait, whatever the provider said.
    ended = decide(K.RATE_LIMITED, attempts=6, jitter=0.0, retry_after=timedelta(seconds=90))
    assert (ended.status, ended.delay) == ("failed", None)


def test_the_limit_is_on_the_tasks_tries_whatever_they_failed_with() -> None:
    """The ledger keeps one count of attempts. A task that waited on concurrency four times
    and then times out has used the four tries provider trouble allows."""
    assert decide(K.CONCURRENCY, attempts=4, jitter=0.0).status == "pending"
    assert decide(K.TIMEOUT, attempts=5, jitter=0.0).status == "dead"
    assert decide(K.RATE_LIMITED, attempts=5, jitter=0.0).status == "pending"
    # A result that expired is asked for again only after a single submission.
    assert decide(K.NOT_FOUND_EXPIRED, attempts=3, jitter=0.0).status == "dead"


def test_a_kind_may_be_given_by_its_name() -> None:
    assert decide("timeout", attempts=1, jitter=0.0) == decide(K.TIMEOUT, attempts=1, jitter=0.0)  # type: ignore[arg-type]
    assert decide("not_found_expired", attempts=1, jitter=0.0).status == "pending"  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="not a failure"):
        decide("empty_result", attempts=1, jitter=0.0)  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="not a valid ProviderErrorKind"):
        decide("no_such_kind", attempts=1, jitter=0.0)  # type: ignore[arg-type]


def test_a_concurrency_error_waits_five_seconds_up_to_ten_times() -> None:
    assert _delays(K.CONCURRENCY, range(1, 10)) == [5] * 9
    assert decide(K.CONCURRENCY, attempts=10, jitter=0.0).status == "failed"
    assert not decide(K.CONCURRENCY, attempts=1, jitter=0.0).reduce_rate


@pytest.mark.parametrize("kind", [K.UPSTREAM_UNAVAILABLE, K.PROVIDER_ERROR, K.TIMEOUT])
def test_provider_trouble_backs_off_from_a_minute_and_ends_dead(kind: ProviderErrorKind) -> None:
    assert _delays(kind, range(1, 4)) == [60, 120, 240]
    assert decide(kind, attempts=4, jitter=0.0) == RetryDecision(status="dead")


@pytest.mark.parametrize("kind", [K.INVALID_REQUEST, K.SCHEMA_MISMATCH])
def test_a_request_or_a_response_we_cannot_use_is_not_tried_again(
    kind: ProviderErrorKind,
) -> None:
    assert decide(kind, attempts=1, jitter=0.0) == RetryDecision(status="failed")


@pytest.mark.parametrize("kind", [K.AUTH, K.PAYMENT, K.ACCOUNT_LIMIT])
def test_a_provider_that_refuses_everything_is_paused_and_the_task_waits(
    kind: ProviderErrorKind,
) -> None:
    for attempts in (1, 5, 50):
        decision = decide(kind, attempts=attempts, jitter=0.0)
        assert decision == RetryDecision(status="pending", pause_provider=True, counts=False)


def test_an_expired_result_is_asked_for_once_more_while_the_window_is_open() -> None:
    assert decide(K.NOT_FOUND_EXPIRED, attempts=1, jitter=0.0) == RetryDecision(status="pending")
    assert decide(K.NOT_FOUND_EXPIRED, attempts=2, jitter=0.0).status == "dead"
    closed = decide(K.NOT_FOUND_EXPIRED, attempts=1, jitter=0.0, window_open=False)
    assert closed.status == "dead"


def test_jitter_adds_up_to_a_fifth_so_tasks_do_not_return_together() -> None:
    base = decide(K.TIMEOUT, attempts=1, jitter=0.0).delay
    most = decide(K.TIMEOUT, attempts=1, jitter=0.999).delay
    assert base == timedelta(seconds=60)
    assert most is not None
    assert base < most < base * (1 + JITTER_SHARE)
    half = decide(K.TIMEOUT, attempts=1, jitter=0.5).delay
    assert half is not None
    assert half.total_seconds() == pytest.approx(66)


@given(
    kind=st.sampled_from([kind for kind in K if kind is not K.EMPTY_RESULT]),
    attempts=st.integers(1, 40),
    jitter=st.floats(0, 1, exclude_max=True),
)
def test_every_error_ends_and_never_waits_longer_than_its_cap(
    kind: ProviderErrorKind, attempts: int, jitter: float
) -> None:
    decision = decide(kind, attempts=attempts, jitter=jitter)
    assert decision.status in ("pending", "failed", "dead")
    if decision.status != "pending":
        assert decision.delay is None
    if decision.delay is not None:
        assert timedelta(0) < decision.delay <= timedelta(minutes=30) * (1 + JITTER_SHARE)
    # A task is not tried for ever, unless the provider itself is paused or the call never
    # left: neither counts as a try, and the run's window ends the task.
    if attempts >= 10 and decision.counts:
        assert decision.status in ("failed", "dead")


def test_a_call_our_limiter_held_back_is_not_an_attempt_and_slows_nothing() -> None:
    decision = decide(K.THROTTLED, attempts=6, jitter=0.0)

    assert decision == RetryDecision(status="pending", delay=timedelta(seconds=30), counts=False)
    spread = decide(K.THROTTLED, attempts=1, jitter=0.999).delay
    assert spread is not None
    assert timedelta(seconds=30) < spread < timedelta(seconds=30) * (1 + JITTER_SHARE)


def test_an_empty_result_is_not_a_failure_and_the_arguments_are_checked() -> None:
    with pytest.raises(ValueError, match="not a failure"):
        decide(K.EMPTY_RESULT, attempts=1, jitter=0.0)
    with pytest.raises(ValueError, match="at least 1"):
        decide(K.TIMEOUT, attempts=0, jitter=0.0)
    with pytest.raises(ValueError, match="jitter"):
        decide(K.TIMEOUT, attempts=1, jitter=1.0)
