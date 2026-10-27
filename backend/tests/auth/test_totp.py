import hashlib
import os
import re
import uuid
from datetime import UTC, datetime, timedelta, timezone

import pyotp
import pytest

from sightline.api.auth.totp import (
    TotpCipher,
    TotpSecretError,
    hash_recovery_code,
    matching_step,
    new_recovery_codes,
    new_secret,
    provisioning_uri,
)

KEY = bytes(range(32))
NOW = datetime(2026, 9, 30, 12, 0, 7, tzinfo=UTC)
STEP = int(NOW.timestamp()) // 30


def test_a_secret_is_160_bits_of_base32() -> None:
    secret = new_secret()
    assert re.fullmatch(r"[A-Z2-7]{32}", secret)
    assert secret != new_secret()


def test_the_provisioning_uri_names_the_issuer_and_the_account() -> None:
    uri = provisioning_uri("JBSWY3DPEHPK3PXP", email="jane@client.example")
    assert uri.startswith("otpauth://totp/idraft.ai:jane%40client.example?")
    assert "secret=JBSWY3DPEHPK3PXP" in uri
    assert "issuer=idraft.ai" in uri


def test_encryption_round_trips_for_the_same_user() -> None:
    cipher, user_id, secret = TotpCipher(KEY), uuid.uuid4(), new_secret()
    blob = cipher.encrypt(secret, user_id=user_id)
    assert secret.encode() not in blob
    assert cipher.decrypt(blob, user_id=user_id) == secret


def test_two_encryptions_of_one_secret_differ() -> None:
    cipher, user_id, secret = TotpCipher(KEY), uuid.uuid4(), new_secret()
    assert cipher.encrypt(secret, user_id=user_id) != cipher.encrypt(secret, user_id=user_id)


def test_a_secret_cannot_be_moved_to_another_user() -> None:
    cipher = TotpCipher(KEY)
    blob = cipher.encrypt(new_secret(), user_id=uuid.uuid4())
    with pytest.raises(TotpSecretError):
        cipher.decrypt(blob, user_id=uuid.uuid4())


@pytest.mark.parametrize("damage", ["flip", "short", "version", "empty", "other_key"])
def test_a_damaged_blob_is_refused(damage: str) -> None:
    cipher, user_id = TotpCipher(KEY), uuid.uuid4()
    blob = cipher.encrypt(new_secret(), user_id=user_id)
    if damage == "flip":
        blob = blob[:-1] + bytes([blob[-1] ^ 1])
    elif damage == "short":
        blob = blob[:20]
    elif damage == "version":
        blob = b"\x02" + blob[1:]
    elif damage == "empty":
        blob = b""
    else:
        cipher = TotpCipher(os.urandom(32))
    with pytest.raises(TotpSecretError) as error:
        cipher.decrypt(blob, user_id=user_id)
    assert str(error.value) == "the stored TOTP secret could not be read"


@pytest.mark.parametrize("length", [0, 16, 31, 33])
def test_the_key_must_be_32_bytes(length: int) -> None:
    with pytest.raises(ValueError, match="32 bytes"):
        TotpCipher(bytes(length))


@pytest.mark.parametrize("offset", [-1, 0, 1])
def test_the_current_previous_and_next_step_match(offset: int) -> None:
    secret = new_secret()
    code = pyotp.TOTP(secret).at(NOW + timedelta(seconds=30 * offset))
    assert matching_step(secret, code, at=NOW) == STEP + offset


@pytest.mark.parametrize("offset", [-2, 2, 10])
def test_a_step_further_away_does_not_match(offset: int) -> None:
    secret = new_secret()
    code = pyotp.TOTP(secret).at(NOW + timedelta(seconds=30 * offset))
    assert matching_step(secret, code, at=NOW) is None


@pytest.mark.parametrize("code", ["", "12345", "1234567", "12345a", "١٢٣٤٥٦", " 123456", "123 456"])
def test_a_code_that_is_not_six_ascii_digits_never_matches(code: str) -> None:
    assert matching_step(new_secret(), code, at=NOW) is None


def test_recovery_codes_are_ten_distinct_80_bit_values() -> None:
    codes = new_recovery_codes()
    assert len(codes) == 10
    assert len(set(codes)) == 10
    for code in codes:
        assert re.fullmatch(r"[A-Z2-7]{4}(-[A-Z2-7]{4}){3}", code)


def test_a_recovery_code_is_hashed_without_its_dashes_and_case() -> None:
    code = new_recovery_codes()[0]
    plain = code.replace("-", "")
    expected = hashlib.sha256(plain.encode()).hexdigest()
    assert hash_recovery_code(code) == expected
    assert hash_recovery_code(plain.lower()) == expected
    assert hash_recovery_code(f"  {code.lower()} ") == expected


# RFC 6238 appendix B, SHA-1, secret "12345678901234567890". The 6-digit code is the last six
# digits of each 8-digit vector.
RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"


@pytest.mark.parametrize(
    ("unix_time", "code"),
    [
        (59, "287082"),
        (1111111109, "081804"),
        (1111111111, "050471"),
        (1234567890, "005924"),
        (2000000000, "279037"),
        (20000000000, "353130"),
    ],
)
def test_rfc_6238_vectors(unix_time: int, code: str) -> None:
    at = datetime.fromtimestamp(unix_time, UTC)
    assert matching_step(RFC_SECRET, code, at=at) == unix_time // 30


def test_a_time_without_a_zone_is_refused() -> None:
    with pytest.raises(ValueError, match="timezone-aware"):
        matching_step(new_secret(), "123456", at=datetime(2026, 9, 30, 12, 0, 7))


def test_the_same_instant_in_another_zone_gives_the_same_step() -> None:
    secret = new_secret()
    code = pyotp.TOTP(secret).at(NOW)
    elsewhere = NOW.astimezone(timezone(timedelta(hours=5, minutes=30)))
    assert matching_step(secret, code, at=elsewhere) == STEP


@pytest.mark.parametrize("secret", ["not-base32!", "A" * 33])
def test_a_stored_secret_that_is_not_base32_is_a_secret_error(secret: str) -> None:
    with pytest.raises(TotpSecretError):
        matching_step(secret, "123456", at=NOW)


def test_a_recovery_code_that_is_not_valid_text_hashes_without_raising() -> None:
    assert len(hash_recovery_code("\ud800")) == 64
