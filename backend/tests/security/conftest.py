"""The security suites drive the API the way its own tests do, with Google configured and a fake
Google behind it, so the routes that connect an account can be driven too."""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from asgi_lifespan import LifespanManager
from fastapi import FastAPI
from pydantic import SecretStr

from idraft.api.main import create_app
from idraft.config.settings import Settings
from tests.api.auth.support import RecordingEmailSender, probes
from tests.api.conftest import api, import_store, mailbox, resources
from tests.api.workspaces.support import workspace_probes
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import BASE_URL
from tests.providers.google.fake_google import CLIENT_ID, CLIENT_SECRET, FakeGoogle

__all__ = ["api", "auth_app", "fake_google", "import_store", "mailbox", "resources"]


@pytest.fixture
def fake_google() -> FakeGoogle:
    return FakeGoogle(BASE_URL + "/api/v1/oauth/google/callback")


@pytest.fixture
async def auth_app(
    app_settings: Settings,
    mailbox: RecordingEmailSender,
    import_store: MemoryStore,
    fake_google: FakeGoogle,
) -> AsyncIterator[FastAPI]:
    settings = app_settings.model_copy(
        update={
            "google_oauth_client_id": SecretStr(CLIENT_ID),
            "google_oauth_client_secret": SecretStr(CLIENT_SECRET),
        }
    )
    application = create_app(
        settings,
        email_sender=mailbox,
        import_store=import_store,
        http_transport=fake_google.transport,
    )
    application.include_router(probes)
    application.include_router(workspace_probes)
    async with LifespanManager(application):
        await application.state.resources.redis.flushdb()
        yield application
