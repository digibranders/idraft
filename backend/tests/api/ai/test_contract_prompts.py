"""Contract C1, prompt list, create and change (docs/ai-visibility/contracts/c1-prompts.md): each
addition not built yet answers 501 once the caller may use the route; left out, nothing changes.
The create members are built (test_prompt_provenance.py)."""

from __future__ import annotations

import json
import uuid
from typing import Any

import httpx
import pytest

from idraft.api.openapi import build_openapi
from idraft.api.resources import Resources
from tests.api.ai.support import ai_project, prompt_body, seed_prompts
from tests.api.auth.support import make_workspace
from tests.api.entities.support import member, problem
from tests.api.keywords.support import project_url
from tests.conftest import PostgresServer

NOT_BUILT = (501, "not_implemented")
FORBIDDEN = (403, "forbidden")
NOT_FOUND = (404, "not_found")
INVALID = (422, "validation_failed")

PROMPTS_PATH = "/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts"


@pytest.mark.parametrize(
    "params",
    [
        {"filter[funnel_stage_in]": "tofu,mofu"},
        {"filter[importance_in]": "1,2"},
        {"filter[is_branded]": "true"},
        {"filter[is_active]": "any"},
        {"sort": "-importance"},
    ],
)
async def test_a_list_filter_that_is_not_built_answers_501(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    params: dict[str, str],
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)

    response = await api.get(
        project_url(workspace, project, "prompts"), params=params, headers=viewer.headers
    )

    assert problem(response) == NOT_BUILT


async def test_the_list_checks_access_before_it_says_not_built(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    billing = await member(resources, migrated, workspace, "billing")
    outsider = await member(resources, migrated, await make_workspace(migrated), "owner")
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "prompts")

    refused = await api.get(url, params={"sort": "-importance"}, headers=billing.headers)
    unseen = await api.get(url, params={"sort": "-importance"}, headers=outsider.headers)

    assert problem(refused) == FORBIDDEN
    assert problem(unseen) == NOT_FOUND


@pytest.mark.parametrize("params", [{"filter[importance_in]": "6"}, {"sort": "volume"}])
async def test_a_list_value_out_of_bounds_is_refused_before_501(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    params: dict[str, str],
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)

    response = await api.get(
        project_url(workspace, project, "prompts"), params=params, headers=viewer.headers
    )

    assert problem(response) == INVALID


async def test_the_list_without_additions_answers_as_before(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    await seed_prompts(migrated, workspace, project, 1)
    url = project_url(workspace, project, "prompts")

    listed = await api.get(url, headers=viewer.headers)
    archived = await api.get(url, params={"filter[is_active]": "false"}, headers=viewer.headers)

    assert listed.status_code == 200, listed.text
    rows = listed.json()["data"]
    assert len(rows) == 1
    assert archived.status_code == 200, archived.text
    assert archived.json()["data"] == []


async def test_a_viewer_is_refused_before_the_new_members_are_looked_at(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)

    response = await api.post(
        project_url(workspace, project, "prompts"),
        json=prompt_body("Which CRM suits a startup?", is_branded=True),
        headers=viewer.headers,
    )

    assert problem(response) == FORBIDDEN


async def test_a_viewer_is_refused_before_the_new_members_of_a_bulk_create_are_looked_at(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)

    response = await api.post(
        project_url(workspace, project, "prompts", "bulk-create"),
        json={"items": [prompt_body("Which CRM suits a startup?", is_branded=True)]},
        headers=viewer.headers,
    )

    assert problem(response) == FORBIDDEN


@pytest.mark.parametrize(
    "extra",
    [
        {"source": "llm_variant"},
        {"creation_method": "llm_generated"},
        {"generated_from": {"tracked_keyword_id": str(uuid.uuid4()), "template": "listicle"}},
    ],
)
async def test_a_create_member_out_of_bounds_is_refused(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    extra: dict[str, Any],
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)

    response = await api.post(
        project_url(workspace, project, "prompts"),
        json=prompt_body("Which CRM suits a startup?", **extra),
        headers=editor.headers,
    )

    assert problem(response) == INVALID


async def test_if_match_on_a_change_answers_501_and_changes_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    (prompt_id,) = await seed_prompts(migrated, workspace, project, 1)
    url = project_url(workspace, project, "prompts", prompt_id)

    changed = await api.patch(
        url, json={"importance": 1}, headers={**editor.headers, "If-Match": '"x"'}
    )
    read = await api.get(url, headers=editor.headers)

    assert problem(changed) == NOT_BUILT
    assert read.json()["data"]["importance"] == 3


async def test_a_viewer_is_refused_before_if_match_is_looked_at(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    (prompt_id,) = await seed_prompts(migrated, workspace, project, 1)

    response = await api.patch(
        project_url(workspace, project, "prompts", prompt_id),
        json={"importance": 1},
        headers={**viewer.headers, "If-Match": '"x"'},
    )

    assert problem(response) == FORBIDDEN


async def test_an_if_match_over_128_characters_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    (prompt_id,) = await seed_prompts(migrated, workspace, project, 1)

    response = await api.patch(
        project_url(workspace, project, "prompts", prompt_id),
        json={"importance": 1},
        headers={**editor.headers, "If-Match": '"' + "x" * 128 + '"'},
    )

    assert problem(response) == INVALID


async def test_a_change_without_if_match_works_as_before(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    (prompt_id,) = await seed_prompts(migrated, workspace, project, 1)

    changed = await api.patch(
        project_url(workspace, project, "prompts", prompt_id),
        json={"importance": 1},
        headers=editor.headers,
    )

    assert changed.status_code == 200, changed.text
    assert changed.json()["data"]["importance"] == 1


def test_the_api_document_has_the_prompt_additions() -> None:
    document = build_openapi()
    schemas = document["components"]["schemas"]

    listing = document["paths"][PROMPTS_PATH]["get"]["parameters"]
    names = {parameter["name"] for parameter in listing}
    assert {
        "filter[prompt_type_in]",
        "filter[funnel_stage_in]",
        "filter[importance_in]",
        "filter[is_branded]",
        "sort",
    } <= names
    active = next(item for item in listing if item["name"] == "filter[is_active]")
    assert "boolean" in json.dumps(active["schema"])
    assert '"any"' in json.dumps(active["schema"])

    create = schemas["PromptCreate"]
    new_members = {"is_branded", "source", "creation_method", "generated_from"}
    assert new_members <= set(create["properties"])
    assert not new_members & set(create.get("required", []))
    assert "GeneratedFrom" in schemas

    prompt = schemas["Prompt"]
    assert {"prompt_type_source", "is_branded_source"} <= set(prompt["properties"])
    assert {"prompt_type_source", "is_branded_source"} <= set(prompt["required"])

    patch = document["paths"][PROMPTS_PATH + "/{prompt_id}"]["patch"]["parameters"]
    header = next(item for item in patch if item["in"] == "header" and item["name"] == "If-Match")
    assert not header.get("required", False)
