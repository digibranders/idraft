"""Adding a pasted list of prompts (docs/19 section 3.7.1; plan decision A3: the base plan)."""

from __future__ import annotations

import asyncio
import uuid

import httpx

from idraft.api.resources import Resources
from idraft.domain.ai_engines import BASE_PLAN
from tests.api.ai.support import added, ai_project, prompt_body, set_prompt_quota
from tests.api.auth.support import execute, fetch, make_workspace
from tests.api.entities.support import member, problem
from tests.api.keywords.support import project_url, term, vocabulary
from tests.conftest import PostgresServer

# One letter two ways: e with acute as one character, and as e then a combining accent.
COMPOSED_E = chr(0xE9)
COMBINING_ACUTE = chr(0x301)


async def test_a_pasted_list_is_added_with_what_it_skipped_and_rejected(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    crm = await term(migrated, workspace, await vocabulary(migrated, workspace), "crm")
    known = await added(api, workspace, project, editor, "Known?")

    response = await api.post(
        project_url(workspace, project, "prompts", "bulk-create"),
        json={
            "items": [
                prompt_body("New one?", term_ids=[crm]),
                prompt_body("Known?"),
                prompt_body("New one?"),
                prompt_body("Bad term?", term_ids=[str(uuid.uuid4())]),
                prompt_body("Other?"),
            ]
        },
        headers=editor.headers,
    )

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert len(data["created"]) == 2
    assert data["skipped"] == [{"index": 1, "existing_id": known}]
    assert [(row["index"], row["code"]) for row in data["rejected"]] == [
        (2, "duplicate_in_request"),
        (3, "term_unknown"),
    ]
    rows = await fetch(
        migrated,
        "SELECT v.text FROM ai.prompts p JOIN ai.prompt_versions v ON v.id = p.current_version_id "
        "WHERE p.project_id = $1 ORDER BY p.id",
        project,
    )
    assert [row["text"] for row in rows] == ["Known?", "New one?", "Other?"]
    created = await fetch(
        migrated,
        "SELECT target_id FROM ops.audit_logs WHERE workspace_id = $1 "
        "AND action = 'prompt.created'",
        workspace.id,
    )
    assert len(created) == 3


async def test_a_duplicate_is_an_error_when_asked(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    await added(api, workspace, project, editor, "Known?")

    response = await api.post(
        project_url(workspace, project, "prompts", "bulk-create"),
        json={"items": [prompt_body("Known?")], "on_duplicate": "error"},
        headers=editor.headers,
    )

    data = response.json()["data"]
    assert (data["created"], data["skipped"]) == ([], [])
    assert [(row["index"], row["code"]) for row in data["rejected"]] == [(0, "duplicate")]


async def test_the_base_plan_holds_150_active_prompts(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Full capacity: a workspace without a quota row and one with the default row both stop at
    the base plan's 150 active prompts."""
    without_row = await make_workspace(migrated)
    with_row = await make_workspace(migrated)
    await execute(
        migrated, "INSERT INTO core.workspace_quotas (workspace_id) VALUES ($1)", with_row.id
    )
    items = [prompt_body(f"Prompt {index}?") for index in range(BASE_PLAN.max_prompts)]
    results = []
    for workspace in (without_row, with_row):
        editor = await member(resources, migrated, workspace, "editor")
        project = await ai_project(migrated, workspace)
        url = project_url(workspace, project, "prompts")
        full = await api.post(f"{url}/bulk-create", json={"items": items}, headers=editor.headers)
        one_more = await api.post(url, json=prompt_body("One more?"), headers=editor.headers)
        results.append((full, one_more))

    for full, one_more in results:
        assert full.status_code == 200, full.text
        assert len(full.json()["data"]["created"]) == 150
        assert problem(one_more) == (422, "quota_exceeded")
        assert (one_more.json()["limit"], one_more.json()["used"]) == (150, 150)


async def test_a_list_over_the_quota_writes_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    items = [prompt_body(f"Prompt {index}?") for index in range(BASE_PLAN.max_prompts + 1)]

    response = await api.post(
        project_url(workspace, project, "prompts", "bulk-create"),
        json={"items": items},
        headers=editor.headers,
    )

    assert problem(response) == (422, "quota_exceeded")
    assert (response.json()["used"], response.json()["requested"]) == (0, 151)
    assert await fetch(migrated, "SELECT id FROM ai.prompts WHERE project_id = $1", project) == []


async def test_a_list_takes_up_to_1000_items(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)

    response = await api.post(
        project_url(workspace, project, "prompts", "bulk-create"),
        json={"items": [prompt_body(f"P{index}?") for index in range(1001)]},
        headers=editor.headers,
    )

    assert problem(response) == (422, "validation_failed")


async def test_two_lists_taking_the_last_places_at_once_fit_only_one(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    await set_prompt_quota(migrated, workspace, 10)
    url = project_url(workspace, project, "prompts", "bulk-create")

    responses = await asyncio.gather(
        *(
            api.post(
                url,
                json={"items": [prompt_body(f"{name} {index}?") for index in range(6)]},
                headers=editor.headers,
            )
            for name in ("First", "Second")
        )
    )

    assert sorted(
        (200, "created") if response.status_code == 200 else problem(response)
        for response in responses
    ) == [(200, "created"), (422, "quota_exceeded")]
    rows = await fetch(migrated, "SELECT id FROM ai.prompts WHERE project_id = $1", project)
    assert len(rows) == 6


async def test_a_decomposed_repeat_inside_a_list_is_a_duplicate_in_the_request(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    composed = f"Caf{COMPOSED_E} au lait?"
    decomposed = f"Cafe{COMBINING_ACUTE} au lait?"
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)

    response = await api.post(
        project_url(workspace, project, "prompts", "bulk-create"),
        json={"items": [prompt_body(composed), prompt_body(decomposed)]},
        headers=editor.headers,
    )

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert len(data["created"]) == 1
    assert [(row["index"], row["code"]) for row in data["rejected"]] == [
        (1, "duplicate_in_request")
    ]
    rows = await fetch(migrated, "SELECT id FROM ai.prompts WHERE project_id = $1", project)
    assert len(rows) == 1
