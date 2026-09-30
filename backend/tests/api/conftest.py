from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager

import httpx
import pytest
from asgi_lifespan import LifespanManager
from fastapi import FastAPI

from sightline.api.main import create_app
from sightline.api.resources import Resources
from sightline.config.settings import Settings
from tests.api.auth.support import RecordingEmailSender, probes
from tests.api.workspaces.support import workspace_probes
from tests.conftest import BASE_URL


@pytest.fixture
def mailbox() -> RecordingEmailSender:
    return RecordingEmailSender()


@pytest.fixture
async def auth_app(app_settings: Settings, mailbox: RecordingEmailSender) -> AsyncIterator[FastAPI]:
    application = create_app(app_settings, email_sender=mailbox)
    application.include_router(probes)
    application.include_router(workspace_probes)
    async with LifespanManager(application):
        # Throttle counters and cached sessions of earlier tests must not decide this one.
        await application.state.resources.redis.flushdb()
        yield application


@pytest.fixture
def resources(auth_app: FastAPI) -> Resources:
    found = auth_app.state.resources
    assert isinstance(found, Resources)
    return found


@pytest.fixture
async def api(auth_app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    """A client that behaves like the web app: same origin, and it says so."""
    transport = httpx.ASGITransport(app=auth_app, raise_app_exceptions=False)
    async with httpx.AsyncClient(
        transport=transport, base_url=BASE_URL, headers={"Origin": BASE_URL}
    ) as client:
        yield client


AppFactory = Callable[..., AbstractAsyncContextManager[httpx.AsyncClient]]


@pytest.fixture
def client_for(app_settings: Settings, mailbox: RecordingEmailSender) -> AppFactory:
    """A client for an application with some settings changed, for example open registration."""

    @asynccontextmanager
    async def build(
        *, http_transport: httpx.AsyncBaseTransport | None = None, **changes: object
    ) -> AsyncIterator[httpx.AsyncClient]:
        application = create_app(
            app_settings.model_copy(update=changes),
            email_sender=mailbox,
            http_transport=http_transport,
        )
        application.include_router(probes)
        application.include_router(workspace_probes)
        async with LifespanManager(application):
            await application.state.resources.redis.flushdb()
            transport = httpx.ASGITransport(app=application, raise_app_exceptions=False)
            async with httpx.AsyncClient(
                transport=transport, base_url=BASE_URL, headers={"Origin": BASE_URL}
            ) as client:
                yield client

    return build
