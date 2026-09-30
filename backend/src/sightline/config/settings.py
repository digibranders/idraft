"""Process settings, read once from the environment and validated at start.

Names match the Compose file (docs/22-infrastructure-devops.md section 4.1). Nothing here reads a
file: local development passes values with `uv run --env-file .env`.
"""

from __future__ import annotations

import re
import sys
from typing import Literal

from pydantic import AliasChoices, Field, ValidationError, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_POSTGRES_SCHEMES = ("postgresql+asyncpg://", "postgresql://", "postgres://")
_TIMEOUT_PATTERN = re.compile(r"^[1-9]\d*(ms|s|min)$")
_ENVIRONMENT_VARIABLE = "APP_ENV"


def to_sqlalchemy_url(database_url: str) -> str:
    """Return the URL with the asyncpg driver, which is the only driver the platform uses."""
    for scheme in _POSTGRES_SCHEMES:
        if database_url.startswith(scheme):
            return "postgresql+asyncpg://" + database_url[len(scheme) :]
    raise ValueError("must be a postgresql:// URL")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore", frozen=True)

    process_role: Literal["api", "worker", "migrator", "cli"] = "api"
    release_sha: str = "dev"
    environment: Literal["local", "test", "production"] = Field(
        default="local", validation_alias=AliasChoices("environment", _ENVIRONMENT_VARIABLE)
    )
    app_origin: str
    log_level: Literal["debug", "info", "warning", "error", "critical"] = "info"
    database_url: str
    db_pool_size: int = Field(default=10, ge=1, le=50)
    db_statement_timeout: str = "15s"
    redis_url: str
    sentry_dsn: str | None = None

    @field_validator("app_origin")
    @classmethod
    def _validate_origin(cls, value: str) -> str:
        if not value.startswith(("https://", "http://")):
            raise ValueError("must start with https:// or http://")
        return value.rstrip("/")

    @field_validator("database_url")
    @classmethod
    def _validate_database_url(cls, value: str) -> str:
        to_sqlalchemy_url(value)
        return value

    @field_validator("redis_url")
    @classmethod
    def _validate_redis_url(cls, value: str) -> str:
        if not value.startswith(("redis://", "rediss://")):
            raise ValueError("must be a redis:// or rediss:// URL")
        return value

    @field_validator("db_statement_timeout")
    @classmethod
    def _validate_timeout(cls, value: str) -> str:
        if not _TIMEOUT_PATTERN.fullmatch(value):
            raise ValueError("must be a duration such as 500ms, 15s or 2min")
        return value

    @field_validator("sentry_dsn")
    @classmethod
    def _empty_dsn_is_none(cls, value: str | None) -> str | None:
        return value or None

    @property
    def sqlalchemy_url(self) -> str:
        return to_sqlalchemy_url(self.database_url)


def _variable_name(location: tuple[int | str, ...]) -> str:
    """The environment variable behind a validation error location."""
    field = str(location[0])
    if field in ("environment", _ENVIRONMENT_VARIABLE):
        return _ENVIRONMENT_VARIABLE
    return field.upper()


def load_settings() -> Settings:
    """Build Settings, or stop the process with a message that names fields and never values."""
    try:
        return Settings()
    except ValidationError as error:
        lines = [f"  {_variable_name(item['loc'])}: {item['msg']}" for item in error.errors()]
        sys.stderr.write("Invalid configuration:\n" + "\n".join(lines) + "\n")
        raise SystemExit(2) from None
