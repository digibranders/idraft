from collections.abc import Iterator

import pytest
import sentry_sdk

from sightline.config.sentry import TRACES_SAMPLE_RATE, init_sentry
from sightline.config.settings import Settings


def _settings(sentry_dsn: str | None = None) -> Settings:
    return Settings(
        app_origin="https://app.example.com",
        database_url="postgresql://u:p@h/db",
        redis_url="redis://h:6379/0",
        release_sha="abc123",
        environment="test",
        sentry_dsn=sentry_dsn,
    )


@pytest.fixture(autouse=True)
def _reset_sentry() -> Iterator[None]:
    yield
    sentry_sdk.init(dsn=None)


def test_sentry_stays_off_without_a_dsn() -> None:
    assert init_sentry(_settings()) is False
    assert sentry_sdk.get_client().is_active() is False


def test_sentry_starts_with_a_dsn_and_the_locked_options() -> None:
    assert init_sentry(_settings(sentry_dsn="https://public@o0.ingest.sentry.io/0")) is True
    options = sentry_sdk.get_client().options
    assert options["release"] == "abc123"
    assert options["environment"] == "test"
    assert options["traces_sample_rate"] == TRACES_SAMPLE_RATE == 0.1
    assert options["send_default_pii"] is False
