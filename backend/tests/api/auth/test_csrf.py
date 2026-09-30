"""The Origin check (docs/24-security.md section 2.1; docs/19 section 2.1 rules 7 and 8)."""

import io
import json

import httpx
import pytest
from fastapi import FastAPI

from sightline.config.logging import configure_logging
from tests.conftest import BASE_URL

OPEN = "/api/v1/_probe/open"
STATE_CHANGING = ["POST", "PUT", "PATCH", "DELETE"]


@pytest.fixture
async def bare(auth_app: FastAPI) -> httpx.AsyncClient:
    """A client that sends no Origin header unless the test adds one."""
    transport = httpx.ASGITransport(app=auth_app, raise_app_exceptions=False)
    return httpx.AsyncClient(transport=transport, base_url=BASE_URL)


@pytest.mark.parametrize("method", STATE_CHANGING)
async def test_a_state_changing_request_from_our_origin_passes(
    bare: httpx.AsyncClient, method: str
) -> None:
    response = await bare.request(method, OPEN, headers={"Origin": BASE_URL})
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


@pytest.mark.parametrize("method", STATE_CHANGING)
async def test_a_state_changing_request_without_an_origin_is_refused(
    bare: httpx.AsyncClient, method: str
) -> None:
    response = await bare.request(method, OPEN)
    assert response.status_code == 403
    assert response.headers["content-type"] == "application/problem+json"
    body = response.json()
    assert body["code"] == "origin_not_allowed"
    assert body["request_id"] == response.headers["x-request-id"]


@pytest.mark.parametrize(
    "origin",
    [
        "null",
        "",
        "https://evil.example",
        "http://app.example.com",
        "https://app.example.com:8443",
        "https://app.example.com.evil.test",
        "https://evil.test/https://app.example.com",
        "https://sub.app.example.com",
        "HTTPS://APP.EXAMPLE.COM",
        "https://app.example.com/",
        " https://app.example.com",
    ],
)
async def test_any_other_origin_is_refused(bare: httpx.AsyncClient, origin: str) -> None:
    response = await bare.post(OPEN, headers={"Origin": origin})
    assert response.status_code == 403
    assert response.json()["code"] == "origin_not_allowed"


async def test_two_origin_headers_are_refused(bare: httpx.AsyncClient) -> None:
    response = await bare.post(
        OPEN, headers=[("Origin", BASE_URL), ("Origin", "https://evil.example")]
    )
    assert response.status_code == 403


async def test_reads_need_no_origin(bare: httpx.AsyncClient) -> None:
    assert (await bare.get(OPEN)).status_code == 200
    assert (await bare.get(OPEN, headers={"Origin": "https://evil.example"})).status_code == 200


async def test_a_preflight_is_refused_and_nothing_is_allowed(bare: httpx.AsyncClient) -> None:
    response = await bare.options(
        OPEN,
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
    )
    assert response.status_code == 403
    assert not [name for name in response.headers if name.startswith("access-control-")]


async def test_the_health_routes_are_not_affected(bare: httpx.AsyncClient) -> None:
    assert (await bare.get("/api/healthz")).status_code == 200


async def test_a_refusal_is_in_the_access_log(bare: httpx.AsyncClient) -> None:
    stream = io.StringIO()
    configure_logging(service="api", version="test", level="info", stream=stream)
    await bare.post(OPEN)
    lines = [json.loads(raw) for raw in stream.getvalue().splitlines()]
    finished = [line for line in lines if line["msg"] == "request finished"]
    assert [(line["method"], line["status_code"]) for line in finished] == [("POST", 403)]
