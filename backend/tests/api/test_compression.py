"""Response compression (docs/ops/api-compression.md): gzip for a client that asks, else plain."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
from fastapi import FastAPI

from tests.api.auth.support import cookie, make_user, open_session
from tests.conftest import PostgresServer

COMMITTED = Path(__file__).parents[2] / "openapi" / "v1.json"
# The one large JSON body that needs no data: the OpenAPI document, served to a signed-in user.
LARGE = "/api/v1/openapi.json"


async def _large(
    app: FastAPI, client: httpx.AsyncClient, migrated: PostgresServer, accept_encoding: str
) -> httpx.Response:
    user = await make_user(migrated)
    token, _ = await open_session(app.state.resources, user)
    headers = {**cookie(token), "Accept-Encoding": accept_encoding}
    return await client.get(LARGE, headers=headers)


async def test_a_large_body_is_gzipped_for_a_client_that_asks(
    app: FastAPI, client: httpx.AsyncClient, migrated: PostgresServer
) -> None:
    response = await _large(app, client, migrated, "gzip")

    assert response.status_code == 200
    assert response.headers["content-encoding"] == "gzip"
    assert "Accept-Encoding" in response.headers["vary"]
    assert response.json() == json.loads(COMMITTED.read_text())  # decoded by the client
    # This JSON shrinks well past 4 to 1.
    assert response.num_bytes_downloaded * 4 < len(response.content)


async def test_the_same_body_is_not_compressed_for_a_client_that_does_not_ask(
    app: FastAPI, client: httpx.AsyncClient, migrated: PostgresServer
) -> None:
    response = await _large(app, client, migrated, "identity")

    assert "content-encoding" not in response.headers
    assert "Accept-Encoding" in response.headers["vary"]  # a shared cache must keep the two apart
    assert response.num_bytes_downloaded == len(response.content)


async def test_compression_keeps_the_other_headers(
    app: FastAPI, client: httpx.AsyncClient, migrated: PostgresServer
) -> None:
    response = await _large(app, client, migrated, "gzip")

    assert response.headers["cache-control"] == "no-store"
    assert response.headers["content-type"] == "application/json"
    assert response.headers["x-request-id"].startswith("req_")
    assert "etag" not in response.headers  # the API sends none to weaken


async def test_a_small_body_is_left_alone(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/healthz", headers={"Accept-Encoding": "gzip"})

    assert response.status_code == 200
    assert "content-encoding" not in response.headers
