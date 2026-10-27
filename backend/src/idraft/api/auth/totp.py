"""Time-based one-time passwords (RFC 6238) and recovery codes.

The server must recompute codes, so the shared secret is encrypted, not hashed. Recovery codes
are random and single-use, so they are hashed like tokens.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets
from datetime import datetime
from uuid import UUID

import pyotp
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ISSUER = "idraft.ai"
STEP_SECONDS = 30
RECOVERY_CODE_COUNT = 10
_KEY_BYTES = 32
_NONCE_BYTES = 12
_TAG_BYTES = 16
# The first byte names the key and format, so a key rotation can tell old blobs from new ones.
_VERSION = b"\x01"
_CODE = re.compile(r"[0-9]{6}", re.ASCII)
_RECOVERY_SEPARATORS = re.compile(r"[\s-]+")


class TotpSecretError(Exception):
    """A stored secret could not be decrypted. The message says nothing about why."""

    def __init__(self) -> None:
        super().__init__("the stored TOTP secret could not be read")


class TotpCipher:
    """AES-256-GCM with the user id as associated data, so a blob works for one user only."""

    def __init__(self, key: bytes) -> None:
        if len(key) != _KEY_BYTES:
            raise ValueError("the TOTP encryption key must be 32 bytes")
        self._aead = AESGCM(key)

    def encrypt(self, secret: str, *, user_id: UUID) -> bytes:
        nonce = os.urandom(_NONCE_BYTES)
        return _VERSION + nonce + self._aead.encrypt(nonce, secret.encode(), user_id.bytes)

    def decrypt(self, blob: bytes, *, user_id: UUID) -> str:
        if len(blob) < len(_VERSION) + _NONCE_BYTES + _TAG_BYTES or blob[:1] != _VERSION:
            raise TotpSecretError
        nonce, ciphertext = blob[1 : 1 + _NONCE_BYTES], blob[1 + _NONCE_BYTES :]
        try:
            return self._aead.decrypt(nonce, ciphertext, user_id.bytes).decode()
        except (InvalidTag, UnicodeDecodeError):
            raise TotpSecretError from None


def new_secret() -> str:
    return pyotp.random_base32()


def provisioning_uri(secret: str, *, email: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=ISSUER)


def matching_step(secret: str, code: str, *, at: datetime) -> int | None:
    """The time step whose code equals `code`: the current one, or one either side of it.

    The caller must then claim the step (a step can be used once), which is what stops a replay.
    """
    if at.utcoffset() is None:
        raise ValueError("at must be timezone-aware")
    if not _CODE.fullmatch(code):
        return None
    totp = pyotp.TOTP(secret)
    current = int(at.timestamp()) // STEP_SECONDS
    matched: int | None = None
    try:
        # Every candidate is compared, so the time taken does not say which step matched.
        for step in (current - 1, current, current + 1):
            if hmac.compare_digest(totp.at(step * STEP_SECONDS), code):
                matched = step
    except ValueError:
        # A secret that is not base32 (binascii.Error is a ValueError). Secrets are authenticated
        # by the cipher, so only a bug or a wrong key version reaches this.
        raise TotpSecretError from None
    return matched


def new_recovery_codes() -> list[str]:
    codes = []
    for _ in range(RECOVERY_CODE_COUNT):
        text = base64.b32encode(secrets.token_bytes(10)).decode()
        codes.append("-".join(text[index : index + 4] for index in range(0, len(text), 4)))
    return codes


def hash_recovery_code(code: str) -> str:
    normalised = _RECOVERY_SEPARATORS.sub("", code).upper()
    return hashlib.sha256(normalised.encode("utf-8", "surrogatepass")).hexdigest()
