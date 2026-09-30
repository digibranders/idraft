import io
import json

import structlog

from sightline.config.logging import REDACT_KEYS, configure_logging


def _capture(level: str = "info") -> io.StringIO:
    stream = io.StringIO()
    configure_logging(service="api", version="abc123", level=level, stream=stream)
    return stream


def _lines(stream: io.StringIO) -> list[dict[str, object]]:
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


def test_redacts_every_secret_shaped_key_at_any_depth() -> None:
    stream = _capture()
    payload = dict.fromkeys(REDACT_KEYS, "s3cret")
    structlog.get_logger().info(
        "outbound call",
        headers={"Authorization": "Basic s3cret", "Accept": "application/json"},
        nested=[{"inner": payload}],
        password="s3cret",
    )
    raw = stream.getvalue()
    assert "s3cret" not in raw
    (line,) = _lines(stream)
    assert line["headers"] == {"Authorization": "[redacted]", "Accept": "application/json"}
    assert line["password"] == "[redacted]"


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
