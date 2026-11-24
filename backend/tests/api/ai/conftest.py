"""Fixtures of the AI route tests that also drive the worker: sessions as the worker's role on an
empty ledger, the collectors' own fixture; and the screenshot worlds."""

from __future__ import annotations

from datetime import timedelta

import pytest
from fastapi import FastAPI

from idraft.api.resources import Resources
from tests.api.ai.screenshot_support import FakeCapture, ShotWorld, build_world, use_fakes
from tests.api.keywords.test_tracked_keyword_ranks import Ledger
from tests.collectors.conftest import worker_db
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

__all__ = ["fake_capture", "old_world", "recent_world", "worker_db"]


@pytest.fixture
def fake_capture(auth_app: FastAPI, resources: Resources) -> FakeCapture:
    """The application's screenshot service on fakes that count what they are asked."""
    return use_fakes(auth_app, resources)


@pytest.fixture
async def recent_world(
    resources: Resources, migrated: PostgresServer, worker_db: Ledger, import_store: MemoryStore
) -> ShotWorld:
    return await build_world(resources, migrated, worker_db, import_store, age=timedelta(hours=1))


@pytest.fixture
async def old_world(
    resources: Resources, migrated: PostgresServer, worker_db: Ledger, import_store: MemoryStore
) -> ShotWorld:
    return await build_world(resources, migrated, worker_db, import_store, age=timedelta(days=8))
