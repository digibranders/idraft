"""The OpenAPI document that apps/web generates its client from.

`python -m sightline.api.openapi > openapi/v1.json` regenerates the committed copy. Building the
document opens no connection, so the settings here are placeholders.
"""

from __future__ import annotations

import json
import sys
from typing import Any

from sightline.api.main import create_app
from sightline.config.settings import Settings

_PLACEHOLDER = Settings(
    app_origin="https://app.example.com",
    database_url="postgresql://unused@localhost/unused",
    redis_url="redis://localhost:6379/0",
    log_level="critical",
)


def build_openapi() -> dict[str, Any]:
    return create_app(_PLACEHOLDER).openapi()


def render_openapi() -> str:
    return json.dumps(build_openapi(), indent=2, sort_keys=True) + "\n"


if __name__ == "__main__":  # pragma: no cover
    sys.stdout.write(render_openapi())
