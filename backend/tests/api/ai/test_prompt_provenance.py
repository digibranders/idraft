"""What a prompt says about itself when it is added: whether its branded flag was computed or set
by a person (prompt-dialogs N04), and where it came from (N07: `source`, `creation_method`,
`generated_from`). Contract C1, POST {P}/prompts and bulk-create."""

from __future__ import annotations

import json
import uuid
from typing import Any

import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.ai.sources_support import statements
from tests.api.ai.support import add_prompt, added, ai_project, prompt_body
from tests.api.auth.support import Workspace, execute, fetch, fetchrow, make_workspace
from tests.api.entities.support import attach, member, problem
from tests.api.keywords.support import errors, project_url, tracked_id
from tests.conftest import PostgresServer

UNKNOWN_KEYWORD = [("generated_from.tracked_keyword_id", "tracked_keyword_unknown")]
INVALID = (422, "validation_failed")


def _from(tracked_keyword_id: str, template: str = "comparison") -> dict[str, str]:
    return {"tracked_keyword_id": tracked_keyword_id, "template": template}


async def _own_brand(
    pg: PostgresServer, workspace: Workspace, project: uuid.UUID, own: str = "Acme"
) -> None:
    """The project owns `own` (Acme) and competes with Rival."""
    for name, role in ((own, "own"), ("Rival", "competitor")):
        entity = await fetchrow(
            pg,
            "INSERT INTO core.entities (workspace_id, entity_type, canonical_name) "
            "VALUES ($1, 'brand', $2) RETURNING id",
            workspace.id,
            name,
        )
        await attach(pg, workspace, project, entity["id"], role)


async def _audit(pg: PostgresServer, workspace: Workspace, action: str) -> list[dict[str, Any]]:
    rows = await fetch(
        pg,
        "SELECT before, after FROM ops.audit_logs WHERE workspace_id = $1 AND action = $2 "
        "ORDER BY id",
        workspace.id,
        action,
    )
    return [
        {
            "before": None if row["before"] is None else json.loads(row["before"]),
            "after": None if row["after"] is None else json.loads(row["after"]),
        }
        for row in rows
    ]


async def test_an_is_branded_override_is_kept_and_marked(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    await _own_brand(migrated, workspace, project)

    # Against the aliases both ways: a text naming Acme set to false, one that does not set to true.
    never = await add_prompt(
        api, workspace, project, editor, "Is Acme good for startups?", is_branded=False
    )
    always = await add_prompt(
        api, workspace, project, editor, "Which CRM suits a startup?", is_branded=True
    )
    many = await api.post(
        project_url(workspace, project, "prompts", "bulk-create"),
        json={
            "items": [
                prompt_body("Is Acme cheap?", is_branded=False),
                prompt_body("Is there a free CRM?", is_branded=True),
                prompt_body("Is Acme fast?"),
            ]
        },
        headers=editor.headers,
    )

    assert never.status_code == always.status_code == 201, always.text
    assert many.status_code == 200, many.text
    for response, branded in ((never, False), (always, True)):
        data = response.json()["data"]
        assert (data["is_branded"], data["is_branded_source"]) == (branded, "override")
    rows = await fetch(
        migrated,
        "SELECT v.text, p.is_branded, p.is_branded_source FROM ai.prompts p "
        "JOIN ai.prompt_versions v ON v.id = p.current_version_id WHERE p.project_id = $1",
        project,
    )
    assert {row["text"]: (row["is_branded"], row["is_branded_source"]) for row in rows} == {
        "Is Acme good for startups?": (False, "override"),
        "Which CRM suits a startup?": (True, "override"),
        "Is Acme cheap?": (False, "override"),
        "Is there a free CRM?": (True, "override"),
        "Is Acme fast?": (True, "computed"),
    }


async def test_without_override_branded_is_computed(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    await _own_brand(migrated, workspace, project)

    own = await add_prompt(api, workspace, project, editor, "Is Acme good for startups?")
    rival = await add_prompt(api, workspace, project, editor, "Is Rival good for startups?")
    plain = await add_prompt(api, workspace, project, editor, "Which CRM suits a startup?")

    # D-21: only the project's own aliases make a prompt branded.
    assert [
        (r.json()["data"]["is_branded"], r.json()["data"]["is_branded_source"])
        for r in (own, rival, plain)
    ] == [(True, "computed"), (False, "computed"), (False, "computed")]


async def test_another_projects_own_alias_does_not_make_a_prompt_branded(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    sibling = await ai_project(migrated, workspace)
    elsewhere = await make_workspace(migrated)
    stranger = await ai_project(migrated, elsewhere)
    await _own_brand(migrated, workspace, sibling, "Zeta")
    await _own_brand(migrated, elsewhere, stranger, "Zeta")

    single = await add_prompt(api, workspace, project, editor, "Is Zeta good?")
    many = await api.post(
        project_url(workspace, project, "prompts", "bulk-create"),
        json={"items": [prompt_body("Is Zeta cheap?")]},
        headers=editor.headers,
    )

    assert single.status_code == 201, single.text
    assert many.status_code == 200, many.text
    data = single.json()["data"]
    assert (data["is_branded"], data["is_branded_source"]) == (False, "computed")
    rows = await fetch(
        migrated,
        "SELECT p.is_branded, p.is_branded_source FROM ai.prompts p WHERE p.project_id = $1",
        project,
    )
    assert [(row["is_branded"], row["is_branded_source"]) for row in rows] == [
        (False, "computed")
    ] * 2


async def test_patch_is_branded_marks_override(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    prompt_id = await added(api, workspace, project, editor, "Which CRM suits a startup?")
    url = project_url(workspace, project, "prompts", prompt_id)

    other = await api.patch(url, json={"importance": 1}, headers=editor.headers)
    # The computed value, sent again, is still the person's word from now on.
    same = await api.patch(url, json={"is_branded": False}, headers=editor.headers)
    flipped = await api.patch(url, json={"is_branded": True}, headers=editor.headers)
    later = await api.patch(url, json={"importance": 2}, headers=editor.headers)

    sources = [
        (r.json()["data"]["is_branded"], r.json()["data"]["is_branded_source"])
        for r in (other, same, flipped, later)
    ]
    assert sources == [
        (False, "computed"),
        (False, "override"),
        (True, "override"),
        (True, "override"),
    ]
    row = await fetchrow(
        migrated, "SELECT is_branded_source FROM ai.prompts WHERE id = $1", uuid.UUID(prompt_id)
    )
    assert row["is_branded_source"] == "override"


async def test_the_audit_entries_carry_the_branded_source(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    prompt_id = await added(api, workspace, project, editor, "Which CRM suits a startup?")
    await added(api, workspace, project, editor, "Is there a free CRM?", is_branded=True)

    changed = await api.patch(
        project_url(workspace, project, "prompts", prompt_id),
        json={"is_branded": True},
        headers=editor.headers,
    )

    assert changed.status_code == 200, changed.text
    created = await _audit(migrated, workspace, "prompt.created")
    assert [entry["after"]["is_branded_source"] for entry in created] == ["computed", "override"]
    (updated,) = await _audit(migrated, workspace, "prompt.updated")
    assert (updated["before"]["is_branded_source"], updated["after"]["is_branded_source"]) == (
        "computed",
        "override",
    )
    assert (updated["before"]["is_branded"], updated["after"]["is_branded"]) == (False, True)


async def test_source_and_creation_method_are_saved_and_shown(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "prompts")

    one = await add_prompt(
        api,
        workspace,
        project,
        editor,
        "Which CRM suits a startup?",
        source="csv_import",
        creation_method="imported",
    )
    many = await api.post(
        project_url(workspace, project, "prompts", "bulk-create"),
        json={
            "items": [
                prompt_body("Is there a free CRM?", source="paa"),
                prompt_body("Best CRM for agencies", source="gsc_query", creation_method="human"),
                prompt_body("CRM for a clinic"),
            ]
        },
        headers=editor.headers,
    )
    listed = await api.get(url, params={"limit": 10}, headers=editor.headers)

    assert one.status_code == 201, one.text
    assert many.status_code == 200, many.text
    shown = one.json()["data"]
    assert (shown["source"], shown["creation_method"]) == ("csv_import", "imported")
    by_text = {
        row["current_version"]["text"]: (row["source"], row["creation_method"])
        for row in listed.json()["data"]
    }
    assert by_text == {
        "Which CRM suits a startup?": ("csv_import", "imported"),
        "Is there a free CRM?": ("paa", "human"),
        "Best CRM for agencies": ("gsc_query", "human"),
        "CRM for a clinic": ("manual", "human"),
    }
    stored = await fetch(
        migrated, "SELECT source, creation_method FROM ai.prompts WHERE project_id = $1", project
    )
    assert sorted((row["source"], row["creation_method"]) for row in stored) == sorted(
        by_text.values()
    )


async def test_generated_from_makes_a_template_prompt_unless_said_otherwise(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    keyword = await tracked_id(api, workspace, project, editor, "crm software")

    generated = await add_prompt(
        api,
        workspace,
        project,
        editor,
        "Which CRM software is best?",
        generated_from=_from(keyword, "recommendation"),
    )
    edited = await add_prompt(
        api,
        workspace,
        project,
        editor,
        "Which CRM software would you pick?",
        generated_from=_from(keyword, "recommendation"),
        creation_method="human",
        source="seo_keyword",
    )

    assert generated.status_code == edited.status_code == 201, edited.text
    assert [
        (r.json()["data"]["source"], r.json()["data"]["creation_method"])
        for r in (generated, edited)
    ] == [("manual", "template"), ("seo_keyword", "human")]
    # The link is audit only: the response and the table have no generated_from.
    assert "generated_from" not in generated.json()["data"]


async def test_llm_generated_is_refused_from_a_caller(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)

    method = await add_prompt(
        api, workspace, project, editor, "Which CRM?", creation_method="llm_generated"
    )
    source = await add_prompt(api, workspace, project, editor, "Which CRM?", source="llm_variant")
    many = await api.post(
        project_url(workspace, project, "prompts", "bulk-create"),
        json={"items": [prompt_body("Which CRM?", creation_method="llm_generated")]},
        headers=editor.headers,
    )

    assert problem(method) == problem(source) == problem(many) == INVALID
    count = await fetchrow(
        migrated, "SELECT count(*) AS n FROM ai.prompts WHERE project_id = $1", project
    )
    assert count["n"] == 0


async def test_generated_from_names_a_tracked_keyword_of_the_project(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    sibling = await ai_project(migrated, workspace)
    own = await tracked_id(api, workspace, project, editor, "crm software")
    of_sibling = await tracked_id(api, workspace, sibling, editor, "crm software")
    removed = await tracked_id(api, workspace, project, editor, "old crm")
    await execute(
        migrated,
        "UPDATE seo.tracked_keywords SET deleted_at = now() WHERE id = $1",
        uuid.UUID(removed),
    )
    elsewhere = await make_workspace(migrated)
    stranger = await member(resources, migrated, elsewhere, "editor")
    of_stranger = await tracked_id(
        api, elsewhere, await ai_project(migrated, elsewhere), stranger, "crm"
    )

    async def create(keyword: str) -> httpx.Response:
        return await add_prompt(
            api,
            workspace,
            project,
            editor,
            f"Which CRM, {uuid.uuid4().hex}?",
            generated_from=_from(keyword),
        )

    accepted = await create(own)
    refused = [
        await create(keyword) for keyword in (of_sibling, removed, of_stranger, str(uuid.uuid4()))
    ]

    assert accepted.status_code == 201, accepted.text
    for response in refused:
        assert problem(response) == INVALID
        assert errors(response) == UNKNOWN_KEYWORD
    written = await fetchrow(
        migrated, "SELECT count(*) AS n FROM ai.prompts WHERE project_id = $1", project
    )
    assert written["n"] == 1


async def test_a_paused_tracked_keyword_is_accepted_as_generated_from(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    paused = await tracked_id(api, workspace, project, editor, "crm software")
    await execute(
        migrated,
        "UPDATE seo.tracked_keywords SET is_active = false WHERE id = $1",
        uuid.UUID(paused),
    )

    response = await add_prompt(
        api, workspace, project, editor, "Which CRM suits a startup?", generated_from=_from(paused)
    )

    assert response.status_code == 201, response.text


async def test_generated_from_is_in_the_audit_entry(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    keyword = await tracked_id(api, workspace, project, editor, "crm software")

    await add_prompt(
        api,
        workspace,
        project,
        editor,
        "Which CRM software is best?",
        source="seo_keyword",
        generated_from=_from(keyword, "how_to"),
    )
    await add_prompt(api, workspace, project, editor, "Is there a free CRM?")

    entries = await _audit(migrated, workspace, "prompt.created")
    generated, plain = [entry["after"] for entry in entries]
    assert (generated["source"], generated["creation_method"]) == ("seo_keyword", "template")
    assert generated["generated_from_tracked_keyword_id"] == keyword
    assert generated["generated_from_template"] == "how_to"
    assert (plain["source"], plain["creation_method"]) == ("manual", "human")
    assert "generated_from_tracked_keyword_id" not in plain


async def test_bulk_create_rejects_only_the_item_with_an_unknown_keyword(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    sibling = await ai_project(migrated, workspace)
    own = await tracked_id(api, workspace, project, editor, "crm software")
    of_sibling = await tracked_id(api, workspace, sibling, editor, "crm software")

    response = await api.post(
        project_url(workspace, project, "prompts", "bulk-create"),
        json={
            "items": [
                prompt_body("Which CRM is best?", generated_from=_from(own)),
                prompt_body("Which CRM is cheapest?", generated_from=_from(of_sibling)),
                prompt_body("Which CRM is fastest?"),
            ]
        },
        headers=editor.headers,
    )

    assert response.status_code == 200, response.text
    result = response.json()["data"]
    assert len(result["created"]) == 2
    assert [(r["index"], r["code"]) for r in result["rejected"]] == [(1, "tracked_keyword_unknown")]
    created = await _audit(migrated, workspace, "prompt.created")
    assert [entry["after"]["creation_method"] for entry in created] == ["template", "human"]


async def test_the_keyword_check_is_one_statement_whatever_the_number_of_items(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    keyword = await tracked_id(api, workspace, project, editor, "crm software")
    url = project_url(workspace, project, "prompts", "bulk-create")

    def items(prefix: str, count: int, **changes: Any) -> dict[str, Any]:
        return {"items": [prompt_body(f"{prefix} {n}?", **changes) for n in range(count)]}

    with statements(resources) as plain:
        await api.post(url, json=items("plain", 20), headers=editor.headers)
    with statements(resources) as one:
        await api.post(
            url, json=items("one", 1, generated_from=_from(keyword)), headers=editor.headers
        )
    with statements(resources) as many:
        await api.post(
            url, json=items("many", 20, generated_from=_from(keyword)), headers=editor.headers
        )

    assert len(one) == len(many) == len(plain) + 1, many


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

    assert problem(response) == (403, "forbidden")


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

    assert problem(response) == (403, "forbidden")


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
