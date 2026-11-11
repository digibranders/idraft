"""A project's AI engines (docs/19 section 3.7.4; spec 2026-11-11 section 4.5)."""

from __future__ import annotations

import json
from datetime import time
from decimal import Decimal

import httpx
import pytest

from idraft.api.resources import Resources
from idraft.domain.ai_engines import BASE_PLAN
from tests.api.ai.support import ai_project, seed_prompts
from tests.api.auth.support import execute, fetch, make_workspace
from tests.api.entities.support import member, problem
from tests.api.keywords.support import LOCATION, OTHER_LOCATION, errors, project_url
from tests.conftest import PostgresServer

CITY = 1023191


def _row(data: dict[str, object]) -> tuple[object, ...]:
    engine = data["engine"]
    assert isinstance(engine, dict)
    return (
        engine["engine_code"],
        data["is_configured"],
        data["is_enabled"],
        data["location_ids"],
        data["replicates"],
        data["active_prompts"],
        data["estimated_monthly_cost_usd"],
    )


async def test_every_engine_is_listed_off_with_its_cost_at_full_capacity(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    await seed_prompts(migrated, workspace, project, BASE_PLAN.max_prompts)

    response = await api.get(project_url(workspace, project, "engines"), headers=viewer.headers)

    assert response.status_code == 200, response.text
    rows = response.json()["data"]
    assert [_row(row) for row in rows] == [
        ("chatgpt_web", False, False, [], 1, 150, "1.56"),
        ("gemini_web", False, False, [], 1, 150, "1.56"),
        ("google_ai_mode", False, False, [], 1, 150, "1.56"),
    ]
    # 150 prompts x 3 engines x 2 runs a week x 52 / 12 weeks x $0.0012 a task.
    assert sum(Decimal(row["estimated_monthly_cost_usd"]) for row in rows) == Decimal("4.68")
    assert rows[2]["engine"]["max_prompt_chars"] == 700


async def test_a_prompt_longer_than_an_engine_takes_is_not_counted_for_it(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    await seed_prompts(migrated, workspace, project, 2)
    await seed_prompts(migrated, workspace, project, 1, text_length=701)

    response = await api.get(project_url(workspace, project, "engines"), headers=viewer.headers)

    rows = response.json()["data"]
    counts = {row["engine"]["engine_code"]: row["active_prompts"] for row in rows}
    assert counts == {"chatgpt_web": 3, "gemini_web": 3, "google_ai_mode": 2}


async def test_turning_the_first_engine_on_starts_two_runs_a_week(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)

    first = await api.put(
        project_url(workspace, project, "engines", "chatgpt_web"),
        json={"location_ids": [LOCATION, OTHER_LOCATION, LOCATION]},
        headers=editor.headers,
    )
    second = await api.put(
        project_url(workspace, project, "engines", "google_ai_mode"),
        json={"location_ids": [LOCATION]},
        headers=editor.headers,
    )

    assert first.status_code == second.status_code == 200, first.text
    data = first.json()["data"]
    assert (
        data["is_configured"],
        data["is_enabled"],
        data["location_ids"],
        data["replicates"],
        data["provider_code"],
    ) == (True, True, [OTHER_LOCATION, LOCATION], 1, "dataforseo")
    rows = await fetch(
        migrated,
        "SELECT name, workload, cadence, weekday, window_start_local, window_hours, "
        "provider_mode, selector FROM ops.schedules WHERE project_id = $1 ORDER BY weekday",
        project,
    )
    assert [tuple(row) for row in rows] == [
        (name, "ai_prompt", "weekly", weekday, time(1, 0), 8, "standard_queue", '{"all": true}')
        for weekday, name in ((1, "AI answers, Monday"), (4, "AI answers, Thursday"))
    ]
    entries = await fetch(
        migrated,
        "SELECT action, target_id, before, after FROM ops.audit_logs WHERE workspace_id = $1 "
        "ORDER BY occurred_at",
        workspace.id,
    )
    assert [(entry["action"], entry["target_id"]) for entry in entries] == [
        ("project_engine.updated", str(project))
    ] * 2
    assert entries[0]["before"] is None
    assert json.loads(entries[0]["after"]) == {
        "engine_code": "chatgpt_web",
        "location_ids": [str(OTHER_LOCATION), str(LOCATION)],
        "is_enabled": True,
    }


async def test_turning_an_engine_off_keeps_its_settings_and_the_schedules(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    never_on = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "engines", "gemini_web")

    await api.put(url, json={"location_ids": [LOCATION]}, headers=editor.headers)
    off = await api.put(
        url, json={"location_ids": [LOCATION], "is_enabled": False}, headers=editor.headers
    )
    await api.put(
        project_url(workspace, never_on, "engines", "gemini_web"),
        json={"location_ids": [LOCATION], "is_enabled": False},
        headers=editor.headers,
    )

    assert off.status_code == 200, off.text
    assert (off.json()["data"]["is_configured"], off.json()["data"]["is_enabled"]) == (True, False)
    kept = await fetch(migrated, "SELECT id FROM ops.schedules WHERE project_id = $1", project)
    none = await fetch(migrated, "SELECT id FROM ops.schedules WHERE project_id = $1", never_on)
    assert (len(kept), len(none)) == (2, 0)


@pytest.mark.parametrize("location_ids", [[CITY], [LOCATION, 999_999_999]])
async def test_an_engine_runs_in_active_countries_only(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    location_ids: list[int],
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    await execute(
        migrated,
        "INSERT INTO core.locations (id, name, country_iso, location_type, parent_id) "
        "VALUES ($1, 'New York', 'US', 'City', $2) ON CONFLICT (id) DO NOTHING",
        CITY,
        LOCATION,
    )

    response = await api.put(
        project_url(workspace, project, "engines", "chatgpt_web"),
        json={"location_ids": location_ids},
        headers=editor.headers,
    )

    assert problem(response) == (422, "validation_failed")
    assert errors(response) == [("location_ids", "location_not_supported")]
    assert (
        await fetch(
            migrated, "SELECT engine_code FROM ai.project_engines WHERE project_id = $1", project
        )
        == []
    )


async def test_removing_an_engine_removes_its_settings_once(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "engines", "chatgpt_web")
    await api.put(url, json={"location_ids": [LOCATION]}, headers=editor.headers)

    removed = await api.delete(url, headers=editor.headers)
    again = await api.delete(url, headers=editor.headers)
    listed = await api.get(project_url(workspace, project, "engines"), headers=editor.headers)

    assert removed.status_code == 204
    assert problem(again) == (404, "not_found")
    assert listed.json()["data"][0]["is_configured"] is False
    actions = await fetch(
        migrated,
        "SELECT action FROM ops.audit_logs WHERE workspace_id = $1 ORDER BY occurred_at",
        workspace.id,
    )
    assert [row["action"] for row in actions] == [
        "project_engine.updated",
        "project_engine.deleted",
    ]


@pytest.mark.parametrize("role", ["viewer", "analyst"])
async def test_only_a_project_writer_changes_engines(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, role: str
) -> None:
    workspace = await make_workspace(migrated)
    caller = await member(resources, migrated, workspace, role)
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "engines", "chatgpt_web")

    put = await api.put(url, json={"location_ids": [LOCATION]}, headers=caller.headers)
    delete = await api.delete(url, headers=caller.headers)

    assert problem(put) == problem(delete) == (403, "forbidden")


async def test_an_engine_the_platform_does_not_offer_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)

    response = await api.put(
        project_url(workspace, project, "engines", "perplexity_web"),
        json={"location_ids": [LOCATION]},
        headers=editor.headers,
    )

    assert problem(response) == (422, "validation_failed")
