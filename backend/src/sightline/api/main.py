"""Application factory. Run with `uvicorn sightline.api.main:create_app --factory`."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import AsyncExitStack, asynccontextmanager

import httpx
from fastapi import FastAPI
from redis.asyncio import Redis

from sightline import __version__
from sightline.api.access_log import AccessLogMiddleware
from sightline.api.auth.passwords import BreachedPasswords
from sightline.api.auth.routes import router as auth_router
from sightline.api.auth.service import AuthService
from sightline.api.auth.sessions import SessionStore
from sightline.api.auth.throttle import LoginThrottle
from sightline.api.auth.tokens import derive_key
from sightline.api.auth.totp import TotpCipher
from sightline.api.csrf import OriginCheckMiddleware
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
from sightline.providers.email import EmailSender, build_email_sender

REDIS_TIMEOUT_SECONDS = 1.0
HTTP_TIMEOUT_SECONDS = 10.0
SESSION_CACHE_KEY_LABEL = b"sightline session cache v1"
TOTP_SECRET_KEY_LABEL = b"sightline totp secrets v1"
HEALTH_PATHS = frozenset({"/api/healthz", "/api/readyz"})


def create_app(
    settings: Settings | None = None,
    *,
    email_sender: EmailSender | None = None,
    http_transport: httpx.AsyncBaseTransport | None = None,
) -> FastAPI:
    """Build the application.

    `email_sender` replaces the configured sender and `http_transport` the network for outbound
    calls; tests pass a recorder and a mock so nothing leaves the process.
    """
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
            # Outbound calls (breached-password lookup, email). Redirects are never followed: a
            # request that carries a key must not be replayed to another host.
            http = httpx.AsyncClient(
                timeout=HTTP_TIMEOUT_SECONDS, follow_redirects=False, transport=http_transport
            )
            stack.push_async_callback(http.aclose)
            sessions = create_session_factory(engine)
            email = email_sender or build_email_sender(
                http,
                provider=settings.email_provider,
                api_key=None
                if settings.email_api_key is None
                else settings.email_api_key.get_secret_value(),
                sender=settings.email_from,
            )
            session_store = SessionStore(
                sessions, redis, cache_key=derive_key(settings.totp_key, SESSION_CACHE_KEY_LABEL)
            )
            app.state.resources = Resources(
                settings=settings,
                engine=engine,
                sessions=sessions,
                redis=redis,
                migrations=migrations,
                http=http,
                email=email,
                session_store=session_store,
                auth=AuthService(
                    sessions=sessions,
                    store=session_store,
                    throttle=LoginThrottle(redis),
                    breached=BreachedPasswords(http) if settings.breached_password_check else None,
                    totp=TotpCipher(derive_key(settings.totp_key, TOTP_SECRET_KEY_LABEL)),
                    email=email,
                    app_origin=settings.app_origin,
                    registration=settings.registration,
                ),
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
    # Added last runs first: the request id is bound before the access log line is written, and
    # a request refused for its origin still gets both.
    app.add_middleware(OriginCheckMiddleware, app_origin=settings.app_origin)
    app.add_middleware(AccessLogMiddleware, quiet_paths=HEALTH_PATHS)
    app.add_middleware(RequestIdMiddleware)
    register_problem_handlers(app, app_origin=settings.app_origin)
    app.include_router(health_router)
    app.include_router(auth_router)
    install_openapi(app)
    return app
