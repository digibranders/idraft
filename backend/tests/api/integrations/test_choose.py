"""Linking a property to a project, and switching it off (docs/19 section 3.10)."""

from __future__ import annotations

import uuid

import httpx
import pytest

from tests.api.auth.support import fetch
from tests.api.integrations.support import (
    Caller,
    Harness,
    World,
    connected,
    make_caller,
    make_project,
    make_world,
    project_url,
)

SITES = [
    ("sc-domain:acme.example", "siteOwner"),
    ("https://www.acme.example/", "siteFullUser"),
    ("sc-domain:locked.example", "siteUnverifiedUser"),
]


async def _choose(
    h: Harness,
    world: World,
    connection_id: str,
    external_property: str,
    caller: Caller | None = None,
    project_id: uuid.UUID | None = None,
) -> httpx.Response:
    return await h.api.post(
        f"/api/v1/workspaces/{world.workspace.id}/projects/{project_id or world.project_id}"
        "/integrations",
        json={
            "connection_id": connection_id,
            "kind": "gsc",
            "external_property": external_property,
        },
        headers=(caller or world.owner).headers,
    )


async def _actions(h: Harness, world: World) -> list[str]:
    rows = await fetch(
        h.pg,
        "SELECT action FROM ops.audit_logs WHERE workspace_id = $1 AND action LIKE 'integration.%' "
        "ORDER BY id",
        world.workspace.id,
    )
    return [row["action"] for row in rows]


async def test_a_property_is_linked_to_the_project_and_audited(google: Harness) -> None:
    world = await make_world(google)
    connection = await connected(google, world, google.fake.account("a@example.com", SITES))

    response = await _choose(google, world, connection, "sc-domain:acme.example", world.admin)

    assert response.status_code == 201
    data = response.json()["data"]
    assert (data["kind"], data["external_property"], data["status"]) == (
        "gsc",
        "sc-domain:acme.example",
        "active",
    )
    assert (data["project_id"], data["connection_id"]) == (str(world.project_id), connection)
    assert (data["external_account"], data["connection_status"]) == ("a@example.com", "active")
    assert data["backfill_state"] == {}
    assert data["last_success_at"] is None
    assert await _actions(google, world) == ["integration.created"]
    listed = await google.api.get(project_url(world, "integrations"), headers=world.viewer.headers)
    assert [row["integration_id"] for row in listed.json()["data"]] == [data["integration_id"]]
    assert listed.json()["page"]["total"] == 1


@pytest.mark.parametrize("role", ["editor", "analyst", "viewer", "billing"])
async def test_only_a_manager_can_choose_a_property(google: Harness, role: str) -> None:
    world = await make_world(google)
    connection = await connected(google, world, google.fake.account("a@example.com", SITES))
    caller = await make_caller(google, world.workspace, role)

    response = await _choose(google, world, connection, "sc-domain:acme.example", caller)

    assert response.status_code == 403
    assert await _actions(google, world) == []


@pytest.mark.parametrize("name", ["sc-domain:locked.example", "sc-domain:unknown.example"])
async def test_a_property_the_account_cannot_read_is_refused(google: Harness, name: str) -> None:
    world = await make_world(google)
    connection = await connected(google, world, google.fake.account("a@example.com", SITES))

    response = await _choose(google, world, connection, name)

    assert (response.status_code, response.json()["code"]) == (422, "property_not_accessible")
    assert await _actions(google, world) == []


async def test_a_property_belongs_to_one_project_of_the_workspace(google: Harness) -> None:
    world = await make_world(google)
    second, _ = await make_project(google, world.workspace, host="second.example")
    connection = await connected(google, world, google.fake.account("a@example.com", SITES))
    assert (await _choose(google, world, connection, "sc-domain:acme.example")).status_code == 201

    again = await _choose(google, world, connection, "sc-domain:acme.example", project_id=second)

    assert (again.status_code, again.json()["code"]) == (409, "duplicate")


async def test_a_project_has_one_live_property(google: Harness) -> None:
    world = await make_world(google)
    connection = await connected(google, world, google.fake.account("a@example.com", SITES))
    assert (await _choose(google, world, connection, "sc-domain:acme.example")).status_code == 201

    second = await _choose(google, world, connection, "https://www.acme.example/")

    assert (second.status_code, second.json()["code"]) == (409, "duplicate")
    rows = await fetch(
        google.pg, "SELECT count(*) FROM fp.integrations WHERE project_id = $1", world.project_id
    )
    assert rows[0][0] == 1


async def test_a_switched_off_property_can_be_chosen_again_by_its_project_only(
    google: Harness,
) -> None:
    world = await make_world(google)
    other, _ = await make_project(google, world.workspace, host="second.example")
    connection = await connected(google, world, google.fake.account("a@example.com", SITES))
    created = await _choose(google, world, connection, "sc-domain:acme.example")
    integration_id = created.json()["data"]["integration_id"]

    off = await google.api.delete(
        project_url(world, "integrations", integration_id), headers=world.owner.headers
    )
    assert off.status_code == 200
    assert off.json()["data"]["status"] == "disabled"
    # Switching off twice changes nothing and writes nothing more
    await google.api.delete(
        project_url(world, "integrations", integration_id), headers=world.owner.headers
    )
    assert await _actions(google, world) == ["integration.created", "integration.disabled"]

    stolen = await _choose(google, world, connection, "sc-domain:acme.example", project_id=other)
    back = await _choose(google, world, connection, "sc-domain:acme.example")

    assert stolen.status_code == 409
    assert back.status_code == 201
    assert back.json()["data"]["integration_id"] == integration_id
    assert back.json()["data"]["status"] == "active"


async def test_switching_a_property_off_needs_a_manager_and_a_recent_sign_in(
    google: Harness,
) -> None:
    world = await make_world(google)
    connection = await connected(google, world, google.fake.account("a@example.com", SITES))
    created = await _choose(google, world, connection, "sc-domain:acme.example")
    integration_id = created.json()["data"]["integration_id"]
    stale = await make_caller(google, world.workspace, "owner", fresh=False)

    editor = await google.api.delete(
        project_url(world, "integrations", integration_id), headers=world.editor.headers
    )
    not_fresh = await google.api.delete(
        project_url(world, "integrations", integration_id), headers=stale.headers
    )
    unknown = await google.api.delete(
        project_url(world, "integrations", uuid.uuid4()), headers=world.owner.headers
    )

    assert (editor.status_code, not_fresh.status_code, unknown.status_code) == (403, 403, 404)
    assert not_fresh.json()["code"] == "fresh_session_required"


async def test_a_connection_of_another_workspace_cannot_be_used(google: Harness) -> None:
    world = await make_world(google)
    other = await make_world(google)
    foreign = await connected(google, other, google.fake.account("b@example.com", SITES))

    response = await _choose(google, world, foreign, "sc-domain:acme.example")

    assert response.status_code == 404


async def test_a_connection_that_needs_renewing_cannot_be_used(google: Harness) -> None:
    world = await make_world(google)
    account = google.fake.account("a@example.com", SITES)
    connection = await connected(google, world, account)
    google.fake.kill_refresh_token(account)

    response = await _choose(google, world, connection, "sc-domain:acme.example")

    assert (response.status_code, response.json()["code"]) == (409, "integration_reauth_required")
    assert await _actions(google, world) == []


async def test_an_unknown_project_or_kind_is_refused(google: Harness) -> None:
    world = await make_world(google)
    connection = await connected(google, world, google.fake.account("a@example.com", SITES))

    nobody = await _choose(
        google, world, connection, "sc-domain:acme.example", project_id=uuid.uuid4()
    )
    wrong_kind = await google.api.post(
        project_url(world, "integrations"),
        json={"connection_id": connection, "kind": "ga4", "external_property": "x"},
        headers=world.owner.headers,
    )
    extra = await google.api.post(
        project_url(world, "integrations"),
        json={
            "connection_id": connection,
            "kind": "gsc",
            "external_property": "sc-domain:acme.example",
            "status": "disabled",
        },
        headers=world.owner.headers,
    )

    assert nobody.status_code == 404
    assert wrong_kind.status_code == 422
    assert extra.status_code == 422


async def test_another_workspace_cannot_see_the_integrations_of_a_project(google: Harness) -> None:
    world = await make_world(google)
    other = await make_world(google)
    connection = await connected(google, world, google.fake.account("a@example.com", SITES))
    await _choose(google, world, connection, "sc-domain:acme.example")

    response = await google.api.get(
        f"/api/v1/workspaces/{other.workspace.id}/projects/{world.project_id}/integrations",
        headers=other.owner.headers,
    )

    assert response.status_code == 404
