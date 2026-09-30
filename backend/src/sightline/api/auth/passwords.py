"""Password hashing and the password policy (docs/24-security.md section 2)."""

from __future__ import annotations

import hashlib
import secrets
from functools import cache
from typing import Literal

import httpx
import structlog
from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError

PASSWORD_MIN = 12
PASSWORD_MAX = 128
# The shortest email local part worth looking for inside a password. "jo" or "al" would match by
# accident far more often than on purpose.
_LOCAL_PART_MIN = 4
RANGE_URL = "https://api.pwnedpasswords.com/range/"
RANGE_TIMEOUT_SECONDS = 2.0
# A real answer is about 35 KB with padding. Anything far larger is not the range API.
RANGE_MAX_BYTES = 1024 * 1024

# OWASP minimum for argon2id: 19 MiB, 2 iterations, 1 lane. Chosen so concurrent sign-ins fit the
# 4 GB host. The parameters travel inside each hash, so raising them later rehashes on sign-in.
_HASHER = PasswordHasher(
    time_cost=2, memory_cost=19_456, parallelism=1, hash_len=32, salt_len=16, type=Type.ID
)
_log = structlog.get_logger(__name__)

WeakPasswordReason = Literal["too_short", "too_long", "contains_email", "breached", "unchanged"]


class WeakPasswordError(Exception):
    """The password breaks the policy. Carries the reason and never the password."""

    def __init__(self, reason: WeakPasswordReason) -> None:
        super().__init__(f"password rejected: {reason}")
        self.reason: WeakPasswordReason = reason


def hash_password(password: str) -> str:
    return _HASHER.hash(password)


def verify_password(encoded: str, password: str) -> bool:
    """Whether `password` matches. Never raises: anything that cannot be verified is a mismatch.

    A malformed stored hash answers in microseconds, a real one in milliseconds. The column is
    NOT NULL and only ever holds a real hash; a caller with no hash to check uses `dummy_verify`.
    """
    try:
        return _HASHER.verify(encoded, password)
    except (VerificationError, InvalidHashError, UnicodeEncodeError):
        # UnicodeEncodeError: a lone surrogate, which JSON can carry and UTF-8 cannot.
        return False


def needs_rehash(encoded: str) -> bool:
    try:
        return _HASHER.check_needs_rehash(encoded)
    except InvalidHashError:
        return True


@cache
def _dummy_hash() -> str:
    return hash_password(secrets.token_urlsafe(24))


def dummy_verify() -> None:
    """Spend what a real verification costs: an unknown email answers as slowly as a known one."""
    verify_password(_dummy_hash(), "not the password")


def check_policy(password: str, *, email: str) -> None:
    """Length and the obvious self-reference. The breached check is separate because it does I/O."""
    if len(password) < PASSWORD_MIN:
        raise WeakPasswordError("too_short")
    if len(password) > PASSWORD_MAX:
        raise WeakPasswordError("too_long")
    local_part = email.partition("@")[0].casefold()
    if len(local_part) >= _LOCAL_PART_MIN and local_part in password.casefold():
        raise WeakPasswordError("contains_email")


class BreachedPasswords:
    """Pwned Passwords range lookup. Only the first five hex characters of the SHA-1 are sent."""

    def __init__(self, client: httpx.AsyncClient) -> None:
        self._client = client

    async def is_breached(self, password: str) -> bool:
        encoded = password.encode("utf-8", "surrogatepass")
        digest = hashlib.sha1(encoded, usedforsecurity=False).hexdigest().upper()
        prefix, suffix = digest[:5], digest[5:]
        body = await self._fetch_range(prefix)
        if body is None:
            return False
        return any(_names(line, suffix) for line in body.splitlines())

    async def _fetch_range(self, prefix: str) -> str | None:
        """The range listing, or None when it cannot be had. Fails open: an outage of a third
        party must not stop people setting a password."""
        chunks: list[bytes] = []
        size = 0
        try:
            async with self._client.stream(
                "GET",
                RANGE_URL + prefix,
                headers={"Add-Padding": "true"},
                timeout=RANGE_TIMEOUT_SECONDS,
            ) as response:
                if response.status_code != httpx.codes.OK:
                    _log.warning("breached password check unavailable", status=response.status_code)
                    return None
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > RANGE_MAX_BYTES:
                        _log.warning("breached password check unavailable", error_type="too_large")
                        return None
                    chunks.append(chunk)
        except httpx.HTTPError as error:
            _log.warning("breached password check unavailable", error_type=type(error).__name__)
            return None
        return b"".join(chunks).decode("ascii", "replace")


def _names(line: str, suffix: str) -> bool:
    """Whether a `SUFFIX:COUNT` line lists this suffix with a real count. Padding has count 0."""
    candidate, _, count = line.partition(":")
    if candidate.strip().upper() != suffix:
        return False
    try:
        return int(count) > 0
    except ValueError:
        return False
