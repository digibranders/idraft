"""The request body limit (docs/19 section 2.7): 1 MB for a JSON body."""

from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator

import httpx
import pytest
from fastapi import FastAPI, Request
from pydantic import BaseModel

from sightline.api.body_limit import (
    JSON_BODY_MAX_BYTES,
    UPLOAD_FRAMING_BYTES,
    UPLOAD_MAX_BYTES,
    UPLOAD_PATH,
    BodyLimitMiddleware,
    LargerLimit,
    Limit,
)
from sightline.api.problems import register_problem_handlers
from tests.conftest import BASE_URL

LIMIT = 64


class Echo(BaseModel):
    text: str


UPLOAD_LIMIT = 256
UPLOAD = LargerLimit(re.compile(r"/api/v1/upload"), Limit(UPLOAD_LIMIT, "An upload is small."))


def _app() -> FastAPI:
    app = FastAPI()
    register_problem_handlers(app, app_origin=BASE_URL)
    app.add_middleware(BodyLimitMiddleware, app_origin=BASE_URL, max_bytes=LIMIT, larger=[UPLOAD])

    @app.post("/api/v1/echo")
    async def echo(body: Echo) -> Echo:
        return body

    @app.post("/api/v1/upload")
    async def upload(request: Request) -> dict[str, int]:
        return {"bytes": len(await request.body())}

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


async def test_an_upload_may_be_larger_than_a_json_body_up_to_its_own_limit(
    client: httpx.AsyncClient,
) -> None:
    within = await client.post("/api/v1/upload", content=b"x" * UPLOAD_LIMIT)
    above = await client.post("/api/v1/upload", content=b"x" * (UPLOAD_LIMIT + 1))
    json_above = await client.post("/api/v1/echo", content=_body(LIMIT + 1))

    assert (within.status_code, within.json()) == (200, {"bytes": UPLOAD_LIMIT})
    assert above.status_code == 413
    assert above.json()["detail"] == "An upload is small."
    # The larger limit belongs to the upload path only.
    assert json_above.status_code == 413
    assert json_above.json()["detail"] == "A request body is at most 1 MB."


async def test_a_chunked_upload_is_counted_against_its_own_limit(
    client: httpx.AsyncClient,
) -> None:
    within = await client.post("/api/v1/upload", content=_chunks(b"x" * UPLOAD_LIMIT))
    above = await client.post("/api/v1/upload", content=_chunks(b"x" * (UPLOAD_LIMIT + 1)))

    assert within.status_code == 200
    assert (above.status_code, above.json()["code"]) == (413, "payload_too_large")


def test_only_the_import_upload_path_is_larger() -> None:
    base = "/api/v1/workspaces/w/projects/p"

    assert UPLOAD_PATH.fullmatch(f"{base}/keyword-imports/upload")
    for other in (
        f"{base}/keyword-imports",
        f"{base}/keyword-imports/upload/more",
        f"{base}/keyword-imports/abc/upload",
        f"{base}/tracked-keywords/bulk-create",
        "/api/v1/workspaces/w/keyword-imports/upload",
    ):
        assert not UPLOAD_PATH.fullmatch(other)


async def test_the_application_allows_an_upload_of_2_mb_and_refuses_one_over_50_mb(
    api: httpx.AsyncClient,
) -> None:
    path = "/api/v1/workspaces/w/projects/p/keyword-imports/upload"

    big = await api.post(path, content=b"x" * (2 * 1024 * 1024))
    # A 50 MB file and the multipart framing around it fit; more than that does not.
    huge = await api.post(path, content=b"x" * (UPLOAD_MAX_BYTES + UPLOAD_FRAMING_BYTES + 1))
    # Another method on the path is a JSON request, whatever the path.
    patch = await api.patch(
        path,
        content=_body(JSON_BODY_MAX_BYTES + 1),
        headers={"content-type": "application/json"},
    )

    # Not refused for its size (the sign-in comes first, then the missing parts).
    assert big.status_code != 413
    assert (huge.status_code, huge.json()["detail"]) == (413, "An upload is at most 50 MB.")
    assert (patch.status_code, patch.json()["detail"]) == (413, "A request body is at most 1 MB.")


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
