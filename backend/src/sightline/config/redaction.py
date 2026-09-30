"""Secret removal shared by the log pipeline and Sentry (docs/24-security.md section 11).

Keys are matched by word, not by exact name: `new_password`, `session_token` and
`DATAFORSEO_PASSWORD` are secrets, while `input_tokens` and `status_code` are not.
"""

from __future__ import annotations

import dataclasses
import re
from collections.abc import Mapping, Set
from typing import Any

from pydantic import BaseModel

CENSOR = "[redacted]"

_SECRET_WORDS = frozenset(
    {
        "password",
        "passwd",
        "secret",
        "token",
        "cookie",
        "authorization",
        "dsn",
        "session",
        "credential",
        "credentials",
        "signature",
        "dek",
        "ciphertext",
    }
)
_SECRET_PHRASES = ("api_key", "apikey", "private_key", "database_url", "redis_url")
_SECRET_PREFIXES = ("dataforseo_", "kek_", "r2_")
_WORD_BREAKS = re.compile(r"[^a-z0-9]+")
_CAMEL_BOUNDARY = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")


def _text(value: object) -> str:
    return value.decode("latin-1") if isinstance(value, bytes | bytearray) else str(value)


def is_secret_key(key: object) -> bool:
    """Whether a mapping key or header name holds a credential."""
    if not isinstance(key, str | bytes | bytearray):
        return False
    normalised = _WORD_BREAKS.sub("_", _CAMEL_BOUNDARY.sub("_", _text(key)).lower()).strip("_")
    if normalised.startswith(_SECRET_PREFIXES):
        return True
    if any(phrase in normalised for phrase in _SECRET_PHRASES):
        return True
    return not _SECRET_WORDS.isdisjoint(normalised.split("_"))


def _is_header_pair(value: object) -> bool:
    return (
        isinstance(value, tuple | list)
        and len(value) == 2
        and isinstance(value[0], str | bytes | bytearray)
        and isinstance(value[1], str | bytes | bytearray)
    )


def redact(value: Any) -> Any:
    """A JSON-serialisable copy of `value` with every secret replaced by `[redacted]`."""
    if isinstance(value, BaseModel):
        return redact(value.model_dump())
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return redact(dataclasses.asdict(value))
    if isinstance(value, Mapping):
        return {
            _text(key): CENSOR if is_secret_key(key) else redact(item)
            for key, item in value.items()
        }
    if isinstance(value, bytes | bytearray):
        return _text(value)
    if _is_header_pair(value):
        name, item = value
        return [_text(name), CENSOR if is_secret_key(name) else _text(item)]
    if isinstance(value, list | tuple | Set):
        return [redact(item) for item in value]
    return value
