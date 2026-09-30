"""Opaque tokens: session ids, email verification, password reset.

The token goes to the user; only its SHA-256 is stored, so reading the database yields nothing
that can be replayed. A fast hash is right here because the input is 256 random bits.
"""

from __future__ import annotations

import hashlib
import secrets

from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

TOKEN_BYTES = 32


def new_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


def hash_token(token: str) -> bytes:
    # surrogatepass: a value that is not valid text is hashed rather than raising. It matches no
    # stored hash, because real tokens are ASCII.
    return hashlib.sha256(token.encode("utf-8", "surrogatepass")).digest()


def derive_key(secret: bytes, label: bytes) -> bytes:
    """A 32-byte key for one purpose, derived from the platform secret (HKDF-SHA256).

    Each purpose has its own label, so the key that authenticates cache entries is unrelated to
    the key that encrypts TOTP secrets, though both come from one configured value.
    """
    return HKDF(algorithm=SHA256(), length=32, salt=None, info=label).derive(secret)
