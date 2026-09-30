"""Error and performance reporting (ADR-022: Sentry, 10% performance sampling)."""

from __future__ import annotations

import sentry_sdk

from sightline.config.settings import Settings

TRACES_SAMPLE_RATE = 0.1


def init_sentry(settings: Settings) -> bool:
    """Start Sentry when a DSN is configured. Returns whether it was started."""
    if settings.sentry_dsn is None:
        return False
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.environment,
        release=settings.release_sha,
        traces_sample_rate=TRACES_SAMPLE_RATE,
        send_default_pii=False,
    )
    return True
