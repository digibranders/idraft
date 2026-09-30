"""Error and performance reporting (ADR-022: Sentry, 10% performance sampling).

Events carry no request bodies, cookies, query strings or frame locals, and what remains is
scrubbed with the same rules as the logs (docs/24-security.md section 11).
"""

from __future__ import annotations

from typing import Any

import sentry_sdk
from fastapi.exceptions import ResponseValidationError
from sentry_sdk.integrations.redis import RedisIntegration
from sentry_sdk.types import Breadcrumb, BreadcrumbHint, Event, Hint

from sightline.config.redaction import redact
from sightline.config.settings import Settings

TRACES_SAMPLE_RATE = 0.1
_DROPPED_REQUEST_FIELDS = ("data", "cookies", "query_string")
_RESPONSE_MODEL_MESSAGE = "response did not match its model"


def scrub_event(event: Event, hint: Hint) -> Event | None:
    request = event.get("request")
    if isinstance(request, dict):
        for field in _DROPPED_REQUEST_FIELDS:
            request.pop(field, None)

    # The message of a response validation error quotes the value the handler returned.
    exc_info = hint.get("exc_info")
    if exc_info is not None and isinstance(exc_info[1], ResponseValidationError):
        for value in event.get("exception", {}).get("values", []):
            if value.get("type") == ResponseValidationError.__name__:
                value["value"] = _RESPONSE_MODEL_MESSAGE

    scrubbed: Any = redact(event)
    return scrubbed  # type: ignore[no-any-return]


def scrub_breadcrumb(crumb: Breadcrumb, _: BreadcrumbHint) -> Breadcrumb | None:
    scrubbed: Any = redact(crumb)
    return scrubbed  # type: ignore[no-any-return]


def init_sentry(settings: Settings) -> bool:
    """Start Sentry when a DSN is configured. Returns whether it was started."""
    if settings.sentry_dsn is None:
        return False
    sentry_sdk.init(
        dsn=settings.sentry_dsn.get_secret_value(),
        environment=settings.app_env,
        release=settings.release_sha,
        traces_sample_rate=TRACES_SAMPLE_RATE,
        send_default_pii=False,
        include_local_variables=False,
        max_request_body_size="never",
        # It records every command and key as a breadcrumb and a span. Session cache keys are
        # hashes, not tokens, but nothing about sessions belongs in a third-party service.
        disabled_integrations=[RedisIntegration()],
        before_send=scrub_event,
        before_breadcrumb=scrub_breadcrumb,
    )
    return True
