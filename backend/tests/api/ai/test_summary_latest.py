"""`latest` on an engine of a prompt row (`include=facts`): the newest valid answer and the state of
its screenshot."""

from __future__ import annotations

from typing import Any

import httpx

from tests.api.ai.screenshot_support import FakeCapture, ShotWorld


async def _engine(api: httpx.AsyncClient, world: ShotWorld, **params: str) -> dict[str, Any]:
    response = await api.get(
        world.url("prompts-summary"), params=params, headers=world.reader.headers
    )
    assert response.status_code == 200, response.text
    engine: dict[str, Any] = response.json()["data"]["prompts"][0]["engines"][0]
    return engine


async def test_latest_names_the_answer_and_says_a_screenshot_can_be_captured(
    api: httpx.AsyncClient, recent_world: ShotWorld
) -> None:
    engine = await _engine(api, recent_world, include="facts")
    latest = engine["latest"]
    assert latest["observation_id"] == str(recent_world.observation_id)
    assert latest["screenshot_url"] is None
    assert latest["screenshot_state"] == "capturable"


async def test_after_a_capture_latest_carries_the_image_path(
    api: httpx.AsyncClient, recent_world: ShotWorld, fake_capture: FakeCapture
) -> None:
    created = await api.post(recent_world.screenshot_url, headers=recent_world.writer.headers)
    assert created.status_code == 201, created.text
    latest = (await _engine(api, recent_world, include="facts"))["latest"]
    assert latest["screenshot_url"] == recent_world.screenshot_url
    assert latest["screenshot_state"] == "available"


async def test_an_old_answer_without_a_screenshot_is_expired(
    api: httpx.AsyncClient, old_world: ShotWorld
) -> None:
    latest = (await _engine(api, old_world, include="facts"))["latest"]
    assert latest["observation_id"] == str(old_world.observation_id)
    assert latest["screenshot_state"] == "expired"


async def test_latest_is_left_out_unless_facts_are_asked_for(
    api: httpx.AsyncClient, recent_world: ShotWorld
) -> None:
    assert "latest" not in await _engine(api, recent_world)
