import re
import time

import httpx
import structlog
from fastapi import FastAPI, Request

from sightline.api.request_id import REQUEST_ID_PATTERN, RequestIdMiddleware, new_request_id


def test_request_id_shape() -> None:
    value = new_request_id()
    assert REQUEST_ID_PATTERN.fullmatch(value)
    assert re.fullmatch(r"req_[0-9A-HJKMNP-TV-Z]{26}", value)


def test_request_ids_are_unique_and_sort_by_time() -> None:
    first = new_request_id()
    time.sleep(0.002)
    second = new_request_id()
    assert first != second
    assert first < second


def _app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RequestIdMiddleware)

    @app.get("/echo")
    async def echo(request: Request) -> dict[str, object]:
        return {
            "state": request.state.request_id,
            "context": structlog.contextvars.get_contextvars().get("request_id"),
        }

    return app


async def _get(headers: dict[str, str] | None = None) -> httpx.Response:
    transport = httpx.ASGITransport(app=_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get("/echo", headers=headers)


async def test_generates_an_id_and_returns_it_in_the_header() -> None:
    response = await _get()
    header = response.headers["X-Request-Id"]
    assert REQUEST_ID_PATTERN.fullmatch(header)
    assert response.json() == {"state": header, "context": header}


async def test_keeps_a_well_formed_inbound_id() -> None:
    inbound = new_request_id()
    response = await _get({"X-Request-Id": inbound})
    assert response.headers["X-Request-Id"] == inbound


async def test_replaces_a_malformed_inbound_id() -> None:
    response = await _get({"X-Request-Id": "not-one-of-ours"})
    header = response.headers["X-Request-Id"]
    assert header != "not-one-of-ours"
    assert REQUEST_ID_PATTERN.fullmatch(header)


async def test_context_is_cleared_after_the_request() -> None:
    await _get()
    assert "request_id" not in structlog.contextvars.get_contextvars()


async def test_non_http_scopes_pass_through_untouched() -> None:
    seen: list[str] = []

    async def inner(scope: dict[str, object], receive: object, send: object) -> None:
        seen.append(str(scope["type"]))

    async def receive() -> dict[str, object]:
        return {}

    async def send(message: object) -> None:
        return None

    await RequestIdMiddleware(inner)({"type": "lifespan"}, receive, send)  # type: ignore[arg-type]
    assert seen == ["lifespan"]
