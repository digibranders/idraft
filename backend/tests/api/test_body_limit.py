"""The request body limit (docs/19 section 2.7): 1 MB for a JSON body."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx
import pytest
from fastapi import FastAPI
from pydantic import BaseModel

from sightline.api.body_limit import JSON_BODY_MAX_BYTES, BodyLimitMiddleware
from sightline.api.problems import register_problem_handlers
from tests.conftest import BASE_URL

LIMIT = 64


class Echo(BaseModel):
    text: str


def _app() -> FastAPI:
    app = FastAPI()
    register_problem_handlers(app, app_origin=BASE_URL)
    app.add_middleware(BodyLimitMiddleware, app_origin=BASE_URL, max_bytes=LIMIT)

    @app.post("/api/v1/echo")
    async def echo(body: Echo) -> Echo:
        return body

    @app.post("/elsewhere")
    async def elsewhere(body: Echo) -> Echo:
        return body

    return app


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=_app(), raise_app_exceptions=False)
    async with httpx.AsyncClient(
        transport=transport, base_url=BASE_URL, headers={"content-type": "application/json"}
    ) as client:
        yield client


def _body(size: int) -> bytes:
    """A JSON body of exactly `size` bytes."""
    padding = size - len(json.dumps({"text": ""}))
    return json.dumps({"text": "a" * padding}).encode()


async def _chunks(body: bytes) -> AsyncIterator[bytes]:
    for start in range(0, len(body), 16):
        yield body[start : start + 16]


async def test_a_body_at_the_limit_is_read(client: httpx.AsyncClient) -> None:
    response = await client.post("/api/v1/echo", content=_body(LIMIT))
    assert response.status_code == 200


async def test_a_body_announced_above_the_limit_is_refused_unread(
    client: httpx.AsyncClient,
) -> None:
    response = await client.post("/api/v1/echo", content=_body(LIMIT + 1))

    assert response.status_code == 413
    assert (response.json()["code"], response.json()["detail"]) == (
        "payload_too_large",
        "A request body is at most 1 MB.",
    )


async def test_a_chunked_body_is_counted_as_it_arrives(client: httpx.AsyncClient) -> None:
    within = await client.post("/api/v1/echo", content=_chunks(_body(LIMIT)))
    above = await client.post("/api/v1/echo", content=_chunks(_body(LIMIT + 1)))

    assert "content-length" not in above.request.headers
    assert within.status_code == 200
    assert above.status_code == 413
    assert above.json()["code"] == "payload_too_large"


async def test_paths_outside_the_api_are_not_limited(client: httpx.AsyncClient) -> None:
    response = await client.post("/elsewhere", content=_body(LIMIT * 4))
    assert response.status_code == 200


async def test_the_application_refuses_a_body_over_1_mb(api: httpx.AsyncClient) -> None:
    response = await api.post(
        "/api/v1/auth/sign-in",
        content=_body(JSON_BODY_MAX_BYTES + 1),
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 413
    assert response.json()["code"] == "payload_too_large"
    assert response.headers["x-request-id"] == response.json()["request_id"]


async def test_the_origin_is_checked_before_the_size(api: httpx.AsyncClient) -> None:
    """A page on another site learns nothing from the body limit."""
    response = await api.post(
        "/api/v1/auth/sign-in",
        content=_body(JSON_BODY_MAX_BYTES + 1),
        headers={"content-type": "application/json", "origin": "https://elsewhere.example"},
    )
    assert response.status_code == 403
    assert response.json()["code"] == "origin_not_allowed"
