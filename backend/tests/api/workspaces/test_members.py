"""Member routes (docs/19 section 3.2.2)."""

import asyncio
import uuid

import httpx
import pytest

from idraft.api.permissions import Role
from idraft.api.problems import ForbiddenError, NotFoundError
from idraft.api.request_info import RequestInfo
from idraft.api.resources import Resources
from idraft.api.workspaces.access import WorkspaceAccess
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
    new_email,
    open_session,
)
from tests.api.conftest import AppFactory
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
    # Someone who does not manage members is not told who has two-factor on, or when others
    # were last active.
    assert (body["data"][1]["role"], body["data"][1]["project_ids"]) == ("owner", None)
    assert (body["data"][1]["two_factor_enabled"], body["data"][1]["last_active_at"]) == (
        None,
        None,
    )
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


# -------------------------------------------------------------------------------------------------
# What the review of these routes asked to be pinned


async def test_a_manager_sees_two_factor_and_activity_and_only_real_ones(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    _, headers = await _member(resources, migrated, workspace, "admin", name="a")
    confirmed, _ = await _member(resources, migrated, workspace, "viewer", name="b")
    unconfirmed, _ = await _member(resources, migrated, workspace, "viewer", name="c")
    signed_out = await make_user(migrated, name="d")
    await add_member(migrated, workspace, signed_out, "viewer")
    await open_session(resources, signed_out, state="pending_totp")
    await execute(
        migrated,
        "INSERT INTO auth.totp_secrets (user_id, secret_encrypted, confirmed_at) VALUES "
        "($1, 'x', now()), ($2, 'x', NULL)",
        confirmed.id,
        unconfirmed.id,
    )
    await execute(
        migrated, "UPDATE auth.sessions SET revoked_at = now() WHERE user_id = $1", unconfirmed.id
    )

    data = (await api.get(_members(workspace), headers=headers)).json()["data"]

    assert [item["two_factor_enabled"] for item in data] == [False, True, False, False]
    # A revoked session and one that never gave its second factor are not activity.
    assert [item["last_active_at"] is not None for item in data] == [True, True, False, False]


async def test_members_with_one_name_keep_one_order(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    users = [await _member(resources, migrated, workspace, "owner", name="Same") for _ in range(4)]
    headers = users[0][1]

    pages = [
        (await api.get(_members(workspace), params={"offset": offset, "limit": 1}, headers=headers))
        for offset in range(4)
    ]

    listed = [page.json()["data"][0]["user"]["user_id"] for page in pages]
    assert listed == sorted(str(user.id) for user, _ in users)


async def test_changes_here_leave_the_callers_memberships_elsewhere_alone(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Row-level security lets a user reach their own memberships of other workspaces, so the
    statements must name the workspace themselves."""
    here, elsewhere = await make_workspace(migrated), await make_workspace(migrated)
    user, headers = await _member(resources, migrated, here, "owner")
    await _member(resources, migrated, here, "owner")
    await add_member(migrated, elsewhere, user, "owner")
    url = f"{_members(here)}/{user.id}"

    changed = await api.patch(url, json={"role": "viewer"}, headers=headers)
    assert changed.status_code == 200
    assert (await _role(migrated, here, user), await _role(migrated, elsewhere, user)) == (
        "viewer",
        "owner",
    )

    await execute(
        migrated,
        "UPDATE auth.memberships SET role = 'owner' WHERE workspace_id = $1 AND user_id = $2",
        here.id,
        user.id,
    )
    removed = await api.delete(url, headers=headers)
    assert removed.status_code == 204
    assert (await _role(migrated, here, user), await _role(migrated, elsewhere, user)) == (
        None,
        "owner",
    )


async def test_the_callers_role_is_read_again_when_the_change_is_made(
    resources: Resources, migrated: PostgresServer
) -> None:
    """The dependency read the role in an earlier transaction; it may be out of date by now."""
    workspace = await make_workspace(migrated)
    actor, target = await make_user(migrated), await make_user(migrated)
    await add_member(migrated, workspace, actor, "owner")
    await add_member(migrated, workspace, target, "viewer")
    await add_member(migrated, workspace, await make_user(migrated), "owner")
    _, session = await open_session(resources, actor, fresh=True)
    stale = WorkspaceAccess(
        session=session, workspace_id=workspace.id, role=Role.OWNER, project_ids=None
    )
    info = RequestInfo(ip=None, user_agent=None, request_id=None)

    async def change() -> None:
        await resources.members.update(
            access=stale,
            user_id=target.id,
            role=Role.OWNER,
            scope_given=False,
            project_ids=None,
            info=info,
        )

    await execute(
        migrated, "UPDATE auth.memberships SET role = 'admin' WHERE user_id = $1", actor.id
    )
    with pytest.raises(ForbiddenError, match="Only an owner"):
        await change()
    await execute(
        migrated, "UPDATE auth.memberships SET role = 'editor' WHERE user_id = $1", actor.id
    )
    with pytest.raises(ForbiddenError):
        await change()
    with pytest.raises(ForbiddenError):
        await resources.members.remove(access=stale, user_id=target.id, info=info)
    await execute(migrated, "DELETE FROM auth.memberships WHERE user_id = $1", actor.id)
    with pytest.raises(NotFoundError):
        await change()
    assert await _role(migrated, workspace, target) == "viewer"


async def test_a_role_change_does_not_judge_the_scope_the_member_already_has(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    live, gone = (
        await make_project(migrated, workspace.id),
        await make_project(migrated, workspace.id),
    )
    _, headers = await _member(resources, migrated, workspace, "owner")
    target, _ = await _member(resources, migrated, workspace, "editor", project_ids=[gone, live])
    await execute(migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", gone)
    url = f"{_members(workspace)}/{target.id}"

    response = await api.patch(url, json={"role": "viewer"}, headers=headers)

    assert response.status_code == 200
    assert response.json()["data"]["role"] == "viewer"
    assert sorted(response.json()["data"]["project_ids"]) == sorted([str(live), str(gone)])
    assert [action for action, *_ in await _audit(migrated, workspace)] == ["member.updated"]


async def test_the_same_scope_in_another_order_is_no_change(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    projects = sorted(
        [await make_project(migrated, workspace.id) for _ in range(3)], key=str, reverse=True
    )
    _, headers = await _member(resources, migrated, workspace, "owner")
    # Stored in descending order by some other writer; the API sends and stores ascending.
    target, _ = await _member(resources, migrated, workspace, "editor", project_ids=projects)

    response = await api.patch(
        f"{_members(workspace)}/{target.id}",
        json={"project_ids": [str(project_id) for project_id in projects]},
        headers=headers,
    )

    assert response.status_code == 200
    assert await _audit(migrated, workspace) == []


async def test_an_empty_scope_is_a_member_of_no_project(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project_id = await make_project(migrated, workspace.id)
    _, headers = await _member(resources, migrated, workspace, "owner")
    target, target_headers = await _member(resources, migrated, workspace, "billing")
    admin, _ = await _member(resources, migrated, workspace, "admin")
    base = f"/api/v1/workspaces/{workspace.id}"

    response = await api.patch(
        f"{_members(workspace)}/{target.id}", json={"project_ids": []}, headers=headers
    )
    refused = await api.patch(
        f"{_members(workspace)}/{admin.id}", json={"project_ids": []}, headers=headers
    )

    assert response.json()["data"]["project_ids"] == []
    assert [error["code"] for error in refused.json()["errors"]] == ["scope_not_allowed"]
    assert (await api.get(base, headers=target_headers)).status_code == 200
    assert (await api.get(f"{base}/projects", headers=target_headers)).json()["data"] == []
    assert _problem(await api.get(f"{base}/projects/{project_id}", headers=target_headers)) == (
        404,
        "not_found",
    )


async def test_invitations_a_member_sent_are_withdrawn_when_they_stop_managing_members(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    _, owner = await _member(resources, migrated, workspace, "owner")
    demoted, demoted_headers = await _member(resources, migrated, workspace, "admin")
    removed, removed_headers = await _member(resources, migrated, workspace, "admin")
    kept, kept_headers = await _member(resources, migrated, workspace, "admin")
    invitations = f"/api/v1/workspaces/{workspace.id}/invitations"
    for headers in (demoted_headers, removed_headers, kept_headers):
        sent = await api.post(
            invitations, json={"email": new_email(), "role": "admin"}, headers=headers
        )
        assert sent.status_code == 201

    await api.patch(f"{_members(workspace)}/{demoted.id}", json={"role": "editor"}, headers=owner)
    await api.delete(f"{_members(workspace)}/{removed.id}", headers=owner)
    # Still a manager afterwards: their invitation stays.
    await api.patch(f"{_members(workspace)}/{kept.id}", json={"role": "owner"}, headers=owner)

    rows = await fetch(
        migrated,
        "SELECT invited_by, status FROM auth.invitations WHERE workspace_id = $1",
        workspace.id,
    )
    assert {row["invited_by"]: row["status"] for row in rows} == {
        demoted.id: "cancelled",
        removed.id: "cancelled",
        kept.id: "pending",
    }
    # Each withdrawal is recorded, after the change that caused it and by whoever made it.
    actions = [action for action, *_ in await _audit(migrated, workspace)]
    assert actions[3:] == [
        "member.updated",
        "invitation.cancelled",
        "member.removed",
        "invitation.cancelled",
        "member.updated",
    ]


async def test_an_owner_invitation_does_not_outlive_its_senders_ownership(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    _, owner = await _member(resources, migrated, workspace, "owner")
    second, second_headers = await _member(resources, migrated, workspace, "owner")
    invitations = f"/api/v1/workspaces/{workspace.id}/invitations"
    address = new_email()
    for email, role in ((address, "owner"), (new_email(), "viewer")):
        sent = await api.post(
            invitations, json={"email": email, "role": role}, headers=second_headers
        )
        assert sent.status_code == 201

    await api.patch(f"{_members(workspace)}/{second.id}", json={"role": "admin"}, headers=owner)

    rows = await fetch(
        migrated, "SELECT role, status FROM auth.invitations WHERE workspace_id = $1", workspace.id
    )
    reasons = await fetch(
        migrated,
        "SELECT after::text FROM ops.audit_logs "
        "WHERE workspace_id = $1 AND action = 'invitation.cancelled'",
        workspace.id,
    )
    assert [row["after"] for row in reasons] == ['{"reason": "sender_demoted"}']
    # Still an admin, so what an admin may send stays; what only an owner may send goes.
    assert {row["role"]: row["status"] for row in rows} == {
        "owner": "cancelled",
        "viewer": "pending",
    }
    # The address is free to be invited again.
    again = await api.post(invitations, json={"email": address, "role": "viewer"}, headers=owner)
    assert again.status_code == 201


async def test_many_changes_at_once_never_deadlock_or_lose_the_last_owner(
    client_for: AppFactory, migrated: PostgresServer
) -> None:
    """An owner promoted while other changes wait must not leave them waiting on each other."""
    async with client_for(db_pool_size=8) as api:
        resources = api._transport.app.state.resources  # type: ignore[attr-defined]
        for _ in range(12):
            workspace = await make_workspace(migrated)
            # Joined first, so their membership sorts before the owner's.
            early, early_headers = await _member(resources, migrated, workspace, "admin")
            late, late_headers = await _member(resources, migrated, workspace, "owner")
            third, _ = await _member(resources, migrated, workspace, "viewer")
            base = _members(workspace)

            responses = await asyncio.gather(
                api.patch(f"{base}/{early.id}", json={"role": "owner"}, headers=late_headers),
                api.patch(f"{base}/{early.id}", json={"project_ids": None}, headers=late_headers),
                api.patch(f"{base}/{late.id}", json={"role": "admin"}, headers=late_headers),
                api.patch(f"{base}/{third.id}", json={"role": "editor"}, headers=early_headers),
            )

            assert all(response.status_code < 500 for response in responses), [
                response.text for response in responses
            ]
            roles = [await _role(migrated, workspace, user) for user in (early, late)]
            assert "owner" in roles


async def test_an_invitation_already_past_its_date_is_left_as_it_is(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    _, owner = await _member(resources, migrated, workspace, "owner")
    sender, sender_headers = await _member(resources, migrated, workspace, "admin")
    invitations = f"/api/v1/workspaces/{workspace.id}/invitations"
    sent = await api.post(
        invitations, json={"email": new_email(), "role": "viewer"}, headers=sender_headers
    )
    await execute(
        migrated,
        "UPDATE auth.invitations SET expires_at = now() - interval '1 minute' WHERE id = $1",
        uuid.UUID(sent.json()["data"]["invitation_id"]),
    )

    removed = await api.delete(f"{_members(workspace)}/{sender.id}", headers=owner)

    assert removed.status_code == 204
    row = await fetchrow(
        migrated, "SELECT status FROM auth.invitations WHERE workspace_id = $1", workspace.id
    )
    # Expired, as the list shows it and as the route that withdraws one treats it.
    assert row["status"] == "pending"
    actions = [action for action, *_ in await _audit(migrated, workspace)]
    assert actions == ["invitation.created", "member.removed"]
