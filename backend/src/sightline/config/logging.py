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
_HANDLER_NAME = "sightline-json"
_URL_LOGGING_LIBRARIES = ("httpx", "httpcore")
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
    """Replace `exc_info` with the `err` object of the log contract."""
    exc_info = event_dict.pop("exc_info", None)
    if not exc_info:
        return event_dict
    if isinstance(exc_info, BaseException):
        error: BaseException | None = exc_info
    elif isinstance(exc_info, tuple):  # standard-library records carry (type, value, traceback)
        error = exc_info[1]
    else:
        error = sys.exc_info()[1]
    if error is not None:
        event_dict["err"] = {
            "type": type(error).__name__,
            "message": str(error),
            "stack": "".join(traceback.format_exception(error)),
        }
    return event_dict


def _drop_colour_duplicate(_: WrappedLogger, __: str, event_dict: EventDict) -> EventDict:
    """uvicorn attaches an ANSI-coloured copy of each message; the plain one is enough."""
    event_dict.pop("color_message", None)
    return event_dict


def _route_standard_library_logs(
    shared: list[Processor], final: list[Processor], level: int, stream: TextIO
) -> None:
    """Send `logging` records (uvicorn, SQLAlchemy, Alembic) through the same JSON pipeline."""
    handler = logging.StreamHandler(stream)
    handler.set_name(_HANDLER_NAME)
    handler.setFormatter(
        structlog.stdlib.ProcessorFormatter(
            foreign_pre_chain=[
                structlog.stdlib.add_logger_name,
                structlog.stdlib.ExtraAdder(),
                _drop_colour_duplicate,
                *shared,
            ],
            processors=[structlog.stdlib.ProcessorFormatter.remove_processors_meta, *final],
        )
    )
    root = logging.getLogger()
    for existing in [h for h in root.handlers if h.get_name() == _HANDLER_NAME]:
        root.removeHandler(existing)
    root.addHandler(handler)
    root.setLevel(level)

    # uvicorn installs its own handlers before the app factory runs; hand its loggers to the root
    # handler, and drop its access log because AccessLogMiddleware writes the request line.
    for name in ("uvicorn", "uvicorn.error"):
        server_logger = logging.getLogger(name)
        server_logger.handlers.clear()
        server_logger.propagate = True
    access = logging.getLogger("uvicorn.access")
    access.handlers.clear()
    access.propagate = False

    # HTTP client libraries log every request URL at info level, query string included. Provider
    # calls are logged by our own client with the endpoint family name instead.
    for name in _URL_LOGGING_LIBRARIES:
        logging.getLogger(name).setLevel(logging.WARNING)


def configure_logging(
    *, service: str, version: str, level: str, stream: TextIO | None = None
) -> None:
    def add_service(_: WrappedLogger, __: str, event_dict: EventDict) -> EventDict:
        event_dict["service"] = service
        event_dict["version"] = version
        return event_dict

    output = stream or sys.stdout
    shared: list[Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True, key="ts"),
        add_service,
        _exception_processor,
    ]
    final: list[Processor] = [
        structlog.processors.EventRenamer("msg"),
        _redact_processor,
        structlog.processors.JSONRenderer(),
    ]
    structlog.configure(
        processors=[*shared, *final],
        wrapper_class=structlog.make_filtering_bound_logger(_LEVELS[level]),
        logger_factory=structlog.PrintLoggerFactory(file=output),
        cache_logger_on_first_use=False,
    )
    _route_standard_library_logs(shared, final, _LEVELS[level], output)
