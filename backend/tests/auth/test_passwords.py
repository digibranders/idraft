import hashlib

import httpx
import pytest
from argon2 import PasswordHasher

from idraft.api.auth import passwords
from idraft.api.auth.passwords import (
    BreachedPasswords,
    WeakPasswordError,
    check_policy,
    hash_password,
    needs_rehash,
    verify_password,
)

GOOD = "correct horse battery staple"


def test_a_hash_is_argon2id_with_the_owasp_minimum_parameters() -> None:
    assert hash_password(GOOD).startswith("$argon2id$v=19$m=19456,t=2,p=1$")


def test_two_hashes_of_one_password_differ() -> None:
    assert hash_password(GOOD) != hash_password(GOOD)


def test_verify_accepts_the_password_and_rejects_another() -> None:
    encoded = hash_password(GOOD)
    assert verify_password(encoded, GOOD) is True
    assert verify_password(encoded, GOOD + " ") is False


@pytest.mark.parametrize("encoded", ["", "not a hash", "$argon2id$v=19$m=19456,t=2,p=1$broken"])
def test_verify_returns_false_for_a_malformed_hash(encoded: str) -> None:
    assert verify_password(encoded, GOOD) is False


def test_a_hash_with_weaker_parameters_needs_rehashing() -> None:
    weaker = PasswordHasher(time_cost=1, memory_cost=8192, parallelism=1).hash(GOOD)
    assert verify_password(weaker, GOOD) is True
    assert needs_rehash(weaker) is True
    assert needs_rehash(hash_password(GOOD)) is False


def test_a_malformed_hash_needs_rehashing() -> None:
    assert needs_rehash("not a hash") is True


def test_the_dummy_verification_costs_a_real_verification(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str]] = []
    real = passwords.verify_password

    def spy(encoded: str, password: str) -> bool:
        calls.append((encoded, password))
        return real(encoded, password)

    monkeypatch.setattr(passwords, "verify_password", spy)
    passwords.dummy_verify()
    assert len(calls) == 1
    assert calls[0][0].startswith("$argon2id$v=19$m=19456,t=2,p=1$")


@pytest.mark.parametrize(
    ("password", "reason"),
    [
        ("a" * 11, "too_short"),
        ("a" * 129, "too_long"),
        ("my Jane.Doe password", "contains_email"),
        ("xxJANE.DOExxxxxx", "contains_email"),
    ],
)
def test_the_policy_rejects(password: str, reason: str) -> None:
    with pytest.raises(WeakPasswordError) as error:
        check_policy(password, email="jane.doe@client.example")
    assert error.value.reason == reason
    assert password not in str(error.value)


@pytest.mark.parametrize("password", ["a" * 12, "a" * 128, "ünïcödé pass"])
def test_the_policy_accepts(password: str) -> None:
    check_policy(password, email="jane.doe@client.example")


def test_a_short_local_part_is_not_held_against_the_password() -> None:
    check_policy("the jo in my password", email="jo@client.example")


def _suffix(password: str) -> tuple[str, str]:
    digest = hashlib.sha1(password.encode(), usedforsecurity=False).hexdigest().upper()
    return digest[:5], digest[5:]


def _client(handler: httpx.MockTransport) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=handler)


async def test_only_the_five_character_prefix_leaves_the_process() -> None:
    prefix, suffix = _suffix(GOOD)
    seen: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, text=f"0000000000000000000000000000000000A:3\r\n{suffix}:12\r\n")

    async with _client(httpx.MockTransport(respond)) as client:
        assert await BreachedPasswords(client).is_breached(GOOD) is True

    assert len(seen) == 1
    assert str(seen[0].url) == f"https://api.pwnedpasswords.com/range/{prefix}"
    assert seen[0].headers["Add-Padding"] == "true"
    sent = str(seen[0].url) + repr(seen[0].headers) + seen[0].content.decode()
    assert suffix not in sent
    assert GOOD not in sent


async def test_a_suffix_is_matched_whatever_its_case() -> None:
    _, suffix = _suffix(GOOD)

    def respond(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=f"{suffix.lower()}:1\n")

    async with _client(httpx.MockTransport(respond)) as client:
        assert await BreachedPasswords(client).is_breached(GOOD) is True


async def test_a_padded_entry_with_count_zero_is_not_a_breach() -> None:
    _, suffix = _suffix(GOOD)

    def respond(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=f"{suffix}:0\r\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:9\r\n")

    async with _client(httpx.MockTransport(respond)) as client:
        assert await BreachedPasswords(client).is_breached(GOOD) is False


@pytest.mark.parametrize("failure", ["timeout", "status", "garbage"])
async def test_the_check_fails_open(failure: str) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        if failure == "timeout":
            raise httpx.ReadTimeout("slow", request=request)
        if failure == "status":
            return httpx.Response(503, text="unavailable")
        return httpx.Response(200, text="<html>not the range format</html>")

    async with _client(httpx.MockTransport(respond)) as client:
        assert await BreachedPasswords(client).is_breached(GOOD) is False


LONE_SURROGATE = "\ud800 is not valid text"


def test_a_password_that_is_not_valid_text_is_a_mismatch_not_an_error() -> None:
    assert verify_password(hash_password(GOOD), LONE_SURROGATE) is False


async def test_a_password_that_is_not_valid_text_can_still_be_looked_up() -> None:
    def respond(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="0000000000000000000000000000000000A:3\r\n")

    async with _client(httpx.MockTransport(respond)) as client:
        assert await BreachedPasswords(client).is_breached(LONE_SURROGATE) is False


async def test_a_real_count_anywhere_in_the_listing_counts() -> None:
    _, suffix = _suffix(GOOD)

    def respond(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=f"{suffix}:0\r\n{suffix}:7\r\n")

    async with _client(httpx.MockTransport(respond)) as client:
        assert await BreachedPasswords(client).is_breached(GOOD) is True


@pytest.mark.parametrize("count", ["", "abc", "-1", "0", "00", " "])
async def test_a_count_that_is_not_a_positive_number_is_not_a_breach(count: str) -> None:
    _, suffix = _suffix(GOOD)

    def respond(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=f"{suffix}:{count}\r\n")

    async with _client(httpx.MockTransport(respond)) as client:
        assert await BreachedPasswords(client).is_breached(GOOD) is False


async def test_an_oversized_answer_is_abandoned() -> None:
    _, suffix = _suffix(GOOD)
    padding = ("F" * 35 + ":1\r\n") * 30_000

    def respond(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=padding + f"{suffix}:9\r\n")

    async with _client(httpx.MockTransport(respond)) as client:
        assert await BreachedPasswords(client).is_breached(GOOD) is False


async def test_an_error_that_is_not_a_network_error_is_not_swallowed() -> None:
    def respond(_: httpx.Request) -> httpx.Response:
        raise RuntimeError("a bug, not an outage")

    async with _client(httpx.MockTransport(respond)) as client:
        with pytest.raises(RuntimeError, match="a bug"):
            await BreachedPasswords(client).is_breached(GOOD)
