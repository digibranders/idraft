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


async def test_the_download_returns_the_bytes() -> None:
    async with _images(b"\x89PNG", "image/png") as http:
        assert await download_image(http, IMAGE_URL) == b"\x89PNG"


async def test_a_download_that_is_not_an_image_is_refused() -> None:
    async with _images(b"<html>", "text/html") as http:
        with pytest.raises(ValueError, match="image"):
            await download_image(http, IMAGE_URL)


async def test_a_download_that_is_too_large_is_refused() -> None:
    async with _images(b"x" * (IMAGE_MAX + 1), "image/png") as http:
        with pytest.raises(ValueError, match="large"):
            await download_image(http, IMAGE_URL)
