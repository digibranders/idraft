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

# OWASP minimum for argon2id: 19 MiB, 2 iterations, 1 lane. Chosen so concurrent sign-ins fit the
# 4 GB host. The parameters travel inside each hash, so raising them later rehashes on sign-in.
_HASHER = PasswordHasher(
    time_cost=2, memory_cost=19_456, parallelism=1, hash_len=32, salt_len=16, type=Type.ID
)
_log = structlog.get_logger(__name__)

WeakPasswordReason = Literal["too_short", "too_long", "contains_email", "breached"]


class WeakPasswordError(Exception):
    """The password breaks the policy. Carries the reason and never the password."""

    def __init__(self, reason: WeakPasswordReason) -> None:
        super().__init__(f"password rejected: {reason}")
        self.reason: WeakPasswordReason = reason


def hash_password(password: str) -> str:
    return _HASHER.hash(password)


def verify_password(encoded: str, password: str) -> bool:
    """Whether `password` matches. A malformed stored hash is a mismatch, not an error."""
    try:
        return _HASHER.verify(encoded, password)
    except (VerificationError, InvalidHashError):
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
        digest = hashlib.sha1(password.encode(), usedforsecurity=False).hexdigest().upper()
        prefix, suffix = digest[:5], digest[5:]
        try:
            response = await self._client.get(
                RANGE_URL + prefix, headers={"Add-Padding": "true"}, timeout=RANGE_TIMEOUT_SECONDS
            )
        except httpx.HTTPError as error:
            # Fail open: an outage of a third party must not stop people setting a password.
            _log.warning("breached password check unavailable", error_type=type(error).__name__)
            return False
        if response.status_code != httpx.codes.OK:
            _log.warning("breached password check unavailable", status=response.status_code)
            return False
        for line in response.text.splitlines():
            candidate, _, count = line.partition(":")
            # Padding entries have a count of 0 and mean nothing.
            if candidate.strip().upper() == suffix:
                return count.strip() not in ("", "0")
        return False
