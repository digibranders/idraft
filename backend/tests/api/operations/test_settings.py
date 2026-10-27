"""Project settings: the `seo` defaults that tracked keyword creation uses (docs/19 section 3.3)."""

from __future__ import annotations

import json
import uuid
from typing import Any

import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.auth.support import Workspace, execute, fetch, fetchrow, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.keywords.support import keyword_project, project_url, track
from tests.conftest import PostgresServer


async def _owner(resources: Resources, pg: PostgresServer) -> tuple[Workspace, uuid.UUID, Caller]:
    workspace = await make_workspace(pg)
    owner = await member(resources, pg, workspace, "owner")
    return workspace, await keyword_project(pg, workspace), owner


async def _patch(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: uuid.UUID,
    caller: Caller,
    body: dict[str, Any],
) -> httpx.Response:
    return await api.patch(
        project_url(workspace, project, "settings"), json=body, headers=caller.headers
    )


async def test_a_new_project_has_the_default_settings(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, _owner_caller = await _owner(resources, migrated)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await api.get(project_url(workspace, project, "settings"), headers=viewer.headers)

    assert response.status_code == 200, response.text
    assert response.json()["data"] == {
        "version": 1,
        "seo": {
            "default_device": "desktop",
            "default_depth_profile": "standard",
            "default_frequency": "daily",
            "visibility_weight_scheme": "uniform",
            "visibility_volume_mode": "annual_average",
        },
        "entity_config_version": 1,
    }


async def test_a_patch_changes_what_it_names_and_keeps_the_rest(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    # Settings of parts this version does not edit yet are kept as they are.
    await execute(
        migrated,
        "UPDATE core.projects SET settings = $2::jsonb WHERE id = $1",
        project,
        json.dumps({"seo": {"default_frequency": "weekly"}, "ai": {"ai_weekday": 2}}),
    )

    response = await _patch(api, workspace, project, owner, {"seo": {"default_device": "mobile"}})

    assert response.status_code == 200, response.text
    seo = response.json()["data"]["seo"]
    assert (seo["default_device"], seo["default_frequency"]) == ("mobile", "weekly")
    row = await fetchrow(migrated, "SELECT settings FROM core.projects WHERE id = $1", project)
    stored = json.loads(row["settings"])
    assert stored["ai"] == {"ai_weekday": 2}
    assert stored["seo"] == {"default_frequency": "weekly", "default_device": "mobile"}
    (entry,) = await fetch(
        migrated,
        "SELECT before, after FROM ops.audit_logs WHERE workspace_id = $1 "
        "AND action = 'project.settings_updated'",
        workspace.id,
    )
    assert json.loads(entry["before"])["seo.default_device"] == "desktop"
    assert json.loads(entry["after"])["seo.default_device"] == "mobile"


async def test_new_tracked_keywords_take_the_projects_defaults(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    await _patch(
        api,
        workspace,
        project,
        owner,
        {"seo": {"default_device": "both", "default_depth_profile": "deep"}},
    )

    response = await track(api, workspace, project, owner, "crm")

    assert response.status_code == 201, response.text
    rows = response.json()["data"]
    assert sorted(row["device"] for row in rows) == ["desktop", "mobile"]
    assert {row["depth_profile"] for row in rows} == {"deep"}


@pytest.mark.parametrize(
    "body",
    [
        {"seo": {"default_device": None}},
        {"seo": {"default_device": "tablet"}},
        {"seo": {"colour": "blue"}},
        {"ai": {"ai_weekday": 1}},
        {"seo": {}},
    ],
)
async def test_a_patch_the_settings_cannot_hold_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, body: dict[str, Any]
) -> None:
    workspace, project, owner = await _owner(resources, migrated)

    response = await _patch(api, workspace, project, owner, body)

    assert problem(response) == (422, "validation_failed")


async def test_only_writers_change_settings(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, _owner_caller = await _owner(resources, migrated)
    analyst = await member(resources, migrated, workspace, "analyst")
    elsewhere = await keyword_project(migrated, await make_workspace(migrated))

    refused = await _patch(api, workspace, project, analyst, {"seo": {"default_device": "mobile"}})
    missing = await api.get(project_url(workspace, elsewhere, "settings"), headers=analyst.headers)

    assert problem(refused) == (403, "forbidden")
    assert problem(missing)[0] == 404
