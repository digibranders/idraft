"""Shareable client summary links, as people manage them (plan 06 Task 4, decision D15)."""

from __future__ import annotations

import hashlib
import uuid

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import Workspace, execute, fetchrow, make_workspace
from tests.api.entities.support import member, problem
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer


async def _base(migrated: PostgresServer) -> tuple[str, Workspace, uuid.UUID]:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    return project_url(workspace, project, "internal-links", "shares"), workspace, project


async def test_a_link_is_made_once_with_its_token_and_only_the_hash_is_stored(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    base, workspace, _ = await _base(migrated)
    editor = await member(resources, migrated, workspace, "editor")

    created = await api.post(base, json={}, headers=editor.headers)

    assert created.status_code == 201
    data = created.json()["data"]
    token = data["token"]
    assert len(token) >= 40
    assert (data["state"], data["revoked_at"]) == ("active", None)
    stored = await fetchrow(
        migrated,
        "SELECT token_hash, expires_at - created_at AS span FROM core.client_summary_shares "
        "WHERE id = $1::uuid",
        data["id"],
    )
    assert bytes(stored["token_hash"]) == hashlib.sha256(token.encode()).digest()
    assert stored["span"].days == 30
    listed = await api.get(base, headers=editor.headers)
    assert "token" not in listed.text
    assert [row["id"] for row in listed.json()["data"]] == [data["id"]]


async def test_only_7_30_or_90_days_are_offered_never_is_not(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    base, workspace, _ = await _base(migrated)
    editor = await member(resources, migrated, workspace, "editor")

    for days in (7, 90):
        made = await api.post(base, json={"expires_in_days": days}, headers=editor.headers)
        assert made.status_code == 201
    for refused in ({"expires_in_days": 365}, {"expires_in_days": None}, {"expires_in_days": 0}):
        response = await api.post(base, json=refused, headers=editor.headers)
        assert response.status_code == 422, refused


async def test_a_viewer_can_list_but_not_make_or_revoke_and_nothing_crosses_workspaces(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    base, workspace, _ = await _base(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    viewer = await member(resources, migrated, workspace, "viewer")
    share = (await api.post(base, json={}, headers=editor.headers)).json()["data"]
    other, other_workspace, _ = await _base(migrated)
    outsider = await member(resources, migrated, other_workspace, "owner")

    assert (await api.get(base, headers=viewer.headers)).status_code == 200
    assert (await api.post(base, json={}, headers=viewer.headers)).status_code == 403
    assert (await api.delete(f"{base}/{share['id']}", headers=viewer.headers)).status_code == 403
    # The same share id under another workspace's project is not found, and not revoked.
    refused = await api.delete(f"{other}/{share['id']}", headers=outsider.headers)
    assert problem(refused) == (404, "not_found")
    still = await fetchrow(
        migrated,
        "SELECT revoked_at FROM core.client_summary_shares WHERE id = $1::uuid",
        share["id"],
    )
    assert still["revoked_at"] is None


async def test_revoking_twice_is_harmless_and_each_make_and_revoke_is_audited(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    base, workspace, _ = await _base(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    share = (await api.post(base, json={}, headers=editor.headers)).json()["data"]

    first = await api.delete(f"{base}/{share['id']}", headers=editor.headers)
    second = await api.delete(f"{base}/{share['id']}", headers=editor.headers)

    assert (first.status_code, second.status_code) == (200, 200)
    assert first.json()["data"]["state"] == second.json()["data"]["state"] == "revoked"
    assert first.json()["data"]["revoked_at"] == second.json()["data"]["revoked_at"]
    counts = await fetchrow(
        migrated,
        "SELECT count(*) FILTER (WHERE action = 'client_summary_share.created') AS made, "
        "count(*) FILTER (WHERE action = 'client_summary_share.revoked') AS revoked "
        "FROM ops.audit_logs WHERE workspace_id = $1",
        workspace.id,
    )
    assert (counts["made"], counts["revoked"]) == (1, 1)
    gone = await api.delete(f"{base}/00000000-0000-7000-8000-000000000000", headers=editor.headers)
    assert problem(gone) == (404, "not_found")


async def test_an_expired_link_is_listed_as_expired(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    base, workspace, _ = await _base(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    share = (await api.post(base, json={}, headers=editor.headers)).json()["data"]
    await execute(
        migrated,
        "UPDATE core.client_summary_shares SET created_at = now() - interval '40 days', "
        "expires_at = now() - interval '10 days' WHERE id = $1::uuid",
        share["id"],
    )

    listed = await api.get(base, headers=editor.headers)

    assert [row["state"] for row in listed.json()["data"]] == ["expired"]
