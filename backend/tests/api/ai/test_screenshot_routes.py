"""POST captures an answer's screenshot once; GET serves it to people who can read the project."""

from __future__ import annotations

from decimal import Decimal

import httpx
from fastapi import FastAPI

from idraft.api.resources import Resources
from idraft.providers.dataforseo.screenshot import SCREENSHOT_HEIGHT
from tests.api.ai.screenshot_support import FakeCapture, ShotWorld, use_fakes
from tests.api.auth.support import fetch
from tests.api.entities.support import problem
from tests.conftest import PostgresServer


async def test_capture_stores_one_screenshot_and_get_serves_it(
    api: httpx.AsyncClient, recent_world: ShotWorld, fake_capture: FakeCapture
) -> None:
    world = recent_world
    created = await api.post(world.screenshot_url, headers=world.writer.headers)
    assert created.status_code == 201, created.text
    data = created.json()["data"]
    assert data["created"] is True
    assert data["truncated"] is False
    assert data["url"] == world.screenshot_url
    assert fake_capture.task_ids == [world.task_id]

    again = await api.post(world.screenshot_url, headers=world.writer.headers)
    assert again.status_code == 200
    assert again.json()["data"]["created"] is False
    assert fake_capture.provider_calls == 1

    image = await api.get(world.screenshot_url, headers=world.reader.headers)
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/png"
    assert image.headers["cache-control"] == "private, max-age=3600"
    assert image.headers["x-content-type-options"] == "nosniff"
    assert image.content.startswith(b"\x89PNG")


async def test_a_capture_is_recorded_with_its_cost(
    api: httpx.AsyncClient,
    recent_world: ShotWorld,
    fake_capture: FakeCapture,
    migrated: PostgresServer,
) -> None:
    world = recent_world
    assert (await api.post(world.screenshot_url, headers=world.writer.headers)).status_code == 201
    shots = await fetch(
        migrated,
        "SELECT height, cost_usd, captured_by, provider_task_id "
        "FROM ai.observation_screenshots WHERE observation_id = $1",
        world.observation_id,
    )
    assert len(shots) == 1
    assert shots[0]["height"] < SCREENSHOT_HEIGHT
    assert shots[0]["captured_by"] == world.writer.user_id
    assert shots[0]["provider_task_id"] == world.task_id
    costs = await fetch(
        migrated,
        "SELECT endpoint, workload, channel, cost_usd, cost_source, subject_id "
        "FROM ops.provider_cost_events WHERE project_id = $1 AND endpoint = '/v3/serp/screenshot'",
        world.project.id,
    )
    assert [dict(row) for row in costs] == [
        {
            "endpoint": "/v3/serp/screenshot",
            "workload": "ai_prompt",
            "channel": "ai",
            "cost_usd": Decimal("0.004000"),
            "cost_source": "provider_reported",
            "subject_id": str(world.observation_id),
        }
    ]


async def test_a_reader_cannot_spend(
    api: httpx.AsyncClient, recent_world: ShotWorld, fake_capture: FakeCapture
) -> None:
    response = await api.post(recent_world.screenshot_url, headers=recent_world.reader.headers)
    assert response.status_code == 403
    assert fake_capture.provider_calls == 0


async def test_an_old_answer_answers_410(
    api: httpx.AsyncClient, old_world: ShotWorld, fake_capture: FakeCapture
) -> None:
    response = await api.post(old_world.screenshot_url, headers=old_world.writer.headers)
    assert problem(response) == (410, "screenshot_expired")
    assert fake_capture.provider_calls == 0


async def test_get_without_a_stored_screenshot_is_404(
    api: httpx.AsyncClient, recent_world: ShotWorld, fake_capture: FakeCapture
) -> None:
    response = await api.get(recent_world.screenshot_url, headers=recent_world.reader.headers)
    assert problem(response) == (404, "no_screenshot")


async def test_an_unknown_answer_is_404_for_both_routes(
    api: httpx.AsyncClient, recent_world: ShotWorld, fake_capture: FakeCapture
) -> None:
    world = recent_world
    url = world.url("observations", world.observation_id + 1000, "screenshot")
    assert problem(await api.post(url, headers=world.writer.headers)) == (404, "not_found")
    assert problem(await api.get(url, headers=world.reader.headers)) == (404, "not_found")
    assert fake_capture.provider_calls == 0


async def test_an_installation_without_the_provider_answers_503_and_spends_nothing(
    api: httpx.AsyncClient,
    auth_app: FastAPI,
    resources: Resources,
    recent_world: ShotWorld,
) -> None:
    use_fakes(auth_app, resources, configured=False)
    response = await api.post(recent_world.screenshot_url, headers=recent_world.writer.headers)
    assert problem(response) == (503, "screenshots_unavailable")


async def test_a_download_that_is_not_an_image_stores_nothing(
    api: httpx.AsyncClient,
    recent_world: ShotWorld,
    fake_capture: FakeCapture,
    migrated: PostgresServer,
) -> None:
    fake_capture.image = b"not an image"
    response = await api.post(recent_world.screenshot_url, headers=recent_world.writer.headers)
    assert problem(response) == (502, "screenshot_failed")
    assert not fake_capture.store.objects
    rows = await fetch(
        migrated,
        "SELECT 1 FROM ai.observation_screenshots WHERE observation_id = $1",
        recent_world.observation_id,
    )
    assert rows == []
