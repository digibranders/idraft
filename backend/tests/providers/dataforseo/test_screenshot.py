"""The body of a screenshot request and the reading of its answer. The answer's shape is the one
DataForSEO documents for POST /v3/serp/screenshot and returned on 2026-11-23 for ChatGPT,
Gemini and AI Mode tasks."""

from __future__ import annotations

import json
from decimal import Decimal

import pytest

from idraft.providers.dataforseo.client import FAMILY_LIMITS
from idraft.providers.dataforseo.screenshot import (
    FAMILY,
    PATH,
    SCREENSHOT_HEIGHT,
    ScreenshotLink,
    ScreenshotTaskExpiredError,
    UnreadableScreenshotError,
    read_screenshot,
    screenshot_body,
)

TASK_ID = "11231230-2666-0066-0000-4cb2621d82f1"

ANSWER = {
    "version": "0.1.20261117",
    "status_code": 20000,
    "status_message": "Ok.",
    "cost": 0.004,
    "tasks_count": 1,
    "tasks_error": 0,
    "tasks": [
        {
            "id": "11231815-2666-0139-0000-3a1f5b8c9d20",
            "status_code": 20000,
            "status_message": "Ok.",
            "cost": 0.004,
            "result_count": 1,
            "result": [
                {
                    "items_count": 1,
                    "items": [{"image": "https://api.dataforseo.com/v3/serp/screenshot/abc.png"}],
                }
            ],
        }
    ],
}


def test_the_body_names_the_task_a_desktop_and_the_tallest_page() -> None:
    assert screenshot_body(TASK_ID) == [
        {
            "task_id": TASK_ID,
            "browser_preset": "desktop",
            "browser_screen_height": SCREENSHOT_HEIGHT,
        }
    ]
    assert SCREENSHOT_HEIGHT == 9999


def test_the_path_is_the_screenshot_endpoint() -> None:
    assert PATH == "/v3/serp/screenshot"


def test_the_call_gate_has_a_family_for_screenshots() -> None:
    assert FAMILY in FAMILY_LIMITS


def test_the_link_and_the_cost_are_read_from_the_answer() -> None:
    link = read_screenshot(json.dumps(ANSWER).encode())
    assert link == ScreenshotLink(
        url="https://api.dataforseo.com/v3/serp/screenshot/abc.png", cost_usd=Decimal("0.004")
    )


def test_an_answer_with_no_image_is_unreadable() -> None:
    empty = json.loads(json.dumps(ANSWER))
    empty["tasks"][0]["result"] = [{"items_count": 0, "items": []}]
    with pytest.raises(UnreadableScreenshotError, match="image"):
        read_screenshot(json.dumps(empty).encode())


def test_a_link_that_is_not_https_is_refused() -> None:
    odd = json.loads(json.dumps(ANSWER))
    odd["tasks"][0]["result"][0]["items"][0]["image"] = "file:///etc/passwd"
    with pytest.raises(UnreadableScreenshotError, match="address"):
        read_screenshot(json.dumps(odd).encode())


def test_a_task_status_other_than_ok_is_unreadable() -> None:
    failed = json.loads(json.dumps(ANSWER))
    failed["tasks"][0]["status_code"] = 40501
    failed["tasks"][0]["status_message"] = "Invalid Field: 'task_id'."
    with pytest.raises(UnreadableScreenshotError, match="40501"):
        read_screenshot(json.dumps(failed).encode())


def test_a_task_the_provider_no_longer_holds_is_told_apart() -> None:
    gone = json.loads(json.dumps(ANSWER))
    gone["tasks"][0]["status_code"] = 40403
    gone["tasks"][0]["status_message"] = "Task not found."
    with pytest.raises(ScreenshotTaskExpiredError):
        read_screenshot(json.dumps(gone).encode())
