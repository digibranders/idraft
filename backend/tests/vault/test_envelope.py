import os
import uuid

import pytest

from idraft.vault.envelope import EnvelopeCipher, SealedSecret, SecretUnreadableError

KEY = bytes(range(32))
OTHER_KEY = bytes(range(32, 64))
TOKEN = "1//fake-refresh-token-for-tests"
WORKSPACE = uuid.uuid4()
KIND = "oauth_refresh_token"


def _seal(
    cipher: EnvelopeCipher, secret_id: uuid.UUID | None = None
) -> tuple[uuid.UUID, SealedSecret]:
    found = secret_id or uuid.uuid4()
    return found, cipher.seal(TOKEN, secret_id=found, workspace_id=WORKSPACE, kind=KIND)


def test_a_secret_round_trips() -> None:
    cipher = EnvelopeCipher({1: KEY})
    secret_id, sealed = _seal(cipher)
    assert cipher.open(sealed, secret_id=secret_id, workspace_id=WORKSPACE, kind=KIND) == TOKEN
    assert sealed.kek_version == 1


def test_the_plaintext_is_in_neither_stored_blob_nor_the_fingerprint() -> None:
    _, sealed = _seal(EnvelopeCipher({1: KEY}))
    for stored in (sealed.ciphertext, sealed.dek_wrapped, sealed.fingerprint.encode()):
        assert TOKEN.encode() not in stored
    assert TOKEN[-4:] not in sealed.fingerprint
    assert len(sealed.fingerprint) == 8


def test_every_seal_uses_a_new_data_key_and_nonce() -> None:
    cipher = EnvelopeCipher({1: KEY})
    secret_id = uuid.uuid4()
    first = cipher.seal(TOKEN, secret_id=secret_id, workspace_id=WORKSPACE, kind=KIND)
    second = cipher.seal(TOKEN, secret_id=secret_id, workspace_id=WORKSPACE, kind=KIND)
    assert first.ciphertext != second.ciphertext
    assert first.dek_wrapped != second.dek_wrapped
    assert first.fingerprint == second.fingerprint


@pytest.mark.parametrize(
    "change",
    [
        {"secret_id": uuid.uuid4()},
        {"workspace_id": uuid.uuid4()},
        {"workspace_id": None},
        {"kind": "provider_api_key"},
    ],
)
def test_a_secret_copied_into_another_row_cannot_be_read(change: dict[str, object]) -> None:
    cipher = EnvelopeCipher({1: KEY})
    secret_id, sealed = _seal(cipher)
    where = {"secret_id": secret_id, "workspace_id": WORKSPACE, "kind": KIND, **change}
    with pytest.raises(SecretUnreadableError):
        cipher.open(sealed, **where)  # type: ignore[arg-type]


def test_a_platform_secret_is_bound_to_no_workspace() -> None:
    cipher = EnvelopeCipher({1: KEY})
    secret_id = uuid.uuid4()
    sealed = cipher.seal(
        "platform", secret_id=secret_id, workspace_id=None, kind="provider_api_key"
    )
    assert (
        cipher.open(sealed, secret_id=secret_id, workspace_id=None, kind="provider_api_key")
        == "platform"
    )


@pytest.mark.parametrize("part", ["ciphertext", "dek_wrapped"])
def test_a_flipped_bit_is_refused(part: str) -> None:
    cipher = EnvelopeCipher({1: KEY})
    secret_id, sealed = _seal(cipher)
    blob = bytearray(getattr(sealed, part))
    blob[-1] ^= 1
    tampered = SealedSecret(
        ciphertext=bytes(blob) if part == "ciphertext" else sealed.ciphertext,
        dek_wrapped=bytes(blob) if part == "dek_wrapped" else sealed.dek_wrapped,
        kek_version=1,
        fingerprint=sealed.fingerprint,
    )
    with pytest.raises(SecretUnreadableError):
        cipher.open(tampered, secret_id=secret_id, workspace_id=WORKSPACE, kind=KIND)


def test_truncated_blobs_are_refused() -> None:
    cipher = EnvelopeCipher({1: KEY})
    secret_id, sealed = _seal(cipher)
    for blob in (b"", os.urandom(5)):
        with pytest.raises(SecretUnreadableError):
            cipher.open(
                SealedSecret(blob, sealed.dek_wrapped, 1, ""),
                secret_id=secret_id,
                workspace_id=WORKSPACE,
                kind=KIND,
            )


def test_the_wrong_key_cannot_open_a_secret_and_says_nothing_about_why() -> None:
    secret_id, sealed = _seal(EnvelopeCipher({1: KEY}))
    with pytest.raises(SecretUnreadableError) as error:
        EnvelopeCipher({1: OTHER_KEY}).open(
            sealed, secret_id=secret_id, workspace_id=WORKSPACE, kind=KIND
        )
    assert str(error.value) == "the stored secret could not be read"
    assert TOKEN not in repr(error.value)


def test_a_new_key_version_seals_and_the_old_one_still_opens() -> None:
    old = EnvelopeCipher({1: KEY})
    secret_id, sealed = _seal(old)
    rotated = EnvelopeCipher({1: KEY, 2: OTHER_KEY})
    assert rotated.open(sealed, secret_id=secret_id, workspace_id=WORKSPACE, kind=KIND) == TOKEN
    _, fresh = _seal(rotated)
    assert fresh.kek_version == 2
    with pytest.raises(SecretUnreadableError):
        old.open(fresh, secret_id=secret_id, workspace_id=WORKSPACE, kind=KIND)


@pytest.mark.parametrize("keys", [{}, {0: KEY}, {1: b"short"}])
def test_a_cipher_needs_valid_keys(keys: dict[int, bytes]) -> None:
    with pytest.raises(ValueError, match="key"):
        EnvelopeCipher(keys)
