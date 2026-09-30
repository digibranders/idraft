import pytest
from pydantic import ValidationError

from sightline.config.settings import Settings, load_settings, to_sqlalchemy_url

BASE_ENV = {
    "APP_ORIGIN": "https://app.example.com",
    "DATABASE_URL": "postgresql://app_api:pw@postgres:5432/sightline",
    "REDIS_URL": "redis://app:pw@redis:6379/0",
}
ALL_NAMES = (
    "APP_ORIGIN",
    "DATABASE_URL",
    "REDIS_URL",
    "LOG_LEVEL",
    "DB_POOL_SIZE",
    "DB_STATEMENT_TIMEOUT",
    "SENTRY_DSN",
    "PROCESS_ROLE",
    "RELEASE_SHA",
    "APP_ENV",
)


def _set(monkeypatch: pytest.MonkeyPatch, env: dict[str, str]) -> None:
    for name in ALL_NAMES:
        monkeypatch.delenv(name, raising=False)
    for name, value in env.items():
        monkeypatch.setenv(name, value)


def test_loads_required_values_and_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    _set(monkeypatch, BASE_ENV)
    settings = Settings()
    assert settings.app_origin == "https://app.example.com"
    assert settings.process_role == "api"
    assert settings.release_sha == "dev"
    assert settings.environment == "local"
    assert settings.log_level == "info"
    assert settings.db_pool_size == 10
    assert settings.db_statement_timeout == "15s"
    assert settings.sentry_dsn is None


def test_environment_is_read_from_app_env(monkeypatch: pytest.MonkeyPatch) -> None:
    _set(monkeypatch, {**BASE_ENV, "APP_ENV": "production"})
    assert Settings().environment == "production"


def test_app_origin_has_no_trailing_slash(monkeypatch: pytest.MonkeyPatch) -> None:
    _set(monkeypatch, {**BASE_ENV, "APP_ORIGIN": "https://app.example.com/"})
    assert Settings().app_origin == "https://app.example.com"


def test_empty_sentry_dsn_means_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    _set(monkeypatch, {**BASE_ENV, "SENTRY_DSN": ""})
    assert Settings().sentry_dsn is None


def test_sqlalchemy_url_uses_the_asyncpg_driver(monkeypatch: pytest.MonkeyPatch) -> None:
    _set(monkeypatch, BASE_ENV)
    assert Settings().sqlalchemy_url == "postgresql+asyncpg://app_api:pw@postgres:5432/sightline"


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("postgresql://u:p@h/db", "postgresql+asyncpg://u:p@h/db"),
        ("postgres://u:p@h/db", "postgresql+asyncpg://u:p@h/db"),
        ("postgresql+asyncpg://u:p@h/db", "postgresql+asyncpg://u:p@h/db"),
    ],
)
def test_to_sqlalchemy_url(url: str, expected: str) -> None:
    assert to_sqlalchemy_url(url) == expected


@pytest.mark.parametrize(
    "override",
    [
        {"DATABASE_URL": "mysql://u:p@h/db"},
        {"REDIS_URL": "http://redis:6379"},
        {"APP_ORIGIN": "app.example.com"},
        {"DB_STATEMENT_TIMEOUT": "fast"},
        {"DB_POOL_SIZE": "0"},
        {"LOG_LEVEL": "verbose"},
        {"APP_ENV": "staging"},
    ],
)
def test_rejects_invalid_values(monkeypatch: pytest.MonkeyPatch, override: dict[str, str]) -> None:
    _set(monkeypatch, {**BASE_ENV, **override})
    with pytest.raises(ValidationError):
        Settings()


def test_load_settings_exits_and_names_the_field_without_its_value(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _set(monkeypatch, {**BASE_ENV, "DATABASE_URL": "mysql://user:hunter2@h/db"})
    with pytest.raises(SystemExit) as exit_info:
        load_settings()
    assert exit_info.value.code == 2
    err = capsys.readouterr().err
    assert "DATABASE_URL" in err
    assert "hunter2" not in err


def test_load_settings_reports_missing_variables(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _set(monkeypatch, {"APP_ORIGIN": "https://app.example.com"})
    with pytest.raises(SystemExit):
        load_settings()
    err = capsys.readouterr().err
    assert "DATABASE_URL" in err
    assert "REDIS_URL" in err


def test_load_settings_reports_the_environment_variable_for_an_aliased_field(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _set(monkeypatch, {**BASE_ENV, "APP_ENV": "staging"})
    with pytest.raises(SystemExit):
        load_settings()
    assert "APP_ENV" in capsys.readouterr().err
