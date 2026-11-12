"""The seed refuses every environment that is not a developer's machine: production, the test
suite, a database elsewhere, an origin elsewhere, and the server's own settings."""

from __future__ import annotations

from typing import Literal

import pytest
from pydantic import SecretStr

from idraft.config.settings import Settings
from idraft.devseed.guard import NotDevelopmentError, check_development

PASSWORD = "api-dev-password"


def _settings(
    *,
    app_env: Literal["local", "test", "production"] = "local",
    database_host: str = "127.0.0.1",
    app_origin: str = "http://localhost:3000",
) -> Settings:
    return Settings(
        process_role="cli",
        app_env=app_env,
        app_origin=app_origin,
        database_url=SecretStr(f"postgresql://app_api:{PASSWORD}@{database_host}:54329/idraft"),
        redis_url=SecretStr("redis://127.0.0.1:63799/0"),
    )


@pytest.mark.parametrize("host", ["localhost", "127.0.0.1", "[::1]", "LOCALHOST"])
@pytest.mark.parametrize(
    "origin", ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"]
)
def test_a_developer_machine_passes(host: str, origin: str) -> None:
    check_development(_settings(database_host=host, app_origin=origin))


def test_production_is_refused_even_on_this_machine() -> None:
    with pytest.raises(NotDevelopmentError, match="APP_ENV is production"):
        check_development(_settings(app_env="production", app_origin="https://localhost"))


def test_the_test_environment_is_refused() -> None:
    with pytest.raises(NotDevelopmentError, match="APP_ENV is test"):
        check_development(_settings(app_env="test"))


# Every host here passes `Settings` validation (checked when this list was written), so each
# refusal below is the guard's own decision, not the settings'. `[[::1]]` reaches the guard as
# the host `[::1]` and `localhost]` as itself: the guard does not strip brackets.
@pytest.mark.parametrize(
    "host",
    [
        "db.internal",
        "201.18.204.36",
        "postgres",
        "localhost.example.com",
        "10.0.0.5",
        "0.0.0.0",
        "localhost.",
        "127.0.0.2",
        "127.1",
        "localhost,evil.example",
        "[::2]",
        "[[::1]]",
        "localhost]",
    ],
)
def test_a_database_elsewhere_is_refused(host: str) -> None:
    with pytest.raises(NotDevelopmentError, match="DATABASE_URL") as caught:
        check_development(_settings(database_host=host))

    assert PASSWORD not in str(caught.value)


@pytest.mark.parametrize(
    "origin",
    [
        "https://app.idraft.ai",
        "http://localhost.example.com:3000",
        "http://10.0.0.5:3000",
        "https://127.0.0.1.nip.io",
        "http://localhost.:3000",  # passes Settings validation; the guard refuses the trailing dot
    ],
)
def test_an_origin_elsewhere_is_refused(origin: str) -> None:
    with pytest.raises(NotDevelopmentError, match="APP_ORIGIN"):
        check_development(_settings(app_origin=origin))


def test_the_servers_own_settings_are_refused() -> None:
    """What infra/vps/provision.sh writes: production, the public origin, and a database on the
    server's own loopback."""
    with pytest.raises(NotDevelopmentError):
        check_development(
            _settings(
                app_env="production", database_host="127.0.0.1", app_origin="https://app.idraft.ai"
            )
        )


def test_an_environment_that_is_not_local_is_refused_before_anything_else() -> None:
    """Every other fact is wrong too; the first refusal names the environment."""
    with pytest.raises(NotDevelopmentError, match="APP_ENV is production"):
        check_development(
            _settings(
                app_env="production",
                database_host="db.internal",
                app_origin="https://app.idraft.ai",
            )
        )


def test_a_missing_host_is_refused_not_assumed_local() -> None:
    """Settings validation makes a hostless URL impossible; the guard still fails closed if one
    is ever built without validation."""
    no_database_host = Settings.model_construct(
        app_env="local",
        app_origin="http://localhost:3000",
        database_url=SecretStr("postgresql:///idraft"),
    )
    no_origin_host = Settings.model_construct(
        app_env="local",
        app_origin="",
        database_url=SecretStr(f"postgresql://app_api:{PASSWORD}@127.0.0.1:54329/idraft"),
    )

    with pytest.raises(NotDevelopmentError, match="DATABASE_URL"):
        check_development(no_database_host)
    with pytest.raises(NotDevelopmentError, match="APP_ORIGIN"):
        check_development(no_origin_host)


def _unvalidated(*, database_url: str, app_origin: str = "http://localhost:3000") -> Settings:
    """Settings as they would be if built without validation, which is the only way a URL that
    cannot be parsed reaches the guard."""
    return Settings.model_construct(
        app_env="local", app_origin=app_origin, database_url=SecretStr(database_url)
    )


@pytest.mark.parametrize(
    "database_url",
    [
        f"not a url {PASSWORD}",  # SQLAlchemy raises ArgumentError, whose text quotes the URL
        f"postgresql://app_api:{PASSWORD}@::1:54329/idraft",  # int() of a port raises ValueError
    ],
    ids=["argument-error", "value-error"],
)
def test_a_database_url_that_cannot_be_read_gets_the_generic_refusal(database_url: str) -> None:
    with pytest.raises(NotDevelopmentError, match="DATABASE_URL could not be read") as caught:
        check_development(_unvalidated(database_url=database_url))

    message = str(caught.value)
    assert PASSWORD not in message
    assert "app_api" not in message
    assert caught.value.__suppress_context__


@pytest.mark.parametrize(
    "origin",
    [
        f"http://user:{PASSWORD}@[bad",  # urlsplit raises ValueError: Invalid IPv6 URL
        "http://localhost]:3000",
        "http://[[::1]]:3000",
        "http://[localhost]:3000",  # a bracket around a name is not an IPv6 literal
    ],
)
def test_an_origin_that_cannot_be_read_gets_the_generic_refusal(origin: str) -> None:
    settings = _unvalidated(
        database_url=f"postgresql://app_api:{PASSWORD}@127.0.0.1:54329/idraft", app_origin=origin
    )

    with pytest.raises(NotDevelopmentError, match="APP_ORIGIN could not be read") as caught:
        check_development(settings)

    assert PASSWORD not in str(caught.value)
    assert caught.value.__suppress_context__
