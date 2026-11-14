"""The device an engine asks from (WP-31; docs/ai-visibility/contracts/wp-31-engines-device.md).

Only Google AI Mode takes a device. It is saved in `ai.project_engines.provider_params`.
"""

from __future__ import annotations

import json
import uuid

import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.ai.support import ai_project
from tests.api.auth.support import execute, fetch, make_workspace
from tests.api.entities.support import member, problem
from tests.api.keywords.support import LOCATION, errors, project_url
from tests.conftest import PostgresServer

AI_MODE = "google_ai_mode"


async def _insert(
    pg: PostgresServer, project: uuid.UUID, workspace_id: uuid.UUID, code: str
) -> None:
    """A row as the API wrote it before devices existed: `provider_params` left at its default."""
    await execute(
        pg,
        "INSERT INTO ai.project_engines (project_id, engine_code, workspace_id, location_ids, "
        "provider_code, is_enabled) VALUES ($1, $2, $3, $4, 'dataforseo', true)",
        project,
        code,
        workspace_id,
        [LOCATION],
    )


async def _stored(pg: PostgresServer, project: uuid.UUID, engine_code: str) -> object:
    rows = await fetch(
        pg,
        "SELECT provider_params FROM ai.project_engines WHERE project_id = $1 AND engine_code = $2",
        project,
        engine_code,
    )
    assert len(rows) == 1
    return json.loads(rows[0]["provider_params"])


async def test_ai_mode_lists_desktop_by_default_and_the_other_engines_list_no_device(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)

    unconfigured = await api.get(project_url(workspace, project, "engines"), headers=viewer.headers)
    # A row that exists with no device saved reads the same way.
    await _insert(migrated, project, workspace.id, AI_MODE)
    await _insert(migrated, project, workspace.id, "chatgpt_web")
    configured = await api.get(project_url(workspace, project, "engines"), headers=viewer.headers)

    for response in (unconfigured, configured):
        assert response.status_code == 200, response.text
        assert {
            row["engine"]["engine_code"]: row["provider_params"] for row in response.json()["data"]
        } == {
            "chatgpt_web": {"device": None},
            "gemini_web": {"device": None},
            "google_ai_mode": {"device": "desktop"},
        }


async def test_a_device_is_saved_for_ai_mode_and_read_back(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)

    put = await api.put(
        project_url(workspace, project, "engines", AI_MODE),
        json={"location_ids": [LOCATION], "provider_params": {"device": "mobile"}},
        headers=editor.headers,
    )
    listed = await api.get(project_url(workspace, project, "engines"), headers=editor.headers)

    assert put.status_code == 200, put.text
    assert put.json()["data"]["provider_params"] == {"device": "mobile"}
    assert {
        row["engine"]["engine_code"]: row["provider_params"]["device"]
        for row in listed.json()["data"]
    } == {"chatgpt_web": None, "gemini_web": None, "google_ai_mode": "mobile"}
    assert await _stored(migrated, project, AI_MODE) == {"device": "mobile"}


async def test_an_engine_without_a_device_stores_no_params_and_ai_mode_always_stores_one(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    body = {"location_ids": [LOCATION]}

    await api.put(
        project_url(workspace, project, "engines", "chatgpt_web"), json=body, headers=editor.headers
    )
    await api.put(
        project_url(workspace, project, "engines", AI_MODE), json=body, headers=editor.headers
    )

    assert await _stored(migrated, project, "chatgpt_web") == {}
    assert await _stored(migrated, project, AI_MODE) == {"device": "desktop"}


async def test_saving_countries_or_turning_the_engine_off_keeps_the_device(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "engines", AI_MODE)
    await api.put(
        url,
        json={"location_ids": [LOCATION], "provider_params": {"device": "mobile"}},
        headers=editor.headers,
    )

    countries = await api.put(url, json={"location_ids": [LOCATION]}, headers=editor.headers)
    off = await api.put(
        url, json={"location_ids": [LOCATION], "is_enabled": False}, headers=editor.headers
    )

    assert countries.json()["data"]["provider_params"] == {"device": "mobile"}
    assert off.json()["data"]["provider_params"] == {"device": "mobile"}
    assert await _stored(migrated, project, AI_MODE) == {"device": "mobile"}
    # A device can be changed back.
    back = await api.put(
        url,
        json={"location_ids": [LOCATION], "provider_params": {"device": "desktop"}},
        headers=editor.headers,
    )
    assert back.json()["data"]["provider_params"] == {"device": "desktop"}


@pytest.mark.parametrize("engine_code", ["chatgpt_web", "gemini_web"])
async def test_a_device_for_chatgpt_or_gemini_is_refused_and_nothing_is_saved(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, engine_code: str
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)

    response = await api.put(
        project_url(workspace, project, "engines", engine_code),
        json={"location_ids": [LOCATION], "provider_params": {"device": "mobile"}},
        headers=editor.headers,
    )

    assert problem(response) == (422, "validation_failed")
    assert errors(response) == [("provider_params.device", "device_not_supported")]
    assert (
        await fetch(
            migrated, "SELECT engine_code FROM ai.project_engines WHERE project_id = $1", project
        )
        == []
    )


@pytest.mark.parametrize("device", ["tablet", "", "Mobile", " desktop", None, 1])
async def test_a_device_other_than_desktop_or_mobile_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, device: object
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)

    response = await api.put(
        project_url(workspace, project, "engines", AI_MODE),
        json={"location_ids": [LOCATION], "provider_params": {"device": device}},
        headers=editor.headers,
    )

    assert problem(response) == (422, "validation_failed")
    assert [path for path, _ in errors(response)] == ["provider_params.device"]
    assert (
        await fetch(
            migrated, "SELECT engine_code FROM ai.project_engines WHERE project_id = $1", project
        )
        == []
    )


async def test_the_device_is_in_the_audit_before_and_after_for_ai_mode_only(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    ai_mode = project_url(workspace, project, "engines", AI_MODE)
    chatgpt = project_url(workspace, project, "engines", "chatgpt_web")

    await api.put(chatgpt, json={"location_ids": [LOCATION]}, headers=editor.headers)
    await api.put(ai_mode, json={"location_ids": [LOCATION]}, headers=editor.headers)
    await api.put(
        ai_mode,
        json={"location_ids": [LOCATION], "provider_params": {"device": "mobile"}},
        headers=editor.headers,
    )

    entries = await fetch(
        migrated,
        "SELECT before, after FROM ops.audit_logs WHERE workspace_id = $1 ORDER BY occurred_at",
        workspace.id,
    )
    assert len(entries) == 3
    chatgpt_entry, first_entry, second_entry = entries
    assert chatgpt_entry["before"] is None
    assert set(json.loads(chatgpt_entry["after"])) == {"engine_code", "location_ids", "is_enabled"}
    assert json.loads(first_entry["after"])["device"] == "desktop"
    assert json.loads(second_entry["before"])["device"] == "desktop"
    assert json.loads(second_entry["after"])["device"] == "mobile"


@pytest.mark.parametrize("role", ["viewer", "analyst"])
async def test_only_a_project_writer_sets_a_device(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, role: str
) -> None:
    workspace = await make_workspace(migrated)
    caller = await member(resources, migrated, workspace, role)
    project = await ai_project(migrated, workspace)

    response = await api.put(
        project_url(workspace, project, "engines", AI_MODE),
        json={"location_ids": [LOCATION], "provider_params": {"device": "mobile"}},
        headers=caller.headers,
    )

    assert problem(response) == (403, "forbidden")
    assert (
        await fetch(
            migrated, "SELECT engine_code FROM ai.project_engines WHERE project_id = $1", project
        )
        == []
    )


@pytest.mark.parametrize("stored", ["{}", '{"device": "tablet"}', '{"device": 3}', "[]"])
async def test_a_row_with_empty_or_junk_provider_params_reads_as_desktop(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, stored: str
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    await _insert(migrated, project, workspace.id, AI_MODE)
    await execute(
        migrated,
        "UPDATE ai.project_engines SET provider_params = $1::jsonb WHERE project_id = $2",
        stored,
        project,
    )

    response = await api.get(project_url(workspace, project, "engines"), headers=viewer.headers)

    rows = {row["engine"]["engine_code"]: row for row in response.json()["data"]}
    assert rows[AI_MODE]["provider_params"] == {"device": "desktop"}
