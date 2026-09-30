"""Process settings, read once from the environment and validated at start.

Names match the Compose file (docs/22-infrastructure-devops.md section 4.1). Nothing here reads a
file: local development passes values with `uv run --env-file .env`. Connection strings are
`SecretStr`, and validation errors never echo the rejected value.
"""

from __future__ import annotations

import base64
import re
import sys
from pathlib import Path
from typing import Literal, Self
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

LogLevel = Literal["debug", "info", "warning", "error", "critical"]

TOTP_KEY_BYTES = 32
# Good enough for the console sender. A real provider refuses it, so it is refused at start.
DEFAULT_EMAIL_FROM = "Sightline <no-reply@localhost>"
_DEFAULT_PORTS = {"https": 443, "http": 80}
_POSTGRES_SCHEMES = ("postgresql+asyncpg://", "postgresql://", "postgres://")
_EMAIL_FROM_PATTERN = re.compile(r"[^\r\n<>]*<[^\s<>@]+@[^\s<>@]+>|[^\s<>@]+@[^\s<>@]+")
_TIMEOUT_PATTERN = re.compile(r"[1-9][0-9]{0,8}(ms|s|min)", re.ASCII)


def _strip_scheme(database_url: str) -> str:
    for scheme in _POSTGRES_SCHEMES:
        if database_url.startswith(scheme):
            return database_url[len(scheme) :]
    raise ValueError("must be a postgresql:// URL")


def to_sqlalchemy_url(database_url: str) -> str:
    """The URL with the asyncpg driver, which is the only driver the application uses."""
    return "postgresql+asyncpg://" + _strip_scheme(database_url)


def to_asyncpg_dsn(database_url: str) -> str:
    """The URL in the plain form asyncpg itself accepts."""
    return "postgresql://" + _strip_scheme(database_url)


def _validate_database_url(value: SecretStr) -> SecretStr:
    try:
        url = make_url(to_sqlalchemy_url(value.get_secret_value()))
    except (ArgumentError, ValueError):
        raise ValueError("must be postgresql://user:password@host[:port]/database") from None
    if not url.host or "@" in url.host or not url.database:
        raise ValueError("must name a host and a database; percent-encode @ in the password")
    if url.query:
        raise ValueError("must not carry query parameters; connection options are set in code")
    return value


def _is_local_origin(origin: str) -> bool:
    """Whether the origin is this machine or a name reserved for testing (RFC 6761)."""
    host = urlsplit(origin).hostname or ""
    return host in ("localhost", "127.0.0.1", "::1") or host.endswith((".localhost", ".test"))


def _validate_origin(value: str) -> str:
    parts = urlsplit(value.strip())
    try:
        port = parts.port
    except ValueError:
        raise ValueError("has an invalid port") from None
    if parts.scheme not in ("https", "http") or not parts.hostname:
        raise ValueError("must be https://host or http://host")
    if parts.username or parts.password or parts.path not in ("", "/") or parts.query:
        raise ValueError("must be scheme and host only: no credentials, path or query")
    if parts.fragment:
        raise ValueError("must be scheme and host only: no fragment")
    # urlsplit strips the brackets of an IPv6 literal; an origin needs them back.
    host = f"[{parts.hostname}]" if ":" in parts.hostname else parts.hostname
    # Browsers leave the default port out of the Origin header, so it is left out here too.
    if port == _DEFAULT_PORTS[parts.scheme]:
        port = None
    return f"{parts.scheme}://{host}" + (f":{port}" if port else "")


class _DatabaseSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=None, extra="ignore", frozen=True, hide_input_in_errors=True
    )

    release_sha: str = "dev"
    log_level: LogLevel = "info"
    database_url: SecretStr

    _check_database_url = field_validator("database_url")(_validate_database_url)

    @property
    def sqlalchemy_url(self) -> str:
        return to_sqlalchemy_url(self.database_url.get_secret_value())

    @property
    def asyncpg_dsn(self) -> str:
        return to_asyncpg_dsn(self.database_url.get_secret_value())


class MigratorSettings(_DatabaseSettings):
    """All the migrator container is given: a database URL (docs/22 section 4.1)."""


class Settings(_DatabaseSettings):
    process_role: Literal["api", "worker", "migrator", "cli"] = "api"
    app_env: Literal["local", "test", "production"] = "local"
    app_origin: str
    db_pool_size: int = Field(default=10, ge=1, le=50)
    db_statement_timeout: str = "15s"
    redis_url: SecretStr
    sentry_dsn: SecretStr | None = None
    # `invited`: an account can be created only with a pending invitation. `open`: anyone can.
    registration: Literal["invited", "open"] = "invited"
    # base64 of 32 random bytes. Encrypts TOTP secrets at rest; only the api process needs it.
    totp_encryption_key: SecretStr | None = None
    email_provider: Literal["console", "resend"] = "console"
    email_api_key: SecretStr | None = None
    email_from: str = DEFAULT_EMAIL_FROM
    breached_password_check: bool = True
    # The worker only. How many handlers of each queue run at once (docs/22 section 4.4).
    collect_concurrency: int = Field(default=8, ge=1, le=64)
    process_concurrency: int = Field(default=4, ge=1, le=32)
    # The worker touches this file while it is healthy; the container healthcheck reads its age.
    heartbeat_file: Path | None = None
    # The worker only. DataForSEO's API login, both or neither: without them the provider is
    # not registered and nothing is sent to it.
    dataforseo_login: SecretStr | None = None
    dataforseo_password: SecretStr | None = None
    # The worker only. The raw payload bucket (docs/23 section 9): R2's S3 endpoint,
    # https://<account id>.r2.cloudflarestorage.com, and a token scoped to the bucket. All
    # three or none: without them nothing is fetched, since a result is kept only once stored.
    r2_raw_endpoint: str | None = None
    r2_raw_bucket: str = Field(default="seo-raw", pattern=r"^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$")
    r2_raw_access_key_id: SecretStr | None = None
    r2_raw_secret_access_key: SecretStr | None = None
    # Resolve submissions of unknown outcome by asking the provider which tasks it holds. Off
    # until spike S-01 confirms that DataForSEO's task list returns our tags.
    resolve_unknown_submissions: bool = False

    @field_validator("heartbeat_file", "r2_raw_endpoint", mode="before")
    @classmethod
    def _empty_is_unset(cls, value: object) -> object:
        # An empty variable is "not set". As a path it would be the working directory.
        return None if value == "" else value

    @field_validator(
        "dataforseo_login",
        "dataforseo_password",
        "r2_raw_access_key_id",
        "r2_raw_secret_access_key",
    )
    @classmethod
    def _empty_credential_is_none(cls, value: SecretStr | None) -> SecretStr | None:
        return value if value is not None and value.get_secret_value().strip() else None

    @field_validator("r2_raw_endpoint")
    @classmethod
    def _validate_r2_endpoint(cls, value: str | None) -> str | None:
        if value is None:
            return None
        parts = urlsplit(value)
        if (
            parts.scheme not in ("https", "http")
            or not parts.hostname
            or parts.path
            not in (
                "",
                "/",
            )
        ):
            raise ValueError("must be the bucket service's origin, such as https://host")
        return f"{parts.scheme}://{parts.netloc}"

    @property
    def dataforseo_credentials(self) -> tuple[str, str] | None:
        if self.dataforseo_login is None or self.dataforseo_password is None:
            return None
        return (
            self.dataforseo_login.get_secret_value(),
            self.dataforseo_password.get_secret_value(),
        )

    @property
    def raw_storage_configured(self) -> bool:
        return self.r2_raw_endpoint is not None

    _check_origin = field_validator("app_origin")(_validate_origin)

    @field_validator("redis_url")
    @classmethod
    def _validate_redis_url(cls, value: SecretStr) -> SecretStr:
        parts = urlsplit(value.get_secret_value())
        if parts.scheme not in ("redis", "rediss") or not parts.hostname:
            raise ValueError("must be redis://[user:password@]host[:port][/db]")
        return value

    @field_validator("db_statement_timeout")
    @classmethod
    def _validate_timeout(cls, value: str) -> str:
        if not _TIMEOUT_PATTERN.fullmatch(value):
            raise ValueError("must be a duration such as 500ms, 15s or 2min")
        return value

    @field_validator("sentry_dsn", "email_api_key")
    @classmethod
    def _empty_secret_is_none(cls, value: SecretStr | None) -> SecretStr | None:
        return value if value is not None and value.get_secret_value() else None

    @field_validator("totp_encryption_key")
    @classmethod
    def _validate_totp_key(cls, value: SecretStr | None) -> SecretStr | None:
        if value is None:
            return None
        # Stripped: a key read from a secrets file usually ends with a newline.
        text = value.get_secret_value().strip()
        try:
            key = base64.b64decode(text, validate=True)
        except ValueError:
            key = b""
        if len(key) != TOTP_KEY_BYTES:
            raise ValueError("must be 32 random bytes, base64 encoded")
        return SecretStr(text)

    @field_validator("email_from")
    @classmethod
    def _validate_email_from(cls, value: str) -> str:
        if not _EMAIL_FROM_PATTERN.fullmatch(value):
            raise ValueError("must be an address, or a name followed by <address>, on one line")
        return value

    @property
    def totp_key(self) -> bytes:
        """The decoded key. Only the api process has one."""
        if self.totp_encryption_key is None:
            raise RuntimeError("this process has no TOTP encryption key")
        return base64.b64decode(self.totp_encryption_key.get_secret_value(), validate=True)

    @model_validator(mode="after")
    def _production_is_served_over_https(self) -> Self:
        if self.app_env == "production" and not self.app_origin.startswith("https://"):
            raise ValueError("APP_ORIGIN must be https:// when APP_ENV is production")
        return self

    @model_validator(mode="after")
    def _the_api_can_run_auth(self) -> Self:
        if self.process_role == "api" and self.totp_encryption_key is None:
            raise ValueError("TOTP_ENCRYPTION_KEY is required for the api process")
        if self.email_provider == "resend" and self.email_api_key is None:
            raise ValueError("EMAIL_API_KEY is required when EMAIL_PROVIDER is resend")
        if self.email_provider == "resend" and self.email_from == DEFAULT_EMAIL_FROM:
            raise ValueError(
                "EMAIL_FROM must be a sender on your domain when EMAIL_PROVIDER is resend"
            )
        # Only the api sends mail so far. The console sender prints tokens, so it is for a local
        # origin only. The origin is checked as well as APP_ENV, so a host that forgot to set
        # APP_ENV still cannot start with it.
        if self.process_role == "api" and self.email_provider == "console":
            if self.app_env == "production":
                raise ValueError("EMAIL_PROVIDER must not be console when APP_ENV is production")
            if self.app_env != "test" and not _is_local_origin(self.app_origin):
                raise ValueError("EMAIL_PROVIDER must not be console unless APP_ORIGIN is local")
        return self

    @model_validator(mode="after")
    def _providers_are_configured_whole(self) -> Self:
        if (self.dataforseo_login is None) != (self.dataforseo_password is None):
            raise ValueError(
                "DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are set together or not at all"
            )
        r2 = (self.r2_raw_endpoint, self.r2_raw_access_key_id, self.r2_raw_secret_access_key)
        if any(part is not None for part in r2) and any(part is None for part in r2):
            raise ValueError(
                "R2_RAW_ENDPOINT, R2_RAW_ACCESS_KEY_ID and R2_RAW_SECRET_ACCESS_KEY are set "
                "together or not at all"
            )
        # Credentials for the bucket go over TLS, except to a store on this machine in tests.
        if (
            self.r2_raw_endpoint is not None
            and self.r2_raw_endpoint.startswith("http://")
            and self.app_env == "production"
        ):
            raise ValueError("R2_RAW_ENDPOINT must be https:// when APP_ENV is production")
        return self


def _exit_with_field_names(error: ValidationError) -> SystemExit:
    """A message that names variables and never values, written to stderr."""
    lines = [
        f"  {str(item['loc'][0]).upper() if item['loc'] else 'SETTINGS'}: {item['msg']}"
        for item in error.errors(include_input=False, include_context=False)
    ]
    sys.stderr.write("Invalid configuration:\n" + "\n".join(lines) + "\n")
    return SystemExit(2)


def load_settings() -> Settings:
    """Build Settings, or stop the process naming the variables that are wrong."""
    try:
        return Settings()
    except ValidationError as error:
        raise _exit_with_field_names(error) from None


def load_migrator_settings() -> MigratorSettings:
    try:
        return MigratorSettings()
    except ValidationError as error:
        raise _exit_with_field_names(error) from None
