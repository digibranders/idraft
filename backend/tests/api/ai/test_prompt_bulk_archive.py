"""Archiving and bringing back many prompts at once (plan D2 Task 6; docs/19 section 3.7.1):
as `DELETE` and `PATCH is_active` do one, in one transaction, bringing back within the active
prompt quota."""

from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any

import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.ai.support import ai_project, seed_prompts, set_prompt_quota
from tests.api.auth.support import Workspace, execute, fetch, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.keywords.support import project_url
from tests.conftest import PostgresServer
from tests.db.support import connection


async def _bulk(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: uuid.UUID,
    caller: Caller,
    ids: list[uuid.UUID],
    *,
    archive: bool,
) -> httpx.Response:
    return await api.post(
        project_url(workspace, project, "prompts", "bulk-archive"),
        json={"ids": [str(prompt_id) for prompt_id in ids], "archive": archive},
        headers=caller.headers,
    )


async def _active(pg: PostgresServer, ids: list[uuid.UUID]) -> dict[uuid.UUID, bool]:
    rows = await fetch(pg, "SELECT id, is_active FROM ai.prompts WHERE id = ANY($1)", ids)
    return {row["id"]: row["is_active"] for row in rows}


async def _archive_directly(pg: PostgresServer, ids: list[uuid.UUID]) -> None:
    await execute(pg, "UPDATE ai.prompts SET is_active = false WHERE id = ANY($1)", ids)


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


async def test_archiving_matches_the_projects_prompts_and_changes_the_active_ones(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    first, second, third = await seed_prompts(migrated, workspace, project, 3)
    await _archive_directly(migrated, [third])

    response = await _bulk(
        api, workspace, project, editor, [first, second, third, uuid.uuid4()], archive=True
    )
    listed = await api.get(project_url(workspace, project, "prompts"), headers=editor.headers)

    assert response.status_code == 200, response.text
    assert response.json() == {"data": {"matched": 3, "updated": 2}}
    assert await _active(migrated, [first, second, third]) == {
        first: False,
        second: False,
        third: False,
    }
    assert listed.json()["data"] == []
    entries = await _entries(migrated, workspace)
    assert [entry for entry in entries if entry["action"] == "prompt.bulk_changed"] == [
        {
            "action": "prompt.bulk_changed",
            "target_type": "project",
            "target_id": str(project),
            "before": None,
            "after": {"is_active": False, "matched": 3, "changed": 2},
        }
    ]
    archived = [entry for entry in entries if entry["action"] == "prompt.archived"]
    assert sorted(entry["target_id"] for entry in archived) == sorted([str(first), str(second)])
    before, after = {"is_active": True}, {"is_active": False, "bulk": True}
    assert all((entry["before"], entry["after"]) == (before, after) for entry in archived)


async def test_bringing_back_counts_against_the_quota_all_or_none(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    active, back, other = await seed_prompts(migrated, workspace, project, 3)
    await _archive_directly(migrated, [back, other])
    await set_prompt_quota(migrated, workspace, 2)

    over = await _bulk(api, workspace, project, editor, [back, other], archive=False)
    fits = await _bulk(api, workspace, project, editor, [back], archive=False)

    assert problem(over) == (422, "quota_exceeded")
    assert (over.json()["limit"], over.json()["used"], over.json()["requested"]) == (2, 1, 2)
    assert fits.json() == {"data": {"matched": 1, "updated": 1}}
    assert await _active(migrated, [active, back, other]) == {
        active: True,
        back: True,
        other: False,
    }
    (updated,) = [e for e in await _entries(migrated, workspace) if e["action"] == "prompt.updated"]
    assert (updated["target_id"], updated["before"], updated["after"]) == (
        str(back),
        {"is_active": False},
        {"is_active": True, "bulk": True},
    )


async def test_two_requests_cannot_both_take_the_last_place(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    ids = await seed_prompts(migrated, workspace, project, 6)
    await _archive_directly(migrated, ids)
    await set_prompt_quota(migrated, workspace, 1)

    responses = await asyncio.gather(
        *(_bulk(api, workspace, project, editor, [prompt], archive=False) for prompt in ids)
    )

    assert sorted(response.status_code for response in responses) == [200] + [422] * 5
    assert sum((await _active(migrated, ids)).values()) == 1


async def test_bringing_back_waits_for_the_workspace_prompt_lock(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Deterministic: with the lock held on a side connection the request must not finish, and
    it completes once the lock is released (the six-request test above can pass by timing,
    with a pool of two connections)."""
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    (prompt,) = await seed_prompts(migrated, workspace, project, 1)
    await _archive_directly(migrated, [prompt])

    async with connection(migrated) as side:
        async with side.transaction():
            await side.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", f"prompts:{workspace.id}"
            )
            request = asyncio.create_task(
                _bulk(api, workspace, project, editor, [prompt], archive=False)
            )
            finished, _ = await asyncio.wait({request}, timeout=1.5)
            was_blocked = not finished
        response = await asyncio.wait_for(request, timeout=15)

    assert was_blocked
    assert response.json() == {"data": {"matched": 1, "updated": 1}}
    assert await _active(migrated, [prompt]) == {prompt: True}


async def test_bringing_back_counts_prompts_of_an_archived_project_in_the_quota(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    resting = await ai_project(migrated, workspace)
    await seed_prompts(migrated, workspace, resting, 1)
    await execute(migrated, "UPDATE core.projects SET status = 'archived' WHERE id = $1", resting)
    back, other = await seed_prompts(migrated, workspace, project, 2)
    await _archive_directly(migrated, [back, other])
    await set_prompt_quota(migrated, workspace, 2)

    over = await _bulk(api, workspace, project, editor, [back, other], archive=False)
    fits = await _bulk(api, workspace, project, editor, [back], archive=False)

    assert problem(over) == (422, "quota_exceeded")
    assert (over.json()["limit"], over.json()["used"], over.json()["requested"]) == (2, 1, 2)
    assert fits.json() == {"data": {"matched": 1, "updated": 1}}
    assert await _active(migrated, [back, other]) == {back: True, other: False}


async def test_a_deleted_prompt_is_not_matched_and_is_not_brought_back(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    kept, gone = await seed_prompts(migrated, workspace, project, 2)
    await _archive_directly(migrated, [kept, gone])
    await execute(migrated, "UPDATE ai.prompts SET deleted_at = now() WHERE id = $1", gone)

    response = await _bulk(api, workspace, project, editor, [kept, gone], archive=False)

    assert response.json() == {"data": {"matched": 1, "updated": 1}}
    assert await _active(migrated, [kept, gone]) == {kept: True, gone: False}
    (row,) = await fetch(migrated, "SELECT deleted_at FROM ai.prompts WHERE id = $1", gone)
    assert row["deleted_at"] is not None
    updated = [e for e in await _entries(migrated, workspace) if e["action"] == "prompt.updated"]
    assert [entry["target_id"] for entry in updated] == [str(kept)]


async def test_exactly_a_thousand_ids_are_accepted_and_a_thousand_and_one_are_not(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    (prompt,) = await seed_prompts(migrated, workspace, project, 1)
    unknown = [uuid.uuid4() for _ in range(1000)]

    accepted = await _bulk(api, workspace, project, editor, [prompt, *unknown[:999]], archive=True)
    refused = await _bulk(api, workspace, project, editor, [prompt, *unknown], archive=True)

    assert accepted.status_code == 200, accepted.text
    assert accepted.json() == {"data": {"matched": 1, "updated": 1}}
    assert problem(refused) == (422, "validation_failed")


async def test_an_id_named_several_times_counts_once(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    (prompt,) = await seed_prompts(migrated, workspace, project, 1)

    response = await _bulk(api, workspace, project, editor, [prompt, prompt, prompt], archive=True)

    assert response.json() == {"data": {"matched": 1, "updated": 1}}
    archived = [e for e in await _entries(migrated, workspace) if e["action"] == "prompt.archived"]
    assert [entry["target_id"] for entry in archived] == [str(prompt)]


async def test_repeating_a_request_changes_nothing_and_adds_one_summary_entry(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    ids = await seed_prompts(migrated, workspace, project, 2)

    first = await _bulk(api, workspace, project, editor, ids, archive=True)
    after_first = [entry["action"] for entry in await _entries(migrated, workspace)]
    second = await _bulk(api, workspace, project, editor, ids, archive=True)
    after_second = [entry["action"] for entry in await _entries(migrated, workspace)]

    assert first.json() == {"data": {"matched": 2, "updated": 2}}
    assert second.json() == {"data": {"matched": 2, "updated": 0}}
    assert sorted(after_first) == ["prompt.archived"] * 2 + ["prompt.bulk_changed"]
    assert sorted(after_second) == ["prompt.archived"] * 2 + ["prompt.bulk_changed"] * 2


async def test_a_prompt_already_in_that_state_changes_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    (prompt,) = await seed_prompts(migrated, workspace, project, 1)

    response = await _bulk(api, workspace, project, editor, [prompt], archive=False)

    assert response.json() == {"data": {"matched": 1, "updated": 0}}
    actions = [entry["action"] for entry in await _entries(migrated, workspace)]
    assert actions == ["prompt.bulk_changed"]


async def test_another_projects_prompt_is_not_matched(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    other = await ai_project(migrated, workspace)
    (theirs,) = await seed_prompts(migrated, workspace, other, 1)

    response = await _bulk(api, workspace, project, editor, [theirs], archive=True)

    assert response.json() == {"data": {"matched": 0, "updated": 0}}
    assert await _active(migrated, [theirs]) == {theirs: True}


@pytest.mark.parametrize("role", ["viewer", "analyst"])
async def test_only_a_prompt_writer_archives_prompts(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, role: str
) -> None:
    workspace = await make_workspace(migrated)
    caller = await member(resources, migrated, workspace, role)
    project = await ai_project(migrated, workspace)
    (prompt,) = await seed_prompts(migrated, workspace, project, 1)

    response = await _bulk(api, workspace, project, caller, [prompt], archive=True)

    assert problem(response) == (403, "forbidden")
    assert await _active(migrated, [prompt]) == {prompt: True}


async def test_a_deleted_project_and_a_bad_body_are_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await ai_project(migrated, workspace)
    (prompt,) = await seed_prompts(migrated, workspace, project, 1)
    url = project_url(workspace, project, "prompts", "bulk-archive")

    too_many = await _bulk(
        api, workspace, project, editor, [uuid.uuid4() for _ in range(1001)], archive=True
    )
    empty = await _bulk(api, workspace, project, editor, [], archive=True)
    no_flag = await api.post(url, json={"ids": [str(prompt)]}, headers=editor.headers)
    await execute(migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", project)
    deleted = await _bulk(api, workspace, project, editor, [prompt], archive=True)

    assert problem(too_many) == problem(empty) == problem(no_flag) == (422, "validation_failed")
    assert problem(deleted) == (404, "not_found")
