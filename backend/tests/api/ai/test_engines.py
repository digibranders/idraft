"""A project's AI engines (docs/19 section 3.7.4; spec 2026-11-11 section 4.5)."""

from __future__ import annotations

import asyncio
import json
from datetime import time
from decimal import Decimal

import httpx
import pytest

from idraft.api.resources import Resources
from idraft.domain.ai_engines import BASE_PLAN, EngineCode
from tests.api.ai.support import ai_project, seed_prompts
from tests.api.auth.support import execute, fetch, make_workspace
from tests.api.entities.support import member, problem
from tests.api.keywords.support import LOCATION, OTHER_LOCATION, errors, project_url
from tests.conftest import PostgresServer

CITY = 1023191
# A country the platform does not offer (`core.locations.is_active` false).
INACTIVE_COUNTRY = 9_990_101
ENGINE_CODES = [code.value for code in EngineCode]


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


async def test_turning_an_engine_on_again_remakes_deleted_schedules_but_saving_it_does_not(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "engines", "gemini_web")
    live = "SELECT id FROM ops.schedules WHERE project_id = $1 AND deleted_at IS NULL"

    await api.put(url, json={"location_ids": [LOCATION]}, headers=editor.headers)
    await execute(
        migrated, "UPDATE ops.schedules SET deleted_at = now() WHERE project_id = $1", project
    )
    # Saving the countries of an engine that is already on brings nothing back.
    await api.put(url, json={"location_ids": [LOCATION, OTHER_LOCATION]}, headers=editor.headers)
    after_save = await fetch(migrated, live, project)
    await api.put(
        url, json={"location_ids": [LOCATION], "is_enabled": False}, headers=editor.headers
    )
    after_off = await fetch(migrated, live, project)
    on_again = await api.put(url, json={"location_ids": [LOCATION]}, headers=editor.headers)
    after_on = await fetch(migrated, live, project)

    assert on_again.status_code == 200, on_again.text
    assert (len(after_save), len(after_off), len(after_on)) == (0, 0, 2)


@pytest.mark.parametrize("engine_code", ENGINE_CODES)
@pytest.mark.parametrize("location_ids", [[CITY], [LOCATION, 999_999_999]])
async def test_an_engine_runs_in_active_countries_only(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    location_ids: list[int],
    engine_code: str,
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
        project_url(workspace, project, "engines", engine_code),
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


@pytest.mark.parametrize("engine_code", ENGINE_CODES)
async def test_an_inactive_country_is_refused_for_every_engine(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, engine_code: str
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    await execute(
        migrated,
        "INSERT INTO core.locations (id, name, country_iso, location_type, is_active) "
        "VALUES ($1, 'Atlantis', 'ZZ', 'Country', false) "
        "ON CONFLICT (id) DO UPDATE SET is_active = false, country_iso = 'ZZ'",
        INACTIVE_COUNTRY,
    )

    response = await api.put(
        project_url(workspace, project, "engines", engine_code),
        json={"location_ids": [LOCATION, INACTIVE_COUNTRY]},
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


async def test_engines_of_a_deleted_project_are_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "engines", "chatgpt_web")
    await api.put(url, json={"location_ids": [LOCATION]}, headers=editor.headers)
    await execute(migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", project)

    listed = await api.get(project_url(workspace, project, "engines"), headers=editor.headers)
    put = await api.put(url, json={"location_ids": [LOCATION]}, headers=editor.headers)
    delete = await api.delete(url, headers=editor.headers)

    assert problem(listed) == problem(put) == problem(delete) == (404, "not_found")


@pytest.mark.parametrize("location_ids", [[], list(range(1, 52))], ids=["none", "fifty_one"])
async def test_location_ids_must_hold_between_one_and_fifty_countries(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    location_ids: list[int],
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)

    response = await api.put(
        project_url(workspace, project, "engines", "chatgpt_web"),
        json={"location_ids": location_ids},
        headers=editor.headers,
    )

    assert problem(response) == (422, "validation_failed")
    assert [path for path, _ in errors(response)] == ["location_ids"]
    assert (
        await fetch(
            migrated, "SELECT engine_code FROM ai.project_engines WHERE project_id = $1", project
        )
        == []
    )


async def test_saving_an_engine_twice_with_the_same_settings_changes_nothing_but_the_audit(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "engines", "chatgpt_web")
    body = {"location_ids": [LOCATION, OTHER_LOCATION]}
    settings = "SELECT * FROM ai.project_engines WHERE project_id = $1"
    schedules = "SELECT id FROM ops.schedules WHERE project_id = $1 ORDER BY id"

    first = await api.put(url, json=body, headers=editor.headers)
    saved = [tuple(row) for row in await fetch(migrated, settings, project)]
    made = [row["id"] for row in await fetch(migrated, schedules, project)]
    second = await api.put(url, json=body, headers=editor.headers)

    assert first.status_code == second.status_code == 200, second.text
    assert second.json()["data"] == first.json()["data"]
    assert [tuple(row) for row in await fetch(migrated, settings, project)] == saved
    assert [row["id"] for row in await fetch(migrated, schedules, project)] == made
    assert len(made) == 2
    entries = await fetch(
        migrated,
        "SELECT before, after FROM ops.audit_logs WHERE workspace_id = $1 ORDER BY occurred_at",
        workspace.id,
    )
    assert len(entries) == 2
    assert entries[1]["before"] == entries[0]["after"] == entries[1]["after"]


async def test_two_engines_turned_on_at_once_make_the_schedules_once(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)

    responses = await asyncio.gather(
        *(
            api.put(
                project_url(workspace, project, "engines", engine_code),
                json={"location_ids": [LOCATION]},
                headers=editor.headers,
            )
            for engine_code in ("chatgpt_web", "gemini_web")
        )
    )

    assert [response.status_code for response in responses] == [200, 200]
    rows = await fetch(
        migrated,
        "SELECT weekday FROM ops.schedules WHERE project_id = $1 AND workload = 'ai_prompt' "
        "AND deleted_at IS NULL ORDER BY weekday",
        project,
    )
    assert [row["weekday"] for row in rows] == [1, 4]


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
