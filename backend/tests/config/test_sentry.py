from collections.abc import Iterator
from typing import Any, cast

import pytest
import sentry_sdk
from fastapi.exceptions import ResponseValidationError
from pydantic import SecretStr
from sentry_sdk.types import Breadcrumb, Event

from sightline.config.sentry import (
    TRACES_SAMPLE_RATE,
    init_sentry,
    scrub_breadcrumb,
    scrub_event,
)
from sightline.config.settings import Settings


def _settings(sentry_dsn: str | None = None) -> Settings:
    return Settings(
        app_origin="https://app.example.com",
        database_url=SecretStr("postgresql://u:p@h/db"),
        redis_url=SecretStr("redis://h:6379/0"),
        release_sha="abc123",
        app_env="test",
        sentry_dsn=SecretStr(sentry_dsn) if sentry_dsn else None,
        totp_encryption_key=SecretStr("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="),
    )


@pytest.fixture(autouse=True)
def _reset_sentry() -> Iterator[None]:
    yield
    sentry_sdk.init(dsn=None)


def test_sentry_stays_off_without_a_dsn() -> None:
    assert init_sentry(_settings()) is False
    assert sentry_sdk.get_client().is_active() is False


def test_sentry_starts_with_a_dsn_and_the_locked_options() -> None:
    assert init_sentry(_settings("https://public@o0.ingest.sentry.io/0")) is True
    options = sentry_sdk.get_client().options
    assert options["release"] == "abc123"
    assert options["environment"] == "test"
    assert options["traces_sample_rate"] == TRACES_SAMPLE_RATE == 0.1
    assert options["send_default_pii"] is False
    assert options["include_local_variables"] is False
    assert options["max_request_body_size"] == "never"
    assert options["before_send"] is scrub_event
    assert options["before_breadcrumb"] is scrub_breadcrumb


def _scrub(event: dict[str, Any], hint: dict[str, Any] | None = None) -> dict[str, Any]:
    scrubbed = scrub_event(cast(Event, event), hint or {})
    assert scrubbed is not None
    return dict(scrubbed)


def _event() -> dict[str, Any]:
    return {
        "request": {
            "url": "https://app.example.com/api/v1/things",
            "query_string": "token=LEAK1",
            "headers": {"cookie": "__Host-session=LEAK2", "accept": "application/json"},
            "cookies": {"__Host-session": "LEAK3"},
            "data": {"password": "LEAK4", "keyword": "LEAK5"},
        },
        "extra": {"nested": [{"refresh_token": "LEAK6"}]},
        "exception": {"values": [{"type": "ValueError", "value": "boom"}]},
    }


def test_events_lose_bodies_cookies_queries_and_secret_keys() -> None:
    scrubbed = _scrub(_event())
    assert "LEAK" not in repr(scrubbed)
    assert scrubbed["request"]["url"] == "https://app.example.com/api/v1/things"
    assert scrubbed["request"]["headers"]["accept"] == "application/json"
    assert "data" not in scrubbed["request"]
    assert "cookies" not in scrubbed["request"]
    assert "query_string" not in scrubbed["request"]
    assert scrubbed["exception"]["values"][0] == {"type": "ValueError", "value": "boom"}


def test_response_validation_errors_lose_the_returned_value() -> None:
    error = ResponseValidationError(
        errors=[{"type": "int_parsing", "loc": ("response", "count"), "input": "LEAK7"}]
    )
    event = {"exception": {"values": [{"type": "ResponseValidationError", "value": str(error)}]}}
    scrubbed = _scrub(event, {"exc_info": (type(error), error, None)})
    assert "LEAK7" not in repr(scrubbed)
    assert scrubbed["exception"]["values"][0]["value"] == "response did not match its model"


def test_breadcrumbs_are_scrubbed_with_the_same_rules() -> None:
    crumb = {"category": "httplib", "data": {"url": "https://x/y", "authorization": "LEAK8"}}
    scrubbed = cast("dict[str, Any]", scrub_breadcrumb(cast(Breadcrumb, crumb), {}))
    assert "LEAK8" not in repr(scrubbed)
    assert scrubbed["data"]["url"] == "https://x/y"
