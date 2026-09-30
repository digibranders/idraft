import io
import json
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from sightline.api.access_log import AccessLogMiddleware
from sightline.api.request_id import RequestIdMiddleware
from sightline.config.logging import configure_logging


def _app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(AccessLogMiddleware, quiet_paths=frozenset({"/api/healthz"}))
    app.add_middleware(RequestIdMiddleware)

    @app.get("/things/{thing_id}")
    async def thing(thing_id: str) -> dict[str, str]:
        return {"id": thing_id}

    @app.get("/api/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("kaput")

    return app


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=_app(), raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as test_client:
        yield test_client


def _capture(level: str = "info") -> io.StringIO:
    stream = io.StringIO()
    configure_logging(service="api", version="test", level=level, stream=stream)
    return stream


def _lines(stream: io.StringIO) -> list[dict[str, Any]]:
    return [json.loads(raw) for raw in stream.getvalue().splitlines()]


async def test_logs_method_route_template_status_and_duration(client: httpx.AsyncClient) -> None:
    stream = _capture()
    response = await client.get("/things/0192abc?token=hunter2")

    (line,) = _lines(stream)
    assert line["msg"] == "request finished"
    assert line["method"] == "GET"
    assert line["route"] == "/things/{thing_id}"
    assert line["status_code"] == 200
    assert isinstance(line["duration_ms"], int | float)
    assert line["duration_ms"] >= 0
    assert line["request_id"] == response.headers["X-Request-Id"]
    assert "hunter2" not in stream.getvalue()
    assert "0192abc" not in stream.getvalue()


async def test_unmatched_paths_are_logged_without_the_raw_url(client: httpx.AsyncClient) -> None:
    stream = _capture()
    await client.get("/secret-path/abc123")

    (line,) = _lines(stream)
    assert line["route"] == "unmatched"
    assert line["status_code"] == 404
    assert "abc123" not in stream.getvalue()


async def test_quiet_paths_are_logged_at_debug_only(client: httpx.AsyncClient) -> None:
    stream = _capture(level="info")
    await client.get("/api/healthz")
    assert _lines(stream) == []

    stream = _capture(level="debug")
    await client.get("/api/healthz")
    (line,) = _lines(stream)
    assert line["level"] == "debug"
    assert line["route"] == "/api/healthz"


async def test_a_crashing_handler_is_logged_as_500(client: httpx.AsyncClient) -> None:
    stream = _capture()
    response = await client.get("/boom")

    assert response.status_code == 500
    finished = [line for line in _lines(stream) if line["msg"] == "request finished"]
    assert len(finished) == 1
    assert finished[0]["status_code"] == 500
    assert finished[0]["route"] == "/boom"
