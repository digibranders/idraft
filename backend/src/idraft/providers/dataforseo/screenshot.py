"""DataForSEO's page screenshot (`POST /v3/serp/screenshot`), used for the page an AI engine
showed (ChatGPT, Gemini, Google AI Mode).

The endpoint takes the id of an earlier task, within 7 days of posting it, renders its saved page
and answers with the address of a PNG that stays valid one day. It costs $0.004 a request, at any
height. Tested on 2026-11-23: it works for the ChatGPT scraper, the Gemini scraper and AI Mode.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from decimal import Decimal
from typing import Final
from urllib.parse import urlsplit

PATH: Final = "/v3/serp/screenshot"
# The call gate's family (client.FAMILY_LIMITS).
FAMILY: Final = "screenshot"
# The tallest page the endpoint takes. An answer is shorter, so the capture is trimmed after.
SCREENSHOT_HEIGHT: Final = 9999
# What one request costs, for estimates; the provider's reported cost is what is recorded.
PRICE_USD: Final = Decimal("0.004")
# DataForSEO keeps the task's page this long.
TASK_WINDOW_DAYS: Final = 7
_OK: Final = 20000


class UnreadableScreenshotError(ValueError):
    """The answer is not a screenshot answer."""


@dataclass(frozen=True, slots=True)
class ScreenshotLink:
    url: str
    cost_usd: Decimal


def screenshot_body(task_id: str) -> list[dict[str, object]]:
    """The request body for the page of one task."""
    return [
        {
            "task_id": task_id,
            "browser_preset": "desktop",
            "browser_screen_height": SCREENSHOT_HEIGHT,
        }
    ]


def read_screenshot(content: bytes) -> ScreenshotLink:
    """The image address and cost of an answer to `screenshot_body`."""
    try:
        envelope = json.loads(content)
        task = envelope["tasks"][0]
    except (ValueError, KeyError, IndexError, TypeError) as error:
        raise UnreadableScreenshotError("the answer is not a screenshot answer") from error
    if task.get("status_code") != _OK:
        raise UnreadableScreenshotError(
            f"task status {task.get('status_code')}: {str(task.get('status_message'))[:120]}"
        )
    try:
        image = task["result"][0]["items"][0]["image"]
    except (KeyError, IndexError, TypeError) as error:
        raise UnreadableScreenshotError("the answer holds no image") from error
    parts = urlsplit(str(image))
    if parts.scheme != "https" or not parts.netloc:
        raise UnreadableScreenshotError("the image address is not an https address")
    return ScreenshotLink(url=str(image), cost_usd=Decimal(str(task.get("cost", 0))))
