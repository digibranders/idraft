"""Whose budgets a caller may see and change (WP-30 T2): the workspace's own, and for a member
limited to some projects those projects' only. Anything else is `404 not_found`, the same answer
as for an id that names nothing."""

from __future__ import annotations

import uuid

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import make_workspace
from tests.api.entities.support import member, problem
from tests.api.keywords.support import keyword_project
from tests.api.operations.cost_support import created, post_budget, stored, url
from tests.conftest import PostgresServer

NOT_FOUND = (404, "not_found")


async def test_another_workspaces_budget_is_not_found_for_patch_and_delete(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    mine = await make_workspace(migrated)
    theirs = await make_workspace(migrated)
    owner = await member(resources, migrated, mine, "owner")
    stranger = await member(resources, migrated, theirs, "owner")
    foreign = await created(api, theirs, stranger.headers, limit_usd="42.00")
    before = await stored(migrated, theirs)

    changed = await api.patch(
        url(mine, "budgets", foreign["budget_id"]),
        json={"limit_usd": "1.00"},
        headers=owner.headers,
    )
    removed = await api.delete(url(mine, "budgets", foreign["budget_id"]), headers=owner.headers)
    nowhere = await api.delete(url(mine, "budgets", uuid.uuid4()), headers=owner.headers)

    assert problem(changed) == problem(removed) == problem(nowhere) == NOT_FOUND
    assert await stored(migrated, theirs) == before
    # The list of one workspace shows nothing of the other.
    assert (await api.get(url(mine, "budgets"), headers=owner.headers)).json()["data"] == []


async def test_a_member_limited_to_a_project_manages_only_its_budgets(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    mine, other = (
        await keyword_project(migrated, workspace),
        await keyword_project(migrated, workspace),
    )
    limited = await member(resources, migrated, workspace, "billing", project_ids=[mine])
    whole = await created(api, workspace, owner.headers, workload="all")
    own = await created(api, workspace, owner.headers, project_id=str(mine), workload="seo_rank")
    elsewhere = await created(api, workspace, owner.headers, project_id=str(other))
    before = {row["id"]: row for row in await stored(migrated, workspace)}

    listed = await api.get(url(workspace, "budgets"), headers=limited.headers)
    filtered = await api.get(
        url(workspace, "budgets"),
        params={"filter[project_id]": str(other)},
        headers=limited.headers,
    )
    status = await api.get(url(workspace, "budgets/status"), headers=limited.headers)
    created_here = await post_budget(
        api, workspace, limited.headers, project_id=str(mine), workload="ai_prompt"
    )
    created_there = await post_budget(
        api, workspace, limited.headers, project_id=str(other), workload="first_party"
    )
    created_whole = await post_budget(api, workspace, limited.headers, workload="first_party")
    refused = [
        await api.patch(
            url(workspace, "budgets", row["budget_id"]),
            json={"limit_usd": "1.00"},
            headers=limited.headers,
        )
        for row in (elsewhere, whole)
    ] + [
        await api.delete(url(workspace, "budgets", row["budget_id"]), headers=limited.headers)
        for row in (elsewhere, whole)
    ]
    patched = await api.patch(
        url(workspace, "budgets", own["budget_id"]),
        json={"limit_usd": "7.00"},
        headers=limited.headers,
    )
    deleted = await api.delete(url(workspace, "budgets", own["budget_id"]), headers=limited.headers)

    # Only the member's project: not another project's budget and not the workspace's.
    assert [row["budget_id"] for row in listed.json()["data"]] == [own["budget_id"]]
    assert listed.json()["page"]["total"] == 1
    assert problem(filtered) == NOT_FOUND
    assert [line["budget"]["budget_id"] for line in status.json()["data"]] == [own["budget_id"]]
    assert created_here.status_code == 201
    assert problem(created_there) == problem(created_whole) == NOT_FOUND
    assert [problem(response) for response in refused] == [NOT_FOUND] * 4
    assert (patched.status_code, deleted.status_code) == (200, 204)
    after = {row["id"]: row for row in await stored(migrated, workspace)}
    # What the member could not reach is as it was.
    for row in (elsewhere, whole):
        assert after[uuid.UUID(row["budget_id"])] == before[uuid.UUID(row["budget_id"])]
    assert uuid.UUID(own["budget_id"]) not in after
