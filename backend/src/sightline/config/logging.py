"""One JSON object per line on stdout, with secrets removed (docs/25-observability.md section 3)."""

from __future__ import annotations

import logging
import sys
import traceback
from collections.abc import Mapping, Sequence
from typing import Any, TextIO

import structlog
from structlog.typing import EventDict, Processor, WrappedLogger

REDACT_KEYS: frozenset[str] = frozenset(
    {
        "authorization",
        "cookie",
        "set-cookie",
        "x-api-key",
        "password",
        "token",
        "access_token",
        "refresh_token",
        "id_token",
        "api_key",
        "apikey",
        "secret",
        "client_secret",
        "totp_secret",
        "dek",
        "dek_wrapped",
        "ciphertext",
    }
)
_CENSOR = "[redacted]"
_LEVELS: Mapping[str, int] = {
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warning": logging.WARNING,
    "error": logging.ERROR,
    "critical": logging.CRITICAL,
}


def _redact(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {
            key: _CENSOR if str(key).lower() in REDACT_KEYS else _redact(item)
            for key, item in value.items()
        }
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [_redact(item) for item in value]
    return value


def _redact_processor(_: WrappedLogger, __: str, event_dict: EventDict) -> EventDict:
    redacted: dict[str, Any] = _redact(event_dict)
    return redacted


def _exception_processor(_: WrappedLogger, __: str, event_dict: EventDict) -> EventDict:
    """Replace structlog's `exc_info` with the `err` object of the log contract."""
    exc_info = event_dict.pop("exc_info", None)
    if not exc_info:
        return event_dict
    error = exc_info if isinstance(exc_info, BaseException) else sys.exc_info()[1]
    if error is not None:
        event_dict["err"] = {
            "type": type(error).__name__,
            "message": str(error),
            "stack": "".join(traceback.format_exception(error)),
        }
    return event_dict


def configure_logging(
    *, service: str, version: str, level: str, stream: TextIO | None = None
) -> None:
    def add_service(_: WrappedLogger, __: str, event_dict: EventDict) -> EventDict:
        event_dict["service"] = service
        event_dict["version"] = version
        return event_dict

    processors: list[Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True, key="ts"),
        add_service,
        _exception_processor,
        structlog.processors.EventRenamer("msg"),
        _redact_processor,
        structlog.processors.JSONRenderer(),
    ]
    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(_LEVELS[level]),
        logger_factory=structlog.PrintLoggerFactory(file=stream or sys.stdout),
        cache_logger_on_first_use=False,
    )
