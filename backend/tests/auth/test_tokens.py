import hashlib
import re

from idraft.api.auth.tokens import hash_token, new_token


def test_a_token_is_256_random_bits_in_url_safe_text() -> None:
    token = new_token()
    assert re.fullmatch(r"[A-Za-z0-9_-]{43}", token)


def test_tokens_do_not_repeat() -> None:
    assert len({new_token() for _ in range(200)}) == 200


def test_the_stored_form_is_the_sha256_digest() -> None:
    token = new_token()
    assert hash_token(token) == hashlib.sha256(token.encode()).digest()
    assert len(hash_token(token)) == 32


def test_a_value_that_is_not_valid_text_hashes_without_raising() -> None:
    assert len(hash_token("\ud800")) == 32
    assert hash_token("\ud800") != hash_token("?")
