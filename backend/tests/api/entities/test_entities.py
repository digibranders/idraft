"""Entity routes (docs/19 section 3.4): entities, their aliases and their domains."""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

import httpx
import pytest

from sightline.api.entities.service import EntityFilters
from sightline.api.pagination import encode_cursor
from sightline.api.resources import Resources
from tests.api.auth.support import fetch, make_workspace
from tests.api.entities.support import (
    Caller,
    attach,
    config_version,
    entities_url,
    member,
    problem,
)
from tests.api.workspaces.support import make_project
from tests.conftest import PostgresServer

ACME: dict[str, Any] = {
    "entity_type": "brand",
    "canonical_name": "  Acme ",
    "is_ambiguous": False,
    "disambiguation_hints": ["crm"],
    "aliases": [{"alias": " Acme CRM "}, {"alias": "acme[ -]?crm", "match_mode": "regex"}],
    "domains": [
        {"domain": "https://www.Acme.com/pricing"},
        {"domain": "docs.acme.com", "match_scope": "host"},
        {"domain": "medium.com", "match_scope": "path_prefix", "path_prefix": "@acme/"},
    ],
}


async def _create(
    api: httpx.AsyncClient, workspace: Any, caller: Caller, body: dict[str, Any] | None = None
) -> dict[str, Any]:
    response = await api.post(entities_url(workspace), json=body or ACME, headers=caller.headers)
    assert response.status_code == 201, response.text
    data: dict[str, Any] = response.json()["data"]
    return data


async def _named(api: httpx.AsyncClient, workspace: Any, caller: Caller, name: str) -> str:
    body = {"entity_type": "brand", "canonical_name": name}
    return str((await _create(api, workspace, caller, body))["entity_id"])


async def _audit(pg: PostgresServer, workspace: Any) -> list[str]:
    rows = await fetch(
        pg, "SELECT action FROM ops.audit_logs WHERE workspace_id = $1 ORDER BY id", workspace.id
    )
    return [row["action"] for row in rows]


# Create and read.


async def test_an_editor_creates_an_entity_with_aliases_and_domains(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")

    data = await _create(api, workspace, editor)

    assert data["canonical_name"] == "Acme"
    assert data["alias_count"] == 2
    assert [
        (d["domain"]["host"], d["domain"]["registrable_domain"], d["match_scope"], d["path_prefix"])
        for d in data["domains"]
    ] == [
        # A registrable rule names the registrable domain itself.
        ("acme.com", "acme.com", "registrable", None),
        ("docs.acme.com", "acme.com", "host", None),
        ("medium.com", "medium.com", "path_prefix", "/@acme"),
    ]
    detail = await api.get(entities_url(workspace, data["entity_id"]), headers=editor.headers)
    assert detail.status_code == 200
    body = detail.json()["data"]
    assert [alias["alias"] for alias in body["aliases"]] == ["Acme CRM", "acme[ -]?crm"]
    assert body["aliases"][0]["created_by"]["user_id"] == str(editor.user_id)
    assert body["projects"] == []
    assert body["domains"] == data["domains"]
    assert await _audit(migrated, workspace) == ["entity.created"]


async def test_a_name_is_unique_per_type_whatever_its_case(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    await _named(api, workspace, owner, "HubSpot")

    again = {"entity_type": "brand", "canonical_name": "hubspot"}
    response = await api.post(entities_url(workspace), json=again, headers=owner.headers)
    assert problem(response) == (409, "duplicate")
    # Another type is another entity.
    other = {"entity_type": "organization", "canonical_name": "HubSpot"}
    assert (
        await api.post(entities_url(workspace), json=other, headers=owner.headers)
    ).status_code == 201


async def test_an_alias_or_domain_given_twice_is_a_duplicate(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    twice = {
        "entity_type": "brand",
        "canonical_name": "Acme",
        "aliases": [{"alias": "Acme"}, {"alias": "ACME"}],
    }
    response = await api.post(entities_url(workspace), json=twice, headers=owner.headers)
    assert problem(response) == (409, "duplicate")
    twice = {
        "entity_type": "brand",
        "canonical_name": "Acme",
        "domains": [{"domain": "acme.com"}, {"domain": "https://www.acme.com"}],
    }
    response = await api.post(entities_url(workspace), json=twice, headers=owner.headers)
    assert problem(response) == (409, "duplicate")
    assert await _audit(migrated, workspace) == []


async def test_a_parent_must_exist_in_the_workspace(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    other = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    theirs = await _named(api, other, await member(resources, migrated, other, "owner"), "Theirs")

    for parent in (theirs, str(uuid.uuid4())):
        body = {"entity_type": "product", "canonical_name": "Cloud", "parent_entity_id": parent}
        response = await api.post(entities_url(workspace), json=body, headers=owner.headers)
        assert response.status_code == 422
        assert response.json()["errors"][0]["code"] == "parent_unknown"


# List.


async def test_the_list_is_by_name_and_pages_by_cursor(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    for name in ("delta", "Alpha", "charlie", "Bravo", "echo"):
        await _named(api, workspace, owner, name)

    seen: list[str] = []
    params: dict[str, Any] = {"limit": 2}
    while True:
        response = await api.get(entities_url(workspace), params=params, headers=owner.headers)
        assert response.status_code == 200
        body = response.json()
        seen += [row["canonical_name"] for row in body["data"]]
        assert body["page"]["limit"] == 2
        if not body["page"]["has_more"]:
            assert body["page"]["next_cursor"] is None
            break
        params = {"limit": 2, "cursor": body["page"]["next_cursor"]}
    assert seen == ["Alpha", "Bravo", "charlie", "delta", "echo"]


async def test_paging_misses_no_name_postgresql_lowers_differently_and_ties_go_by_id(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Python lowers U+0130 to `i` and a combining dot; PostgreSQL to `i`. A cursor made from
    the first would skip `istanbul`."""
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    names = [
        ("brand", "\N{LATIN CAPITAL LETTER I WITH DOT ABOVE}stanbul"),
        ("organization", "istanbul"),
        ("brand", "Same"),
        ("organization", "Same"),
        ("brand", "Zeta"),
    ]
    for entity_type, name in names:
        await _create(api, workspace, owner, {"entity_type": entity_type, "canonical_name": name})

    seen: list[tuple[str, str]] = []
    params: dict[str, Any] = {"limit": 1}
    while True:
        body = (await api.get(entities_url(workspace), params=params, headers=owner.headers)).json()
        seen += [(row["entity_type"], row["canonical_name"]) for row in body["data"]]
        if not body["page"]["has_more"]:
            break
        params = {"limit": 1, "cursor": body["page"]["next_cursor"]}
    assert sorted(seen) == sorted(names)


async def test_a_cursor_only_works_with_its_own_filters(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    for name in ("a", "b"):
        await _named(api, workspace, owner, name)
    first = await api.get(entities_url(workspace), params={"limit": 1}, headers=owner.headers)
    cursor = first.json()["page"]["next_cursor"]

    # Made with the right filters but a key this list never writes.
    scope = EntityFilters(entity_type=None, q=None, project_id=None, role=None).scope()
    for params in (
        {"cursor": cursor, "filter[entity_type]": "brand"},
        {"cursor": "not-a-cursor"},
        {"cursor": encode_cursor(["a"], scope=scope)},
        {"cursor": encode_cursor(["a", 1], scope=scope)},
        {"cursor": encode_cursor(["a", "not-a-uuid"], scope=scope)},
    ):
        response = await api.get(entities_url(workspace), params=params, headers=owner.headers)
        assert problem(response) == (400, "invalid_cursor")


async def test_the_list_filters_by_type_text_project_and_role(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await make_project(migrated, workspace.id)
    acme = (await _create(api, workspace, owner))["entity_id"]
    rival = await _named(api, workspace, owner, "Rival")
    gone = await _named(api, workspace, owner, "Gone")
    cloud = str(
        (
            await _create(
                api, workspace, owner, {"entity_type": "product", "canonical_name": "Cloud 100%"}
            )
        )["entity_id"]
    )
    await attach(migrated, workspace, project, acme, "own")
    await attach(migrated, workspace, project, rival, "competitor")
    await attach(migrated, workspace, project, gone, "competitor", removed=True)

    async def names(params: dict[str, str]) -> list[str]:
        response = await api.get(entities_url(workspace), params=params, headers=owner.headers)
        assert response.status_code == 200, response.text
        return [row["canonical_name"] for row in response.json()["data"]]

    assert await names({"filter[entity_type]": "product"}) == ["Cloud 100%"]
    # Names and aliases match, without case; % is a character, not a wildcard.
    assert await names({"filter[q]": "acme crm"}) == ["Acme"]
    assert await names({"filter[q]": "0%"}) == ["Cloud 100%"]
    assert await names({"filter[q]": "_"}) == []
    nul = await api.get(
        entities_url(workspace), params={"filter[q]": "a\x00"}, headers=owner.headers
    )
    assert nul.status_code == 422
    # A removed role does not count.
    assert await names({"filter[project_id]": str(project)}) == ["Acme", "Rival"]
    assert await names({"filter[role]": "competitor"}) == ["Rival"]
    assert await names({"filter[project_id]": str(project), "filter[role]": "own"}) == ["Acme"]
    assert cloud


# Change.


async def test_an_editor_changes_an_entity_and_the_projects_naming_it_are_bumped(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    naming, removed, unrelated_id = [await make_project(migrated, workspace.id) for _ in range(3)]
    entity_id = await _named(api, workspace, editor, "Acme")
    await attach(migrated, workspace, naming, entity_id)
    await attach(migrated, workspace, removed, entity_id, removed=True)

    response = await api.patch(
        entities_url(workspace, entity_id),
        json={"canonical_name": "Acme Inc", "is_ambiguous": True, "description": "CRM"},
        headers=editor.headers,
    )

    assert response.status_code == 200
    assert response.json()["data"]["canonical_name"] == "Acme Inc"
    rows = await fetch(
        migrated,
        "SELECT id, entity_config_version FROM core.projects WHERE workspace_id = $1",
        workspace.id,
    )
    versions = {row["id"]: row["entity_config_version"] for row in rows}
    assert versions[unrelated_id] == 1
    assert sorted(versions.values()) == [1, 2, 2]
    assert await _audit(migrated, workspace) == ["entity.created", "entity.updated"]

    # The same values again change nothing, log nothing and bump nothing.
    same = await api.patch(
        entities_url(workspace, entity_id),
        json={"canonical_name": "Acme Inc"},
        headers=editor.headers,
    )
    assert same.status_code == 200
    assert await _audit(migrated, workspace) == ["entity.created", "entity.updated"]
    assert await config_version(migrated, unrelated_id) == 1


@pytest.mark.parametrize(
    "write",
    [
        "update entity",
        "add alias",
        "update alias",
        "delete alias",
        "add domain",
        "delete domain",
    ],
)
async def test_every_write_bumps_the_projects_naming_the_entity_and_no_others(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, write: str
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    naming, removed, unrelated = [await make_project(migrated, workspace.id) for _ in range(3)]
    created = await _create(api, workspace, owner)
    entity_id = created["entity_id"]
    await attach(migrated, workspace, naming, entity_id)
    await attach(migrated, workspace, removed, entity_id, removed=True)
    detail = (await api.get(entities_url(workspace, entity_id), headers=owner.headers)).json()
    alias_id = detail["data"]["aliases"][0]["alias_id"]
    domain_id = detail["data"]["domains"][0]["entity_domain_id"]
    method, path, body = {
        "update entity": ("PATCH", entities_url(workspace, entity_id), {"description": "x"}),
        "add alias": ("POST", entities_url(workspace, entity_id, "aliases"), {"alias": "New"}),
        "update alias": (
            "PATCH",
            entities_url(workspace, entity_id, "aliases", alias_id),
            {"alias": "Changed"},
        ),
        "delete alias": ("DELETE", entities_url(workspace, entity_id, "aliases", alias_id), None),
        "add domain": (
            "POST",
            entities_url(workspace, entity_id, "domains"),
            {"domain": "new.example"},
        ),
        "delete domain": (
            "DELETE",
            entities_url(workspace, entity_id, "domains", domain_id),
            None,
        ),
    }[write]

    response = await api.request(method, path, json=body, headers=owner.headers)

    assert response.status_code < 300, response.text
    assert [
        await config_version(migrated, project) for project in (naming, removed, unrelated)
    ] == [2, 2, 1]


async def test_a_parent_cannot_make_a_cycle(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    brand = await _named(api, workspace, owner, "Brand")
    product = str(
        (
            await _create(
                api,
                workspace,
                owner,
                {"entity_type": "product", "canonical_name": "Product", "parent_entity_id": brand},
            )
        )["entity_id"]
    )

    for entity_id, parent in ((brand, product), (brand, brand)):
        response = await api.patch(
            entities_url(workspace, entity_id),
            json={"parent_entity_id": parent},
            headers=owner.headers,
        )
        assert problem(response) == (422, "cycle_detected")
    cleared = await api.patch(
        entities_url(workspace, product), json={"parent_entity_id": None}, headers=owner.headers
    )
    assert cleared.json()["data"]["parent_entity_id"] is None
    other = await _named(api, workspace, owner, "Other brand")
    moved = await api.patch(
        entities_url(workspace, product),
        json={"parent_entity_id": other, "disambiguation_hints": ["crm", "sales"]},
        headers=owner.headers,
    )
    assert moved.json()["data"]["parent_entity_id"] == other
    rows = await fetch(
        migrated,
        "SELECT after::text FROM ops.audit_logs WHERE workspace_id = $1 AND action = "
        "'entity.updated' ORDER BY id DESC LIMIT 1",
        workspace.id,
    )
    assert '"disambiguation_hints": ["crm", "sales"]' in rows[0]["after"]


async def test_a_parent_change_to_an_unknown_entity_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    entity_id = await _named(api, workspace, owner, "Acme")
    response = await api.patch(
        entities_url(workspace, entity_id),
        json={"parent_entity_id": str(uuid.uuid4())},
        headers=owner.headers,
    )
    assert response.status_code == 422
    assert response.json()["errors"][0]["code"] == "parent_unknown"


async def test_two_parent_changes_at_once_cannot_write_a_cycle(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    first = await _named(api, workspace, owner, "First")
    second = await _named(api, workspace, owner, "Second")

    responses = await asyncio.gather(
        api.patch(
            entities_url(workspace, first), json={"parent_entity_id": second}, headers=owner.headers
        ),
        api.patch(
            entities_url(workspace, second), json={"parent_entity_id": first}, headers=owner.headers
        ),
    )

    assert sorted(response.status_code for response in responses) == [200, 422]
    rows = await fetch(
        migrated,
        "SELECT count(*) AS n FROM core.entities WHERE workspace_id = $1 "
        "AND parent_entity_id IS NOT NULL",
        workspace.id,
    )
    assert rows[0]["n"] == 1


async def test_a_change_to_a_taken_name_is_a_duplicate(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    await _named(api, workspace, owner, "One")
    two = await _named(api, workspace, owner, "Two")
    response = await api.patch(
        entities_url(workspace, two), json={"canonical_name": "ONE"}, headers=owner.headers
    )
    assert problem(response) == (409, "duplicate")


# Delete.


async def test_an_entity_no_project_has_named_is_deleted_with_its_aliases_and_domains(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    entity_id = (await _create(api, workspace, owner))["entity_id"]

    response = await api.delete(entities_url(workspace, entity_id), headers=owner.headers)

    assert response.status_code == 204
    assert (
        await api.get(entities_url(workspace, entity_id), headers=owner.headers)
    ).status_code == 404
    left = await fetch(
        migrated, "SELECT 1 FROM core.entity_aliases WHERE entity_id = $1", uuid.UUID(entity_id)
    )
    assert left == []
    assert await _audit(migrated, workspace) == ["entity.created", "entity.deleted"]


async def test_an_entity_a_project_named_or_with_products_is_in_use(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await make_project(migrated, workspace.id)
    named = await _named(api, workspace, owner, "Named")
    await attach(migrated, workspace, project, named, removed=True)
    brand = await _named(api, workspace, owner, "Brand")
    await _create(
        api,
        workspace,
        owner,
        {"entity_type": "product", "canonical_name": "Product", "parent_entity_id": brand},
    )

    for entity_id in (named, brand):
        response = await api.delete(entities_url(workspace, entity_id), headers=owner.headers)
        assert problem(response) == (409, "entity_in_use")


# Aliases.


async def test_aliases_are_added_singly_or_in_batches_and_listed(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await make_project(migrated, workspace.id)
    entity_id = await _named(api, workspace, owner, "Acme")
    await attach(migrated, workspace, project, entity_id)
    url = entities_url(workspace, entity_id, "aliases")

    one = await api.post(url, json={"alias": "Acme Inc"}, headers=owner.headers)
    batch = await api.post(
        url,
        json={"items": [{"alias": f"acme {index}"} for index in range(199)]},
        headers=owner.headers,
    )
    too_many = await api.post(
        url,
        json={"items": [{"alias": f"x {index}"} for index in range(201)]},
        headers=owner.headers,
    )

    assert one.status_code == 201
    assert [alias["alias"] for alias in one.json()["data"]] == ["Acme Inc"]
    assert batch.status_code == 201
    assert len(batch.json()["data"]) == 199
    assert too_many.status_code == 422
    listed = await api.get(url, headers=owner.headers)
    assert len(listed.json()["data"]) == 200
    assert await config_version(migrated, project) == 3


async def test_an_alias_that_ignores_case_is_a_duplicate_in_any_case(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    url = entities_url(workspace, await _named(api, workspace, owner, "Acme"), "aliases")
    await api.post(url, json={"alias": "HubSpot"}, headers=owner.headers)
    response = await api.post(url, json={"alias": "hubspot"}, headers=owner.headers)
    assert problem(response) == (409, "duplicate")


async def test_a_pattern_re2_cannot_run_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    url = entities_url(workspace, await _named(api, workspace, owner, "Acme"), "aliases")
    response = await api.post(
        url, json={"alias": "(a)\\1", "match_mode": "regex"}, headers=owner.headers
    )
    assert response.status_code == 422
    assert response.json()["errors"][0]["code"] == "invalid_regex"


async def test_an_alias_change_is_checked_on_its_result(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Ignoring case makes `[a-z]{400}` too large a program; the stored mode decides too."""
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    url = entities_url(workspace, await _named(api, workspace, owner, "Acme"), "aliases")
    created = await api.post(
        url,
        json={"alias": "[a-z]{400}", "match_mode": "regex", "case_sensitive": True},
        headers=owner.headers,
    )
    alias_id = created.json()["data"][0]["alias_id"]

    flipped = await api.patch(
        f"{url}/{alias_id}", json={"case_sensitive": False}, headers=owner.headers
    )
    assert flipped.status_code == 422
    assert flipped.json()["errors"][0]["code"] == "invalid_regex"
    # Back to a word alias, the spaces around it go.
    word = await api.patch(
        f"{url}/{alias_id}",
        json={"alias": " Acme ", "match_mode": "word_boundary"},
        headers=owner.headers,
    )
    assert word.status_code == 200
    assert word.json()["data"]["alias"] == "Acme"
    assert word.json()["data"]["match_mode"] == "word_boundary"


async def test_an_alias_change_to_nothing_new_writes_nothing_and_a_taken_one_is_a_duplicate(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    url = entities_url(workspace, await _named(api, workspace, owner, "Acme"), "aliases")
    batch = await api.post(
        url, json={"items": [{"alias": "Acme"}, {"alias": "Acme Inc"}]}, headers=owner.headers
    )
    first, second = (alias["alias_id"] for alias in batch.json()["data"])

    same = await api.patch(f"{url}/{first}", json={"alias": " Acme "}, headers=owner.headers)
    taken = await api.patch(f"{url}/{second}", json={"alias": "acme"}, headers=owner.headers)
    missing = await api.patch(f"{url}/{uuid.uuid4()}", json={"alias": "x"}, headers=owner.headers)

    assert same.status_code == 200
    assert problem(taken) == (409, "duplicate")
    assert problem(missing) == (404, "not_found")
    assert "entity_alias.updated" not in await _audit(migrated, workspace)


async def test_an_alias_is_removed(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    url = entities_url(workspace, await _named(api, workspace, owner, "Acme"), "aliases")
    alias_id = (await api.post(url, json={"alias": "Acme"}, headers=owner.headers)).json()["data"][
        0
    ]["alias_id"]

    assert (await api.delete(f"{url}/{alias_id}", headers=owner.headers)).status_code == 204
    assert problem(await api.delete(f"{url}/{alias_id}", headers=owner.headers)) == (
        404,
        "not_found",
    )
    assert await _audit(migrated, workspace) == [
        "entity.created",
        "entity_alias.created",
        "entity_alias.deleted",
    ]


# Domains.


async def test_a_domain_is_canonicalized_and_removed_by_its_own_id(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    entity_id = await _named(api, workspace, owner, "Acme")
    url = entities_url(workspace, entity_id, "domains")

    first = await api.post(
        url,
        json={"domain": "GitHub.com", "match_scope": "path_prefix", "path_prefix": "/acme/"},
        headers=owner.headers,
    )
    second = await api.post(
        url,
        json={"domain": "github.com", "match_scope": "path_prefix", "path_prefix": "/acme-labs"},
        headers=owner.headers,
    )
    again = await api.post(
        url,
        json={
            "domain": "https://github.com/x",
            "match_scope": "path_prefix",
            "path_prefix": "acme",
        },
        headers=owner.headers,
    )

    assert first.status_code == second.status_code == 201
    assert first.json()["data"]["path_prefix"] == "/acme"
    assert first.json()["meta"] == {"warnings": []}
    assert problem(again) == (409, "duplicate")
    entity_domain_id = first.json()["data"]["entity_domain_id"]
    assert (await api.delete(f"{url}/{entity_domain_id}", headers=owner.headers)).status_code == 204
    gone = await api.delete(f"{url}/{entity_domain_id}", headers=owner.headers)
    assert problem(gone) == (404, "not_found")
    listed = await api.get(url, headers=owner.headers)
    assert [d["path_prefix"] for d in listed.json()["data"]] == ["/acme-labs"]


async def test_another_entitys_domain_cannot_be_removed_through_this_one(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    mine = await _named(api, workspace, owner, "Mine")
    theirs = (await _create(api, workspace, owner))["entity_id"]
    their_domain = (
        await api.get(entities_url(workspace, theirs, "domains"), headers=owner.headers)
    ).json()["data"][0]["entity_domain_id"]

    response = await api.delete(
        entities_url(workspace, mine, "domains", their_domain), headers=owner.headers
    )

    assert problem(response) == (404, "not_found")
    kept = await api.get(entities_url(workspace, theirs, "domains"), headers=owner.headers)
    assert their_domain in [d["entity_domain_id"] for d in kept.json()["data"]]


async def test_a_domain_another_entity_of_a_shared_project_claims_is_a_warning(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await make_project(migrated, workspace.id)
    acme = (await _create(api, workspace, owner))["entity_id"]
    rival = await _named(api, workspace, owner, "Rival")
    await attach(migrated, workspace, project, acme, "own")
    await attach(migrated, workspace, project, rival, "competitor")
    url = entities_url(workspace, rival, "domains")

    clash = await api.post(url, json={"domain": "acme.com"}, headers=owner.headers)
    fine = await api.post(url, json={"domain": "rival.com"}, headers=owner.headers)

    assert clash.json()["meta"] == {"warnings": ["domain_role_conflict"]}
    assert fine.json()["meta"] == {"warnings": []}


# Access.


async def test_another_workspaces_entity_is_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    other = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    theirs = await _named(api, other, await member(resources, migrated, other, "owner"), "Theirs")

    for method, path, body in (
        ("GET", entities_url(workspace, theirs), None),
        ("PATCH", entities_url(workspace, theirs), {"canonical_name": "Mine"}),
        ("DELETE", entities_url(workspace, theirs), None),
        ("GET", entities_url(workspace, theirs, "aliases"), None),
        ("POST", entities_url(workspace, theirs, "aliases"), {"alias": "x"}),
        ("POST", entities_url(workspace, theirs, "domains"), {"domain": "x.com"}),
        ("DELETE", entities_url(workspace, theirs, "domains", uuid.uuid4()), None),
    ):
        response = await api.request(method, path, json=body, headers=owner.headers)
        assert problem(response) == (404, "not_found"), (method, path)


async def test_a_viewer_reads_and_cannot_write_and_billing_cannot_read(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    viewer = await member(resources, migrated, workspace, "viewer")
    billing = await member(resources, migrated, workspace, "billing")
    entity_id = await _named(api, workspace, owner, "Acme")

    assert (
        await api.get(entities_url(workspace, entity_id), headers=viewer.headers)
    ).status_code == 200
    write = await api.post(entities_url(workspace), json=ACME, headers=viewer.headers)
    assert problem(write) == (403, "forbidden")
    read = await api.get(entities_url(workspace), headers=billing.headers)
    assert problem(read) == (403, "forbidden")


async def test_a_member_limited_to_some_projects_sees_only_their_entities(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    mine, theirs = (
        await make_project(migrated, workspace.id),
        await make_project(migrated, workspace.id),
    )
    shown = await _named(api, workspace, owner, "Shown")
    hidden = await _named(api, workspace, owner, "Hidden")
    await _named(api, workspace, owner, "Unnamed")
    await attach(migrated, workspace, mine, shown)
    await attach(migrated, workspace, theirs, hidden)
    await attach(migrated, workspace, theirs, shown)
    scoped = await member(resources, migrated, workspace, "editor", project_ids=[mine])

    listed = await api.get(entities_url(workspace), headers=scoped.headers)
    assert [row["canonical_name"] for row in listed.json()["data"]] == ["Shown"]
    detail = await api.get(entities_url(workspace, shown), headers=scoped.headers)
    assert [role["project_id"] for role in detail.json()["data"]["projects"]] == [str(mine)]
    assert problem(await api.get(entities_url(workspace, hidden), headers=scoped.headers)) == (
        404,
        "not_found",
    )
    other_project = await api.get(
        entities_url(workspace), params={"filter[project_id]": str(theirs)}, headers=scoped.headers
    )
    assert other_project.json()["data"] == []
    # A role counts only in the member's own projects, even for an entity the member sees.
    await attach(
        migrated, workspace, theirs, await _named(api, workspace, owner, "Watched"), "watch"
    )
    both = await _named(api, workspace, owner, "Both")
    await attach(migrated, workspace, mine, both, "competitor")
    await attach(migrated, workspace, theirs, both, "watch")
    by_role = await api.get(
        entities_url(workspace), params={"filter[role]": "watch"}, headers=scoped.headers
    )
    assert by_role.json()["data"] == []
    # A shared entity cannot be changed by someone who sees only some of its projects.
    change = await api.patch(
        entities_url(workspace, shown), json={"canonical_name": "Mine"}, headers=scoped.headers
    )
    assert problem(change) == (403, "forbidden")
