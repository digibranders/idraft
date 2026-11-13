"""Term assignments for prompts and the prompt count of terms (contract C1, BE-TOPICS-02 and
BE-TOPICS-03): `subject_type: prompt` takes `subject_ids` only, one audit summary and one entry per
changed prompt; `include=prompt_count` counts active, live prompts in visible projects."""

from __future__ import annotations

import json
import uuid
from typing import Any

import httpx
import pytest

from idraft.api.permissions import ROLE_PERMISSIONS, Permission, Role
from idraft.api.resources import Resources
from idraft.api.workspaces import access as workspace_access
from tests.api.ai.sources_support import statements
from tests.api.ai.support import ai_project, seed_prompts
from tests.api.auth.support import Workspace, execute, fetch, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.keywords.support import errors, project_url, term, tracked_id, vocabulary
from tests.conftest import PostgresServer


async def _assign(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: uuid.UUID,
    caller: Caller,
    body: dict[str, Any],
) -> httpx.Response:
    return await api.post(
        project_url(workspace, project, "term-assignments"),
        json={"subject_type": "prompt", **body},
        headers=caller.headers,
    )


def _ids(ids: list[uuid.UUID]) -> list[str]:
    return [str(prompt_id) for prompt_id in ids]


def _answer(response: httpx.Response) -> tuple[int, int, int]:
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    return data["subjects_matched"], data["assignments_added"], data["assignments_removed"]


async def _scene(
    resources: Resources, migrated: PostgresServer, role: str = "editor"
) -> tuple[Workspace, Caller, uuid.UUID]:
    workspace = await make_workspace(migrated)
    caller = await member(resources, migrated, workspace, role)
    return workspace, caller, await ai_project(migrated, workspace)


async def _held(pg: PostgresServer, ids: list[uuid.UUID]) -> dict[uuid.UUID, set[str]]:
    rows = await fetch(
        pg, "SELECT prompt_id, term_id FROM ai.prompt_terms WHERE prompt_id = ANY($1)", ids
    )
    held: dict[uuid.UUID, set[str]] = {prompt_id: set() for prompt_id in ids}
    for row in rows:
        held[row["prompt_id"]].add(str(row["term_id"]))
    return held


async def _link(
    pg: PostgresServer, workspace: Workspace, prompt_id: uuid.UUID, *terms: str
) -> None:
    for term_id in terms:
        await execute(
            pg,
            "INSERT INTO ai.prompt_terms (prompt_id, term_id, workspace_id) VALUES ($1, $2, $3)",
            prompt_id,
            uuid.UUID(term_id),
            workspace.id,
        )


async def _updated_at(pg: PostgresServer, ids: list[uuid.UUID]) -> dict[uuid.UUID, Any]:
    rows = await fetch(pg, "SELECT id, updated_at FROM ai.prompts WHERE id = ANY($1)", ids)
    return {row["id"]: row["updated_at"] for row in rows}


async def _entries(pg: PostgresServer, workspace: Workspace) -> list[dict[str, Any]]:
    rows = await fetch(
        pg,
        "SELECT action, target_type, target_id, after FROM ops.audit_logs "
        "WHERE workspace_id = $1 AND action LIKE 'prompt.%' ORDER BY action, target_id",
        workspace.id,
    )
    return [
        {
            "action": row["action"],
            "target_type": row["target_type"],
            "target_id": row["target_id"],
            "after": json.loads(row["after"]),
        }
        for row in rows
    ]


async def test_term_assignments_add_remove_replace_on_prompts(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, editor, project = await _scene(resources, migrated)
    topics = await vocabulary(migrated, workspace)
    stages = await vocabulary(migrated, workspace, single=True)
    crm, erp, hr = [await term(migrated, workspace, topics, slug) for slug in ("crm", "erp", "hr")]
    early, late = [await term(migrated, workspace, stages, slug) for slug in ("early", "late")]
    first, second, third = await seed_prompts(migrated, workspace, project, 3)

    async def assign(op: str, ids: list[uuid.UUID], *term_ids: str) -> tuple[int, int, int]:
        body = {"op": op, "subject_ids": _ids(ids), "term_ids": list(term_ids)}
        return _answer(await _assign(api, workspace, project, editor, body))

    # An id the project does not have is not matched.
    assert await assign("add", [first, second, uuid.uuid4()], crm, erp) == (2, 4, 0)
    before = await _updated_at(migrated, [first])
    assert await assign("add", [first], crm) == (1, 0, 0)
    assert await _updated_at(migrated, [first]) == before
    assert await assign("add", [first, third], early) == (2, 2, 0)
    # A term of a single-valued vocabulary takes the place of the prompt's other one.
    assert await assign("add", [first, second], late) == (2, 2, 1)
    assert await _held(migrated, [first, second, third]) == {
        first: {crm, erp, late},
        second: {crm, erp, late},
        third: {early},
    }
    bumped = await _updated_at(migrated, [first, second, third])
    assert await assign("remove", [first, second, third], erp, early) == (3, 0, 3)
    after = await _updated_at(migrated, [first, second, third])
    assert all(after[prompt_id] > bumped[prompt_id] for prompt_id in (first, second, third))
    assert await _held(migrated, [first, second, third]) == {
        first: {crm, late},
        second: {crm, late},
        third: set(),
    }
    # `replace` makes the given terms the only ones within their vocabularies; others stay.
    assert await assign("replace", [first, third], hr, erp) == (2, 4, 1)
    assert await _held(migrated, [first, second, third]) == {
        first: {late, hr, erp},
        second: {crm, late},
        third: {hr, erp},
    }
    entries = await _entries(migrated, workspace)
    summaries = [entry for entry in entries if entry["action"] == "prompt.bulk_changed"]
    replaced = [entry for entry in summaries if entry["after"]["term_assignment"] == "replace"]
    assert len(summaries) == 6
    assert [entry["target_type"] for entry in replaced] == ["project"]
    assert replaced[0]["target_id"] == str(project)
    assert replaced[0]["after"] == {
        "term_assignment": "replace",
        "term_ids": sorted([hr, erp]),
        "matched": 2,
        "changed": 2,
    }
    changed = [
        entry
        for entry in entries
        if entry["action"] == "prompt.updated" and entry["after"]["term_assignment"] == "replace"
    ]
    assert sorted(entry["target_id"] for entry in changed) == sorted([str(first), str(third)])
    assert all(entry["after"] == {"term_assignment": "replace", "bulk": True} for entry in changed)
    assigned = await fetch(
        migrated,
        "SELECT DISTINCT assigned_by FROM ai.prompt_terms WHERE prompt_id = ANY($1)",
        [first, second, third],
    )
    assert [row["assigned_by"] for row in assigned] == ["manual"]


async def test_term_assignments_leave_another_projects_prompts_alone(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, editor, project = await _scene(resources, migrated)
    other = await ai_project(migrated, workspace)
    topics = await vocabulary(migrated, workspace)
    crm, erp = [await term(migrated, workspace, topics, slug) for slug in ("crm", "erp")]
    (mine,) = await seed_prompts(migrated, workspace, project, 1)
    (theirs,) = await seed_prompts(migrated, workspace, other, 1)
    await _link(migrated, workspace, theirs, crm)
    before = await _updated_at(migrated, [theirs])

    added = await _assign(
        api,
        workspace,
        project,
        editor,
        {"op": "add", "subject_ids": _ids([mine, theirs]), "term_ids": [erp]},
    )
    removed = await _assign(
        api,
        workspace,
        project,
        editor,
        {"op": "remove", "subject_ids": _ids([theirs]), "term_ids": [crm]},
    )
    replaced = await _assign(
        api,
        workspace,
        project,
        editor,
        {"op": "replace", "subject_ids": _ids([mine, theirs]), "term_ids": [erp]},
    )

    assert _answer(added) == (1, 1, 0)
    assert _answer(removed) == (0, 0, 0)
    assert _answer(replaced) == (1, 0, 0)
    assert await _held(migrated, [mine, theirs]) == {mine: {erp}, theirs: {crm}}
    assert await _updated_at(migrated, [theirs]) == before


async def test_term_assignments_ignore_another_workspaces_prompts_and_refuse_its_terms(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, editor, project = await _scene(resources, migrated)
    stranger = await make_workspace(migrated)
    foreign_project = await ai_project(migrated, stranger)
    foreign_topics = await vocabulary(migrated, stranger)
    foreign_term = await term(migrated, stranger, foreign_topics, "secret")
    (theirs,) = await seed_prompts(migrated, stranger, foreign_project, 1)
    (mine,) = await seed_prompts(migrated, workspace, project, 1)
    mine_term = await term(migrated, workspace, await vocabulary(migrated, workspace), "crm")
    await _link(migrated, stranger, theirs, foreign_term)
    before = await _updated_at(migrated, [theirs])

    stranger_prompt = await _assign(
        api,
        workspace,
        project,
        editor,
        {"op": "remove", "subject_ids": _ids([theirs]), "term_ids": [mine_term]},
    )
    stranger_replace = await _assign(
        api,
        workspace,
        project,
        editor,
        {"op": "replace", "subject_ids": _ids([theirs]), "term_ids": [mine_term]},
    )
    stranger_term = await _assign(
        api,
        workspace,
        project,
        editor,
        {"op": "add", "subject_ids": _ids([mine]), "term_ids": [foreign_term]},
    )
    stranger_removal = await _assign(
        api,
        workspace,
        project,
        editor,
        {"op": "remove", "subject_ids": _ids([mine]), "term_ids": [foreign_term]},
    )

    assert _answer(stranger_prompt) == (0, 0, 0)
    assert _answer(stranger_replace) == (0, 0, 0)
    assert problem(stranger_term) == (422, "validation_failed")
    assert problem(stranger_removal) == (422, "validation_failed")
    assert errors(stranger_term) == errors(stranger_removal) == [("term_ids", "term_unknown")]
    assert await _held(migrated, [theirs, mine]) == {theirs: {foreign_term}, mine: set()}
    assert await _updated_at(migrated, [theirs]) == before
    # The two calls that were answered are audited, with nothing changed.
    assert [
        entry["after"]["changed"]
        for entry in await _entries(migrated, workspace)
        if entry["action"] == "prompt.bulk_changed"
    ] == [0, 0]


async def test_a_prompt_subject_filter_is_422(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, editor, project = await _scene(resources, migrated)
    crm = await term(migrated, workspace, await vocabulary(migrated, workspace), "crm")
    (prompt,) = await seed_prompts(migrated, workspace, project, 1)

    by_filter = await _assign(
        api, workspace, project, editor, {"op": "add", "subject_filter": {}, "term_ids": [crm]}
    )
    narrowed = await _assign(
        api,
        workspace,
        project,
        editor,
        {"op": "add", "subject_filter": {"is_active": True}, "term_ids": [crm]},
    )
    both = await _assign(
        api,
        workspace,
        project,
        editor,
        {"op": "add", "subject_ids": _ids([prompt]), "subject_filter": {}, "term_ids": [crm]},
    )
    over = await _assign(
        api,
        workspace,
        project,
        editor,
        {"op": "add", "subject_ids": _ids([uuid.uuid4() for _ in range(5001)]), "term_ids": [crm]},
    )

    assert [problem(response) for response in (by_filter, narrowed, both, over)] == [
        (422, "validation_failed")
    ] * 4
    assert errors(by_filter) == errors(narrowed) == [("subject_filter", "filter_not_supported")]
    assert errors(both) != [("subject_filter", "filter_not_supported")]
    assert errors(over) != [("subject_filter", "filter_not_supported")]
    assert await _held(migrated, [prompt]) == {prompt: set()}
    assert await _entries(migrated, workspace) == []


async def test_prompt_assignments_need_prompts_write(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Today the same roles hold `keywords:write` and `prompts:write`, so a role that has one
    and not the other is made for the test: the route lets the caller in on the first, and the
    prompt branch asks for the second."""
    workspace, editor, project = await _scene(resources, migrated)
    crm = await term(migrated, workspace, await vocabulary(migrated, workspace), "crm")
    (prompt,) = await seed_prompts(migrated, workspace, project, 1)
    keyword = await tracked_id(api, workspace, project, editor, "crm software")
    monkeypatch.setattr(
        workspace_access,
        "ROLE_PERMISSIONS",
        {
            **ROLE_PERMISSIONS,
            Role.EDITOR: ROLE_PERMISSIONS[Role.EDITOR] - {Permission.PROMPTS_WRITE},
        },
    )

    refused = await _assign(
        api,
        workspace,
        project,
        editor,
        {"op": "add", "subject_ids": _ids([prompt]), "term_ids": [crm]},
    )
    keywords = await api.post(
        project_url(workspace, project, "term-assignments"),
        json={
            "op": "add",
            "subject_type": "tracked_keyword",
            "subject_ids": [keyword],
            "term_ids": [crm],
        },
        headers=editor.headers,
    )

    assert problem(refused) == (403, "forbidden")
    assert keywords.status_code == 200, keywords.text
    assert await _held(migrated, [prompt]) == {prompt: set()}
    assert await _entries(migrated, workspace) == []


async def test_keyword_assignments_answer_as_before(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, editor, project = await _scene(resources, migrated)
    topics = await vocabulary(migrated, workspace)
    crm, erp = [await term(migrated, workspace, topics, slug) for slug in ("crm", "erp")]
    first = await tracked_id(api, workspace, project, editor, "crm software")
    second = await tracked_id(api, workspace, project, editor, "erp software")
    url = project_url(workspace, project, "term-assignments")

    by_ids = await api.post(
        url,
        json={
            "op": "add",
            "subject_type": "tracked_keyword",
            "subject_ids": [first, second],
            "term_ids": [crm, erp],
        },
        headers=editor.headers,
    )
    by_filter = await api.post(
        url,
        json={
            "op": "replace",
            "subject_type": "tracked_keyword",
            "subject_filter": {},
            "term_ids": [erp],
        },
        headers=editor.headers,
    )
    viewer = await member(resources, migrated, workspace, "viewer")
    refused = await api.post(
        url,
        json={
            "op": "remove",
            "subject_type": "tracked_keyword",
            "subject_ids": [first],
            "term_ids": [erp],
        },
        headers=viewer.headers,
    )

    assert _answer(by_ids) == (2, 4, 0)
    assert _answer(by_filter) == (2, 0, 2)
    assert problem(refused) == (403, "forbidden")
    linked = await fetch(
        migrated,
        "SELECT tracked_keyword_id::text AS id, term_id::text AS term "
        "FROM seo.tracked_keyword_terms WHERE tracked_keyword_id = ANY($1)",
        [uuid.UUID(first), uuid.UUID(second)],
    )
    assert sorted((row["id"], row["term"]) for row in linked) == sorted(
        [(first, erp), (second, erp)]
    )
    assert await _entries(migrated, workspace) == []


async def test_prompt_counts_roll_up_and_count_each_prompt_once(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, editor, project = await _scene(resources, migrated)
    topics = await vocabulary(migrated, workspace)
    software = await term(migrated, workspace, topics, "software")
    crm = await term(migrated, workspace, topics, "crm", parent=software)
    erp = await term(migrated, workspace, topics, "erp", parent=software)
    await term(migrated, workspace, topics, "hr")
    both, only_crm, only_root, _untermed = await seed_prompts(migrated, workspace, project, 4)
    # Two terms under `software` and `software` itself: the prompt is one for each of them.
    await _link(migrated, workspace, both, crm, erp, software)
    await _link(migrated, workspace, only_crm, crm)
    await _link(migrated, workspace, only_root, software)
    await execute(migrated, "UPDATE ai.prompts SET is_branded = true WHERE id = $1", only_crm)
    url = f"/api/v1/workspaces/{workspace.id}/vocabularies/{topics}/terms"

    tree = await api.get(url, params={"include": "prompt_count"}, headers=editor.headers)
    flat = await api.get(
        url, params={"include": "prompt_count", "format": "flat"}, headers=editor.headers
    )

    assert tree.status_code == 200, tree.text
    roots = {node["slug"]: node for node in tree.json()["data"]}
    assert roots["software"]["prompt_count"] == 3
    assert {child["slug"]: child["prompt_count"] for child in roots["software"]["children"]} == {
        "crm": 2,
        "erp": 1,
    }
    assert roots["hr"]["prompt_count"] == 0
    assert {node["slug"]: node["prompt_count"] for node in flat.json()["data"]} == {
        "software": 3,
        "crm": 2,
        "erp": 1,
        "hr": 0,
    }


async def test_prompt_counts_leave_out_archived_and_deleted(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, editor, project = await _scene(resources, migrated)
    gone = await ai_project(migrated, workspace)
    topics = await vocabulary(migrated, workspace)
    crm = await term(migrated, workspace, topics, "crm")
    live, archived, deleted = await seed_prompts(migrated, workspace, project, 3)
    (in_gone,) = await seed_prompts(migrated, workspace, gone, 1)
    for prompt_id in (live, archived, deleted, in_gone):
        await _link(migrated, workspace, prompt_id, crm)
    await execute(migrated, "UPDATE ai.prompts SET is_active = false WHERE id = $1", archived)
    await execute(migrated, "UPDATE ai.prompts SET deleted_at = now() WHERE id = $1", deleted)
    url = f"/api/v1/workspaces/{workspace.id}/vocabularies/{topics}/terms"

    before = await api.get(url, params={"include": "prompt_count"}, headers=editor.headers)
    await execute(migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", gone)
    after = await api.get(url, params={"include": "prompt_count"}, headers=editor.headers)

    # The prompt in a project that is not deleted yet counts, so the project is what takes it out.
    assert [node["prompt_count"] for node in before.json()["data"]] == [2]
    assert [node["prompt_count"] for node in after.json()["data"]] == [1]


async def test_prompt_counts_leave_out_projects_the_member_cannot_see(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, owner, project = await _scene(resources, migrated, "owner")
    other = await ai_project(migrated, workspace)
    scoped = await member(resources, migrated, workspace, "editor", project_ids=[project])
    topics = await vocabulary(migrated, workspace)
    software = await term(migrated, workspace, topics, "software")
    crm = await term(migrated, workspace, topics, "crm", parent=software)
    mine, spare = await seed_prompts(migrated, workspace, project, 2)
    theirs, more = await seed_prompts(migrated, workspace, other, 2)
    for prompt_id in (mine, theirs, more):
        await _link(migrated, workspace, prompt_id, crm)
    await _link(migrated, workspace, spare, software)
    url = f"/api/v1/workspaces/{workspace.id}/vocabularies/{topics}/terms"
    params = {"include": "prompt_count", "format": "flat"}

    everything = await api.get(url, params=params, headers=owner.headers)
    visible = await api.get(url, params=params, headers=scoped.headers)

    assert {node["slug"]: node["prompt_count"] for node in everything.json()["data"]} == {
        "software": 4,
        "crm": 3,
    }
    assert {node["slug"]: node["prompt_count"] for node in visible.json()["data"]} == {
        "software": 2,
        "crm": 1,
    }


async def test_prompt_count_costs_one_statement_and_is_absent_unless_asked(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, editor, project = await _scene(resources, migrated)
    topics = await vocabulary(migrated, workspace)
    parent = await term(migrated, workspace, topics, "software")
    children = [await term(migrated, workspace, topics, f"t{n}", parent=parent) for n in range(5)]
    url = f"/api/v1/workspaces/{workspace.id}/vocabularies/{topics}/terms"
    flat = {"include": "prompt_count", "format": "flat"}
    used: list[tuple[int, int, int]] = []
    total = 0
    # The first request of a session reads what the later ones find cached: not counted.
    assert (await api.get(url, headers=editor.headers)).status_code == 200

    for size in (1, 30):
        total += size
        for prompt_id in await seed_prompts(migrated, workspace, project, size):
            await _link(migrated, workspace, prompt_id, *children)
        with statements(resources) as plain_seen:
            plain = await api.get(url, headers=editor.headers)
        with statements(resources) as asked_seen:
            asked = await api.get(url, params={"include": "prompt_count"}, headers=editor.headers)
        with statements(resources) as flat_seen:
            await api.get(url, params=flat, headers=editor.headers)
        used.append(
            (
                len(asked_seen) - len(plain_seen),
                len([sql for sql in asked_seen if "prompt_terms" in sql]),
                len(flat_seen) - len(plain_seen),
            )
        )
        assert plain.status_code == asked.status_code == 200
        assert [node["prompt_count"] for node in asked.json()["data"]] == [total]

    # Absent, not null, unless asked; and the same one statement for 1 prompt and for 31.
    assert "prompt_count" not in json.dumps(plain.json())
    assert used == [(1, 1, 1), (1, 1, 1)]
    bad = await api.get(url, params={"include": "prompt_count,bogus"}, headers=editor.headers)
    assert problem(bad) == (422, "validation_failed")
