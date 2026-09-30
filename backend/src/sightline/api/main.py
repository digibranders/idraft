"""Application factory. Run with `uvicorn sightline.api.main:create_app --factory`."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from redis.asyncio import Redis

from sightline import __version__
from sightline.api.access_log import AccessLogMiddleware
from sightline.api.health import router as health_router
from sightline.api.problems import register_problem_handlers
from sightline.api.request_id import RequestIdMiddleware
from sightline.config.logging import configure_logging
from sightline.config.sentry import init_sentry
from sightline.config.settings import Settings, load_settings
from sightline.db.engine import create_engine, create_session_factory
from sightline.db.migrate import head_revision

OPENAPI_URL = "/api/v1/openapi.json"
REDIS_TIMEOUT_SECONDS = 1.0
HEALTH_PATHS = frozenset({"/api/healthz", "/api/readyz"})


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = app.state.settings
    engine = create_engine(settings)
    redis = Redis.from_url(
        settings.redis_url,
        socket_connect_timeout=REDIS_TIMEOUT_SECONDS,
        socket_timeout=REDIS_TIMEOUT_SECONDS,
    )
    app.state.engine = engine
    app.state.sessions = create_session_factory(engine)
    app.state.redis = redis
    try:
        yield
    finally:
        await redis.aclose()
        await engine.dispose()


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    configure_logging(
        service=settings.process_role, version=settings.release_sha, level=settings.log_level
    )
    init_sentry(settings)

    app = FastAPI(
        title="Sightline API",
        version=__version__,
        openapi_url=OPENAPI_URL,
        docs_url=None,
        redoc_url=None,
        lifespan=_lifespan,
    )
    app.state.settings = settings
    app.state.migration_head = head_revision()
    # Added last runs first: the request id is bound before the access log line is written.
    app.add_middleware(AccessLogMiddleware, quiet_paths=HEALTH_PATHS)
    app.add_middleware(RequestIdMiddleware)
    register_problem_handlers(app, app_origin=settings.app_origin)
    app.include_router(health_router)
    return app
