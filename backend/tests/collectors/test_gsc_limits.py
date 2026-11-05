"""The Search Console call budgets (docs/18 section 4.5), on a clock the test moves."""

from __future__ import annotations

import pytest

from idraft.collectors.gsc_limits import (
    BURST_SECONDS,
    SLOW_FOR_SECONDS,
    Budgets,
    GscLimiter,
    TokenBucket,
)


class Time:
    """A clock that only moves when something sleeps or the test says so."""

    def __init__(self) -> None:
        self.now = 1_000.0
        self.slept: list[float] = []

    def __call__(self) -> float:
        return self.now

    async def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


def _limiter(
    time: Time, *, project: float = 1e9, user: float = 1e9, site: float = 1e9
) -> GscLimiter:
    return GscLimiter(Budgets(project, user, site), clock=time, sleep=time.sleep)


async def test_a_burst_goes_through_and_then_calls_are_paced_to_the_budget() -> None:
    time = Time()
    limiter = _limiter(time, site=300.0)  # five a second, a burst of fifty

    for _ in range(int(300 / 60 * BURST_SECONDS)):
        await limiter.acquire(user="u", site="s")
    assert time.slept == []

    await limiter.acquire(user="u", site="s")
    assert time.slept == [pytest.approx(0.2)]
    await limiter.acquire(user="u", site="s")
    assert time.slept == [pytest.approx(0.2), pytest.approx(0.2)]


async def test_a_call_waits_for_the_slowest_budget_not_for_the_sum() -> None:
    time = Time()
    limiter = _limiter(time, user=6.0, site=15.0)  # a token per 10 s, per 4 s

    await limiter.acquire(user="u", site="s")
    await limiter.acquire(user="u", site="s")

    assert time.slept == [pytest.approx(10.0)]


async def test_a_call_that_waits_for_one_budget_spends_nothing_from_the_others() -> None:
    time = Time()
    # The project can pay for a burst of two; the account must make the second call wait.
    limiter = _limiter(time, project=12.0, user=6.0)
    await limiter.acquire(user="u", site="s")
    await limiter.acquire(user="u", site="s")  # waits for the account, then takes one of each
    await limiter.acquire(user="other", site="s")
    # two tokens for the two calls above, one for this: the project's burst of 2 was not spent
    # by the waiting of the second call
    assert len(time.slept) == 1


async def test_accounts_and_properties_have_budgets_of_their_own() -> None:
    time = Time()
    limiter = _limiter(time, user=6.0, site=6.0)

    await limiter.acquire(user="a", site="x")
    await limiter.acquire(user="b", site="y")

    assert time.slept == []


async def test_a_quota_error_halves_the_property_for_half_an_hour() -> None:
    time = Time()
    limiter = _limiter(time, site=60.0)  # a token a second, a burst of ten
    for _ in range(10):
        await limiter.acquire(user="u", site="s")

    await limiter.acquire(user="u", site="s")
    assert time.slept == [pytest.approx(1.0)]

    limiter.quota_exceeded(site="s")
    await limiter.acquire(user="u", site="s")
    assert time.slept[-1] == pytest.approx(2.0)
    # another property is not slowed
    await limiter.acquire(user="u", site="elsewhere")
    assert len(time.slept) == 2

    # half an hour later the bucket is full again and refills at the full rate
    time.now += SLOW_FOR_SECONDS
    for _ in range(10):
        await limiter.acquire(user="u", site="s")
    assert len(time.slept) == 2
    await limiter.acquire(user="u", site="s")
    assert time.slept[-1] == pytest.approx(1.0)


def test_a_bucket_does_not_refill_backwards_when_the_clock_steps_back() -> None:
    time = Time()
    bucket = TokenBucket(60.0, time)
    for _ in range(10):
        bucket.take()
    time.now -= 500
    assert bucket.wait_for_token() == pytest.approx(1.0)
    # counted from the new time: half a second is half a token
    time.now += 0.5
    assert bucket.wait_for_token() == pytest.approx(0.5)


def test_a_budget_is_a_positive_number() -> None:
    with pytest.raises(ValueError, match="positive"):
        Budgets(site_per_minute=0)
