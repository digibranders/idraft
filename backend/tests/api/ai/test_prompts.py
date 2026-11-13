"""Prompts (docs/19 section 3.7.1; spec 2026-11-11 sections 4.2 and 4.5; plan decisions A2, A3
and A7)."""

from __future__ import annotations

import asyncio
import hashlib
import json
import uuid

import asyncpg
import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.ai.support import (
    add_prompt,
    added,
    ai_project,
    enable_engine,
    seed_prompts,
    set_prompt_quota,
)
from tests.api.auth.support import execute, fetch, fetchrow, make_workspace
from tests.api.entities.support import attach, member, problem
from tests.api.keywords.support import (
    LOCATION,
    OTHER_LOCATION,
    errors,
    project_url,
    term,
    vocabulary,
)
from tests.conftest import PostgresServer
from tests.db.support import scoped

# Built from code points so the file stays ASCII: the composed spelling is "cafe" with
# e-acute, the decomposed one "cafe" with a combining acute accent after a plain "e".
E_ACUTE = chr(0xE9)
COMBINING_ACUTE = chr(0x301)
CAFE = "Which caf" + E_ACUTE + " suits a meeting?"
CAFE_DECOMPOSED = "Which cafe" + COMBINING_ACUTE + " suits a meeting?"


def problem_or_created(response: httpx.Response) -> tuple[int, str]:
    """`(201, "created")`, or the problem's status and code."""
    return (201, "created") if response.status_code == 201 else problem(response)


async def test_an_editor_adds_a_prompt_with_its_first_version(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)

    response = await add_prompt(
        api,
        workspace,
        project,
        editor,
        "  Best CRM for a 20-person startup?  ",
        intent="commercial",
        importance=5,
    )

    assert response.status_code == 201, response.text
    data = response.json()["data"]
    version = data["current_version"]
    assert (version["version_no"], version["text"], version["change_kind"]) == (
        1,
        "Best CRM for a 20-person startup?",
        "initial",
    )
    assert version["text_hash"] == hashlib.sha256(b"Best CRM for a 20-person startup?").hexdigest()
    assert (
        data["language_code"],
        data["country_iso"],
        data["intent"],
        data["importance"],
        data["is_active"],
        data["is_branded"],
        data["source"],
        data["creation_method"],
        data["terms"],
    ) == ("en", "US", "commercial", 5, True, False, "manual", "human", [])
    assert data["created_by"]["user_id"] == str(editor.user_id)
    entries = await fetch(
        migrated,
        "SELECT action, target_id FROM ops.audit_logs WHERE workspace_id = $1",
        workspace.id,
    )
    assert [(entry["action"], entry["target_id"]) for entry in entries] == [
        ("prompt.created", data["prompt_id"])
    ]


async def test_a_prompt_naming_an_own_brand_is_branded(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    for name, role in (("Acme", "own"), ("Rival", "competitor")):
        entity = await fetchrow(
            migrated,
            "INSERT INTO core.entities (workspace_id, entity_type, canonical_name) "
            "VALUES ($1, 'brand', $2) RETURNING id",
            workspace.id,
            name,
        )
        await attach(migrated, workspace, project, entity["id"], role)

    own = await add_prompt(api, workspace, project, editor, "Is Acme good for startups?")
    rival = await add_prompt(api, workspace, project, editor, "Is Rival good for startups?")

    assert own.json()["data"]["is_branded"] is True
    assert rival.json()["data"]["is_branded"] is False


async def test_the_same_prompt_twice_is_a_duplicate_archived_or_not(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    first = await added(api, workspace, project, editor, CAFE)

    again = await add_prompt(api, workspace, project, editor, CAFE)
    decomposed = await add_prompt(api, workspace, project, editor, CAFE_DECOMPOSED)
    await api.delete(project_url(workspace, project, "prompts", first), headers=editor.headers)
    archived = await add_prompt(api, workspace, project, editor, f" {CAFE} ")
    elsewhere = await add_prompt(api, workspace, project, editor, CAFE, country_iso="GB")
    other_case = await add_prompt(api, workspace, project, editor, CAFE.lower())

    assert problem(again) == problem(decomposed) == problem(archived) == (409, "duplicate")
    assert (
        again.json()["existing_id"]
        == decomposed.json()["existing_id"]
        == archived.json()["existing_id"]
        == first
    )
    assert elsewhere.status_code == other_case.status_code == 201


async def test_two_writers_adding_the_same_prompt_at_once_make_one_and_a_duplicate(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)

    responses = await asyncio.gather(
        *(add_prompt(api, workspace, project, editor, "Best CRM?") for _ in range(2))
    )

    assert sorted(problem_or_created(response) for response in responses) == [
        (201, "created"),
        (409, "duplicate"),
    ]


async def test_two_writers_taking_the_last_places_at_once_fit_only_one(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    await set_prompt_quota(migrated, workspace, 2)
    await seed_prompts(migrated, workspace, project, 1)

    responses = await asyncio.gather(
        add_prompt(api, workspace, project, editor, "First new?"),
        add_prompt(api, workspace, project, editor, "Second new?"),
    )

    assert sorted(problem_or_created(response) for response in responses) == [
        (201, "created"),
        (422, "quota_exceeded"),
    ]


async def test_a_prompt_is_in_a_country_every_enabled_engine_runs_in(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    await enable_engine(migrated, workspace, project, "chatgpt_web", [LOCATION])
    await enable_engine(migrated, workspace, project, "google_ai_mode", [LOCATION, OTHER_LOCATION])

    us = await add_prompt(api, workspace, project, editor, "Best CRM?")
    gb = await add_prompt(api, workspace, project, editor, "Best CRM?", country_iso="GB")
    await execute(
        migrated,
        "UPDATE ai.project_engines SET is_enabled = false WHERE project_id = $1 "
        "AND engine_code = 'chatgpt_web'",
        project,
    )
    gb_again = await add_prompt(api, workspace, project, editor, "Best CRM?", country_iso="GB")

    assert us.status_code == 201, us.text
    assert problem(gb) == (422, "validation_failed")
    assert errors(gb) == [("country_iso", "location_not_supported")]
    assert gb_again.status_code == 201, gb_again.text


async def test_a_prompt_takes_the_terms_the_project_may_use(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    topics = await vocabulary(migrated, workspace)
    crm = await term(migrated, workspace, topics, "crm")
    pricing = await term(migrated, workspace, topics, "pricing", parent=crm)
    single = await vocabulary(migrated, workspace, single=True)
    one, two = (
        await term(migrated, workspace, single, "a"),
        await term(migrated, workspace, single, "b"),
    )

    tagged = await add_prompt(api, workspace, project, editor, "CRM pricing?", term_ids=[pricing])
    unknown = await add_prompt(
        api, workspace, project, editor, "Other?", term_ids=[str(uuid.uuid4())]
    )
    both = await add_prompt(api, workspace, project, editor, "Both?", term_ids=[one, two])
    under_crm = await api.get(
        project_url(workspace, project, "prompts"),
        params={"filter[term]": crm},
        headers=editor.headers,
    )

    assert tagged.status_code == 201, tagged.text
    assert [entry["path"] for entry in tagged.json()["data"]["terms"]] == ["crm/pricing"]
    assert errors(unknown) == [("term_ids", "term_unknown")]
    assert errors(both) == [("term_ids", "single_valued_vocabulary")]
    assert [row["prompt_id"] for row in under_crm.json()["data"]] == [
        tagged.json()["data"]["prompt_id"]
    ]


async def test_the_workspace_quota_stops_new_and_returning_prompts(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    await set_prompt_quota(migrated, workspace, 1)

    first = await added(api, workspace, project, editor, "First?")
    over = await add_prompt(api, workspace, project, editor, "Second?")
    await api.delete(project_url(workspace, project, "prompts", first), headers=editor.headers)
    in_its_place = await add_prompt(api, workspace, project, editor, "Third?")
    back = await api.patch(
        project_url(workspace, project, "prompts", first),
        json={"is_active": True},
        headers=editor.headers,
    )

    assert problem(over) == (422, "quota_exceeded")
    assert (over.json()["limit"], over.json()["used"], over.json()["requested"]) == (1, 1, 1)
    assert in_its_place.status_code == 201, in_its_place.text
    assert problem(back) == (422, "quota_exceeded")


async def test_prompts_are_listed_newest_first_with_filters_and_pages(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    analyst = await member(resources, migrated, workspace, "analyst")
    project = await ai_project(migrated, workspace)
    a = await added(api, workspace, project, editor, "Alpha?", intent="commercial")
    b = await added(api, workspace, project, editor, "Beta?", language_code="de")
    c = await added(api, workspace, project, editor, "Gamma?", country_iso="GB")
    url = project_url(workspace, project, "prompts")

    async def ids(**params: str) -> list[str]:
        response = await api.get(url, params=params, headers=analyst.headers)
        assert response.status_code == 200, response.text
        return [row["prompt_id"] for row in response.json()["data"]]

    first = await api.get(url, params={"limit": "2"}, headers=analyst.headers)
    page = first.json()["page"]
    rest = await api.get(
        url, params={"limit": "2", "cursor": page["next_cursor"]}, headers=analyst.headers
    )
    crossed = await api.get(
        url,
        params={"limit": "2", "cursor": page["next_cursor"], "filter[language_code]": "de"},
        headers=analyst.headers,
    )
    unknown = await api.get(url, params={"filter[panel]": "core"}, headers=analyst.headers)

    assert [row["prompt_id"] for row in first.json()["data"]] == [c, b]
    assert page["has_more"] is True
    assert [row["prompt_id"] for row in rest.json()["data"]] == [a]
    assert rest.json()["page"] == {"limit": 2, "next_cursor": None, "has_more": False}
    assert problem(crossed) == (400, "invalid_cursor")
    assert problem(unknown) == (422, "validation_failed")
    assert await ids(**{"filter[intent_in]": "commercial,local"}) == [a]
    assert await ids(**{"filter[language_code]": "de"}) == [b]
    assert await ids(**{"filter[country_iso]": "GB"}) == [c]
    assert await ids(**{"filter[q]": "BET"}) == [b]
    await api.delete(project_url(workspace, project, "prompts", a), headers=editor.headers)
    assert await ids() == [c, b]
    assert await ids(**{"filter[is_active]": "false"}) == [a]


async def test_a_prompt_is_read_within_its_project_only(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    other = await ai_project(migrated, workspace)
    (prompt_id,) = await seed_prompts(migrated, workspace, project, 1)

    own = await api.get(
        project_url(workspace, project, "prompts", prompt_id), headers=viewer.headers
    )
    elsewhere = await api.get(
        project_url(workspace, other, "prompts", prompt_id), headers=viewer.headers
    )

    assert own.status_code == 200, own.text
    assert own.json()["data"]["current_version"]["text"] == "prompt 1"
    assert problem(elsewhere) == (404, "not_found")


async def test_a_change_touches_the_metadata_and_never_the_text(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    prompt_id = await added(api, workspace, project, editor, "Best CRM?")
    url = project_url(workspace, project, "prompts", prompt_id)

    changed = await api.patch(
        url,
        json={"importance": 1, "intent": "commercial", "is_branded": True},
        headers=editor.headers,
    )
    text = await api.patch(url, json={"text": "Better CRM?"}, headers=editor.headers)

    assert changed.status_code == 200, changed.text
    data = changed.json()["data"]
    assert (data["importance"], data["intent"], data["is_branded"]) == (1, "commercial", True)
    assert data["updated_at"] > data["created_at"]
    assert errors(text) == [("text", "immutable_field")]
    (entry,) = await fetch(
        migrated,
        "SELECT before, after FROM ops.audit_logs WHERE workspace_id = $1 "
        "AND action = 'prompt.updated'",
        workspace.id,
    )
    assert (
        json.loads(entry["before"])["importance"],
        json.loads(entry["after"])["importance"],
    ) == (
        3,
        1,
    )


async def test_archiving_keeps_the_prompt_and_says_so_once(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    prompt_id = await added(api, workspace, project, editor, "Best CRM?")
    url = project_url(workspace, project, "prompts", prompt_id)

    first = await api.delete(url, headers=editor.headers)
    again = await api.delete(url, headers=editor.headers)
    kept = await api.get(url, headers=editor.headers)

    assert first.status_code == again.status_code == 204
    assert kept.json()["data"]["is_active"] is False
    archived = await fetch(
        migrated,
        "SELECT id FROM ops.audit_logs WHERE workspace_id = $1 AND action = 'prompt.archived'",
        workspace.id,
    )
    assert len(archived) == 1


@pytest.mark.parametrize("role", ["viewer", "analyst"])
async def test_only_a_prompt_writer_changes_prompts(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, role: str
) -> None:
    workspace = await make_workspace(migrated)
    caller = await member(resources, migrated, workspace, role)
    project = await ai_project(migrated, workspace)
    (prompt_id,) = await seed_prompts(migrated, workspace, project, 1)
    url = project_url(workspace, project, "prompts", prompt_id)

    create = await add_prompt(api, workspace, project, caller, "Best CRM?")
    change = await api.patch(url, json={"importance": 1}, headers=caller.headers)
    archive = await api.delete(url, headers=caller.headers)

    assert problem(create) == problem(change) == problem(archive) == (403, "forbidden")


async def test_a_prompt_without_a_type_gets_the_rule_and_says_so(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)

    versus = await add_prompt(api, workspace, project, editor, "Asana versus Trello for a team?")
    plain = await add_prompt(api, workspace, project, editor, "best crm")

    assert versus.status_code == plain.status_code == 201, plain.text
    assert versus.json()["data"]["prompt_type"] == "comparison"
    assert versus.json()["data"]["prompt_type_source"] == "rule"
    assert plain.json()["data"]["prompt_type"] == "other"
    assert plain.json()["data"]["prompt_type_source"] == "rule"
    rows = await fetch(
        migrated,
        "SELECT prompt_type, prompt_type_source FROM ai.prompts WHERE project_id = $1 "
        "ORDER BY prompt_type",
        project,
    )
    assert [(row["prompt_type"], row["prompt_type_source"]) for row in rows] == [
        ("comparison", "rule"),
        ("other", "rule"),
    ]
    (entry, _) = await fetch(
        migrated,
        "SELECT after FROM ops.audit_logs WHERE workspace_id = $1 AND action = 'prompt.created' "
        "ORDER BY id",
        workspace.id,
    )
    assert json.loads(entry["after"])["prompt_type_source"] == "rule"


async def test_a_null_type_is_the_same_as_none_sent(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)

    # The documented lenient reading: null is "no type", so the rule answers.
    response = await add_prompt(
        api, workspace, project, editor, "Asana versus Trello?", prompt_type=None
    )

    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert (data["prompt_type"], data["prompt_type_source"]) == ("comparison", "rule")


async def test_a_type_sent_is_kept_and_marked_person(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)

    # The wording says comparison; the person's choice stands, even when it is the default.
    sent = await add_prompt(
        api, workspace, project, editor, "Asana versus Trello?", prompt_type="recommendation"
    )
    same = await add_prompt(
        api, workspace, project, editor, "Is Asana good?", prompt_type="question"
    )

    for response, expected in ((sent, "recommendation"), (same, "question")):
        assert response.status_code == 201, response.text
        assert response.json()["data"]["prompt_type"] == expected
        assert response.json()["data"]["prompt_type_source"] == "person"
    assert sent.json()["data"]["is_branded_source"] == "computed"


async def test_a_type_changed_by_patch_becomes_person(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    prompt_id = await added(api, workspace, project, editor, "Asana versus Trello?")
    url = project_url(workspace, project, "prompts", prompt_id)

    other_field = await api.patch(url, json={"importance": 1}, headers=editor.headers)
    retyped = await api.patch(url, json={"prompt_type": "recommendation"}, headers=editor.headers)

    assert other_field.json()["data"]["prompt_type_source"] == "rule"
    assert retyped.status_code == 200, retyped.text
    data = retyped.json()["data"]
    assert (data["prompt_type"], data["prompt_type_source"]) == ("recommendation", "person")
    entries = await fetch(
        migrated,
        "SELECT before, after FROM ops.audit_logs WHERE workspace_id = $1 "
        "AND action = 'prompt.updated' ORDER BY id",
        workspace.id,
    )
    last = entries[-1]
    assert json.loads(last["before"])["prompt_type_source"] == "rule"
    assert json.loads(last["after"])["prompt_type_source"] == "person"


async def test_a_patch_to_the_type_the_rule_gave_still_says_person(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    prompt_id = await added(api, workspace, project, editor, "Asana versus Trello?")
    url = project_url(workspace, project, "prompts", prompt_id)

    same = await api.patch(url, json={"prompt_type": "comparison"}, headers=editor.headers)

    assert same.status_code == 200, same.text
    data = same.json()["data"]
    assert (data["prompt_type"], data["prompt_type_source"]) == ("comparison", "person")


async def test_a_cursor_does_not_cross_to_another_type_filter(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    await added(api, workspace, project, editor, "Asana versus Trello?")
    await added(api, workspace, project, editor, "Asana versus Monday?")
    await added(api, workspace, project, editor, "How to pick a CRM")
    url = project_url(workspace, project, "prompts")

    first = await api.get(
        url, params={"filter[prompt_type_in]": "comparison", "limit": "1"}, headers=editor.headers
    )
    crossed = await api.get(
        url,
        params={
            "filter[prompt_type_in]": "how_to",
            "limit": "1",
            "cursor": first.json()["page"]["next_cursor"],
        },
        headers=editor.headers,
    )

    assert first.json()["page"]["has_more"] is True
    assert problem(crossed) == (400, "invalid_cursor")


async def test_the_list_filters_by_prompt_type(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    versus = await added(api, workspace, project, editor, "Asana versus Trello?")
    how_to = await added(api, workspace, project, editor, "How to pick a CRM")
    await added(api, workspace, project, editor, "What is a CRM?")
    url = project_url(workspace, project, "prompts")

    both = await api.get(
        url, params={"filter[prompt_type_in]": "comparison,how_to"}, headers=editor.headers
    )
    first = await api.get(
        url,
        params={"filter[prompt_type_in]": "comparison,how_to", "limit": "1"},
        headers=editor.headers,
    )
    cursor = first.json()["page"]["next_cursor"]
    rest = await api.get(
        url,
        params={"filter[prompt_type_in]": "comparison,how_to", "limit": "1", "cursor": cursor},
        headers=editor.headers,
    )
    unfiltered = await api.get(url, params={"limit": "1"}, headers=editor.headers)
    crossed = await api.get(
        url,
        params={
            "filter[prompt_type_in]": "comparison",
            "limit": "1",
            "cursor": unfiltered.json()["page"]["next_cursor"],
        },
        headers=editor.headers,
    )
    unknown = await api.get(
        url, params={"filter[prompt_type_in]": "comparison,poem"}, headers=editor.headers
    )

    # Newest first: the question (left out) is newest, then how to, then the comparison.
    assert [row["prompt_id"] for row in both.json()["data"]] == [how_to, versus]
    assert [row["prompt_id"] for row in first.json()["data"]] == [how_to]
    assert [row["prompt_id"] for row in rest.json()["data"]] == [versus]
    assert rest.json()["page"]["has_more"] is False
    assert problem(crossed) == (400, "invalid_cursor")
    assert problem(unknown) == (422, "validation_failed")


async def test_a_cursor_issued_without_the_type_filter_still_decodes(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    for text in ("Alpha?", "Beta?", "Gamma?"):
        await added(api, workspace, project, editor, text)
    url = project_url(workspace, project, "prompts")

    first = await api.get(url, params={"limit": "2"}, headers=editor.headers)
    rest = await api.get(
        url,
        params={"limit": "2", "cursor": first.json()["page"]["next_cursor"]},
        headers=editor.headers,
    )

    # A page two cursor must not need the `prompt_types` key, which an older client never sent.
    assert rest.status_code == 200, rest.text
    assert len(rest.json()["data"]) == 1


async def test_the_new_columns_default_and_are_granted(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    # Written directly with no value for the new columns, as a row made before them is.
    (prompt_id,) = await seed_prompts(migrated, workspace, project, 1)

    read = await api.get(
        project_url(workspace, project, "prompts", prompt_id), headers=viewer.headers
    )
    async with scoped(migrated, "app_api", workspace_id=workspace.id) as db:
        updated = await db.execute(
            "UPDATE ai.prompts SET prompt_type_source = 'rule', is_branded_source = 'override' "
            "WHERE id = $1",
            prompt_id,
        )
    async with scoped(migrated, "app_api", workspace_id=workspace.id) as db:
        with pytest.raises(asyncpg.CheckViolationError):
            await db.execute(
                "UPDATE ai.prompts SET prompt_type_source = 'robot' WHERE id = $1", prompt_id
            )
    async with scoped(migrated, "app_api", workspace_id=workspace.id) as db:
        with pytest.raises(asyncpg.CheckViolationError):
            await db.execute(
                "UPDATE ai.prompts SET is_branded_source = 'guess' WHERE id = $1", prompt_id
            )

    data = read.json()["data"]
    assert (data["prompt_type_source"], data["is_branded_source"]) == ("person", "computed")
    assert updated == "UPDATE 1"
