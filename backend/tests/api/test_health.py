import io
import json
import time
from typing import Any

import asyncpg
import httpx
import pytest
from asgi_lifespan import LifespanManager
from fastapi import FastAPI
from pydantic import SecretStr
from sqlalchemy import text

from sightline.api.main import create_app
from sightline.api.resources import Resources
from sightline.config.logging import configure_logging
from sightline.config.settings import Settings
from tests.conftest import BASE_URL, PostgresServer


async def test_healthz_is_alive_and_reveals_nothing(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["X-Request-Id"].startswith("req_")


async def test_readyz_is_ready_when_everything_answers(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/readyz")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "checks": {"postgres": True, "redis": True, "migrations": True},
    }


async def _readyz(settings: Settings) -> httpx.Response:
    application = create_app(settings)
    async with LifespanManager(application):
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(transport=transport, base_url=BASE_URL) as test_client:
            return await test_client.get("/api/readyz")


@pytest.mark.parametrize(
    ("override", "expected"),
    [
        (
            {"redis_url": SecretStr("redis://127.0.0.1:1/0")},
            {"postgres": True, "redis": False, "migrations": True},
        ),
        (
            {"database_url": SecretStr("postgresql://nobody:x@127.0.0.1:1/none")},
            {"postgres": False, "redis": True, "migrations": False},
        ),
    ],
)
async def test_readyz_names_the_failing_checks_only(
    app_settings: Settings, override: dict[str, Any], expected: dict[str, bool]
) -> None:
    response = await _readyz(app_settings.model_copy(update=override))
    assert response.status_code == 503
    assert response.json() == {"status": "not_ready", "checks": expected}


async def _database(pg: PostgresServer, name: str, *, version: str | None) -> SecretStr:
    """A database the api role can connect to, optionally claiming a schema revision."""
    await pg.create_database(name)
    if version is not None:
        owner = await asyncpg.connect(pg.url("migrator", name))
        try:
            await owner.execute("CREATE SCHEMA ops")
            await owner.execute("CREATE TABLE ops.alembic_version (version_num text)")
            await owner.execute("INSERT INTO ops.alembic_version VALUES ($1)", version)
            await owner.execute("GRANT USAGE ON SCHEMA ops TO app_api")
            await owner.execute("GRANT SELECT ON ops.alembic_version TO app_api")
        finally:
            await owner.close()
    return SecretStr(pg.url("app_api", name))


async def test_readyz_fails_when_the_database_was_never_migrated(
    app_settings: Settings, pg: PostgresServer
) -> None:
    url = await _database(pg, "ready_unmigrated", version=None)
    response = await _readyz(app_settings.model_copy(update={"database_url": url}))
    assert response.status_code == 503
    assert response.json()["checks"] == {"postgres": True, "redis": True, "migrations": False}


async def test_readyz_stays_ready_when_a_newer_build_has_migrated_the_database(
    app_settings: Settings, pg: PostgresServer
) -> None:
    """A rolled-back release must pass its own health gate (docs/22 section 8.5)."""
    url = await _database(pg, "ready_ahead", version="9999_from_the_future")
    response = await _readyz(app_settings.model_copy(update={"database_url": url}))
    assert response.status_code == 200
    assert response.json()["checks"]["migrations"] is True


async def test_frozen_dependencies_cannot_hold_readiness_open(
    app_settings: Settings, black_hole: str
) -> None:
    settings = app_settings.model_copy(
        update={
            "database_url": SecretStr(f"postgresql://u:p@{black_hole}/db"),
            "redis_url": SecretStr(f"redis://{black_hole}/0"),
        }
    )
    started = time.perf_counter()
    response = await _readyz(settings)
    elapsed = time.perf_counter() - started

    assert response.status_code == 503
    assert response.json()["checks"] == {"postgres": False, "redis": False, "migrations": False}
    assert elapsed < 4.0


async def test_a_failed_check_is_explained_in_the_log_not_in_the_response(
    app_settings: Settings,
) -> None:
    settings = app_settings.model_copy(
        update={"redis_url": SecretStr("redis://127.0.0.1:1/0"), "log_level": "info"}
    )
    application = create_app(settings)
    stream = io.StringIO()
    configure_logging(service="api", version="test", level="info", stream=stream)
    async with LifespanManager(application):
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(transport=transport, base_url=BASE_URL) as test_client:
            response = await test_client.get("/api/readyz")

    lines = [json.loads(raw) for raw in stream.getvalue().splitlines()]
    (probe,) = [line for line in lines if line["msg"] == "redis probe failed"]
    assert probe["level"] == "warning"
    assert probe["error_kind"]
    (request,) = [line for line in lines if line["msg"] == "request finished"]
    assert (request["route"], request["status_code"], request["level"]) == (
        "/api/readyz",
        503,
        "info",
    )
    assert set(response.json()) == {"status", "checks"}


async def test_the_app_holds_typed_working_resources_while_running(app: FastAPI) -> None:
    resources = app.state.resources
    assert isinstance(resources, Resources)
    async with resources.engine.connect() as connection:
        assert (await connection.execute(text("SELECT 1"))).scalar_one() == 1
    assert await resources.redis.ping() is True


async def test_unknown_api_route_is_a_problem(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/v1/does-not-exist")
    assert response.status_code == 404
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json()["type"] == f"{BASE_URL}/api/problems/not_found"


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json", "/api/v1/openapi.json"])
async def test_the_api_contract_is_not_served_without_a_session(
    client: httpx.AsyncClient, path: str
) -> None:
    assert (await client.get(path)).status_code == 404
