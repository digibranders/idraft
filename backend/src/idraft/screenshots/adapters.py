"""The real parts behind `service.capture_screenshot`: DataForSEO's screenshot call and the
download of the image it points to."""

from __future__ import annotations

from decimal import Decimal
from typing import Final

import httpx

from idraft.domain.retries import ProviderErrorKind
from idraft.providers.contract import ProviderCallError
from idraft.providers.dataforseo.client import DataForSeoClient
from idraft.providers.dataforseo.screenshot import (
    FAMILY,
    PATH,
    ScreenshotTaskExpiredError,
    read_screenshot,
    screenshot_body,
)

# A tall capture of a long answer is well under this; it bounds what a bad link can cost us.
IMAGE_MAX: Final = 8 * 1024 * 1024


class DataForSeoScreenshots:
    def __init__(self, client: DataForSeoClient) -> None:
        self._client = client

    async def screenshot(self, task_id: str) -> tuple[str, Decimal]:
        try:
            answered = await self._client.call(
                "POST", PATH, family=FAMILY, body=screenshot_body(task_id)
            )
        except ProviderCallError as error:
            if error.error.kind is ProviderErrorKind.NOT_FOUND_EXPIRED:
                raise ScreenshotTaskExpiredError("the provider no longer holds the task") from None
            raise
        link = read_screenshot(answered.content)
        return link.url, link.cost_usd


async def download_image(http: httpx.AsyncClient, url: str) -> bytes:
    """The PNG at `url` (it needs no login). Refuses anything that is not an image or is large."""
    response = await http.get(url, follow_redirects=False)
    response.raise_for_status()
    if not response.headers.get("content-type", "").startswith("image/"):
        raise ValueError("the link did not return an image")
    if len(response.content) > IMAGE_MAX:
        raise ValueError(f"the image is too large ({len(response.content)} bytes)")
    return response.content
