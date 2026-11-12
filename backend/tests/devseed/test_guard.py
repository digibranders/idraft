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


@pytest.mark.parametrize(
    "host",
    ["db.internal", "201.18.204.36", "postgres", "localhost.example.com", "10.0.0.5", "0.0.0.0"],
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
