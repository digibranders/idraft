"""Taxonomy routes (docs/19 section 3.5): vocabularies and their terms."""

from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any

import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.auth.support import Workspace, execute, fetch, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.workspaces.support import make_project
from tests.conftest import PostgresServer


def _url(workspace: Workspace, *parts: object) -> str:
    return "/".join([f"/api/v1/workspaces/{workspace.id}", *map(str, parts)])


async def _vocabulary(
    api: httpx.AsyncClient, workspace: Workspace, caller: Caller, **body: Any
) -> dict[str, Any]:
    response = await api.post(
        _url(workspace, "vocabularies"),
        json={
            "kind": "topic",
            "name": f"Topics {uuid.uuid4().hex[:6]}",
            "is_hierarchical": True,
            **body,
        },
        headers=caller.headers,
    )
    assert response.status_code == 201, response.text
    data: dict[str, Any] = response.json()["data"]
    return data


async def _terms(
    api: httpx.AsyncClient, workspace: Workspace, caller: Caller, vocabulary_id: str, body: Any
) -> httpx.Response:
    return await api.post(
        _url(workspace, "vocabularies", vocabulary_id, "terms"), json=body, headers=caller.headers
    )


async def _tree(
    api: httpx.AsyncClient,
    workspace: Workspace,
    caller: Caller,
    vocabulary_id: str,
    **params: str,
) -> list[dict[str, Any]]:
    response = await api.get(
        _url(workspace, "vocabularies", vocabulary_id, "terms"),
        params=params,
        headers=caller.headers,
    )
    assert response.status_code == 200, response.text
    data: list[dict[str, Any]] = response.json()["data"]
    return data


def _shape(nodes: list[dict[str, Any]]) -> list[Any]:
    return [
        (node["path"], _shape(node["children"])) if node["children"] else node["path"]
        for node in nodes
    ]


# Vocabularies.


async def test_vocabularies_are_workspace_wide_or_per_project(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project, other = (
        await make_project(migrated, workspace.id),
        await make_project(migrated, workspace.id),
    )
    shared = await _vocabulary(api, workspace, editor, name="Topics")
    mine = await _vocabulary(
        api, workspace, editor, name="Markets", kind="market", project_id=str(project)
    )
    await _vocabulary(api, workspace, editor, name="Elsewhere", project_id=str(other))

    assert (shared["project_id"], shared["term_count"], shared["is_single_valued"]) == (
        None,
        0,
        False,
    )
    listed = await api.get(
        _url(workspace, "vocabularies"),
        params={"filter[project_id]": str(project)},
        headers=editor.headers,
    )
    body = listed.json()
    assert sorted(v["name"] for v in body["data"]) == ["Markets", "Topics"]
    assert body["page"]["total"] == 2
    kinds = await api.get(
        _url(workspace, "vocabularies"), params={"filter[kind]": "market"}, headers=editor.headers
    )
    assert [v["vocabulary_id"] for v in kinds.json()["data"]] == [mine["vocabulary_id"]]


async def test_a_vocabulary_name_is_unique_in_its_scope_whatever_its_case(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await make_project(migrated, workspace.id)
    await _vocabulary(api, workspace, owner, name="Topics")

    again = await api.post(
        _url(workspace, "vocabularies"),
        json={"kind": "topic", "name": "TOPICS"},
        headers=owner.headers,
    )
    assert problem(again) == (409, "duplicate")
    # The same name on a project, or of another kind, is another vocabulary.
    await _vocabulary(api, workspace, owner, name="Topics", project_id=str(project))
    await _vocabulary(api, workspace, owner, name="Topics", kind="tag")


async def test_a_vocabulary_on_an_unknown_project_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    response = await api.post(
        _url(workspace, "vocabularies"),
        json={"kind": "topic", "name": "Topics", "project_id": str(uuid.uuid4())},
        headers=owner.headers,
    )
    assert response.status_code == 422
    assert response.json()["errors"][0]["code"] == "project_unknown"


async def test_a_vocabulary_is_renamed_made_single_valued_and_deleted_with_its_terms(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    vocabulary = await _vocabulary(api, workspace, owner)
    vocabulary_url = _url(workspace, "vocabularies", vocabulary["vocabulary_id"])
    await _terms(api, workspace, owner, vocabulary["vocabulary_id"], {"items": [{"path": "A/B"}]})

    changed = await api.patch(
        vocabulary_url, json={"name": "Renamed", "is_single_valued": True}, headers=owner.headers
    )
    assert (changed.json()["data"]["name"], changed.json()["data"]["is_single_valued"]) == (
        "Renamed",
        True,
    )
    assert changed.json()["data"]["term_count"] == 2
    assert (await api.delete(vocabulary_url, headers=owner.headers)).status_code == 204
    left = await fetch(
        migrated,
        "SELECT 1 FROM core.taxonomy_terms WHERE vocabulary_id = $1",
        uuid.UUID(vocabulary["vocabulary_id"]),
    )
    assert left == []
    actions = await fetch(
        migrated,
        "SELECT action, before, after FROM ops.audit_logs WHERE workspace_id = $1 ORDER BY id",
        workspace.id,
    )
    assert [row["action"] for row in actions] == [
        "vocabulary.created",
        "term.created",
        "term.created",
        "vocabulary.updated",
        "vocabulary.deleted",
    ]
    assert json.loads(actions[3]["before"]) == {
        "name": vocabulary["name"],
        "is_single_valued": False,
    }
    assert json.loads(actions[3]["after"]) == {"name": "Renamed", "is_single_valued": True}
    assert json.loads(actions[4]["before"])["term_count"] == 2


# Terms.


async def test_terms_are_added_singly_and_listed_as_a_tree_or_flat(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    vocabulary_id = (await _vocabulary(api, workspace, owner))["vocabulary_id"]

    crm = (await _terms(api, workspace, owner, vocabulary_id, {"name": "CRM"})).json()["data"][0]
    child = await _terms(
        api,
        workspace,
        owner,
        vocabulary_id,
        {"name": "CRM for Startups", "parent_id": crm["term_id"], "description": "Small teams"},
    )
    await _terms(api, workspace, owner, vocabulary_id, {"name": "Email marketing"})

    assert (crm["slug"], crm["path"], crm["parent_id"], crm["source"]) == (
        "crm",
        "crm",
        None,
        "manual",
    )
    created = child.json()["data"][0]
    assert (created["slug"], created["path"], created["description"]) == (
        "crm-for-startups",
        "crm/crm-for-startups",
        "Small teams",
    )
    assert _shape(await _tree(api, workspace, owner, vocabulary_id)) == [
        ("crm", ["crm/crm-for-startups"]),
        "email-marketing",
    ]
    flat = await _tree(api, workspace, owner, vocabulary_id, format="flat")
    assert [term["path"] for term in flat] == ["crm", "crm/crm-for-startups", "email-marketing"]
    assert all(term["children"] == [] for term in flat)


async def test_slugs_are_made_from_names_and_unique_among_siblings(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    vocabulary_id = (await _vocabulary(api, workspace, owner))["vocabulary_id"]
    names = ["Caf\N{LATIN SMALL LETTER E WITH ACUTE} & Bars!", "Cafe Bars", "***"]

    slugs = [
        (await _terms(api, workspace, owner, vocabulary_id, {"name": name})).json()["data"][0][
            "slug"
        ]
        for name in names
    ]
    assert slugs == ["cafe-bars", "cafe-bars-2", "term"]
    taken = await _terms(api, workspace, owner, vocabulary_id, {"name": "Other", "slug": "term"})
    assert problem(taken) == (409, "duplicate")


async def test_a_batch_of_paths_creates_the_missing_parents(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    vocabulary_id = (await _vocabulary(api, workspace, owner))["vocabulary_id"]
    await _terms(api, workspace, owner, vocabulary_id, {"name": "CRM"})

    response = await _terms(
        api,
        workspace,
        owner,
        vocabulary_id,
        {
            "items": [
                {"path": "crm / CRM for Startups"},
                {"path": "CRM/CRM for Startups/Free"},
                {"path": "Email"},
                {"name": "Social"},
            ]
        },
    )

    assert response.status_code == 201
    # Only what is new: the existing CRM is matched by name, without case.
    assert [term["path"] for term in response.json()["data"]] == [
        "crm/crm-for-startups",
        "crm/crm-for-startups/free",
        "email",
        "social",
    ]
    too_many = await _terms(
        api, workspace, owner, vocabulary_id, {"items": [{"name": f"t{n}"} for n in range(501)]}
    )
    assert too_many.status_code == 422


async def test_a_flat_vocabulary_takes_no_parents(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    vocabulary_id = (await _vocabulary(api, workspace, owner, is_hierarchical=False))[
        "vocabulary_id"
    ]
    parent = (await _terms(api, workspace, owner, vocabulary_id, {"name": "A"})).json()["data"][0]

    for body in ({"name": "B", "parent_id": parent["term_id"]}, {"items": [{"path": "A/B"}]}):
        response = await _terms(api, workspace, owner, vocabulary_id, body)
        assert response.status_code == 422
        assert response.json()["errors"][0]["code"] == "not_hierarchical"


async def test_a_parent_from_another_vocabulary_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    first = (await _vocabulary(api, workspace, owner))["vocabulary_id"]
    second = (await _vocabulary(api, workspace, owner))["vocabulary_id"]
    parent = (await _terms(api, workspace, owner, first, {"name": "A"})).json()["data"][0]

    response = await _terms(
        api, workspace, owner, second, {"name": "B", "parent_id": parent["term_id"]}
    )

    assert response.status_code == 422
    assert response.json()["errors"][0]["code"] == "parent_unknown"


async def test_a_move_rewrites_the_paths_of_the_whole_subtree(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    vocabulary_id = (await _vocabulary(api, workspace, owner))["vocabulary_id"]
    created = (
        await _terms(
            api,
            workspace,
            owner,
            vocabulary_id,
            {"items": [{"path": "A/B/C"}, {"path": "A/B/D"}, {"path": "X"}]},
        )
    ).json()["data"]
    by_path = {term["path"]: term["term_id"] for term in created}

    moved = await api.patch(
        _url(workspace, "terms", by_path["a/b"]),
        json={"parent_id": by_path["x"], "slug": "bee"},
        headers=owner.headers,
    )

    assert moved.status_code == 200
    assert moved.json()["data"]["path"] == "x/bee"
    flat = await _tree(api, workspace, owner, vocabulary_id, format="flat")
    assert [term["path"] for term in flat] == ["a", "x", "x/bee", "x/bee/c", "x/bee/d"]
    to_root = await api.patch(
        _url(workspace, "terms", by_path["a/b"]), json={"parent_id": None}, headers=owner.headers
    )
    assert to_root.json()["data"]["path"] == "bee"
    (entry, _) = await fetch(
        migrated,
        "SELECT before, after FROM ops.audit_logs WHERE workspace_id = $1 "
        "AND action = 'term.updated' ORDER BY id",
        workspace.id,
    )
    assert json.loads(entry["before"]) == {"parent_id": by_path["a"], "slug": "b", "path": "a/b"}
    assert json.loads(entry["after"]) == {"parent_id": by_path["x"], "slug": "bee", "path": "x/bee"}


async def test_a_moved_term_whose_slug_is_taken_is_numbered_unless_one_is_given(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    vocabulary_id = (await _vocabulary(api, workspace, owner))["vocabulary_id"]
    created = (
        await _terms(
            api,
            workspace,
            owner,
            vocabulary_id,
            {"items": [{"path": "A/C"}, {"path": "B/C++"}, {"path": "B/C++/Templates"}]},
        )
    ).json()["data"]
    by_path = {term["path"]: term["term_id"] for term in created}
    url = _url(workspace, "terms", by_path["b/c"])

    given = await api.patch(
        url, json={"parent_id": by_path["a"], "slug": "c"}, headers=owner.headers
    )
    moved = await api.patch(url, json={"parent_id": by_path["a"]}, headers=owner.headers)

    assert problem(given) == (409, "duplicate")
    assert (moved.json()["data"]["slug"], moved.json()["data"]["path"]) == ("c-2", "a/c-2")
    flat = await _tree(api, workspace, owner, vocabulary_id, format="flat")
    assert [term["path"] for term in flat] == ["a", "a/c", "a/c-2", "a/c-2/templates", "b"]


async def test_a_move_into_its_own_subtree_is_a_cycle(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    vocabulary_id = (await _vocabulary(api, workspace, owner))["vocabulary_id"]
    created = (
        await _terms(api, workspace, owner, vocabulary_id, {"items": [{"path": "A/B"}]})
    ).json()["data"]
    a, b = created[0]["term_id"], created[1]["term_id"]

    for term_id, parent in ((a, b), (a, a)):
        response = await api.patch(
            _url(workspace, "terms", term_id), json={"parent_id": parent}, headers=owner.headers
        )
        assert problem(response) == (422, "cycle_detected")


async def test_a_rename_keeps_the_slug_unless_one_is_given(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    vocabulary_id = (await _vocabulary(api, workspace, owner))["vocabulary_id"]
    created = (
        await _terms(
            api, workspace, owner, vocabulary_id, {"items": [{"path": "A"}, {"path": "B"}]}
        )
    ).json()["data"]

    renamed = await api.patch(
        _url(workspace, "terms", created[0]["term_id"]),
        json={"name": "Alpha", "description": "First"},
        headers=owner.headers,
    )
    clash = await api.patch(
        _url(workspace, "terms", created[0]["term_id"]), json={"slug": "b"}, headers=owner.headers
    )

    assert (renamed.json()["data"]["name"], renamed.json()["data"]["slug"]) == ("Alpha", "a")
    assert problem(clash) == (409, "duplicate")
    cleared = await api.patch(
        _url(workspace, "terms", created[0]["term_id"]),
        json={"description": None},
        headers=owner.headers,
    )
    assert (cleared.json()["data"]["description"], cleared.json()["data"]["path"]) == (None, "a")


async def test_siblings_never_share_a_name_whatever_its_case(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    vocabulary_id = (await _vocabulary(api, workspace, owner))["vocabulary_id"]
    created = (
        await _terms(
            api,
            workspace,
            owner,
            vocabulary_id,
            {
                "items": [
                    {"path": "A/Email"},
                    {"path": "A/Social"},
                    {"path": "Email"},
                    {"path": "Social Media", "slug": "social"},
                ]
            },
        )
    ).json()["data"]
    by_path = {term["path"]: term["term_id"] for term in created}

    added = await _terms(
        api, workspace, owner, vocabulary_id, {"name": "EMAIL", "parent_id": by_path["a"]}
    )
    renamed = await api.patch(
        _url(workspace, "terms", by_path["a/social"]), json={"name": "email"}, headers=owner.headers
    )
    moved = await api.patch(
        _url(workspace, "terms", by_path["email"]),
        json={"parent_id": by_path["a"], "slug": "mail"},
        headers=owner.headers,
    )
    slug_clash = await api.patch(
        _url(workspace, "terms", by_path["a/social"]),
        json={"parent_id": None, "slug": "social"},
        headers=owner.headers,
    )

    # The slug clash is with `Social Media`, whose slug was given.
    for response in (added, renamed, moved, slug_clash):
        assert problem(response) == (409, "duplicate")
    # Renamed under its own parent, a child keeps its place and its slug's path.
    child = await api.patch(
        _url(workspace, "terms", by_path["a/email"]),
        json={"name": "E-mail", "slug": "e-mail"},
        headers=owner.headers,
    )
    assert child.json()["data"]["path"] == "a/e-mail"


async def test_a_change_to_nothing_new_writes_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    vocabulary = await _vocabulary(api, workspace, owner, name="Topics")
    term = (await _terms(api, workspace, owner, vocabulary["vocabulary_id"], {"name": "A"})).json()[
        "data"
    ][0]

    same_vocabulary = await api.patch(
        _url(workspace, "vocabularies", vocabulary["vocabulary_id"]),
        json={"name": "Topics", "is_single_valued": False},
        headers=owner.headers,
    )
    same_term = await api.patch(
        _url(workspace, "terms", term["term_id"]),
        json={"name": "A", "slug": "a", "parent_id": None},
        headers=owner.headers,
    )

    assert same_vocabulary.json()["data"]["name"] == "Topics"
    assert same_term.json()["data"] == term
    actions = await fetch(
        migrated,
        "SELECT action FROM ops.audit_logs WHERE workspace_id = $1 ORDER BY id",
        workspace.id,
    )
    assert [row["action"] for row in actions] == ["vocabulary.created", "term.created"]


async def test_a_vocabulary_renamed_onto_another_is_a_duplicate(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    await _vocabulary(api, workspace, owner, name="Topics")
    other = await _vocabulary(api, workspace, owner, name="Others")

    response = await api.patch(
        _url(workspace, "vocabularies", other["vocabulary_id"]),
        json={"name": "topics"},
        headers=owner.headers,
    )

    assert problem(response) == (409, "duplicate")


async def test_a_move_needs_a_parent_in_a_hierarchical_vocabulary(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    flat_id = (await _vocabulary(api, workspace, owner, is_hierarchical=False))["vocabulary_id"]
    tree_id = (await _vocabulary(api, workspace, owner))["vocabulary_id"]
    flat = (
        await _terms(api, workspace, owner, flat_id, {"items": [{"name": "A"}, {"name": "B"}]})
    ).json()["data"]
    elsewhere = (await _terms(api, workspace, owner, tree_id, {"name": "C"})).json()["data"][0]

    into_flat = await api.patch(
        _url(workspace, "terms", flat[0]["term_id"]),
        json={"parent_id": flat[1]["term_id"]},
        headers=owner.headers,
    )
    across = await api.patch(
        _url(workspace, "terms", elsewhere["term_id"]),
        json={"parent_id": flat[0]["term_id"]},
        headers=owner.headers,
    )

    assert into_flat.status_code == 422
    assert into_flat.json()["errors"][0] == {
        "location": "body",
        "path": "parent_id",
        "code": "not_hierarchical",
        "message": "The vocabulary is flat.",
    }
    assert across.status_code == 422
    assert across.json()["errors"][0]["code"] == "parent_unknown"


async def test_a_term_is_at_most_ten_levels_deep(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    vocabulary_id = (await _vocabulary(api, workspace, owner))["vocabulary_id"]
    deep = "/".join(f"L{level}" for level in range(1, 11))
    created = (
        await _terms(
            api, workspace, owner, vocabulary_id, {"items": [{"path": deep}, {"path": "X/Y"}]}
        )
    ).json()["data"]
    by_path = {term["path"]: term["term_id"] for term in created}
    bottom = "/".join(f"l{level}" for level in range(1, 11))

    too_long = await _terms(api, workspace, owner, vocabulary_id, {"path": deep + "/L11"})
    under_bottom = await _terms(
        api,
        workspace,
        owner,
        vocabulary_id,
        {"items": [{"name": "Z", "parent_id": by_path[bottom]}]},
    )
    moved = await api.patch(
        _url(workspace, "terms", by_path["x"]),
        # Level 9, so X lands on level 10 and Y under it on level 11.
        json={"parent_id": by_path["/".join(f"l{level}" for level in range(1, 10))]},
        headers=owner.headers,
    )

    assert too_long.status_code == 422
    assert too_long.json()["errors"][0]["code"] == "too_deep"
    assert under_bottom.status_code == 422
    assert under_bottom.json()["errors"][0]["path"] == "items.0.parent_id"
    assert under_bottom.json()["errors"][0]["code"] == "too_deep"
    assert moved.status_code == 422
    assert moved.json()["errors"][0]["code"] == "too_deep"


async def test_a_term_with_children_is_deleted_only_with_cascade(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    vocabulary_id = (await _vocabulary(api, workspace, owner))["vocabulary_id"]
    created = (
        await _terms(
            api, workspace, owner, vocabulary_id, {"items": [{"path": "A/B"}, {"path": "C"}]}
        )
    ).json()["data"]
    a, c = created[0]["term_id"], created[2]["term_id"]

    assert problem(await api.delete(_url(workspace, "terms", a), headers=owner.headers)) == (
        409,
        "has_children",
    )
    assert (await api.delete(_url(workspace, "terms", c), headers=owner.headers)).status_code == 204
    cascade = await api.delete(
        _url(workspace, "terms", a), params={"cascade": "true"}, headers=owner.headers
    )
    assert cascade.status_code == 204
    assert await _tree(api, workspace, owner, vocabulary_id) == []
    deleted = await fetch(
        migrated,
        "SELECT target_id, before FROM ops.audit_logs WHERE workspace_id = $1 "
        "AND action = 'term.deleted' ORDER BY id",
        workspace.id,
    )
    assert [(row["target_id"], json.loads(row["before"])["terms_below"]) for row in deleted] == [
        (c, 0),
        (a, 1),
    ]
    assert json.loads(deleted[1]["before"])["path"] == "a"


async def test_paths_are_listed_level_by_level(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """`-` sorts before `/` as text, so plain text order would put `a-b` inside `a`'s subtree."""
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    vocabulary_id = (await _vocabulary(api, workspace, owner))["vocabulary_id"]
    await _terms(
        api,
        workspace,
        owner,
        vocabulary_id,
        {"items": [{"path": "A B"}, {"path": "A0"}, {"path": "A/C"}, {"path": "A/B"}]},
    )

    flat = await _tree(api, workspace, owner, vocabulary_id, format="flat")

    assert [term["path"] for term in flat] == ["a", "a/b", "a/c", "a-b", "a0"]


async def test_names_compare_the_same_composed_or_decomposed(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    vocabulary_id = (await _vocabulary(api, workspace, owner))["vocabulary_id"]
    composed = "Caf\N{LATIN SMALL LETTER E WITH ACUTE}"
    decomposed = "Cafe\N{COMBINING ACUTE ACCENT}"
    await _terms(api, workspace, owner, vocabulary_id, {"name": composed})

    again = await _terms(api, workspace, owner, vocabulary_id, {"name": decomposed})
    reused = await _terms(api, workspace, owner, vocabulary_id, {"path": f"{decomposed}/Menu"})

    assert problem(again) == (409, "duplicate")
    assert [term["path"] for term in reused.json()["data"]] == ["cafe/menu"]


async def test_a_batch_may_create_five_thousand_terms(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """500 paths of 10 new levels: more audit entries than one statement can carry."""
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    vocabulary_id = (await _vocabulary(api, workspace, owner))["vocabulary_id"]
    items = [{"path": "/".join(f"T{item} L{level}" for level in range(10))} for item in range(500)]

    response = await _terms(api, workspace, owner, vocabulary_id, {"items": items})

    assert response.status_code == 201, response.text
    assert len(response.json()["data"]) == 5000
    entries = await fetch(
        migrated,
        "SELECT count(*) AS n FROM ops.audit_logs WHERE workspace_id = $1 "
        "AND action = 'term.created'",
        workspace.id,
    )
    assert entries[0]["n"] == 5000


async def test_two_moves_at_once_cannot_make_a_cycle(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    vocabulary_id = (await _vocabulary(api, workspace, owner))["vocabulary_id"]
    created = (
        await _terms(
            api, workspace, owner, vocabulary_id, {"items": [{"name": "A"}, {"name": "B"}]}
        )
    ).json()["data"]
    a, b = created[0]["term_id"], created[1]["term_id"]

    responses = await asyncio.gather(
        api.patch(_url(workspace, "terms", a), json={"parent_id": b}, headers=owner.headers),
        api.patch(_url(workspace, "terms", b), json={"parent_id": a}, headers=owner.headers),
    )

    assert sorted(response.status_code for response in responses) == [200, 422]
    flat = await _tree(api, workspace, owner, vocabulary_id, format="flat")
    assert sorted(term["path"] for term in flat) in (["a", "a/b"], ["b", "b/a"])


async def test_one_wrong_field_is_one_error_at_its_own_path(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """A body is one term or a batch; only the shape sent is checked."""
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    vocabulary_id = (await _vocabulary(api, workspace, owner))["vocabulary_id"]

    one = await _terms(api, workspace, owner, vocabulary_id, {"name": "A", "slug": "Not A Slug"})
    batch = await _terms(
        api, workspace, owner, vocabulary_id, {"items": [{"name": "A"}, {"name": ""}]}
    )

    assert [(e["path"], e["code"]) for e in one.json()["errors"]] == [
        ("slug", "string_pattern_mismatch")
    ]
    assert [(e["path"], e["code"]) for e in batch.json()["errors"]] == [
        ("items.1.name", "string_too_short")
    ]


async def test_a_text_filter_keeps_the_ancestors_in_the_tree(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    vocabulary_id = (await _vocabulary(api, workspace, owner))["vocabulary_id"]
    await _terms(
        api,
        workspace,
        owner,
        vocabulary_id,
        {"items": [{"path": "CRM/Startups"}, {"path": "CRM/Enterprise"}, {"path": "Email"}]},
    )

    tree = await _tree(api, workspace, owner, vocabulary_id, **{"filter[q]": "start"})
    flat = await _tree(
        api, workspace, owner, vocabulary_id, format="flat", **{"filter[q]": "start"}
    )

    assert _shape(tree) == [("crm", ["crm/startups"])]
    assert [term["path"] for term in flat] == ["crm/startups"]


# Access.


async def test_a_viewer_reads_and_cannot_write(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    viewer = await member(resources, migrated, workspace, "viewer")
    vocabulary_id = (await _vocabulary(api, workspace, owner))["vocabulary_id"]

    assert (
        await api.get(_url(workspace, "vocabularies"), headers=viewer.headers)
    ).status_code == 200
    assert problem(await _terms(api, workspace, viewer, vocabulary_id, {"name": "A"})) == (
        403,
        "forbidden",
    )


@pytest.mark.parametrize("kind", ["shared", "theirs"])
async def test_a_member_limited_to_a_project_works_only_on_its_vocabularies(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, kind: str
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    mine, theirs = (
        await make_project(migrated, workspace.id),
        await make_project(migrated, workspace.id),
    )
    shared = await _vocabulary(api, workspace, owner, name="Shared")
    own = await _vocabulary(api, workspace, owner, name="Own", project_id=str(mine))
    hidden = await _vocabulary(api, workspace, owner, name="Hidden", project_id=str(theirs))
    scoped = await member(resources, migrated, workspace, "editor", project_ids=[mine])

    listed = await api.get(_url(workspace, "vocabularies"), headers=scoped.headers)
    assert sorted(v["name"] for v in listed.json()["data"]) == ["Own", "Shared"]
    assert (
        await _terms(api, workspace, scoped, own["vocabulary_id"], {"name": "A"})
    ).status_code == 201
    if kind == "shared":
        # Shared by every project, so a member limited to some cannot change it.
        response = await _terms(api, workspace, scoped, shared["vocabulary_id"], {"name": "A"})
        assert problem(response) == (403, "forbidden")
        made = await api.post(
            _url(workspace, "vocabularies"),
            json={"kind": "tag", "name": "Mine"},
            headers=scoped.headers,
        )
        assert problem(made) == (403, "forbidden")
    else:
        for response in (
            await api.get(
                _url(workspace, "vocabularies", hidden["vocabulary_id"], "terms"),
                headers=scoped.headers,
            ),
            await _terms(api, workspace, scoped, hidden["vocabulary_id"], {"name": "A"}),
        ):
            assert problem(response) == (404, "not_found")
        made = await api.post(
            _url(workspace, "vocabularies"),
            json={"kind": "tag", "name": "Mine", "project_id": str(theirs)},
            headers=scoped.headers,
        )
        assert made.status_code == 422
        assert made.json()["errors"][0]["code"] == "project_unknown"


async def test_the_vocabularies_of_a_deleted_project_are_gone(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await make_project(migrated, workspace.id)
    vocabulary = await _vocabulary(api, workspace, owner, project_id=str(project))
    await execute(migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", project)

    listed = await api.get(_url(workspace, "vocabularies"), headers=owner.headers)
    terms = await api.get(
        _url(workspace, "vocabularies", vocabulary["vocabulary_id"], "terms"),
        headers=owner.headers,
    )
    made = await api.post(
        _url(workspace, "vocabularies"),
        json={"kind": "tag", "name": "Late", "project_id": str(project)},
        headers=owner.headers,
    )

    assert listed.json()["data"] == []
    assert problem(terms) == (404, "not_found")
    assert made.json()["errors"][0]["code"] == "project_unknown"


async def test_another_workspaces_vocabulary_and_terms_are_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    other = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    theirs_owner = await member(resources, migrated, other, "owner")
    vocabulary_id = (await _vocabulary(api, other, theirs_owner))["vocabulary_id"]
    term_id = (await _terms(api, other, theirs_owner, vocabulary_id, {"name": "A"})).json()["data"][
        0
    ]["term_id"]

    for method, path, body in (
        ("PATCH", _url(workspace, "vocabularies", vocabulary_id), {"name": "Mine"}),
        ("DELETE", _url(workspace, "vocabularies", vocabulary_id), None),
        ("GET", _url(workspace, "vocabularies", vocabulary_id, "terms"), None),
        ("POST", _url(workspace, "vocabularies", vocabulary_id, "terms"), {"name": "B"}),
        ("PATCH", _url(workspace, "terms", term_id), {"name": "B"}),
        ("DELETE", _url(workspace, "terms", term_id), None),
    ):
        response = await api.request(method, path, json=body, headers=owner.headers)
        assert problem(response) == (404, "not_found"), (method, path)
