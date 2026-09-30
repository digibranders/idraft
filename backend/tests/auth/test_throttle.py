"""Sign-in throttling (docs/24-security.md section 2): 5 per account, 20 per IP, doubling."""

import asyncio
from collections.abc import AsyncIterator

import pytest
from redis.asyncio import Redis

from sightline.api.auth.throttle import LoginThrottle, ThrottleUnavailableError

EMAIL = "jane@client.example"
IP = "203.0.113.7"


@pytest.fixture
async def redis(redis_url: str) -> AsyncIterator[Redis]:
    client = Redis.from_url(redis_url)
    await client.flushdb()
    yield client
    await client.flushdb()
    await client.aclose()


async def _fail(
    throttle: LoginThrottle, times: int, *, email: str = EMAIL, ip: str = IP
) -> list[bool]:
    return [await throttle.failure(email=email, ip=ip) for _ in range(times)]


async def _number(redis: Redis, key: bytes | str) -> int:
    value = await redis.get(key)
    assert value is not None
    return int(value)


async def test_nothing_is_locked_before_any_failure(redis: Redis) -> None:
    assert await LoginThrottle(redis).check(email=EMAIL, ip=IP) is None


async def test_the_fifth_failure_locks_the_account_for_fifteen_minutes(redis: Redis) -> None:
    throttle = LoginThrottle(redis)
    assert await _fail(throttle, 4) == [False] * 4
    assert await throttle.check(email=EMAIL, ip=IP) is None
    assert await _fail(throttle, 1) == [True]
    wait = await throttle.check(email=EMAIL, ip=IP)
    assert wait is not None
    assert 895 <= wait <= 900


async def test_the_lock_follows_the_account_not_the_address(redis: Redis) -> None:
    throttle = LoginThrottle(redis)
    await _fail(throttle, 5)
    assert await throttle.check(email=EMAIL, ip="198.51.100.9") is not None
    assert await throttle.check(email="JANE@Client.Example", ip="198.51.100.9") is not None
    assert await throttle.check(email="other@client.example", ip=IP) is None


async def test_failures_while_locked_are_not_counted_towards_the_next_lockout(
    redis: Redis,
) -> None:
    throttle = LoginThrottle(redis)
    await _fail(throttle, 5)
    assert await _fail(throttle, 30, ip="198.51.100.1") == [False] * 30
    wait = await throttle.check(email=EMAIL, ip="198.51.100.2")
    assert wait is not None
    assert wait <= 900


async def test_a_second_lockout_within_a_day_lasts_twice_as_long(redis: Redis) -> None:
    throttle = LoginThrottle(redis)
    await _fail(throttle, 5)
    await redis.delete(*(await redis.keys("throttle:login:lock:acct:*")))
    assert await _fail(throttle, 5) == [False, False, False, False, True]
    wait = await throttle.check(email=EMAIL, ip=IP)
    assert wait is not None
    assert 1795 <= wait <= 1800


async def test_the_lockout_is_capped_at_a_day(redis: Redis) -> None:
    throttle = LoginThrottle(redis)
    await _fail(throttle, 5)
    (count_key,) = await redis.keys("throttle:login:lockouts:acct:*")
    await redis.set(count_key, 40, ex=86_400)
    await redis.delete(*(await redis.keys("throttle:login:lock:acct:*")))
    await _fail(throttle, 5)
    wait = await throttle.check(email=EMAIL, ip=IP)
    assert wait is not None
    assert 86_395 <= wait <= 86_400


async def test_twenty_failures_from_one_address_lock_the_address(redis: Redis) -> None:
    throttle = LoginThrottle(redis)
    for index in range(19):
        await throttle.failure(email=f"user{index}@client.example", ip=IP)
    assert await throttle.check(email="fresh@client.example", ip=IP) is None
    await throttle.failure(email="user19@client.example", ip=IP)
    wait = await throttle.check(email="fresh@client.example", ip=IP)
    assert wait is not None
    assert 895 <= wait <= 900
    assert await throttle.check(email="fresh@client.example", ip="198.51.100.9") is None


async def test_success_clears_the_account_and_keeps_the_address_count(redis: Redis) -> None:
    throttle = LoginThrottle(redis)
    await _fail(throttle, 4)
    await throttle.success(email=EMAIL)
    assert await _fail(throttle, 4) == [False] * 4
    assert await throttle.check(email=EMAIL, ip=IP) is None
    (ip_key,) = await redis.keys("throttle:login:failures:ip:*")
    assert await _number(redis, ip_key) == 8


async def test_fifty_failures_at_once_start_exactly_one_lockout(redis: Redis) -> None:
    throttle = LoginThrottle(redis)
    results = await asyncio.gather(
        *(throttle.failure(email=EMAIL, ip=f"198.51.100.{index}") for index in range(50))
    )
    assert sum(results) == 1
    (count_key,) = await redis.keys("throttle:login:lockouts:acct:*")
    assert await _number(redis, count_key) == 1


async def test_counters_expire_with_their_window(redis: Redis) -> None:
    throttle = LoginThrottle(redis)
    await _fail(throttle, 1)
    for key in await redis.keys("throttle:login:failures:*"):
        assert 0 < await redis.ttl(key) <= 900


async def test_no_key_holds_an_email_address_or_an_ip(redis: Redis) -> None:
    throttle = LoginThrottle(redis)
    await _fail(throttle, 5)
    await throttle.allow("email:verify", EMAIL, limit=3, window_seconds=3600)
    keys = " ".join(
        key.decode() if isinstance(key, bytes) else key for key in await redis.keys("*")
    )
    assert "jane" not in keys
    assert "client.example" not in keys
    assert IP not in keys


async def test_allow_counts_per_subject_within_a_window(redis: Redis) -> None:
    throttle = LoginThrottle(redis)
    verdicts = [
        await throttle.allow("email:verify", EMAIL, limit=3, window_seconds=3600) for _ in range(5)
    ]
    assert verdicts == [True, True, True, False, False]
    assert await throttle.allow("email:verify", "other@client.example", limit=3, window_seconds=60)
    assert await throttle.allow("email:reset", EMAIL, limit=3, window_seconds=3600)
    (key,) = [
        key for key in await redis.keys("throttle:email:verify:*") if await redis.ttl(key) > 60
    ]
    assert 3590 <= await redis.ttl(key) <= 3600


async def test_a_redis_outage_is_reported_not_ignored(black_hole: str) -> None:
    client = Redis.from_url(
        f"redis://{black_hole}/0", socket_timeout=0.2, socket_connect_timeout=0.2
    )
    throttle = LoginThrottle(client)
    try:
        with pytest.raises(ThrottleUnavailableError):
            await throttle.check(email=EMAIL, ip=IP)
        with pytest.raises(ThrottleUnavailableError):
            await throttle.failure(email=EMAIL, ip=IP)
        with pytest.raises(ThrottleUnavailableError):
            await throttle.success(email=EMAIL)
        with pytest.raises(ThrottleUnavailableError):
            await throttle.clear(email=EMAIL)
        with pytest.raises(ThrottleUnavailableError):
            await throttle.allow("x", "y", limit=1, window_seconds=1)
    finally:
        await client.aclose()


async def test_clearing_lifts_the_account_lock_and_keeps_the_address_lock(redis: Redis) -> None:
    throttle = LoginThrottle(redis)
    for index in range(20):
        await throttle.failure(email=EMAIL if index < 5 else f"u{index}@client.example", ip=IP)
    assert await throttle.check(email=EMAIL, ip="198.51.100.9") is not None

    await throttle.clear(email=EMAIL)

    assert await throttle.check(email=EMAIL, ip="198.51.100.9") is None
    assert await throttle.check(email=EMAIL, ip=IP) is not None


async def test_a_lock_that_expires_between_the_two_reads_is_no_lock(
    redis: Redis, monkeypatch: pytest.MonkeyPatch
) -> None:
    throttle = LoginThrottle(redis)
    await _fail(throttle, 5)
    real = redis.mget

    async def expire_after_reading(*keys: str) -> object:
        found = await real(*keys)
        await redis.delete(*keys)
        return found

    monkeypatch.setattr(redis, "mget", expire_after_reading)
    assert await throttle.check(email=EMAIL, ip=IP) is None
