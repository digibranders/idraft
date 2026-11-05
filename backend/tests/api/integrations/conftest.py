from __future__ import annotations

from collections.abc import AsyncIterator

import pytest

from idraft.config.settings import Settings
from tests.api.integrations.support import Harness, running
from tests.conftest import PostgresServer


@pytest.fixture
async def google(app_settings: Settings, migrated: PostgresServer) -> AsyncIterator[Harness]:
    """The application with Google configured, talking to a fake Google."""
    async with running(app_settings, migrated) as harness:
        yield harness
