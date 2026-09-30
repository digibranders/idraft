import pytest
from pydantic import ValidationError

from sightline.config.settings import (
    MigratorSettings,
    Settings,
    load_migrator_settings,
    load_settings,
    to_asyncpg_dsn,
    to_sqlalchemy_url,
)

TOTP_KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="  # bytes 0 to 31
BASE_ENV = {
    "APP_ORIGIN": "https://app.example.com",
    "DATABASE_URL": "postgresql://app_api:pw@postgres:5432/sightline",
    "REDIS_URL": "redis://app:pw@redis:6379/0",
    "TOTP_ENCRYPTION_KEY": TOTP_KEY,
    "EMAIL_PROVIDER": "resend",
    "EMAIL_API_KEY": "re_123",
    "EMAIL_FROM": "Sightline <login@mail.example.com>",
}
# What a developer's machine has: a local origin and no email provider.
LOCAL_ENV = {
    "APP_ORIGIN": "http://localhost:3000",
    "DATABASE_URL": BASE_ENV["DATABASE_URL"],
    "REDIS_URL": BASE_ENV["REDIS_URL"],
    "TOTP_ENCRYPTION_KEY": TOTP_KEY,
}


def _set(monkeypatch: pytest.MonkeyPatch, env: dict[str, str]) -> None:
    for name, value in env.items():
        monkeypatch.setenv(name, value)


def test_loads_required_values_and_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    _set(monkeypatch, LOCAL_ENV)
    settings = Settings()
    assert settings.app_origin == "http://localhost:3000"
    assert settings.process_role == "api"
    assert settings.release_sha == "dev"
    assert settings.app_env == "local"
    assert settings.log_level == "info"
    assert settings.db_pool_size == 10
    assert settings.db_statement_timeout == "15s"
    assert settings.sentry_dsn is None
    assert settings.registration == "invited"
    assert settings.email_provider == "console"
    assert settings.email_api_key is None
    assert settings.email_from == "Sightline <no-reply@localhost>"
    assert settings.breached_password_check is True
    assert settings.totp_key == bytes(range(32))


def test_app_env_is_read_from_its_variable_only(monkeypatch: pytest.MonkeyPatch) -> None:
    _set(monkeypatch, {**BASE_ENV, "APP_ENV": "production", "ENVIRONMENT": "local"})
    assert Settings().app_env == "production"


@pytest.mark.parametrize(
    ("origin", "expected"),
    [
        ("https://app.example.com/", "https://app.example.com"),
        ("https://APP.Example.com", "https://app.example.com"),
        ("http://localhost:3000", "http://localhost:3000"),
        ("http://[::1]:3000", "http://[::1]:3000"),
        ("https://app.example.com:443", "https://app.example.com"),
        ("http://localhost:80", "http://localhost"),
        ("https://app.example.com:8443", "https://app.example.com:8443"),
        ("http://app.example.com:443", "http://app.example.com:443"),
        ("https://[2001:DB8::1]", "https://[2001:db8::1]"),
        (" https://app.example.com ", "https://app.example.com"),
    ],
)
def test_app_origin_is_normalised_to_scheme_and_host(
    monkeypatch: pytest.MonkeyPatch, origin: str, expected: str
) -> None:
    _set(monkeypatch, {**BASE_ENV, "APP_ORIGIN": origin})
    assert Settings().app_origin == expected


def test_empty_sentry_dsn_means_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    _set(monkeypatch, {**BASE_ENV, "SENTRY_DSN": ""})
    assert Settings().sentry_dsn is None


def test_connection_urls_are_exposed_per_driver(monkeypatch: pytest.MonkeyPatch) -> None:
    _set(monkeypatch, BASE_ENV)
    settings = Settings()
    assert settings.sqlalchemy_url == "postgresql+asyncpg://app_api:pw@postgres:5432/sightline"
    assert settings.asyncpg_dsn == "postgresql://app_api:pw@postgres:5432/sightline"


@pytest.mark.parametrize(
    "url", ["postgresql://u:p@h/db", "postgres://u:p@h/db", "postgresql+asyncpg://u:p@h/db"]
)
def test_url_conversions(url: str) -> None:
    assert to_sqlalchemy_url(url) == "postgresql+asyncpg://u:p@h/db"
    assert to_asyncpg_dsn(url) == "postgresql://u:p@h/db"


def test_secrets_never_appear_in_repr_or_str(monkeypatch: pytest.MonkeyPatch) -> None:
    _set(
        monkeypatch,
        {
            "APP_ORIGIN": "https://app.example.com",
            "DATABASE_URL": "postgresql://app_api:LEAK1@postgres/sightline",
            "REDIS_URL": "redis://app:LEAK2@redis:6379/0",
            "SENTRY_DSN": "https://LEAK3@o0.ingest.sentry.io/0",
            "TOTP_ENCRYPTION_KEY": "TEVBSzRMRUFLNExFQUs0TEVBSzRMRUFLNExFQUs0TEU=",
            "EMAIL_PROVIDER": "resend",
            "EMAIL_API_KEY": "re_LEAK5",
            "EMAIL_FROM": "Sightline <login@mail.example.com>",
        },
    )
    settings = Settings()
    assert "LEAK" not in repr(settings)
    assert "LEAK" not in str(settings)
    assert "LEAK" not in settings.model_dump_json()
    assert "TEVBSz" not in repr(settings) + settings.model_dump_json()


@pytest.mark.parametrize(
    "override",
    [
        {"DATABASE_URL": "mysql://u:p@h/db"},
        {"DATABASE_URL": "postgresql+psycopg://u:p@h/db"},
        {"DATABASE_URL": "postgresql://"},
        {"DATABASE_URL": "postgresql://u:p@h"},
        {"DATABASE_URL": "postgresql://u:p@h:notaport/db"},
        {"DATABASE_URL": "postgresql://u:p@ss@h/db"},
        {"DATABASE_URL": "postgresql://u:p@h/db?sslmode=require"},
        {"REDIS_URL": "http://redis:6379"},
        {"REDIS_URL": "redis://"},
        {"APP_ORIGIN": "app.example.com"},
        {"APP_ORIGIN": "https://"},
        {"APP_ORIGIN": "https://app.example.com/some/path"},
        {"APP_ORIGIN": "https://user:pw@app.example.com"},
        {"APP_ORIGIN": "https://app.example.com?x=1"},
        {"APP_ORIGIN": "ftp://app.example.com"},
        {"APP_ORIGIN": "https://app.example.com:notaport"},
        {"APP_ORIGIN": "https://app.example.com#fragment"},
        {"DB_STATEMENT_TIMEOUT": "fast"},
        {"DB_STATEMENT_TIMEOUT": "1٣s"},
        {"DB_STATEMENT_TIMEOUT": "99999999999999999999s"},
        {"DB_POOL_SIZE": "0"},
        {"LOG_LEVEL": "verbose"},
        {"APP_ENV": "staging"},
        {"APP_ENV": "production", "APP_ORIGIN": "http://app.example.com"},
        {"REGISTRATION": "closed"},
        {"TOTP_ENCRYPTION_KEY": ""},
        {"TOTP_ENCRYPTION_KEY": "not base64 at all!"},
        {"TOTP_ENCRYPTION_KEY": "AAECAwQFBgcICQoLDA0ODw=="},
        {"TOTP_ENCRYPTION_KEY": "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gIQ=="},
        {"EMAIL_PROVIDER": "sendgrid"},
        {"EMAIL_API_KEY": ""},
        {"EMAIL_FROM": "Sightline <no-reply@localhost>"},
        {"EMAIL_PROVIDER": "console"},
        {"EMAIL_FROM": "Sightline"},
        {"EMAIL_FROM": "Sightline <a@b.example>\r\nBcc: x@y.example"},
        {"APP_ENV": "production", "EMAIL_PROVIDER": "console"},
        {"BREACHED_PASSWORD_CHECK": "sometimes"},
    ],
)
def test_rejects_invalid_values(monkeypatch: pytest.MonkeyPatch, override: dict[str, str]) -> None:
    _set(monkeypatch, {**BASE_ENV, **override})
    with pytest.raises(ValidationError):
        Settings()


def test_validation_errors_never_echo_the_rejected_value(monkeypatch: pytest.MonkeyPatch) -> None:
    _set(monkeypatch, {**BASE_ENV, "DATABASE_URL": "mysql://user:hunter2@h/db"})
    with pytest.raises(ValidationError) as error:
        Settings()
    assert "hunter2" not in str(error.value)


def test_a_percent_encoded_password_is_accepted(monkeypatch: pytest.MonkeyPatch) -> None:
    _set(monkeypatch, {**BASE_ENV, "DATABASE_URL": "postgresql://u:p%40ss%25@h:5432/db"})
    assert Settings().asyncpg_dsn == "postgresql://u:p%40ss%25@h:5432/db"


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


def test_the_migrator_needs_only_a_database_url(monkeypatch: pytest.MonkeyPatch) -> None:
    _set(monkeypatch, {"DATABASE_URL": BASE_ENV["DATABASE_URL"], "RELEASE_SHA": "abc123"})
    settings = load_migrator_settings()
    assert isinstance(settings, MigratorSettings)
    assert settings.asyncpg_dsn == BASE_ENV["DATABASE_URL"]
    assert settings.release_sha == "abc123"
    assert settings.log_level == "info"


def test_the_migrator_exits_without_a_database_url(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exit_info:
        load_migrator_settings()
    assert exit_info.value.code == 2
    assert "DATABASE_URL" in capsys.readouterr().err


def test_the_api_cannot_start_without_a_totp_key(monkeypatch: pytest.MonkeyPatch) -> None:
    env = {name: value for name, value in BASE_ENV.items() if name != "TOTP_ENCRYPTION_KEY"}
    _set(monkeypatch, env)
    with pytest.raises(ValidationError, match="TOTP_ENCRYPTION_KEY is required"):
        Settings()


@pytest.mark.parametrize("role", ["worker", "migrator", "cli"])
def test_other_processes_do_not_need_a_totp_key(monkeypatch: pytest.MonkeyPatch, role: str) -> None:
    env = {name: value for name, value in BASE_ENV.items() if name != "TOTP_ENCRYPTION_KEY"}
    _set(monkeypatch, {**env, "PROCESS_ROLE": role})
    settings = Settings()
    assert settings.totp_encryption_key is None
    with pytest.raises(RuntimeError, match="no TOTP encryption key"):
        _ = settings.totp_key


def test_a_rejected_totp_key_is_not_echoed(monkeypatch: pytest.MonkeyPatch) -> None:
    _set(monkeypatch, {**BASE_ENV, "TOTP_ENCRYPTION_KEY": "c2hvcnQtc2VjcmV0LWtleQ=="})
    with pytest.raises(ValidationError) as error:
        Settings()
    assert "c2hvcnQt" not in str(error.value)
    assert "32 random bytes" in str(error.value)


def test_production_with_resend_is_accepted(monkeypatch: pytest.MonkeyPatch) -> None:
    _set(
        monkeypatch,
        {
            **BASE_ENV,
            "APP_ENV": "production",
            "EMAIL_PROVIDER": "resend",
            "EMAIL_API_KEY": "re_123",
            "EMAIL_FROM": "Sightline <login@mail.example.com>",
            "REGISTRATION": "open",
        },
    )
    settings = Settings()
    assert settings.email_provider == "resend"
    assert settings.registration == "open"


@pytest.mark.parametrize("key", [TOTP_KEY + "\n", f"  {TOTP_KEY}  ", TOTP_KEY + "\r\n"])
def test_whitespace_around_the_totp_key_is_ignored(
    monkeypatch: pytest.MonkeyPatch, key: str
) -> None:
    _set(monkeypatch, {**BASE_ENV, "TOTP_ENCRYPTION_KEY": key})
    assert Settings().totp_key == bytes(range(32))


def test_the_worker_may_run_in_production_without_an_email_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    env = {**LOCAL_ENV, "APP_ORIGIN": "https://app.example.com"}
    _set(monkeypatch, {**env, "APP_ENV": "production", "PROCESS_ROLE": "worker"})
    assert Settings().email_provider == "console"


@pytest.mark.parametrize(
    "origin",
    [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://[::1]:3000",
        "http://app.localhost:3000",
        "https://sightline.test",
    ],
)
def test_the_console_sender_is_allowed_for_a_local_origin(
    monkeypatch: pytest.MonkeyPatch, origin: str
) -> None:
    _set(monkeypatch, {**LOCAL_ENV, "APP_ORIGIN": origin})
    assert Settings().email_provider == "console"


@pytest.mark.parametrize(
    "origin",
    ["https://app.example.com", "http://10.0.0.5:3000", "https://localhost.evil.example"],
)
def test_a_host_that_forgot_app_env_still_cannot_print_emails(
    monkeypatch: pytest.MonkeyPatch, origin: str
) -> None:
    _set(monkeypatch, {**LOCAL_ENV, "APP_ORIGIN": origin})
    with pytest.raises(ValidationError, match="unless APP_ORIGIN is local"):
        Settings()


def test_tests_may_use_the_console_sender_with_any_origin(monkeypatch: pytest.MonkeyPatch) -> None:
    _set(monkeypatch, {**LOCAL_ENV, "APP_ORIGIN": "https://app.example.com", "APP_ENV": "test"})
    assert Settings().email_provider == "console"
