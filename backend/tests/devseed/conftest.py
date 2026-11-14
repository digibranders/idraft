"""Sessions as the API's role on the migrated test database: the role the seed connects as."""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest

from idraft.config.settings import Settings
from idraft.db.engine import create_engine, create_session_factory
from idraft.devseed.context import Sessions


@pytest.fixture
async def sessions(app_settings: Settings) -> AsyncIterator[Sessions]:
    engine = create_engine(app_settings)
    try:
        yield create_session_factory(engine)
    finally:
        await engine.dispose()
