import dataclasses

import pytest
from pydantic import BaseModel

from idraft.config.redaction import CENSOR, is_secret_key, redact


class Login(BaseModel):
    email: str
    password: str


@dataclasses.dataclass
class Credentials:
    login: str
    api_key: str


@pytest.mark.parametrize(
    "key",
    [
        "password",
        "Password",
        "new_password",
        "password_hash",
        "DATAFORSEO_PASSWORD",
        "dataforseo_login",
        "token",
        "session_token",
        "access_token",
        "x-csrf-token",
        "secret",
        "client_secret",
        "totp_secret",
        "authorization",
        "Proxy-Authorization",
        "cookie",
        "Set-Cookie",
        "session",
        "session_id",
        "__Host-session",
        "api_key",
        "apiKey",
        "X-Api-Key",
        "private_key",
        "database_url",
        "redis_url",
        "sentry_dsn",
        "dsn",
        "dek",
        "dek_wrapped",
        "ciphertext",
        b"authorization",
    ],
)
def test_secret_shaped_keys_are_recognised(key: str | bytes) -> None:
    assert is_secret_key(key)


@pytest.mark.parametrize(
    "key",
    [
        "status_code",
        "duration_ms",
        "request_id",
        "route",
        "input_tokens",
        "output_tokens",
        "workspace_id",
        "keyword_count",
        "ranking_url_hash",
        "engine_code",
        "secretary",
        7,
        None,
    ],
)
def test_ordinary_keys_are_left_alone(key: object) -> None:
    assert not is_secret_key(key)


def test_redacts_at_any_depth() -> None:
    value: object = {"password": "LEAK"}
    for _ in range(40):
        value = {"wrap": [value]}
    assert "LEAK" not in repr(redact(value))


def test_redacts_raw_asgi_header_pairs() -> None:
    headers = [(b"authorization", b"Bearer LEAK1"), (b"cookie", b"__Host-session=LEAK2")]
    assert redact({"headers": headers}) == {
        "headers": [["authorization", CENSOR], ["cookie", CENSOR]]
    }


def test_header_pairs_with_ordinary_names_are_kept() -> None:
    assert redact([(b"accept", b"application/json")]) == [["accept", "application/json"]]


def test_walks_models_dataclasses_tuples_and_sets() -> None:
    result = redact(
        {
            "model": Login(email="a@b.c", password="LEAK3"),
            "data": Credentials(login="svc", api_key="LEAK4"),
            "pair": ("fine", {"token": "LEAK5"}),
            "group": {"alpha"},
        }
    )
    assert "LEAK" not in repr(result)
    assert result["model"] == {"email": "a@b.c", "password": CENSOR}
    assert result["data"] == {"login": "svc", "api_key": CENSOR}
    assert result["group"] == ["alpha"]


def test_keys_become_strings_so_the_result_is_always_json_serialisable() -> None:
    assert redact({b"accept": "x", 3: "y", None: "z"}) == {"accept": "x", "3": "y", "None": "z"}


def test_bytes_values_are_decoded() -> None:
    assert redact({"body_sha": b"abc"}) == {"body_sha": "abc"}


def test_scalars_pass_through_unchanged() -> None:
    assert redact({"n": 1, "f": 1.5, "b": True, "none": None, "s": "text"}) == {
        "n": 1,
        "f": 1.5,
        "b": True,
        "none": None,
        "s": "text",
    }
