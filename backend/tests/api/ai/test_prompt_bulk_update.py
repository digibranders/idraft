"""Changing the metadata of many prompts at once (contract C1, BE-PROMPTS-07, PD-N09, CF-12):
selection by ids or by the list's filters, `set` and the terms to add and remove in one
transaction, one summary audit entry and one entry per changed prompt."""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any

import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.ai.sources_support import statements
from tests.api.ai.support import added, ai_project, seed_prompts
from tests.api.auth.support import Workspace, execute, fetch, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.keywords.support import errors, project_url, term, vocabulary
from tests.conftest import PostgresServer

INVALID = (422, "validation_failed")


async def _bulk(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: uuid.UUID,
    caller: Caller,
    body: dict[str, Any],
) -> httpx.Response:
    return await api.post(
        project_url(workspace, project, "prompts", "bulk-update"),
        json=body,
        headers=caller.headers,
    )


def _ids(ids: list[uuid.UUID]) -> list[str]:
    return [str(prompt_id) for prompt_id in ids]


async def _scene(
    resources: Resources, migrated: PostgresServer, role: str = "editor"
) -> tuple[Workspace, Caller, uuid.UUID]:
    workspace = await make_workspace(migrated)
    caller = await member(resources, migrated, workspace, role)
    return workspace, caller, await ai_project(migrated, workspace)


async def _rows(pg: PostgresServer, ids: list[uuid.UUID]) -> dict[uuid.UUID, dict[str, Any]]:
    rows = await fetch(
        pg,
        "SELECT id, intent, funnel_stage, prompt_type, prompt_type_source, importance, "
        "is_branded, is_branded_source, is_active, updated_at FROM ai.prompts "
        "WHERE id = ANY($1)",
        ids,
    )
    return {row["id"]: dict(row) for row in rows}


async def _terms(pg: PostgresServer, ids: list[uuid.UUID]) -> dict[uuid.UUID, set[str]]:
    rows = await fetch(
        pg, "SELECT prompt_id, term_id FROM ai.prompt_terms WHERE prompt_id = ANY($1)", ids
    )
    held: dict[uuid.UUID, set[str]] = {prompt_id: set() for prompt_id in ids}
    for row in rows:
        held[row["prompt_id"]].add(str(row["term_id"]))
    return held


async def _link(
    pg: PostgresServer, workspace: Workspace, prompt_id: uuid.UUID, *term_ids: str
) -> None:
    for term_id in term_ids:
        await execute(
            pg,
            "INSERT INTO ai.prompt_terms (prompt_id, term_id, workspace_id) VALUES ($1, $2, $3)",
            prompt_id,
            uuid.UUID(term_id),
            workspace.id,
        )


async def _entries(pg: PostgresServer, workspace: Workspace) -> list[dict[str, Any]]:
    rows = await fetch(
        pg,
        "SELECT action, target_type, target_id, before, after FROM ops.audit_logs "
        "WHERE workspace_id = $1 AND action LIKE 'prompt.%' ORDER BY action, target_id",
        workspace.id,
    )
    return [
        {
            "action": row["action"],
            "target_type": row["target_type"],
            "target_id": row["target_id"],
            "before": None if row["before"] is None else json.loads(row["before"]),
            "after": json.loads(row["after"]),
        }
        for row in rows
    ]


async def test_bulk_update_sets_metadata_and_counts_matched_and_updated(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, editor, project = await _scene(resources, migrated)
    first, second, third = await seed_prompts(migrated, workspace, project, 3)
    await execute(
        migrated,
        "UPDATE ai.prompts SET importance = 5, funnel_stage = 'bofu' WHERE id = $1",
        third,
    )
    before = await _rows(migrated, [first, second, third])

    response = await _bulk(
        api,
        workspace,
        project,
        editor,
        {
            "ids": _ids([first, second, third, uuid.uuid4()]),
            "set": {"importance": 5, "funnel_stage": "bofu"},
        },
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"data": {"matched": 3, "updated": 2}}
    after = await _rows(migrated, [first, second, third])
    for prompt_id in (first, second, third):
        assert (after[prompt_id]["importance"], after[prompt_id]["funnel_stage"]) == (5, "bofu")
        assert after[prompt_id]["intent"] == "unknown"
    assert after[first]["updated_at"] > before[first]["updated_at"]
    assert after[second]["updated_at"] > before[second]["updated_at"]
    assert after[third]["updated_at"] == before[third]["updated_at"]


async def test_bulk_update_adds_and_removes_terms(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, editor, project = await _scene(resources, migrated)
    topics = await vocabulary(migrated, workspace)
    crm, erp, hr = [await term(migrated, workspace, topics, slug) for slug in ("crm", "erp", "hr")]
    first, second, third = await seed_prompts(migrated, workspace, project, 3)
    await _link(migrated, workspace, first, crm, erp)
    await _link(migrated, workspace, second, erp)
    await _link(migrated, workspace, third, hr)
    before = await _rows(migrated, [first, second, third])

    response = await _bulk(
        api,
        workspace,
        project,
        editor,
        {"ids": _ids([first, second, third]), "add_term_ids": [hr], "remove_term_ids": [crm]},
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"data": {"matched": 3, "updated": 2}}
    assert await _terms(migrated, [first, second, third]) == {
        first: {erp, hr},
        second: {erp, hr},
        third: {hr},
    }
    after = await _rows(migrated, [first, second, third])
    assert after[first]["updated_at"] > before[first]["updated_at"]
    assert after[second]["updated_at"] > before[second]["updated_at"]
    assert after[third]["updated_at"] == before[third]["updated_at"]
    assigned = await fetch(
        migrated,
        "SELECT assigned_by FROM ai.prompt_terms WHERE prompt_id = ANY($1) AND term_id = $2",
        [first, second],
        uuid.UUID(hr),
    )
    assert [row["assigned_by"] for row in assigned] == ["manual", "manual"]


async def test_an_added_single_valued_term_replaces_the_other(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, editor, project = await _scene(resources, migrated)
    stages = await vocabulary(migrated, workspace, single=True)
    topics = await vocabulary(migrated, workspace)
    early, late = (
        await term(migrated, workspace, stages, "early"),
        await term(migrated, workspace, stages, "late"),
    )
    crm = await term(migrated, workspace, topics, "crm")
    first, second, third = await seed_prompts(migrated, workspace, project, 3)
    await _link(migrated, workspace, first, early, crm)
    await _link(migrated, workspace, third, late)

    response = await _bulk(
        api,
        workspace,
        project,
        editor,
        {"ids": _ids([first, second, third]), "add_term_ids": [late]},
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"data": {"matched": 3, "updated": 2}}
    assert await _terms(migrated, [first, second, third]) == {
        first: {late, crm},
        second: {late},
        third: {late},
    }


async def test_bulk_update_by_filter_changes_what_the_list_would_show(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, editor, project = await _scene(resources, migrated)
    low = await added(api, workspace, project, editor, "Low?", importance=1)
    lower = await added(api, workspace, project, editor, "Lower?", importance=2)
    resting = await added(api, workspace, project, editor, "Resting?", importance=1)
    high = await added(api, workspace, project, editor, "High?", importance=4)
    await execute(
        migrated, "UPDATE ai.prompts SET is_active = false WHERE id = $1", uuid.UUID(resting)
    )
    url = project_url(workspace, project, "prompts")
    would_show = await api.get(
        url,
        params={"filter[importance_in]": "1,2", "filter[is_active]": "any"},
        headers=editor.headers,
    )

    everything = await _bulk(
        api,
        workspace,
        project,
        editor,
        {"filter": {"importance_in": [1, 2]}, "set": {"funnel_stage": "bofu"}},
    )
    active_only = await _bulk(
        api,
        workspace,
        project,
        editor,
        {"filter": {"importance_in": [1, 2], "is_active": True}, "set": {"intent": "commercial"}},
    )

    assert everything.json() == {"data": {"matched": 3, "updated": 3}}
    assert active_only.json() == {"data": {"matched": 2, "updated": 2}}
    shown = {row["prompt_id"] for row in would_show.json()["data"]}
    assert shown == {low, lower, resting}
    rows = await _rows(
        migrated, [uuid.UUID(prompt_id) for prompt_id in (low, lower, resting, high)]
    )
    assert {str(prompt_id): row["funnel_stage"] for prompt_id, row in rows.items()} == {
        low: "bofu",
        lower: "bofu",
        resting: "bofu",
        high: "unknown",
    }
    assert {str(prompt_id): row["intent"] for prompt_id, row in rows.items()} == {
        low: "commercial",
        lower: "commercial",
        resting: "unknown",
        high: "unknown",
    }


async def test_bulk_update_leaves_another_projects_prompts_alone(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, editor, project = await _scene(resources, migrated)
    other = await ai_project(migrated, workspace)
    topics = await vocabulary(migrated, workspace)
    crm = await term(migrated, workspace, topics, "crm")
    (mine,) = await seed_prompts(migrated, workspace, project, 1)
    (theirs,) = await seed_prompts(migrated, workspace, other, 1)
    before = (await _rows(migrated, [theirs]))[theirs]

    by_ids = await _bulk(
        api,
        workspace,
        project,
        editor,
        {"ids": _ids([mine, theirs]), "set": {"importance": 1}, "add_term_ids": [crm]},
    )
    by_filter = await _bulk(
        api,
        workspace,
        project,
        editor,
        {"filter": {"importance_in": [3, 1]}, "set": {"funnel_stage": "bofu"}},
    )

    assert by_ids.json() == {"data": {"matched": 1, "updated": 1}}
    assert by_filter.json() == {"data": {"matched": 1, "updated": 1}}
    assert (await _rows(migrated, [theirs]))[theirs] == before
    assert await _terms(migrated, [mine, theirs]) == {mine: {crm}, theirs: set()}


async def test_bulk_update_ignores_another_workspaces_ids(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, editor, project = await _scene(resources, migrated)
    stranger = await make_workspace(migrated)
    foreign_project = await ai_project(migrated, stranger)
    (theirs,) = await seed_prompts(migrated, stranger, foreign_project, 1)
    before = (await _rows(migrated, [theirs]))[theirs]

    response = await _bulk(
        api,
        workspace,
        project,
        editor,
        {"ids": _ids([theirs]), "set": {"importance": 1, "prompt_type": "other"}},
    )

    assert response.json() == {"data": {"matched": 0, "updated": 0}}
    assert (await _rows(migrated, [theirs]))[theirs] == before


async def test_bulk_update_term_unknown_and_single_valued_are_422(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, editor, project = await _scene(resources, migrated)
    stranger = await make_workspace(migrated)
    stages = await vocabulary(migrated, workspace, single=True)
    early, late = (
        await term(migrated, workspace, stages, "early"),
        await term(migrated, workspace, stages, "late"),
    )
    foreign = await term(migrated, stranger, await vocabulary(migrated, stranger), "crm")
    (prompt,) = await seed_prompts(migrated, workspace, project, 1)
    base = {"ids": _ids([prompt]), "set": {"importance": 1}}

    unknown_add = await _bulk(
        api, workspace, project, editor, {**base, "add_term_ids": [str(uuid.uuid4())]}
    )
    foreign_add = await _bulk(api, workspace, project, editor, {**base, "add_term_ids": [foreign]})
    unknown_remove = await _bulk(
        api, workspace, project, editor, {**base, "remove_term_ids": [str(uuid.uuid4())]}
    )
    two_of_one = await _bulk(
        api, workspace, project, editor, {**base, "add_term_ids": [early, late]}
    )

    assert all(
        response.status_code == INVALID[0]
        for response in (unknown_add, foreign_add, unknown_remove, two_of_one)
    )
    assert errors(unknown_add) == errors(foreign_add) == [("add_term_ids", "term_unknown")]
    assert errors(unknown_remove) == [("remove_term_ids", "term_unknown")]
    assert errors(two_of_one) == [("add_term_ids", "single_valued_vocabulary")]
    assert (await _rows(migrated, [prompt]))[prompt]["importance"] == 3
    assert await _entries(migrated, workspace) == []


async def test_bulk_update_writes_one_summary_and_one_entry_per_changed_prompt(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, editor, project = await _scene(resources, migrated)
    topics = await vocabulary(migrated, workspace)
    crm = await term(migrated, workspace, topics, "crm")
    first, second, third = await seed_prompts(migrated, workspace, project, 3)
    await execute(
        migrated,
        "UPDATE ai.prompts SET importance = 5, prompt_type = 'comparison' WHERE id = $1",
        third,
    )
    await _link(migrated, workspace, third, crm)

    response = await _bulk(
        api,
        workspace,
        project,
        editor,
        {
            "ids": _ids([first, second, third]),
            "set": {"importance": 5, "prompt_type": "comparison"},
            "add_term_ids": [crm],
        },
    )

    assert response.json() == {"data": {"matched": 3, "updated": 2}}
    entries = await _entries(migrated, workspace)
    assert [entry for entry in entries if entry["action"] == "prompt.bulk_changed"] == [
        {
            "action": "prompt.bulk_changed",
            "target_type": "project",
            "target_id": str(project),
            "before": None,
            "after": {
                "importance": 5,
                "prompt_type": "comparison",
                "add_term_ids": [crm],
                "matched": 3,
                "changed": 2,
            },
        }
    ]
    changed = [entry for entry in entries if entry["action"] == "prompt.updated"]
    assert sorted(entry["target_id"] for entry in changed) == sorted([str(first), str(second)])
    assert all(entry["target_type"] == "prompt" for entry in changed)
    assert all(
        entry["after"] == {"importance": 5, "prompt_type": "comparison", "bulk": True}
        for entry in changed
    )
    assert len(entries) == 3


async def test_bulk_update_marks_type_and_branded_as_set_by_a_person(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, editor, project = await _scene(resources, migrated)
    typed, branded, plain = await seed_prompts(migrated, workspace, project, 3)
    await execute(
        migrated,
        "UPDATE ai.prompts SET prompt_type_source = 'rule', is_branded_source = 'computed' "
        "WHERE id = ANY($1)",
        [typed, branded, plain],
    )

    by_type = await _bulk(
        api, workspace, project, editor, {"ids": _ids([typed]), "set": {"prompt_type": "other"}}
    )
    by_flag = await _bulk(
        api, workspace, project, editor, {"ids": _ids([branded]), "set": {"is_branded": True}}
    )
    by_importance = await _bulk(
        api, workspace, project, editor, {"ids": _ids([plain]), "set": {"importance": 1}}
    )

    assert by_type.json() == by_flag.json() == by_importance.json()
    rows = await _rows(migrated, [typed, branded, plain])
    assert (rows[typed]["prompt_type"], rows[typed]["prompt_type_source"]) == ("other", "person")
    assert (rows[typed]["is_branded"], rows[typed]["is_branded_source"]) == (False, "computed")
    assert (rows[branded]["is_branded"], rows[branded]["is_branded_source"]) == (True, "override")
    assert (rows[branded]["prompt_type"], rows[branded]["prompt_type_source"]) == (
        "question",
        "rule",
    )
    assert (rows[plain]["prompt_type_source"], rows[plain]["is_branded_source"]) == (
        "rule",
        "computed",
    )


async def test_a_filter_over_1000_prompts_is_too_many_subjects(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, editor, project = await _scene(resources, migrated)
    ids = await seed_prompts(migrated, workspace, project, 1001)
    await execute(migrated, "UPDATE ai.prompts SET importance = 4 WHERE id = $1", ids[-1])

    with statements(resources) as seen:
        update = await _bulk(
            api, workspace, project, editor, {"filter": {}, "set": {"funnel_stage": "bofu"}}
        )
    archive = await api.post(
        project_url(workspace, project, "prompts", "bulk-archive"),
        json={"filter": {}, "archive": True},
        headers=editor.headers,
    )
    untouched = await fetch(
        migrated,
        "SELECT count(*) AS n FROM ai.prompts WHERE project_id = $1 "
        "AND funnel_stage = 'unknown' AND is_active",
        project,
    )
    exactly = await _bulk(
        api,
        workspace,
        project,
        editor,
        {"filter": {"importance_in": [3]}, "set": {"funnel_stage": "bofu"}},
    )

    # The selection never locks more than one row past the cap.
    (locking,) = [sql for sql in seen if "FOR NO KEY UPDATE" in sql]
    assert " LIMIT " in locking
    assert problem(update) == problem(archive) == (422, "too_many_subjects")
    assert update.json()["limit"] == archive.json()["limit"] == 1000
    assert untouched[0]["n"] == 1001
    assert exactly.status_code == 200, exactly.text
    assert exactly.json() == {"data": {"matched": 1000, "updated": 1000}}


async def test_bulk_update_statement_count_is_constant(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    counts: dict[str, list[int]] = {"ids": [], "filter": []}
    for size in (1, 50):
        workspace, editor, project = await _scene(resources, migrated)
        topics = await vocabulary(migrated, workspace, single=True)
        old, new = (
            await term(migrated, workspace, topics, "old"),
            await term(migrated, workspace, topics, "new"),
        )
        ids = await seed_prompts(migrated, workspace, project, size)
        for prompt_id in ids:
            await _link(migrated, workspace, prompt_id, old)
        # By ids only the terms change (the rows are touched); by filter the values change too,
        # and the terms swap back.
        shapes: dict[str, tuple[dict[str, Any], int, str, str]] = {
            "ids": ({"ids": _ids(ids)}, 3, new, old),
            "filter": ({"filter": {"importance_in": [3]}}, 2, old, new),
        }
        for shape, (selection, importance, add, remove) in shapes.items():
            body = {
                **selection,
                "set": {"importance": importance},
                "add_term_ids": [add],
                "remove_term_ids": [remove],
            }
            with statements(resources) as seen:
                response = await _bulk(api, workspace, project, editor, body)
            assert response.json() == {"data": {"matched": size, "updated": size}}, response.text
            counts[shape].append(len(seen))

    assert counts["ids"][0] == counts["ids"][1], counts
    assert counts["filter"][0] == counts["filter"][1], counts


@pytest.mark.parametrize("role", ["viewer", "analyst"])
async def test_bulk_update_viewer_403_foreign_project_404(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, role: str
) -> None:
    workspace, reader, project = await _scene(resources, migrated, role)
    editor = await member(resources, migrated, workspace, "editor")
    stranger = await make_workspace(migrated)
    outsider = await member(resources, migrated, stranger, "owner")
    foreign = await ai_project(migrated, stranger)
    deleted = await ai_project(migrated, workspace)
    await execute(migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", deleted)
    (prompt,) = await seed_prompts(migrated, workspace, project, 1)
    body = {"ids": _ids([prompt]), "set": {"importance": 1}}

    refused = await _bulk(api, workspace, project, reader, body)
    elsewhere = await _bulk(api, workspace, foreign, editor, body)
    nobody = await _bulk(api, workspace, project, outsider, body)
    gone = await _bulk(api, workspace, deleted, editor, body)
    empty = await _bulk(api, workspace, project, editor, {"ids": _ids([prompt])})

    assert problem(refused) == (403, "forbidden")
    assert problem(elsewhere) == problem(nobody) == problem(gone) == (404, "not_found")
    assert problem(empty) == INVALID
    assert "nothing_to_change" in [error["code"] for error in empty.json()["errors"]]
    assert (await _rows(migrated, [prompt]))[prompt]["importance"] == 3


async def test_updated_at_moves_forward_only_for_changed_prompts(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, editor, project = await _scene(resources, migrated)
    (prompt,) = await seed_prompts(migrated, workspace, project, 1)
    before: datetime = (await _rows(migrated, [prompt]))[prompt]["updated_at"]

    same = await _bulk(
        api, workspace, project, editor, {"ids": _ids([prompt]), "set": {"importance": 3}}
    )

    assert same.json() == {"data": {"matched": 1, "updated": 0}}
    assert (await _rows(migrated, [prompt]))[prompt]["updated_at"] == before
    entries = await _entries(migrated, workspace)
    assert [entry["action"] for entry in entries] == ["prompt.bulk_changed"]
    assert entries[0]["after"] == {"importance": 3, "matched": 1, "changed": 0}
