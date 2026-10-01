"""The location sync as a monthly job and as a command (plan decision D8)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.config.settings import Settings
from sightline.db.engine import create_engine, create_session_factory
from sightline.providers.dataforseo.client import DataForSeoClient
from sightline.providers.dataforseo.locations import LOCATIONS_PATH
from sightline.worker import sync_locations as command
from sightline.worker.assembly import sync_dataforseo_locations
from tests.api.auth.support import execute, fetch
from tests.conftest import PostgresServer
from tests.providers.dataforseo.support import (
    FIXTURES,
    LOGIN,
    ORIGIN,
    PASSWORD,
    Api,
    FakeGate,
    fixture,
)

SAMPLE = FIXTURES / "locations.json"


@pytest.fixture
async def no_locations(migrated: PostgresServer) -> None:
    await execute(migrated, "UPDATE core.projects SET default_location_id = NULL")
    await execute(migrated, "DELETE FROM core.provider_location_map")
    await execute(migrated, "DELETE FROM core.locations")


@pytest.fixture
async def sessions(worker_settings: Settings) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_engine(worker_settings)
    try:
        yield create_session_factory(engine)
    finally:
        await engine.dispose()


async def _count(pg: PostgresServer) -> int:
    rows = await fetch(pg, "SELECT count(*) AS n FROM core.locations")
    count: int = rows[0]["n"]
    return count


@pytest.mark.usefixtures("no_locations")
async def test_without_credentials_the_job_syncs_nothing(
    sessions: async_sessionmaker[AsyncSession], migrated: PostgresServer
) -> None:
    assert await sync_dataforseo_locations(sessions, None) is None
    assert await _count(migrated) == 0


@pytest.mark.usefixtures("no_locations")
async def test_with_credentials_the_job_syncs_dataforseos_list(
    sessions: async_sessionmaker[AsyncSession], migrated: PostgresServer
) -> None:
    events: list[str] = []
    api = Api(events)
    api.answer("GET", LOCATIONS_PATH, fixture("locations"))
    async with httpx.AsyncClient(transport=httpx.MockTransport(api)) as http:
        client = DataForSeoClient(
            http, FakeGate(events), login=LOGIN, password=PASSWORD, origin=ORIGIN
        )
        report = await sync_dataforseo_locations(sessions, client)
    assert report is not None
    assert report.listed == 9
    assert await _count(migrated) == 9


def _environment(monkeypatch: pytest.MonkeyPatch, settings: Settings, **extra: str) -> None:
    for name in ("DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"):
        monkeypatch.delenv(name, raising=False)
    values = {
        "PROCESS_ROLE": settings.process_role,
        "APP_ORIGIN": settings.app_origin,
        "APP_ENV": "test",
        "DATABASE_URL": settings.database_url.get_secret_value(),
        "REDIS_URL": settings.redis_url.get_secret_value(),
        "LOG_LEVEL": "critical",
        **extra,
    }
    for name, value in values.items():
        monkeypatch.setenv(name, value)


@pytest.mark.usefixtures("no_locations")
def test_the_command_fills_locations_from_a_saved_file(
    monkeypatch: pytest.MonkeyPatch,
    worker_settings: Settings,
    capsys: pytest.CaptureFixture[str],
) -> None:
    _environment(monkeypatch, worker_settings)

    assert command.main(["--from-file", str(SAMPLE)]) == 0
    assert capsys.readouterr().out == "9 locations, 0 skipped, 0 deactivated\n"


def test_the_command_says_why_it_cannot_sync(
    monkeypatch: pytest.MonkeyPatch,
    worker_settings: Settings,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    _environment(monkeypatch, worker_settings)
    broken = tmp_path / "broken.json"
    broken.write_text("not json")

    assert command.main([]) == 1
    assert "No DataForSEO credentials" in capsys.readouterr().err
    assert command.main(["--from-file", str(broken)]) == 1
    assert "could not be read" in capsys.readouterr().err
    assert command.main(["--from-file", str(tmp_path / "missing.json")]) == 1
    assert "The file could not be read" in capsys.readouterr().err
    # A database that cannot be reached is not a file that cannot be read.
    monkeypatch.setenv("DATABASE_URL", "postgresql://app_worker:x@127.0.0.1:9/sightline")
    assert command.main(["--from-file", str(SAMPLE)]) == 1
    assert "The sync could not run" in capsys.readouterr().err


def test_the_command_runs_as_the_worker_only(
    monkeypatch: pytest.MonkeyPatch,
    worker_settings: Settings,
    capsys: pytest.CaptureFixture[str],
) -> None:
    _environment(
        monkeypatch,
        worker_settings,
        PROCESS_ROLE="cli",
    )
    assert command.main(["--from-file", str(SAMPLE)]) == 2
    assert "PROCESS_ROLE" in capsys.readouterr().err


def test_a_refused_call_is_reported(
    monkeypatch: pytest.MonkeyPatch,
    worker_settings: Settings,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """With credentials and a provider that refuses them."""
    _environment(
        monkeypatch,
        worker_settings,
        DATAFORSEO_LOGIN="owner@example.com",
        DATAFORSEO_PASSWORD="wrong",
        R2_RAW_ENDPOINT="http://127.0.0.1:9",
        R2_RAW_ACCESS_KEY_ID="key",
        R2_RAW_SECRET_ACCESS_KEY="secret",
    )

    def refuse(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"status_code": 40100, "status_message": "Unauthorized."})

    original = httpx.AsyncClient

    def mocked(*args: object, **kwargs: object) -> httpx.AsyncClient:
        return original(transport=httpx.MockTransport(refuse))

    monkeypatch.setattr(httpx, "AsyncClient", mocked)
    assert command.main([]) == 1
    assert "The DataForSEO call failed: auth" in capsys.readouterr().err
