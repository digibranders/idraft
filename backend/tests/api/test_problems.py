import io
import json
from collections.abc import AsyncIterator

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from sightline.api.problems import (
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    UnauthenticatedError,
    register_problem_handlers,
)
from sightline.api.request_id import REQUEST_ID_PATTERN, RequestIdMiddleware
from sightline.config.logging import configure_logging

ORIGIN = "https://app.example.com"


class Item(BaseModel):
    name: str = Field(min_length=2)
    size: int = Field(le=100)


def _app(*, with_request_ids: bool = True) -> FastAPI:
    app = FastAPI()
    if with_request_ids:
        app.add_middleware(RequestIdMiddleware)
    register_problem_handlers(app, app_origin=ORIGIN)

    @app.get("/missing")
    async def missing() -> None:
        raise NotFoundError("No project with that id.")

    @app.get("/duplicate")
    async def duplicate() -> None:
        raise ConflictError("Already exists.", code="duplicate", existing_id="0192")

    @app.get("/bad")
    async def bad() -> None:
        raise BadRequestError()

    @app.get("/login-needed")
    async def login_needed() -> None:
        raise UnauthenticatedError()

    @app.get("/no-access")
    async def no_access() -> None:
        raise ForbiddenError("You cannot change billing.")

    @app.get("/teapot")
    async def teapot() -> None:
        raise HTTPException(status_code=418)

    @app.post("/items")
    async def create(item: Item) -> Item:
        return item

    @app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("SELECT secret FROM vault failed for user admin")

    @app.get("/things/{thing_id}")
    async def thing(thing_id: str) -> None:
        raise RuntimeError(f"cannot load {thing_id}")

    return app


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=_app(), raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as test_client:
        yield test_client


def _assert_problem(response: httpx.Response, status: int, code: str) -> dict[str, object]:
    assert response.status_code == status
    assert response.headers["content-type"] == "application/problem+json"
    body: dict[str, object] = response.json()
    assert body["status"] == status
    assert body["code"] == code
    assert body["type"] == f"{ORIGIN}/api/problems/{code}"
    assert REQUEST_ID_PATTERN.fullmatch(str(body["request_id"]))
    assert response.headers["X-Request-Id"] == body["request_id"]
    return body


async def test_problem_error_subclass(client: httpx.AsyncClient) -> None:
    body = _assert_problem(await client.get("/missing"), 404, "not_found")
    assert body["title"] == "Resource not found"
    assert body["detail"] == "No project with that id."
    assert body["instance"] == "/missing"


async def test_extensions_and_code_override(client: httpx.AsyncClient) -> None:
    body = _assert_problem(await client.get("/duplicate"), 409, "duplicate")
    assert body["existing_id"] == "0192"


@pytest.mark.parametrize(
    ("path", "status", "code"),
    [
        ("/bad", 400, "bad_request"),
        ("/login-needed", 401, "unauthenticated"),
        ("/no-access", 403, "forbidden"),
    ],
)
async def test_each_error_class_maps_to_its_status_and_code(
    client: httpx.AsyncClient, path: str, status: int, code: str
) -> None:
    _assert_problem(await client.get(path), status, code)


async def test_detail_is_omitted_when_none_was_given(client: httpx.AsyncClient) -> None:
    assert "detail" not in (await client.get("/bad")).json()


async def test_unknown_route_is_not_found(client: httpx.AsyncClient) -> None:
    _assert_problem(await client.get("/nope"), 404, "not_found")


async def test_wrong_method(client: httpx.AsyncClient) -> None:
    _assert_problem(await client.delete("/missing"), 405, "method_not_allowed")


async def test_an_unmapped_http_status_gets_a_generic_code(client: httpx.AsyncClient) -> None:
    _assert_problem(await client.get("/teapot"), 418, "http_error")


async def test_validation_errors_list_each_field(client: httpx.AsyncClient) -> None:
    response = await client.post("/items", json={"name": "a", "size": 500})
    body = _assert_problem(response, 422, "validation_failed")
    assert body["detail"] == "2 fields are invalid."
    errors = body["errors"]
    assert isinstance(errors, list)
    assert {(e["location"], e["path"], e["code"]) for e in errors} == {
        ("body", "name", "string_too_short"),
        ("body", "size", "less_than_equal"),
    }
    assert all(isinstance(e["message"], str) and e["message"] for e in errors)


async def test_single_validation_error_wording(client: httpx.AsyncClient) -> None:
    response = await client.post("/items", json={"name": "ok", "size": 500})
    assert response.json()["detail"] == "1 field is invalid."


async def test_malformed_json_is_bad_request(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/items", content=b"{not json", headers={"content-type": "application/json"}
    )
    _assert_problem(response, 400, "bad_request")


async def test_unexpected_errors_leak_nothing(client: httpx.AsyncClient) -> None:
    response = await client.get("/boom")
    body = _assert_problem(response, 500, "internal_error")
    assert "detail" not in body
    assert "vault" not in response.text
    assert "RuntimeError" not in response.text


async def test_a_request_id_is_minted_when_the_middleware_is_absent() -> None:
    transport = httpx.ASGITransport(app=_app(with_request_ids=False))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as bare:
        response = await bare.get("/missing")
    _assert_problem(response, 404, "not_found")


async def test_unexpected_errors_are_logged_with_the_route_template(
    client: httpx.AsyncClient,
) -> None:
    stream = io.StringIO()
    configure_logging(service="api", version="test", level="info", stream=stream)

    response = await client.get("/things/0192abc?token=hunter2")

    assert response.status_code == 500
    (line,) = [json.loads(raw) for raw in stream.getvalue().splitlines()]
    assert line["msg"] == "unhandled exception"
    assert line["level"] == "error"
    assert line["route"] == "/things/{thing_id}"
    assert line["request_id"] == response.json()["request_id"]
    assert line["err"]["type"] == "RuntimeError"
    assert "hunter2" not in stream.getvalue()
