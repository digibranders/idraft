"""Disconnecting an account (docs/24 section 6, docs/18 section 14)."""

from __future__ import annotations

import uuid

import httpx
import pytest

from idraft.providers.google.client import REVOKE_URL
from tests.api.auth.support import fetch
from tests.api.integrations.support import (
    Caller,
    Harness,
    World,
    connected,
    make_caller,
    make_world,
    project_url,
    workspace_url,
)

SITES = [("sc-domain:acme.example", "siteOwner")]


async def _delete(
    h: Harness, world: World, connection_id: str, caller: Caller | None = None
) -> httpx.Response:
    return await h.api.delete(
        workspace_url(world.workspace, "connections", connection_id),
        headers=(caller or world.owner).headers,
    )


async def _linked(h: Harness, world: World, connection_id: str) -> str:
    response = await h.api.post(
        project_url(world, "integrations"),
        json={
            "connection_id": connection_id,
            "kind": "gsc",
            "external_property": "sc-domain:acme.example",
        },
        headers=world.owner.headers,
    )
    assert response.status_code == 201, response.text
    integration_id: str = response.json()["data"]["integration_id"]
    return integration_id


async def _store_a_day(h: Harness, world: World, integration_id: str) -> None:
    await fetch(
        h.pg,
        "INSERT INTO fp.gsc_search_analytics (integration_id, metric_date, search_type, "
        "query_hash, url_id, country_iso3, device, workspace_id, project_id, clicks, "
        "impressions, position_sum, data_state) VALUES ($1, current_date, 'web', '\\x05', 1, "
        "'USA', 'MOBILE', $2, $3, 4, 90, 300, 'final') RETURNING 1",
        uuid.UUID(integration_id),
        world.workspace.id,
        world.project_id,
    )


async def test_a_disconnect_revokes_at_google_deletes_the_secret_and_keeps_the_numbers(
    google: Harness,
) -> None:
    world = await make_world(google)
    account = google.fake.account("a@example.com", SITES)
    connection = await connected(google, world, account)
    integration_id = await _linked(google, world, connection)
    await _store_a_day(google, world, integration_id)

    response = await _delete(google, world, connection, world.admin)

    assert response.status_code == 200
    data = response.json()["data"]
    assert (data["status"], data["integration_count"]) == ("revoked", 0)
    assert not google.fake.alive(account)
    assert google.fake.called(REVOKE_URL)[0].form == {"token": account.refresh_token}
    (row,) = await fetch(
        google.pg,
        "SELECT status, credential_ref FROM fp.connections WHERE id = $1",
        uuid.UUID(connection),
    )
    assert (row["status"], row["credential_ref"]) == ("revoked", None)
    secrets = await fetch(
        google.pg, "SELECT count(*) FROM ops.secrets WHERE workspace_id = $1", world.workspace.id
    )
    assert secrets[0][0] == 0
    (integration,) = await fetch(
        google.pg, "SELECT status FROM fp.integrations WHERE id = $1", uuid.UUID(integration_id)
    )
    assert integration["status"] == "disabled"
    numbers = await fetch(
        google.pg,
        "SELECT clicks FROM fp.gsc_search_analytics WHERE integration_id = $1",
        uuid.UUID(integration_id),
    )
    assert [n["clicks"] for n in numbers] == [4]
    audit = await fetch(
        google.pg,
        "SELECT action, before, after, actor_id FROM ops.audit_logs "
        "WHERE workspace_id = $1 AND action = 'connection.revoked'",
        world.workspace.id,
    )
    assert len(audit) == 1
    assert audit[0]["actor_id"] == str(world.admin.user_id)
    assert account.refresh_token not in str(dict(audit[0]))


async def test_disconnecting_twice_does_nothing_more(google: Harness) -> None:
    world = await make_world(google)
    connection = await connected(google, world, google.fake.account("a@example.com", SITES))
    await _delete(google, world, connection)

    again = await _delete(google, world, connection)

    assert again.status_code == 200
    assert again.json()["data"]["status"] == "revoked"
    assert len(google.fake.called(REVOKE_URL)) == 1
    audit = await fetch(
        google.pg,
        "SELECT count(*) FROM ops.audit_logs "
        "WHERE workspace_id = $1 AND action = 'connection.revoked'",
        world.workspace.id,
    )
    assert audit[0][0] == 1


@pytest.mark.parametrize("status", [400, 503])
async def test_a_disconnect_does_not_depend_on_google_answering(
    google: Harness, status: int
) -> None:
    world = await make_world(google)
    account = google.fake.account("a@example.com", SITES)
    connection = await connected(google, world, account)
    google.fake.revoke_status = status

    response = await _delete(google, world, connection)

    assert response.status_code == 200
    assert response.json()["data"]["status"] == "revoked"
    secrets = await fetch(
        google.pg, "SELECT count(*) FROM ops.secrets WHERE workspace_id = $1", world.workspace.id
    )
    assert secrets[0][0] == 0


async def test_a_connection_whose_secret_cannot_be_read_can_still_be_disconnected(
    google: Harness,
) -> None:
    world = await make_world(google)
    connection = await connected(google, world, google.fake.account("a@example.com", SITES))
    await fetch(
        google.pg,
        "UPDATE ops.secrets SET ciphertext = '\\x00' WHERE workspace_id = $1 RETURNING 1",
        world.workspace.id,
    )

    response = await _delete(google, world, connection)

    assert response.status_code == 200
    assert google.fake.called(REVOKE_URL) == []


async def test_a_disconnected_account_cannot_be_used_until_it_connects_again(
    google: Harness,
) -> None:
    world = await make_world(google)
    account = google.fake.account("a@example.com", SITES)
    connection = await connected(google, world, account)
    await _delete(google, world, connection)

    properties = await google.api.get(
        workspace_url(world.workspace, "connections", connection, "properties", "gsc"),
        headers=world.owner.headers,
    )
    again = await connected(google, world, account)

    assert properties.json()["code"] == "integration_reauth_required"
    assert again == connection
    (row,) = await fetch(
        google.pg,
        "SELECT status, credential_ref FROM fp.connections WHERE id = $1",
        uuid.UUID(connection),
    )
    assert row["status"] == "active"
    assert row["credential_ref"] is not None


async def test_only_a_manager_with_a_recent_sign_in_can_disconnect(google: Harness) -> None:
    world = await make_world(google)
    connection = await connected(google, world, google.fake.account("a@example.com", SITES))
    stale = await make_caller(google, world.workspace, "admin", fresh=False)

    editor = await _delete(google, world, connection, world.editor)
    not_fresh = await _delete(google, world, connection, stale)

    assert (editor.status_code, not_fresh.status_code) == (403, 403)
    assert not_fresh.json()["code"] == "fresh_session_required"
    assert google.fake.called(REVOKE_URL) == []


async def test_another_workspace_cannot_disconnect_it(google: Harness) -> None:
    world = await make_world(google)
    other = await make_world(google)
    connection = await connected(google, world, google.fake.account("a@example.com", SITES))

    response = await google.api.delete(
        workspace_url(other.workspace, "connections", connection), headers=other.owner.headers
    )

    assert response.status_code == 404
    assert google.fake.called(REVOKE_URL) == []
