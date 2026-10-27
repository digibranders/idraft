import httpx
import pytest
import structlog
from fastapi import FastAPI, Request

from idraft.api.request_id import (
    RequestIdMiddleware,
    is_request_id,
    new_request_id,
)

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def _decode(request_id: str) -> int:
    number = 0
    for character in request_id.removeprefix("req_"):
        number = number * 32 + _CROCKFORD.index(character)
    return number


def test_a_new_id_is_a_uuid_version_7_in_base32() -> None:
    value = new_request_id()
    assert value.startswith("req_")
    assert len(value) == 30
    number = _decode(value)
    assert number < 2**128
    assert (number >> 76) & 0xF == 7  # version
    assert (number >> 62) & 0b11 == 0b10  # RFC 9562 variant
    assert is_request_id(value)


def test_ids_are_unique_and_strictly_increasing_even_within_one_millisecond() -> None:
    ids = [new_request_id() for _ in range(5000)]
    assert len(set(ids)) == len(ids)
    assert ids == sorted(ids)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda v: v[:-1],  # too short
        lambda v: v + "0",  # too long
        lambda v: v.lower(),  # wrong case
        lambda v: v[:10] + "I" + v[11:],  # letter outside the alphabet
        lambda v: v.replace("req_", "REQ_"),  # wrong prefix
        lambda v: v + "\n",  # trailing junk
        lambda v: "req_" + "Z" * 26,  # more than 128 bits
        lambda v: "req_" + "0" * 26,  # not version 7
        lambda v: "",  # empty
        lambda v: "3f2b8c1e-6d4a-4b7e-9c1d-2a5f8e7b6c4d",  # a plain UUID
    ],
)
def test_near_misses_are_not_request_ids(mutate: object) -> None:
    assert callable(mutate)
    assert not is_request_id(mutate(new_request_id()))


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
    assert is_request_id(header)
    assert response.json() == {"state": header, "context": header}


async def test_keeps_a_well_formed_inbound_id() -> None:
    inbound = new_request_id()
    response = await _get({"X-Request-Id": inbound})
    assert response.headers["X-Request-Id"] == inbound


@pytest.mark.parametrize("inbound", ["not-one-of-ours", "req_" + "Z" * 26, "req_" + "0" * 26])
async def test_replaces_a_malformed_inbound_id(inbound: str) -> None:
    response = await _get({"X-Request-Id": inbound})
    header = response.headers["X-Request-Id"]
    assert header != inbound
    assert is_request_id(header)


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
