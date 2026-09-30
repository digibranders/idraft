"""The OpenAPI document that apps/web generates its client from.

`python -m sightline.api.openapi > openapi/v1.json` regenerates the committed copy. Building the
document opens no connection, so the settings here are placeholders, and every field is given so
nothing is read from the environment.
"""

from __future__ import annotations

import json
import sys
from typing import Any

from pydantic import SecretStr

from sightline.api.main import create_app
from sightline.config.settings import Settings


def placeholder_settings() -> Settings:
    return Settings(
        process_role="cli",
        release_sha="openapi",
        app_env="local",
        app_origin="https://app.example.com",
        log_level="critical",
        database_url=SecretStr("postgresql://unused@localhost/unused"),
        db_pool_size=1,
        db_statement_timeout="15s",
        redis_url=SecretStr("redis://localhost:6379/0"),
        sentry_dsn=None,
    )


def build_openapi() -> dict[str, Any]:
    return create_app(placeholder_settings()).openapi()


def render_openapi() -> str:
    return json.dumps(build_openapi(), indent=2, sort_keys=True) + "\n"


if __name__ == "__main__":  # pragma: no cover
    sys.stdout.write(render_openapi())
