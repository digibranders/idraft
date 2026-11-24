"""The real parts behind `service.capture_screenshot`: DataForSEO's screenshot call and the
download of the image it points to."""

from __future__ import annotations

from decimal import Decimal
from typing import Final
from urllib.parse import urlsplit

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
# The image link is the provider's: https, on its own domain or a subdomain of it. A link taken
# from an answer is not followed anywhere else.
IMAGE_HOST: Final = "dataforseo.com"
PNG_MAGIC: Final = b"\x89PNG\r\n\x1a\n"


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
    """The PNG at `url` (it needs no login). Refuses a link that is not the provider's, a body
    that is not a PNG, and one past `IMAGE_MAX`, which is not read to its end."""
    _check_link(url)
    async with http.stream("GET", url, follow_redirects=False) as response:
        response.raise_for_status()
        if not response.headers.get("content-type", "").startswith("image/"):
            raise ValueError("the link did not return an image")
        body = bytearray()
        async for chunk in response.aiter_bytes():
            body += chunk
            if len(body) > IMAGE_MAX:
                raise ValueError(f"the image is too large (more than {IMAGE_MAX} bytes)")
    if not body.startswith(PNG_MAGIC):
        raise ValueError("the link did not return an image")
    return bytes(body)


def _check_link(url: str) -> None:
    parts = urlsplit(url)
    host = parts.hostname or ""
    if (
        parts.scheme != "https"
        or parts.username is not None
        or not (host == IMAGE_HOST or host.endswith(f".{IMAGE_HOST}"))
    ):
        raise ValueError("the image link is not an https link of the provider")
