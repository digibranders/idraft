"""Keyword groups (docs/19 section 3.6.2)."""

from __future__ import annotations

import uuid
from typing import Any

import httpx

from sightline.api.resources import Resources
from tests.api.auth.support import Workspace, fetch, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.keywords.support import errors, keyword_project, project_url, tracked_id
from tests.conftest import PostgresServer


async def _owner(resources: Resources, pg: PostgresServer) -> tuple[Workspace, uuid.UUID, Caller]:
    workspace = await make_workspace(pg)
    owner = await member(resources, pg, workspace, "owner")
    return workspace, await keyword_project(pg, workspace), owner


async def _create(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: uuid.UUID,
    caller: Caller,
    name: str,
    parent: str | None = None,
) -> httpx.Response:
    body: dict[str, Any] = {"name": name}
    if parent is not None:
        body["parent_id"] = parent
    return await api.post(
        project_url(workspace, project, "keyword-groups"), json=body, headers=caller.headers
    )


async def _group(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: uuid.UUID,
    caller: Caller,
    name: str,
    parent: str | None = None,
) -> str:
    response = await _create(api, workspace, project, caller, name, parent)
    assert response.status_code == 201, response.text
    group_id: str = response.json()["data"]["group_id"]
    return group_id


async def _members(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: uuid.UUID,
    caller: Caller,
    group_id: str,
    ids: list[str],
    *,
    remove: bool = False,
) -> httpx.Response:
    parts = ("keyword-groups", group_id, "members", *(("remove",) if remove else ()))
    return await api.post(
        project_url(workspace, project, *parts),
        json={"tracked_keyword_ids": ids},
        headers=caller.headers,
    )


def _flat(response: httpx.Response) -> dict[str, tuple[str, int]]:
    assert response.status_code == 200, response.text
    return {g["name"]: (g["path"], g["keyword_count"]) for g in response.json()["data"]}


async def test_groups_nest_and_count_the_keywords_in_them_and_under_them(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    product = await _group(api, workspace, project, owner, "Product")
    pricing = await _group(api, workspace, project, owner, "Pricing", parent=product)
    await _group(api, workspace, project, owner, "Blog")
    crm = await tracked_id(api, workspace, project, owner, "crm", group_ids=[pricing])
    await tracked_id(api, workspace, project, owner, "erp", group_ids=[product, pricing])
    archived = await tracked_id(api, workspace, project, owner, "hr", group_ids=[pricing])
    await api.patch(
        project_url(workspace, project, "tracked-keywords", archived),
        json={"is_active": False},
        headers=owner.headers,
    )
    deleted = await tracked_id(api, workspace, project, owner, "pos", group_ids=[product])
    await api.delete(
        project_url(workspace, project, "tracked-keywords", deleted), headers=owner.headers
    )

    flat = await api.get(
        project_url(workspace, project, "keyword-groups"),
        params={"format": "flat"},
        headers=owner.headers,
    )
    tree = await api.get(project_url(workspace, project, "keyword-groups"), headers=owner.headers)

    # Each keyword once, archived and deleted ones left out.
    assert _flat(flat) == {
        "Blog": ("Blog", 0),
        "Product": ("Product", 2),
        "Pricing": ("Product/Pricing", 2),
    }
    roots = tree.json()["data"]
    assert [(g["name"], [c["name"] for c in g["children"]]) for g in roots] == [
        ("Blog", []),
        ("Product", ["Pricing"]),
    ]
    assert roots[1]["children"][0]["parent_id"] == product
    assert crm


async def test_a_name_is_unique_among_siblings_whatever_its_case(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    product = await _group(api, workspace, project, owner, "Product")
    await _group(api, workspace, project, owner, "Pricing", parent=product)

    taken = await _create(api, workspace, project, owner, "PRICING", parent=product)
    root = await _create(api, workspace, project, owner, "pricing")
    slash = await _create(api, workspace, project, owner, "a/b")

    assert problem(taken) == (409, "duplicate")
    assert root.status_code == 201
    assert slash.status_code == 422
    assert errors(slash) == [("name", "slash_not_allowed")]


async def test_a_parent_must_be_a_group_of_the_project(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    other = await keyword_project(migrated, workspace)
    foreign = await _group(api, workspace, other, owner, "Elsewhere")

    response = await _create(api, workspace, project, owner, "Child", parent=foreign)

    assert response.status_code == 422
    assert errors(response) == [("parent_id", "group_unknown")]


async def test_a_rename_or_move_rewrites_the_subtree_and_refuses_a_cycle(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    product = await _group(api, workspace, project, owner, "Product")
    pricing = await _group(api, workspace, project, owner, "Pricing", parent=product)
    plans = await _group(api, workspace, project, owner, "Plans", parent=pricing)
    blog = await _group(api, workspace, project, owner, "Blog")

    def url(group_id: str) -> str:
        return project_url(workspace, project, "keyword-groups", group_id)

    renamed = await api.patch(url(product), json={"name": "Products"}, headers=owner.headers)
    moved = await api.patch(url(pricing), json={"parent_id": blog}, headers=owner.headers)
    cycle = await api.patch(url(blog), json={"parent_id": plans}, headers=owner.headers)
    itself = await api.patch(url(blog), json={"parent_id": blog}, headers=owner.headers)
    rooted = await api.patch(url(plans), json={"parent_id": None}, headers=owner.headers)
    flat = await api.get(
        project_url(workspace, project, "keyword-groups"),
        params={"format": "flat"},
        headers=owner.headers,
    )

    assert renamed.json()["data"]["path"] == "Products"
    assert moved.json()["data"]["path"] == "Blog/Pricing"
    assert problem(cycle) == (422, "cycle_detected")
    assert problem(itself) == (422, "cycle_detected")
    assert rooted.json()["data"] == {**rooted.json()["data"], "parent_id": None, "path": "Plans"}
    assert {name: path for name, (path, _) in _flat(flat).items()} == {
        "Blog": "Blog",
        "Plans": "Plans",
        "Pricing": "Blog/Pricing",
        "Products": "Products",
    }
    audited = await fetch(
        migrated,
        "SELECT action FROM ops.audit_logs WHERE workspace_id = $1 "
        "AND action LIKE 'keyword_group.%' ORDER BY id",
        workspace.id,
    )
    assert [row["action"] for row in audited] == ["keyword_group.created"] * 4 + [
        "keyword_group.updated"
    ] * 3


async def test_deleting_a_group_takes_its_subgroups_and_unlinks_its_keywords(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    product = await _group(api, workspace, project, owner, "Product")
    pricing = await _group(api, workspace, project, owner, "Pricing", parent=product)
    created = await tracked_id(api, workspace, project, owner, "crm", group_ids=[pricing])

    response = await api.delete(
        project_url(workspace, project, "keyword-groups", product), headers=owner.headers
    )
    again = await api.delete(
        project_url(workspace, project, "keyword-groups", product), headers=owner.headers
    )

    assert response.status_code == 204
    assert problem(again) == (404, "not_found")
    groups = await fetch(
        migrated, "SELECT id FROM seo.keyword_groups WHERE project_id = $1", project
    )
    assert groups == []
    kept = await fetch(
        migrated,
        "SELECT deleted_at FROM seo.tracked_keywords WHERE id = $1",
        uuid.UUID(created),
    )
    assert kept[0]["deleted_at"] is None


async def test_members_are_added_and_removed_within_the_project(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    other = await keyword_project(migrated, workspace)
    pricing = await _group(api, workspace, project, owner, "Pricing")
    crm = await tracked_id(api, workspace, project, owner, "crm")
    erp = await tracked_id(api, workspace, project, owner, "erp")
    foreign = await tracked_id(api, workspace, other, owner, "hr")

    added = await _members(api, workspace, project, owner, pricing, [crm, erp, foreign])
    again = await _members(api, workspace, project, owner, pricing, [crm])
    removed = await _members(api, workspace, project, owner, pricing, [crm, foreign], remove=True)

    assert added.json()["data"] == {"added": 2}
    assert again.json()["data"] == {"added": 0}
    assert removed.json()["data"] == {"removed": 1}
    members = await fetch(
        migrated,
        "SELECT tracked_keyword_id::text AS id FROM seo.keyword_group_members WHERE group_id = $1",
        uuid.UUID(pricing),
    )
    assert [row["id"] for row in members] == [erp]


async def test_a_viewer_reads_and_another_projects_group_is_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    other = await keyword_project(migrated, workspace)
    foreign = await _group(api, workspace, other, owner, "Elsewhere")
    viewer = await member(resources, migrated, workspace, "viewer")

    listed = await api.get(
        project_url(workspace, project, "keyword-groups"), headers=viewer.headers
    )
    refused = await _create(api, workspace, project, viewer, "Mine")
    hidden = await api.patch(
        project_url(workspace, project, "keyword-groups", foreign),
        json={"name": "Taken"},
        headers=owner.headers,
    )

    assert listed.status_code == 200
    assert problem(refused) == (403, "forbidden")
    assert problem(hidden) == (404, "not_found")
