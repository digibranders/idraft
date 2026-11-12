"""The prompt lint: own brand names and engine limits, nothing stored (docs/19 section 3.7.1)."""

from __future__ import annotations

import httpx

from idraft.api.resources import Resources
from tests.api.ai.support import ai_project, set_prompt_quota
from tests.api.auth.support import execute, fetch, fetchrow, make_workspace
from tests.api.entities.support import attach, member
from tests.api.keywords.support import project_url
from tests.conftest import PostgresServer

# U+1F642: one character, two UTF-16 code units.
SMILE = chr(0x1F642)


async def test_the_lint_finds_own_brand_names_and_counts_against_the_quota(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    await set_prompt_quota(migrated, workspace, 40)
    own = await fetchrow(
        migrated,
        "INSERT INTO core.entities (workspace_id, entity_type, canonical_name) "
        "VALUES ($1, 'brand', 'Acme') RETURNING id",
        workspace.id,
    )
    await execute(
        migrated,
        "INSERT INTO core.entity_aliases (workspace_id, entity_id, alias) VALUES ($1, $2, 'Acme')",
        workspace.id,
        own["id"],
    )
    await attach(migrated, workspace, project, own["id"], "own")

    response = await api.post(
        project_url(workspace, project, "prompts", "lint"),
        json={"texts": [f"{SMILE} Is Acme good?", "  Is Rival good?  "]},
        headers=viewer.headers,
    )

    assert response.status_code == 200, response.text
    branded, plain = response.json()["data"]
    assert branded["is_branded"] is True
    assert [(m["entity"]["canonical_name"], m["alias"]) for m in branded["matched_aliases"]] == [
        ("Acme", "Acme")
    ]
    # The emoji is one character and two UTF-16 units: the name starts at unit 6.
    warnings = branded["warnings"]
    assert [(w["rule"], w["severity"], w["engine_code"], w["span"]) for w in warnings] == [
        ("contains_brand_alias", "warning", None, {"start": 6, "end": 10})
    ]
    assert (plain["text"], plain["is_branded"], plain["warnings"]) == ("Is Rival good?", False, [])
    assert response.json()["quota"] == {"limit": 40, "used": 0}
    assert await fetch(migrated, "SELECT id FROM ai.prompts WHERE project_id = $1", project) == []


async def test_the_lint_warns_of_each_engine_a_prompt_is_too_long_for(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "prompts", "lint")

    every = await api.post(url, json={"texts": ["x" * 701, "x" * 2001]}, headers=editor.headers)
    chatgpt = await api.post(
        url, json={"texts": ["x" * 701], "engine_codes": ["chatgpt_web"]}, headers=editor.headers
    )

    assert every.status_code == 200, every.text
    over_mode, over_all = every.json()["data"]
    assert [(w["rule"], w["severity"], w["engine_code"]) for w in over_mode["warnings"]] == [
        ("engine_limit", "warning", "google_ai_mode")
    ]
    assert [(w["severity"], w["engine_code"]) for w in over_all["warnings"]] == [
        ("error", "chatgpt_web"),
        ("error", "gemini_web"),
        ("error", "google_ai_mode"),
    ]
    assert chatgpt.json()["data"][0]["warnings"] == []
