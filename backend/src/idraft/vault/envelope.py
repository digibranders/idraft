"""Envelope encryption of one secret (docs/24-security.md section 5.2).

    ciphertext  = AES-256-GCM(DEK, plaintext, aad = secret id || workspace id || kind)
    dek_wrapped = AES-256-GCM(KEK_vN, DEK, aad = secret id)

Each secret has its own random DEK, and the KEK is a versioned key from the environment. The
associated data binds a ciphertext to its row, so one copied into another workspace's row, or
filed under another kind, fails to decrypt. Both blobs are `nonce || ciphertext || tag`.

Nothing here reads or writes the database and nothing is logged: a failure says that a secret
could not be read, never why.
"""

from __future__ import annotations

import hashlib
import os
from collections.abc import Mapping
from dataclasses import dataclass
from uuid import UUID

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

KEY_BYTES = 32
_NONCE_BYTES = 12
_TAG_BYTES = 16
_FINGERPRINT_CHARS = 8
_PLATFORM = b"\x00" * 16


class SecretUnreadableError(Exception):
    """A stored secret could not be decrypted: tampered with, filed in another row, or sealed
    with a key this process does not have. The message says nothing about which."""

    def __init__(self) -> None:
        super().__init__("the stored secret could not be read")


@dataclass(frozen=True, slots=True)
class SealedSecret:
    """What is stored for a secret, in the columns of `ops.secrets`."""

    ciphertext: bytes
    dek_wrapped: bytes
    kek_version: int
    # A prefix of the plaintext's hash: enough to tell two secrets apart, nothing to guess from.
    fingerprint: str


def _row_binding(secret_id: UUID, workspace_id: UUID | None, kind: str) -> bytes:
    return (
        secret_id.bytes
        + (_PLATFORM if workspace_id is None else workspace_id.bytes)
        + kind.encode()
    )


def _seal(key: bytes, plaintext: bytes, aad: bytes) -> bytes:
    nonce = os.urandom(_NONCE_BYTES)
    return nonce + AESGCM(key).encrypt(nonce, plaintext, aad)


def _open(key: bytes, blob: bytes, aad: bytes) -> bytes:
    if len(blob) < _NONCE_BYTES + _TAG_BYTES:
        raise SecretUnreadableError
    try:
        return AESGCM(key).decrypt(blob[:_NONCE_BYTES], blob[_NONCE_BYTES:], aad)
    except InvalidTag:
        raise SecretUnreadableError from None


class EnvelopeCipher:
    """Seals with the newest key version and opens with whichever version the row names."""

    def __init__(self, keys: Mapping[int, bytes]) -> None:
        if not keys or any(version < 1 for version in keys):
            raise ValueError("key versions start at 1 and at least one key is needed")
        if any(len(key) != KEY_BYTES for key in keys.values()):
            raise ValueError("every secrets encryption key must be 32 bytes")
        self._keys = dict(keys)
        self._current = max(self._keys)

    def seal(
        self, plaintext: str, *, secret_id: UUID, workspace_id: UUID | None, kind: str
    ) -> SealedSecret:
        data = plaintext.encode()
        dek = AESGCM.generate_key(bit_length=KEY_BYTES * 8)
        return SealedSecret(
            ciphertext=_seal(dek, data, _row_binding(secret_id, workspace_id, kind)),
            dek_wrapped=_seal(self._keys[self._current], dek, secret_id.bytes),
            kek_version=self._current,
            fingerprint=hashlib.sha256(data).hexdigest()[:_FINGERPRINT_CHARS],
        )

    def open(
        self, sealed: SealedSecret, *, secret_id: UUID, workspace_id: UUID | None, kind: str
    ) -> str:
        key = self._keys.get(sealed.kek_version)
        if key is None:
            raise SecretUnreadableError
        dek = _open(key, sealed.dek_wrapped, secret_id.bytes)
        try:
            return _open(
                dek, sealed.ciphertext, _row_binding(secret_id, workspace_id, kind)
            ).decode()
        except UnicodeDecodeError:
            raise SecretUnreadableError from None
