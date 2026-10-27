"""Application factory. Run with `uvicorn idraft.api.main:create_app --factory`."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import AbstractAsyncContextManager, AsyncExitStack, asynccontextmanager

import httpx
from fastapi import FastAPI
from redis.asyncio import Redis

from idraft import __version__
from idraft.api.access_log import AccessLogMiddleware
from idraft.api.auth.passwords import BreachedPasswords
from idraft.api.auth.routes import router as auth_router
from idraft.api.auth.service import AuthService
from idraft.api.auth.sessions import SessionStore
from idraft.api.auth.throttle import LoginThrottle
from idraft.api.auth.tokens import derive_key
from idraft.api.auth.totp import TotpCipher
from idraft.api.body_limit import UPLOADS, BodyLimitMiddleware
from idraft.api.csrf import OriginCheckMiddleware
from idraft.api.document import router as document_router
from idraft.api.entities.project_routes import router as project_entities_router
from idraft.api.entities.project_service import ProjectEntityService
from idraft.api.entities.routes import router as entities_router
from idraft.api.entities.service import EntityService
from idraft.api.health import router as health_router
from idraft.api.imports.routes import router as imports_router
from idraft.api.imports.service import ImportService
from idraft.api.keywords.group_routes import router as keyword_groups_router
from idraft.api.keywords.group_service import GroupService
from idraft.api.keywords.routes import keywords_router
from idraft.api.keywords.routes import router as tracked_keywords_router
from idraft.api.keywords.service import KeywordService
from idraft.api.operations.cost_routes import router as cost_routes_router
from idraft.api.operations.costs import CostService
from idraft.api.operations.run_routes import router as run_routes_router
from idraft.api.operations.runs import RunService
from idraft.api.operations.schedule_routes import router as schedule_routes_router
from idraft.api.operations.schedules import ScheduleService
from idraft.api.operations.settings import SettingsService
from idraft.api.operations.settings_routes import router as settings_routes_router
from idraft.api.problems import register_problem_handlers
from idraft.api.projects.routes import router as projects_router
from idraft.api.projects.service import ProjectService
from idraft.api.ranks.routes import event_router as rank_events_router
from idraft.api.ranks.routes import keyword_router as rank_history_router
from idraft.api.ranks.routes import snapshot_router as serp_snapshots_router
from idraft.api.ranks.service import RankService
from idraft.api.registries import router as registries_router
from idraft.api.request_id import RequestIdMiddleware
from idraft.api.resources import Resources
from idraft.api.schema import install_openapi
from idraft.api.taxonomy.assignments import router as term_assignments_router
from idraft.api.taxonomy.routes import router as taxonomy_router
from idraft.api.taxonomy.service import TaxonomyService
from idraft.api.workspaces.invitations import InvitationService
from idraft.api.workspaces.members import MemberService
from idraft.api.workspaces.routes import router as workspaces_router
from idraft.api.workspaces.service import WorkspaceService
from idraft.config.logging import configure_logging
from idraft.config.sentry import init_sentry
from idraft.config.settings import Settings, load_settings
from idraft.db.engine import create_engine, create_session_factory
from idraft.db.migrate import migration_state
from idraft.providers.email import EmailSender, build_email_sender
from idraft.providers.pauses import RedisPauses
from idraft.storage.raw import ObjectStore, RawStore, open_raw_store

REDIS_TIMEOUT_SECONDS = 1.0
HTTP_TIMEOUT_SECONDS = 10.0
# Connections to the bucket: an upload is one request, and few run at once.
IMPORT_STORE_CONNECTIONS = 4
SESSION_CACHE_KEY_LABEL = b"idraft session cache v1"
TOTP_SECRET_KEY_LABEL = b"idraft totp secrets v1"
HEALTH_PATHS = frozenset({"/api/healthz", "/api/readyz"})


def _open_import_store(settings: Settings) -> AbstractAsyncContextManager[RawStore]:
    """The bucket the API keeps import sources in: the raw bucket the worker reads them from."""
    if (
        settings.r2_raw_endpoint is None
        or settings.r2_raw_access_key_id is None
        or settings.r2_raw_secret_access_key is None
    ):  # pragma: no cover - checked by `raw_storage_configured` and the settings' validator
        raise ValueError("raw storage is not configured")
    return open_raw_store(
        endpoint=settings.r2_raw_endpoint,
        bucket=settings.r2_raw_bucket,
        access_key_id=settings.r2_raw_access_key_id.get_secret_value(),
        secret_access_key=settings.r2_raw_secret_access_key.get_secret_value(),
        max_connections=IMPORT_STORE_CONNECTIONS,
    )


def create_app(
    settings: Settings | None = None,
    *,
    email_sender: EmailSender | None = None,
    http_transport: httpx.AsyncBaseTransport | None = None,
    import_store: ObjectStore | None = None,
) -> FastAPI:
    """Build the application.

    `email_sender` replaces the configured sender and `http_transport` the network for outbound
    calls, and `import_store` the bucket keyword import sources are kept in; tests pass a
    recorder, a mock and a memory store so nothing leaves the process.
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
            throttle = LoginThrottle(redis)
            session_store = SessionStore(
                sessions, redis, cache_key=derive_key(settings.totp_key, SESSION_CACHE_KEY_LABEL)
            )
            sources = import_store
            if sources is None and settings.raw_storage_configured:
                sources = await stack.enter_async_context(_open_import_store(settings))
            app.state.resources = Resources(
                settings=settings,
                engine=engine,
                sessions=sessions,
                redis=redis,
                migrations=migrations,
                http=http,
                email=email,
                import_store=sources,
                session_store=session_store,
                auth=AuthService(
                    sessions=sessions,
                    store=session_store,
                    throttle=throttle,
                    breached=BreachedPasswords(http) if settings.breached_password_check else None,
                    totp=TotpCipher(derive_key(settings.totp_key, TOTP_SECRET_KEY_LABEL)),
                    email=email,
                    app_origin=settings.app_origin,
                    registration=settings.registration,
                ),
                workspaces=WorkspaceService(
                    sessions=sessions, throttle=throttle, registration=settings.registration
                ),
                members=MemberService(sessions=sessions),
                projects=ProjectService(sessions=sessions),
                entities=EntityService(sessions=sessions),
                project_entities=ProjectEntityService(sessions=sessions),
                taxonomy=TaxonomyService(sessions=sessions),
                keywords=KeywordService(sessions=sessions),
                keyword_groups=GroupService(sessions=sessions),
                runs=RunService(sessions=sessions, pauses=RedisPauses(redis)),
                schedules=ScheduleService(sessions=sessions),
                project_settings=SettingsService(sessions=sessions),
                costs=CostService(sessions=sessions),
                imports=ImportService(sessions=sessions, store=sources),
                ranks=RankService(sessions=sessions, raw_store=sources),
                invitations=InvitationService(
                    sessions=sessions,
                    throttle=throttle,
                    email=email,
                    app_origin=settings.app_origin,
                ),
            )
            yield

    app = FastAPI(
        title="idraft.ai API",
        version=__version__,
        # The document is committed in backend/openapi/v1.json. Over HTTP it is served only to a
        # signed-in user, by idraft.api.document (docs/19-api-specification.md section 1.1).
        openapi_url=None,
        docs_url=None,
        redoc_url=None,
        lifespan=lifespan,
    )
    # Added last runs first: the request id is bound before the access log line is written, and
    # a request refused for its origin still gets both.
    app.add_middleware(BodyLimitMiddleware, app_origin=settings.app_origin, larger=UPLOADS)
    app.add_middleware(OriginCheckMiddleware, app_origin=settings.app_origin)
    app.add_middleware(AccessLogMiddleware, quiet_paths=HEALTH_PATHS)
    app.add_middleware(RequestIdMiddleware)
    register_problem_handlers(app, app_origin=settings.app_origin)
    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(workspaces_router)
    app.include_router(projects_router)
    app.include_router(entities_router)
    app.include_router(project_entities_router)
    app.include_router(taxonomy_router)
    app.include_router(keywords_router)
    app.include_router(tracked_keywords_router)
    app.include_router(rank_history_router)
    app.include_router(serp_snapshots_router)
    app.include_router(rank_events_router)
    app.include_router(keyword_groups_router)
    app.include_router(term_assignments_router)
    app.include_router(run_routes_router)
    app.include_router(schedule_routes_router)
    app.include_router(settings_routes_router)
    app.include_router(cost_routes_router)
    app.include_router(imports_router)
    app.include_router(registries_router)
    app.include_router(document_router)
    install_openapi(app)
    return app
