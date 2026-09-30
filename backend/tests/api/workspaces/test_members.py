"""Member routes (docs/19 section 3.2.2)."""

import asyncio
import uuid

import httpx
import pytest

from sightline.api.resources import Resources
from tests.api.auth.support import (
    User,
    Workspace,
    add_member,
    cookie,
    execute,
    fetch,
    fetchrow,
    make_user,
    make_workspace,
    open_session,
)
from tests.api.workspaces.support import make_project
from tests.conftest import PostgresServer


def _members(workspace: Workspace) -> str:
    return f"/api/v1/workspaces/{workspace.id}/members"


def _problem(response: httpx.Response) -> tuple[int, str]:
    return response.status_code, response.json()["code"]


async def _member(
    resources: Resources,
    pg: PostgresServer,
    workspace: Workspace,
    role: str,
    *,
    fresh: bool = True,
    name: str = "Jane Doe",
    project_ids: list[uuid.UUID] | None = None,
) -> tuple[User, dict[str, str]]:
    user = await make_user(pg, name=name)
    await add_member(pg, workspace, user, role, project_ids)
    token, _ = await open_session(resources, user, fresh=fresh)
    return user, cookie(token)


async def _role(pg: PostgresServer, workspace: Workspace, user: User) -> str | None:
    rows = await fetch(
        pg,
        "SELECT role FROM auth.memberships WHERE workspace_id = $1 AND user_id = $2",
        workspace.id,
        user.id,
    )
    return rows[0]["role"] if rows else None


async def _audit(
    pg: PostgresServer, workspace: Workspace
) -> list[tuple[str, str, str | None, str | None]]:
    rows = await fetch(
        pg,
        "SELECT action, target_id, before::text, after::text FROM ops.audit_logs "
        "WHERE workspace_id = $1 ORDER BY id",
        workspace.id,
    )
    return [(row["action"], row["target_id"], row["before"], row["after"]) for row in rows]


# -------------------------------------------------------------------------------------------------
# List


async def test_any_member_lists_the_members_of_the_workspace_and_only_those(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, elsewhere = await make_workspace(migrated), await make_workspace(migrated)
    project_id = await make_project(migrated, workspace.id)
    owner, _ = await _member(resources, migrated, workspace, "owner", name="Zoe")
    viewer, headers = await _member(
        resources, migrated, workspace, "billing", name="adam", project_ids=[project_id]
    )
    # The caller also belongs to another workspace, which has a member of its own.
    await add_member(migrated, elsewhere, viewer, "owner")
    stranger, _ = await _member(resources, migrated, elsewhere, "admin", name="Mallory")
    await execute(
        migrated,
        "INSERT INTO auth.totp_secrets (user_id, secret_encrypted, confirmed_at) "
        "VALUES ($1, 'x', now())",
        owner.id,
    )

    response = await api.get(_members(workspace), headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["page"] == {"offset": 0, "limit": 50, "total": 2}
    assert [item["user"]["name"] for item in body["data"]] == ["adam", "Zoe"]
    assert body["data"][0] == {
        "user": {"user_id": str(viewer.id), "name": "adam", "email": viewer.email},
        "role": "billing",
        "project_ids": [str(project_id)],
        "two_factor_enabled": False,
        "joined_at": body["data"][0]["joined_at"],
        "last_active_at": body["data"][0]["last_active_at"],
    }
    assert body["data"][0]["last_active_at"] is not None
    assert (body["data"][1]["role"], body["data"][1]["two_factor_enabled"]) == ("owner", True)
    assert body["data"][1]["project_ids"] is None
    assert str(stranger.id) not in response.text
    assert "password" not in response.text


async def test_the_member_list_is_paged(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    _, headers = await _member(resources, migrated, workspace, "owner", name="a")
    for name in ("b", "c", "d"):
        await _member(resources, migrated, workspace, "viewer", name=name)

    response = await api.get(_members(workspace), params={"offset": 1, "limit": 2}, headers=headers)

    assert response.json()["page"] == {"offset": 1, "limit": 2, "total": 4}
    assert [item["user"]["name"] for item in response.json()["data"]] == ["b", "c"]


async def test_a_stranger_cannot_list_members(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, other = await make_workspace(migrated), await make_workspace(migrated)
    _, headers = await _member(resources, migrated, other, "owner")
    assert _problem(await api.get(_members(workspace), headers=headers)) == (404, "not_found")


# -------------------------------------------------------------------------------------------------
# Change


async def test_changing_a_member_needs_the_permission_and_a_fresh_session(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    target, _ = await _member(resources, migrated, workspace, "viewer")
    _, editor = await _member(resources, migrated, workspace, "editor")
    _, stale_admin = await _member(resources, migrated, workspace, "admin", fresh=False)
    url = f"{_members(workspace)}/{target.id}"

    forbidden = await api.patch(url, json={"role": "analyst"}, headers=editor)
    stale = await api.patch(url, json={"role": "analyst"}, headers=stale_admin)
    removal = await api.delete(url, headers=stale_admin)

    assert _problem(forbidden) == (403, "forbidden")
    assert _problem(stale) == _problem(removal) == (403, "fresh_session_required")
    assert await _role(migrated, workspace, target) == "viewer"


async def test_an_admin_changes_a_role_and_a_scope_and_both_are_recorded(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    second, first = (
        await make_project(migrated, workspace.id),
        await make_project(migrated, workspace.id),
    )
    admin, headers = await _member(resources, migrated, workspace, "admin")
    target, _ = await _member(resources, migrated, workspace, "viewer")
    url = f"{_members(workspace)}/{target.id}"

    response = await api.patch(
        url,
        json={"role": "editor", "project_ids": [str(first), str(second), str(first)]},
        headers=headers,
    )

    assert response.status_code == 200
    scope = sorted([str(first), str(second)])
    data = response.json()["data"]
    assert (data["user"]["user_id"], data["role"], data["project_ids"]) == (
        str(target.id),
        "editor",
        scope,
    )
    row = await fetchrow(
        migrated, "SELECT role, project_ids FROM auth.memberships WHERE user_id = $1", target.id
    )
    assert (row["role"], sorted(str(item) for item in row["project_ids"])) == ("editor", scope)
    ((action, target_id, before, after),) = await _audit(migrated, workspace)
    assert (action, target_id) == ("member.updated", str(target.id))
    assert before == '{"role": "viewer", "project_ids": null}'
    assert after == f'{{"role": "editor", "project_ids": ["{scope[0]}", "{scope[1]}"]}}'
    rows = await fetch(
        migrated, "SELECT actor_id FROM ops.audit_logs WHERE workspace_id = $1", workspace.id
    )
    assert rows[0]["actor_id"] == str(admin.id)

    # The role is kept when only the scope is given, and null lifts the limit.
    lifted = await api.patch(url, json={"project_ids": None}, headers=headers)
    assert (lifted.json()["data"]["role"], lifted.json()["data"]["project_ids"]) == ("editor", None)


async def test_a_change_that_changes_nothing_is_not_recorded(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    _, headers = await _member(resources, migrated, workspace, "admin")
    target, _ = await _member(resources, migrated, workspace, "viewer")

    response = await api.patch(
        f"{_members(workspace)}/{target.id}", json={"role": "viewer"}, headers=headers
    )

    assert response.status_code == 200
    assert await _audit(migrated, workspace) == []


async def test_only_an_owner_grants_or_changes_the_owner_role(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner, owner_headers = await _member(resources, migrated, workspace, "owner")
    second_owner, _ = await _member(resources, migrated, workspace, "owner")
    _, admin = await _member(resources, migrated, workspace, "admin")
    viewer, _ = await _member(resources, migrated, workspace, "viewer")
    base = _members(workspace)

    grant = await api.patch(f"{base}/{viewer.id}", json={"role": "owner"}, headers=admin)
    demote = await api.patch(f"{base}/{owner.id}", json={"role": "admin"}, headers=admin)
    remove = await api.delete(f"{base}/{owner.id}", headers=admin)

    assert _problem(grant) == _problem(demote) == _problem(remove) == (403, "forbidden")
    assert await _role(migrated, workspace, viewer) == "viewer"
    assert await _role(migrated, workspace, owner) == "owner"

    granted = await api.patch(f"{base}/{viewer.id}", json={"role": "owner"}, headers=owner_headers)
    demoted = await api.patch(
        f"{base}/{second_owner.id}", json={"role": "admin"}, headers=owner_headers
    )
    assert (granted.status_code, demoted.status_code) == (200, 200)
    assert await _role(migrated, workspace, viewer) == "owner"
    assert await _role(migrated, workspace, second_owner) == "admin"


async def test_the_last_owner_cannot_be_demoted_or_removed(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner, headers = await _member(resources, migrated, workspace, "owner")
    await _member(resources, migrated, workspace, "admin")
    url = f"{_members(workspace)}/{owner.id}"

    demote = await api.patch(url, json={"role": "admin"}, headers=headers)
    remove = await api.delete(url, headers=headers)
    scope_only = await api.patch(url, json={"project_ids": None}, headers=headers)

    assert _problem(demote) == _problem(remove) == (409, "last_owner")
    assert scope_only.status_code == 200
    assert await _role(migrated, workspace, owner) == "owner"
    assert await _audit(migrated, workspace) == []


async def test_two_owners_demoting_each_other_at_once_leave_one_owner(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    first, first_headers = await _member(resources, migrated, workspace, "owner")
    second, second_headers = await _member(resources, migrated, workspace, "owner")
    base = _members(workspace)

    responses = await asyncio.gather(
        api.patch(f"{base}/{second.id}", json={"role": "admin"}, headers=first_headers),
        api.patch(f"{base}/{first.id}", json={"role": "admin"}, headers=second_headers),
    )

    roles = [await _role(migrated, workspace, first), await _role(migrated, workspace, second)]
    assert sorted(role or "" for role in roles) == ["admin", "owner"]
    # The loser either found no owner role left to act with, or would have removed the last owner.
    assert sorted(response.status_code for response in responses) in ([200, 403], [200, 409])


async def test_a_scope_names_projects_of_this_workspace_and_suits_the_role(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, other = await make_workspace(migrated), await make_workspace(migrated)
    mine, theirs = (
        await make_project(migrated, workspace.id),
        await make_project(migrated, other.id),
    )
    deleted = await make_project(migrated, workspace.id)
    await execute(migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", deleted)
    _, headers = await _member(resources, migrated, workspace, "owner")
    target, _ = await _member(resources, migrated, workspace, "editor", project_ids=[mine])
    url = f"{_members(workspace)}/{target.id}"

    for project_ids in (
        [str(theirs)],
        [str(deleted)],
        [str(uuid.uuid4())],
        [str(mine), str(theirs)],
    ):
        response = await api.patch(url, json={"project_ids": project_ids}, headers=headers)
        assert _problem(response) == (422, "validation_failed"), project_ids
        assert [(error["path"], error["code"]) for error in response.json()["errors"]] == [
            ("project_ids", "project_unknown")
        ]
    managing = await api.patch(
        url, json={"role": "admin", "project_ids": [str(mine)]}, headers=headers
    )
    assert [(error["path"], error["code"]) for error in managing.json()["errors"]] == [
        ("project_ids", "scope_not_allowed")
    ]
    row = await fetchrow(
        migrated, "SELECT role, project_ids FROM auth.memberships WHERE user_id = $1", target.id
    )
    assert (row["role"], row["project_ids"]) == ("editor", [mine])

    # Promotion without a scope lifts the limit the member had.
    promoted = await api.patch(url, json={"role": "admin"}, headers=headers)
    assert (promoted.json()["data"]["role"], promoted.json()["data"]["project_ids"]) == (
        "admin",
        None,
    )


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"role": None},
        {"role": "superuser"},
        {"project_ids": "all"},
        {"project_ids": ["not-an-id"]},
        {"role": "viewer", "user_id": "0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11"},
    ],
)
async def test_a_malformed_change_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, body: dict[str, object]
) -> None:
    workspace = await make_workspace(migrated)
    _, headers = await _member(resources, migrated, workspace, "owner")
    target, _ = await _member(resources, migrated, workspace, "viewer")
    response = await api.patch(f"{_members(workspace)}/{target.id}", json=body, headers=headers)
    assert _problem(response) == (422, "validation_failed")


async def test_someone_who_is_not_a_member_here_cannot_be_changed_or_removed(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, other = await make_workspace(migrated), await make_workspace(migrated)
    _, headers = await _member(resources, migrated, workspace, "owner")
    outsider, _ = await _member(resources, migrated, other, "viewer")
    # The caller belongs to the other workspace too: its members stay out of reach from here.
    caller = await fetchrow(
        migrated, "SELECT user_id FROM auth.memberships WHERE workspace_id = $1", workspace.id
    )
    await execute(
        migrated,
        "INSERT INTO auth.memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
        other.id,
        caller["user_id"],
    )

    for user_id in (outsider.id, uuid.uuid4()):
        url = f"{_members(workspace)}/{user_id}"
        assert _problem(await api.patch(url, json={"role": "admin"}, headers=headers)) == (
            404,
            "not_found",
        )
        assert _problem(await api.delete(url, headers=headers)) == (404, "not_found")
    assert await _role(migrated, other, outsider) == "viewer"


# -------------------------------------------------------------------------------------------------
# Remove


async def test_a_removed_member_is_out_with_their_next_request(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project_id = await make_project(migrated, workspace.id)
    _, headers = await _member(resources, migrated, workspace, "admin")
    target, target_headers = await _member(
        resources, migrated, workspace, "analyst", project_ids=[project_id]
    )
    assert (await api.get(_members(workspace), headers=target_headers)).status_code == 200

    response = await api.delete(f"{_members(workspace)}/{target.id}", headers=headers)

    assert response.status_code == 204
    assert response.content == b""
    assert await _role(migrated, workspace, target) is None
    assert _problem(await api.get(_members(workspace), headers=target_headers)) == (
        404,
        "not_found",
    )
    ((action, target_id, before, after),) = await _audit(migrated, workspace)
    assert (action, target_id, after) == ("member.removed", str(target.id), None)
    assert before == f'{{"role": "analyst", "project_ids": ["{project_id}"]}}'
    # The account itself is untouched.
    assert await fetch(migrated, "SELECT 1 FROM auth.users WHERE id = $1", target.id) != []


async def test_an_owner_can_leave_when_another_owner_stays(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    leaving, headers = await _member(resources, migrated, workspace, "owner")
    staying, _ = await _member(resources, migrated, workspace, "owner")

    response = await api.delete(f"{_members(workspace)}/{leaving.id}", headers=headers)

    assert response.status_code == 204
    assert await _role(migrated, workspace, leaving) is None
    assert await _role(migrated, workspace, staying) == "owner"
