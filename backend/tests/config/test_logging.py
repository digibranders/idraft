import io
import json
import logging
from typing import Any

import structlog

from idraft.config.logging import configure_logging


def _capture(level: str = "info") -> io.StringIO:
    stream = io.StringIO()
    configure_logging(service="api", version="abc123", level=level, stream=stream)
    return stream


def _lines(stream: io.StringIO) -> list[dict[str, Any]]:
    return [json.loads(line) for line in stream.getvalue().splitlines()]


def test_emits_one_json_object_with_the_fixed_fields() -> None:
    stream = _capture()
    structlog.get_logger().info("request finished", status_code=200, duration_ms=12)
    (line,) = _lines(stream)
    assert line["msg"] == "request finished"
    assert line["level"] == "info"
    assert line["service"] == "api"
    assert line["version"] == "abc123"
    assert line["status_code"] == 200
    assert str(line["ts"]).endswith("Z")
    assert "event" not in line


def test_respects_the_minimum_level() -> None:
    stream = _capture(level="warning")
    logger = structlog.get_logger()
    logger.info("hidden")
    logger.warning("shown")
    assert [line["msg"] for line in _lines(stream)] == ["shown"]


def test_secrets_are_redacted_in_the_rendered_line() -> None:
    stream = _capture()
    structlog.get_logger().info(
        "outbound call",
        headers=[(b"authorization", b"Basic s3cret"), (b"accept", b"application/json")],
        nested=[{"inner": {"new_password": "s3cret", "session_token": "s3cret"}}],
        password="s3cret",
    )
    assert "s3cret" not in stream.getvalue()
    (line,) = _lines(stream)
    assert line["headers"] == [["authorization", "[redacted]"], ["accept", "application/json"]]
    assert line["password"] == "[redacted]"


def test_a_value_that_cannot_be_rendered_never_breaks_the_caller() -> None:
    stream = _capture()

    class Hostile:
        def __repr__(self) -> str:
            raise RuntimeError("no repr for you")

    structlog.get_logger().info("still logged", payload=Hostile())

    (line,) = _lines(stream)
    assert line["msg"] == "still logged"
    assert line["level"] == "info"
    assert line["log_error"] == "RuntimeError"
    assert "payload" not in line


def test_context_variables_are_merged() -> None:
    stream = _capture()
    structlog.contextvars.bind_contextvars(request_id="req_TEST")
    try:
        structlog.get_logger().info("with context")
    finally:
        structlog.contextvars.clear_contextvars()
    assert _lines(stream)[0]["request_id"] == "req_TEST"


def test_exceptions_become_an_err_object() -> None:
    stream = _capture()
    try:
        raise ValueError("boom")
    except ValueError:
        structlog.get_logger().exception("task failed")
    (line,) = _lines(stream)
    err = line["err"]
    assert isinstance(err, dict)
    assert err["type"] == "ValueError"
    assert err["message"] == "boom"
    assert "ValueError: boom" in str(err["stack"])
    assert "exc_info" not in line


def test_an_exception_instance_can_be_passed_directly() -> None:
    stream = _capture()
    structlog.get_logger().error("handler failed", exc_info=KeyError("missing"))
    (line,) = _lines(stream)
    err = line["err"]
    assert isinstance(err, dict)
    assert err["type"] == "KeyError"


def test_exc_info_false_adds_nothing() -> None:
    stream = _capture()
    structlog.get_logger().info("plain", exc_info=False)
    (line,) = _lines(stream)
    assert "err" not in line
    assert "exc_info" not in line


def test_standard_library_loggers_emit_the_same_json() -> None:
    stream = _capture()
    logging.getLogger("uvicorn.error").info("Application startup complete.")
    (line,) = _lines(stream)
    assert line["msg"] == "Application startup complete."
    assert line["level"] == "info"
    assert line["logger"] == "uvicorn.error"
    assert line["service"] == "api"
    assert str(line["ts"]).endswith("Z")


def test_standard_library_arguments_are_interpolated_and_redacted() -> None:
    stream = _capture()
    logging.getLogger("third.party").warning("retry %d of %d", 2, 5, extra={"password": "s3cret"})
    (line,) = _lines(stream)
    assert line["msg"] == "retry 2 of 5"
    assert "s3cret" not in stream.getvalue()


def test_uvicorn_access_lines_are_silenced_because_the_api_logs_its_own() -> None:
    stream = _capture()
    logging.getLogger("uvicorn.access").info('127.0.0.1 - "GET /x?token=hunter2 HTTP/1.1" 200')
    assert stream.getvalue() == ""


def test_standard_library_loggers_respect_the_minimum_level() -> None:
    stream = _capture(level="warning")
    logging.getLogger("uvicorn.error").info("hidden")
    logging.getLogger("uvicorn.error").warning("shown")
    assert [line["msg"] for line in _lines(stream)] == ["shown"]


def test_http_client_libraries_do_not_log_request_urls() -> None:
    stream = _capture(level="debug")
    logging.getLogger("httpx").info("HTTP Request: GET https://api.example.com/x?key=hunter2")
    logging.getLogger("httpcore").debug("send_request_headers.started url=/x?key=hunter2")
    assert stream.getvalue() == ""

    logging.getLogger("httpx").warning("connection pool is full")
    assert [line["msg"] for line in _lines(stream)] == ["connection pool is full"]


def test_terminal_colour_duplicates_from_the_server_are_dropped() -> None:
    stream = _capture()
    logging.getLogger("uvicorn.error").info(
        "Started server process [%d]", 1, extra={"color_message": "\x1b[36mStarted\x1b[0m"}
    )
    (line,) = _lines(stream)
    assert line["msg"] == "Started server process [1]"
    assert "color_message" not in line


def test_standard_library_exceptions_become_an_err_object() -> None:
    stream = _capture()
    try:
        raise LookupError("not here")
    except LookupError:
        logging.getLogger("third.party").exception("lookup failed")
    (line,) = _lines(stream)
    assert line["err"]["type"] == "LookupError"
    assert "LookupError: not here" in line["err"]["stack"]


def test_the_server_duplicate_of_an_unhandled_error_is_dropped() -> None:
    stream = _capture()
    try:
        raise RuntimeError("kaput")
    except RuntimeError:
        logging.getLogger("uvicorn.error").exception("Exception in ASGI application\n")
    assert stream.getvalue() == ""
