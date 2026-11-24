"""The provider call and the image download behind the capture service."""

from __future__ import annotations

from collections.abc import AsyncIterator
from decimal import Decimal

import httpx
import pytest

from idraft.providers.dataforseo.client import DataForSeoClient
from idraft.providers.dataforseo.screenshot import ScreenshotTaskExpiredError
from idraft.screenshots.adapters import IMAGE_MAX, DataForSeoScreenshots, download_image
from tests.providers.dataforseo.support import LOGIN, ORIGIN, PASSWORD, Api, FakeGate

IMAGE_URL = "https://api.dataforseo.com/shot.png"
ANSWER = {
    "version": "0.1",
    "status_code": 20000,
    "status_message": "Ok.",
    "cost": 0.004,
    "tasks_count": 1,
    "tasks_error": 0,
    "tasks": [
        {
            "id": "t",
            "status_code": 20000,
            "status_message": "Ok.",
            "cost": 0.004,
            "result_count": 1,
            "result": [{"items_count": 1, "items": [{"image": IMAGE_URL}]}],
        }
    ],
}


@pytest.fixture
async def client_and_api() -> AsyncIterator[tuple[DataForSeoClient, Api]]:
    events: list[str] = []
    api = Api(events)
    async with httpx.AsyncClient(transport=httpx.MockTransport(api)) as http:
        yield (
            DataForSeoClient(http, FakeGate(events), login=LOGIN, password=PASSWORD, origin=ORIGIN),
            api,
        )


def _images(content: bytes, content_type: str) -> httpx.AsyncClient:
    transport = httpx.MockTransport(
        lambda request: httpx.Response(200, content=content, headers={"content-type": content_type})
    )
    return httpx.AsyncClient(transport=transport)


async def test_the_provider_returns_the_link_and_the_cost(
    client_and_api: tuple[DataForSeoClient, Api],
) -> None:
    client, api = client_and_api
    api.answer("POST", "/v3/serp/screenshot", ANSWER)
    url, cost = await DataForSeoScreenshots(client).screenshot("task-1")
    assert url == IMAGE_URL
    assert cost == Decimal("0.004")
    assert api.requests[0].url.path == "/v3/serp/screenshot"
    assert api.posted()[0]["task_id"] == "task-1"


async def test_a_task_the_provider_does_not_hold_is_an_expired_task(
    client_and_api: tuple[DataForSeoClient, Api],
) -> None:
    client, api = client_and_api
    gone = {**ANSWER, "status_code": 40403, "status_message": "Task not found.", "tasks": []}
    api.answer("POST", "/v3/serp/screenshot", gone)
    with pytest.raises(ScreenshotTaskExpiredError):
        await DataForSeoScreenshots(client).screenshot("old-task")


PNG = b"\x89PNG\r\n\x1a\n" + b"x" * 100


async def test_the_download_returns_the_bytes() -> None:
    async with _images(PNG, "image/png") as http:
        assert await download_image(http, IMAGE_URL) == PNG


async def test_a_subdomain_of_the_provider_is_allowed() -> None:
    async with _images(PNG, "image/png") as http:
        assert await download_image(http, "https://image.dataforseo.com/a.png") == PNG


@pytest.mark.parametrize(
    "url",
    [
        "http://api.dataforseo.com/shot.png",
        "https://evil.example/shot.png",
        "https://dataforseo.com.evil.example/shot.png",
        "https://evildataforseo.com/shot.png",
        "https://user@api.dataforseo.com/shot.png",
        "https://127.0.0.1/shot.png",
    ],
)
async def test_a_link_that_is_not_the_providers_is_refused_without_a_request(url: str) -> None:
    asked: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        asked.append(str(request.url))
        return httpx.Response(200, content=PNG, headers={"content-type": "image/png"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(ValueError, match="link"):
            await download_image(http, url)
    assert asked == []


async def test_a_download_that_is_not_an_image_is_refused() -> None:
    async with _images(b"<html>", "text/html") as http:
        with pytest.raises(ValueError, match="image"):
            await download_image(http, IMAGE_URL)


async def test_a_body_that_is_not_a_png_is_refused_whatever_it_claims() -> None:
    async with _images(b"<html>" + b"x" * 100, "image/png") as http:
        with pytest.raises(ValueError, match="image"):
            await download_image(http, IMAGE_URL)


async def test_a_body_larger_than_the_limit_is_cut_off_while_streaming() -> None:
    chunk = 1024 * 1024
    produced: list[int] = []

    async def body() -> AsyncIterator[bytes]:
        yield PNG
        while True:
            produced.append(chunk)
            yield b"x" * chunk

    transport = httpx.MockTransport(
        lambda request: httpx.Response(200, content=body(), headers={"content-type": "image/png"})
    )
    async with httpx.AsyncClient(transport=transport) as http:
        with pytest.raises(ValueError, match="large"):
            await download_image(http, IMAGE_URL)
    # The limit is 8 MB: the reading stopped a chunk or two after it, not at the end of a body
    # that never ends.
    assert len(produced) <= IMAGE_MAX // chunk + 2


async def test_a_redirect_is_not_followed() -> None:
    transport = httpx.MockTransport(
        lambda request: httpx.Response(302, headers={"location": "https://evil.example/x.png"})
    )
    async with httpx.AsyncClient(transport=transport) as http:
        with pytest.raises(httpx.HTTPStatusError):
            await download_image(http, IMAGE_URL)
