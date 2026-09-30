"""Application factory. Run with `uvicorn sightline.api.main:create_app --factory`."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import AsyncExitStack, asynccontextmanager

from fastapi import FastAPI
from redis.asyncio import Redis

from sightline import __version__
from sightline.api.access_log import AccessLogMiddleware
from sightline.api.health import router as health_router
from sightline.api.problems import register_problem_handlers
from sightline.api.request_id import RequestIdMiddleware
from sightline.api.resources import Resources
from sightline.api.schema import install_openapi
from sightline.config.logging import configure_logging
from sightline.config.sentry import init_sentry
from sightline.config.settings import Settings, load_settings
from sightline.db.engine import create_engine, create_session_factory
from sightline.db.migrate import migration_state

REDIS_TIMEOUT_SECONDS = 1.0
HEALTH_PATHS = frozenset({"/api/healthz", "/api/readyz"})


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    configure_logging(
        service=settings.process_role, version=settings.release_sha, level=settings.log_level
    )
    init_sentry(settings)
    migrations = migration_state()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        async with AsyncExitStack() as stack:
            engine = create_engine(settings)
            stack.push_async_callback(engine.dispose)
            redis = Redis.from_url(
                settings.redis_url.get_secret_value(),
                socket_connect_timeout=REDIS_TIMEOUT_SECONDS,
                socket_timeout=REDIS_TIMEOUT_SECONDS,
            )
            stack.push_async_callback(redis.aclose)
            app.state.resources = Resources(
                settings=settings,
                engine=engine,
                sessions=create_session_factory(engine),
                redis=redis,
                migrations=migrations,
            )
            yield

    app = FastAPI(
        title="Sightline API",
        version=__version__,
        # The document is committed in backend/openapi/v1.json. It is served over HTTP only behind
        # a session (docs/19-api-specification.md section 1.1), which arrives with the auth module.
        openapi_url=None,
        docs_url=None,
        redoc_url=None,
        lifespan=lifespan,
    )
    # Added last runs first: the request id is bound before the access log line is written.
    app.add_middleware(AccessLogMiddleware, quiet_paths=HEALTH_PATHS)
    app.add_middleware(RequestIdMiddleware)
    register_problem_handlers(app, app_origin=settings.app_origin)
    app.include_router(health_router)
    install_openapi(app)
    return app
