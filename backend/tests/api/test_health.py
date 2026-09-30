from collections.abc import AsyncIterator

import asyncpg
import httpx
import pytest
from asgi_lifespan import LifespanManager
from fastapi import FastAPI
from sqlalchemy import text

from sightline.api.main import create_app
from sightline.config.settings import Settings
from tests.conftest import BASE_URL


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


@pytest.fixture
async def degraded_client(
    app_settings: Settings, request: pytest.FixtureRequest
) -> AsyncIterator[httpx.AsyncClient]:
    overrides: dict[str, object] = request.param
    application = create_app(app_settings.model_copy(update=overrides))
    async with LifespanManager(application):
        transport = httpx.ASGITransport(app=application, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url=BASE_URL) as test_client:
            yield test_client


@pytest.mark.parametrize(
    ("degraded_client", "expected"),
    [
        (
            {"redis_url": "redis://127.0.0.1:1/0"},
            {"postgres": True, "redis": False, "migrations": True},
        ),
        (
            {"database_url": "postgresql://nobody:x@127.0.0.1:1/none"},
            {"postgres": False, "redis": True, "migrations": False},
        ),
    ],
    indirect=["degraded_client"],
)
async def test_readyz_names_the_failing_checks_only(
    degraded_client: httpx.AsyncClient, expected: dict[str, bool]
) -> None:
    response = await degraded_client.get("/api/readyz")
    assert response.status_code == 503
    assert response.json() == {"status": "not_ready", "checks": expected}


async def test_readyz_fails_when_the_schema_is_behind(
    app_settings: Settings, postgres_url: str
) -> None:
    admin = await asyncpg.connect(postgres_url)
    try:
        await admin.execute('DROP DATABASE IF EXISTS "unmigrated"')
        await admin.execute('CREATE DATABASE "unmigrated"')
    finally:
        await admin.close()
    url = postgres_url.rsplit("/", 1)[0] + "/unmigrated"

    application = create_app(app_settings.model_copy(update={"database_url": url}))
    async with LifespanManager(application):
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(transport=transport, base_url=BASE_URL) as test_client:
            response = await test_client.get("/api/readyz")
    assert response.status_code == 503
    assert response.json()["checks"] == {"postgres": True, "redis": True, "migrations": False}


async def test_the_app_holds_a_working_engine_and_redis_while_running(app: FastAPI) -> None:
    async with app.state.engine.connect() as connection:
        assert (await connection.execute(text("SELECT 1"))).scalar_one() == 1
    assert await app.state.redis.ping() is True


async def test_unknown_api_route_is_a_problem(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/v1/does-not-exist")
    assert response.status_code == 404
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json()["type"] == f"{BASE_URL}/api/problems/not_found"


async def test_interactive_docs_are_not_served(client: httpx.AsyncClient) -> None:
    assert (await client.get("/docs")).status_code == 404
    assert (await client.get("/redoc")).status_code == 404


async def test_openapi_document_is_served_under_the_versioned_path(
    client: httpx.AsyncClient,
) -> None:
    response = await client.get("/api/v1/openapi.json")
    assert response.status_code == 200
    assert response.json()["info"]["title"] == "Sightline API"
