"""A project's primary domain, default location and own entity (docs/19 section 3.3)."""

from __future__ import annotations

import json
import uuid
from typing import Any

import httpx
import pytest

from sightline.api.resources import Resources
from tests.api.auth.support import Workspace, execute, fetch, make_workspace
from tests.api.entities.support import Caller, entities_url, member, problem
from tests.conftest import PostgresServer

ACTIVE = 2147480001
INACTIVE = 2147480002


@pytest.fixture
async def located(migrated: PostgresServer) -> None:
    await execute(
        migrated,
        "INSERT INTO core.locations (id, name, country_iso, location_type, is_active) "
        "VALUES ($1, 'Austin,Texas,United States', 'US', 'City', true), "
        "($2, 'Gone', 'US', 'City', false) ON CONFLICT (id) DO NOTHING",
        ACTIVE,
        INACTIVE,
    )


def _projects(workspace: Workspace) -> str:
    return f"/api/v1/workspaces/{workspace.id}/projects"


async def _create(
    api: httpx.AsyncClient, workspace: Workspace, caller: Caller, **fields: Any
) -> httpx.Response:
    body = {"name": "Site", "slug": f"site-{uuid.uuid4().hex[:8]}", **fields}
    return await api.post(_projects(workspace), json=body, headers=caller.headers)


@pytest.mark.usefixtures("located")
async def test_a_project_names_its_primary_domain_and_default_location(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")

    response = await _create(
        api,
        workspace,
        owner,
        primary_domain="https://www.Fynix.digital/x",
        default_location_id=ACTIVE,
    )

    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert data["primary_domain"]["host"] == "www.fynix.digital"
    assert data["primary_domain"]["registrable_domain"] == "fynix.digital"
    assert data["default_location"] == {
        "location_id": ACTIVE,
        "name": "Austin,Texas,United States",
        "country_iso": "US",
        "location_type": "City",
    }
    assert data["entity_config_version"] == 1


@pytest.mark.usefixtures("located")
@pytest.mark.parametrize("location_id", [INACTIVE, 2147480999])
async def test_a_location_that_is_not_listed_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, location_id: int
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    response = await _create(api, workspace, owner, default_location_id=location_id)
    assert response.status_code == 422
    assert response.json()["errors"][0]["code"] == "location_unknown"


async def test_a_project_is_created_with_its_own_brand(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")

    response = await _create(
        api,
        workspace,
        owner,
        own_entity={
            "canonical_name": "Fynix",
            "aliases": ["fynix", "Fynix Digital", "FYNIX DIGITAL"],
            "domains": ["https://www.fynix.digital/", "fynix.io", "fynix.digital"],
        },
    )

    assert response.status_code == 201, response.text
    project = response.json()["data"]
    assert project["entity_config_version"] == 2
    roles = await api.get(
        f"{_projects(workspace)}/{project['project_id']}/entities", headers=owner.headers
    )
    (role,) = roles.json()["data"]
    assert (role["role"], role["is_primary"], role["entity"]["canonical_name"]) == (
        "own",
        True,
        "Fynix",
    )
    # The name itself is matched without an alias; repeats in any case are one alias.
    assert role["alias_count"] == 1
    assert [(d["domain"]["host"], d["match_scope"]) for d in role["domains"]] == [
        ("fynix.digital", "registrable"),
        ("fynix.io", "registrable"),
    ]
    actions = await fetch(
        migrated,
        "SELECT action FROM ops.audit_logs WHERE workspace_id = $1 ORDER BY id",
        workspace.id,
    )
    assert [row["action"] for row in actions] == [
        "project.created",
        "entity.created",
        "project_entity.created",
    ]


@pytest.mark.parametrize(
    ("own_entity", "path", "code"),
    [
        ({"aliases": ["Fynix", "   "]}, "own_entity.aliases.1", "string_too_short"),
        ({"domains": ["fynix.io", "co.uk"]}, "own_entity.domains.1", "domain_is_public_suffix"),
        ({"domains": ["https://github.io/x"]}, "own_entity.domains.0", "domain_is_public_suffix"),
        ({"domains": ["not a host"]}, "own_entity.domains.0", "invalid_domain"),
    ],
)
async def test_an_own_brand_alias_or_domain_that_cannot_be_stored_is_refused(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    own_entity: dict[str, Any],
    path: str,
    code: str,
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")

    response = await _create(
        api, workspace, owner, own_entity={"canonical_name": "Fynix", **own_entity}
    )

    assert response.status_code == 422
    error = response.json()["errors"][0]
    assert (error["path"], error["code"]) == (path, code)
    listed = await api.get(_projects(workspace), headers=owner.headers)
    assert listed.json()["data"] == []


async def test_own_brand_aliases_are_trimmed_and_kept_once_by_the_databases_rule(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    dotted_capital_i = "\N{LATIN CAPITAL LETTER I WITH DOT ABOVE}"

    response = await _create(
        api,
        workspace,
        owner,
        own_entity={
            "canonical_name": "Fynix",
            # Python's casefold keeps the dot of the capital, PostgreSQL's lower() drops it.
            "aliases": [" Fynix Digital ", f"{dotted_capital_i}zmir", "izmir"],
        },
    )

    assert response.status_code == 201, response.text
    rows = await fetch(
        migrated,
        "SELECT a.alias FROM core.entity_aliases a JOIN core.entities e ON e.id = a.entity_id "
        "WHERE e.workspace_id = $1 ORDER BY a.id",
        workspace.id,
    )
    assert [row["alias"] for row in rows] == ["Fynix Digital", f"{dotted_capital_i}zmir"]
    created = await fetch(
        migrated,
        "SELECT after FROM ops.audit_logs WHERE workspace_id = $1 AND action = 'entity.created'",
        workspace.id,
    )
    assert json.loads(created[0]["after"])["aliases"] == [row["alias"] for row in rows]


async def test_an_own_brand_the_workspace_has_is_refused_and_nothing_is_made(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    await api.post(
        entities_url(workspace),
        json={"entity_type": "brand", "canonical_name": "Fynix"},
        headers=owner.headers,
    )

    response = await _create(api, workspace, owner, own_entity={"canonical_name": "fynix"})

    assert response.status_code == 422
    error = response.json()["errors"][0]
    assert (error["path"], error["code"]) == ("own_entity.canonical_name", "entity_exists")
    listed = await api.get(_projects(workspace), headers=owner.headers)
    assert listed.json()["data"] == []


@pytest.mark.usefixtures("located")
async def test_the_primary_domain_and_location_are_changed_and_cleared(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    created = await _create(api, workspace, owner, primary_domain="old.example")
    url = f"{_projects(workspace)}/{created.json()['data']['project_id']}"

    changed = await api.patch(
        url,
        json={"primary_domain": "new.example", "default_location_id": ACTIVE},
        headers=owner.headers,
    )
    same = await api.patch(url, json={"primary_domain": "NEW.example."}, headers=owner.headers)
    unknown = await api.patch(url, json={"default_location_id": INACTIVE}, headers=owner.headers)
    cleared = await api.patch(
        url, json={"primary_domain": None, "default_location_id": None}, headers=owner.headers
    )

    assert changed.json()["data"]["primary_domain"]["host"] == "new.example"
    assert changed.json()["data"]["default_location"]["location_id"] == ACTIVE
    assert same.status_code == 200
    assert unknown.status_code == 422
    assert unknown.json()["errors"][0]["code"] == "location_unknown"
    assert (
        cleared.json()["data"]["primary_domain"],
        cleared.json()["data"]["default_location"],
    ) == (
        None,
        None,
    )
    actions = await fetch(
        migrated,
        "SELECT action, before, after FROM ops.audit_logs WHERE workspace_id = $1 ORDER BY id",
        workspace.id,
    )
    assert [row["action"] for row in actions] == [
        "project.created",
        "project.updated",
        "project.updated",
    ]
    # Hosts, not domain row ids.
    assert json.loads(actions[1]["before"]) == {
        "primary_domain": "old.example",
        "default_location_id": None,
    }
    assert json.loads(actions[1]["after"]) == {
        "primary_domain": "new.example",
        "default_location_id": ACTIVE,
    }
    assert json.loads(actions[2]["after"]) == {
        "primary_domain": None,
        "default_location_id": None,
    }


async def test_a_member_limited_to_some_projects_still_cannot_create_one(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = (await _create(api, workspace, owner)).json()["data"]["project_id"]
    scoped = await member(
        resources, migrated, workspace, "editor", project_ids=[uuid.UUID(project)]
    )
    response = await _create(api, workspace, scoped, own_entity={"canonical_name": "Mine"})
    assert problem(response) == (403, "forbidden")
