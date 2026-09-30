"""Membership, project scope and permission checks (docs/19 section 2.2, docs/24 section 3)."""

import io
import json
import uuid
from typing import Any

import httpx
import pytest

from sightline.api.resources import Resources
from sightline.config.logging import configure_logging
from tests.api.auth.support import (
    Workspace,
    add_member,
    cookie,
    execute,
    make_user,
    make_workspace,
    open_session,
)
from tests.api.workspaces.support import make_project
from tests.conftest import PostgresServer

PROBE = "/api/v1/_probe/workspaces"


async def _signed_in(
    resources: Resources,
    pg: PostgresServer,
    workspace: Workspace | None = None,
    role: str = "owner",
    *,
    project_ids: list[uuid.UUID] | None = None,
    fresh: bool = False,
    state: str = "active",
) -> dict[str, str]:
    user = await make_user(pg)
    if workspace is not None:
        await add_member(pg, workspace, user, role, project_ids)
    token, _ = await open_session(resources, user, fresh=fresh, state=state)
    return cookie(token)


def _problem(response: httpx.Response) -> tuple[int, str]:
    return response.status_code, response.json()["code"]


def _without_request_details(body: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in body.items() if key not in ("instance", "request_id")}


async def test_a_workspace_route_needs_a_session(
    api: httpx.AsyncClient, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    assert _problem(await api.get(f"{PROBE}/{workspace.id}/member")) == (401, "unauthenticated")


async def test_a_session_that_owes_its_second_factor_is_not_signed_in(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    headers = await _signed_in(resources, migrated, workspace, state="pending_totp")
    response = await api.get(f"{PROBE}/{workspace.id}/member", headers=headers)
    assert _problem(response) == (401, "unauthenticated")


async def test_a_member_is_told_their_role_and_scope(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project_id = await make_project(migrated, workspace.id)
    headers = await _signed_in(resources, migrated, workspace, "editor", project_ids=[project_id])

    response = await api.get(f"{PROBE}/{workspace.id}/member", headers=headers)

    assert response.status_code == 200
    assert response.json()["role"] == "editor"
    assert response.json()["project_ids"] == [str(project_id)]


async def test_someone_elses_workspace_looks_exactly_like_one_that_does_not_exist(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    theirs = await make_workspace(migrated)
    headers = await _signed_in(resources, migrated, await make_workspace(migrated))

    foreign = await api.get(f"{PROBE}/{theirs.id}/member", headers=headers)
    missing = await api.get(f"{PROBE}/{uuid.uuid4()}/member", headers=headers)

    assert _problem(foreign) == _problem(missing) == (404, "not_found")
    assert _without_request_details(foreign.json()) == _without_request_details(missing.json())


async def test_a_foreign_workspace_answers_404_before_the_body_is_checked(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    theirs, mine = await make_workspace(migrated), await make_workspace(migrated)
    headers = await _signed_in(resources, migrated, mine, "admin")

    foreign = await api.post(f"{PROBE}/{theirs.id}/manage", json={"value": "x"}, headers=headers)
    own = await api.post(f"{PROBE}/{mine.id}/manage", json={"value": "x"}, headers=headers)

    assert _problem(foreign) == (404, "not_found")
    assert _problem(own) == (422, "validation_failed")


async def test_a_workspace_being_deleted_is_gone_for_its_members(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    headers = await _signed_in(resources, migrated, workspace)
    await execute(
        migrated, "UPDATE auth.workspaces SET status = 'deleting' WHERE id = $1", workspace.id
    )
    response = await api.get(f"{PROBE}/{workspace.id}/member", headers=headers)
    assert _problem(response) == (404, "not_found")


async def test_a_disabled_user_with_a_cached_session_cannot_enter_a_workspace(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    user = await make_user(migrated)
    await add_member(migrated, workspace, user, "owner")
    token, _ = await open_session(resources, user)
    assert (await api.get(f"{PROBE}/{workspace.id}/member", headers=cookie(token))).is_success

    await execute(migrated, "UPDATE auth.users SET disabled_at = now() WHERE id = $1", user.id)

    response = await api.get(f"{PROBE}/{workspace.id}/member", headers=cookie(token))
    assert _problem(response) == (404, "not_found")


async def test_removal_and_a_role_change_take_effect_on_the_next_request(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    user = await make_user(migrated)
    await add_member(migrated, workspace, user, "admin")
    token, _ = await open_session(resources, user)
    manage = f"{PROBE}/{workspace.id}/manage"
    assert (await api.post(manage, json={"value": 1}, headers=cookie(token))).is_success

    await execute(
        migrated, "UPDATE auth.memberships SET role = 'viewer' WHERE user_id = $1", user.id
    )
    demoted = await api.post(manage, json={"value": 1}, headers=cookie(token))
    await execute(migrated, "DELETE FROM auth.memberships WHERE user_id = $1", user.id)
    removed = await api.post(manage, json={"value": 1}, headers=cookie(token))

    assert _problem(demoted) == (403, "forbidden")
    assert _problem(removed) == (404, "not_found")


@pytest.mark.parametrize(
    ("role", "expected"),
    [
        ("owner", 200),
        ("admin", 200),
        ("editor", 403),
        ("analyst", 403),
        ("viewer", 403),
        ("billing", 403),
    ],
)
async def test_a_permission_is_held_by_the_roles_of_the_matrix(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, role: str, expected: int
) -> None:
    workspace = await make_workspace(migrated)
    headers = await _signed_in(resources, migrated, workspace, role)
    response = await api.post(f"{PROBE}/{workspace.id}/manage", json={"value": 1}, headers=headers)
    assert response.status_code == expected
    if expected == 403:
        assert response.json()["code"] == "forbidden"


async def test_a_fresh_route_wants_a_recent_credential_from_someone_who_may_use_it(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    url = f"{PROBE}/{workspace.id}/delete"
    stale = await _signed_in(resources, migrated, workspace, "owner")
    fresh = await _signed_in(resources, migrated, workspace, "owner", fresh=True)
    admin = await _signed_in(resources, migrated, workspace, "admin", fresh=True)

    refused = await api.post(url, headers=stale)

    assert _problem(refused) == (403, "fresh_session_required")
    assert refused.json()["reauth_url"] == "/api/v1/me/reauthenticate"
    assert (await api.post(url, headers=fresh)).status_code == 200
    # Without the permission the answer is the same whether or not the session is fresh.
    stale_admin = await _signed_in(resources, migrated, workspace, "admin")
    assert _problem(await api.post(url, headers=admin)) == (403, "forbidden")
    assert _problem(await api.post(url, headers=stale_admin)) == (403, "forbidden")


async def test_a_project_outside_the_members_scope_does_not_exist_for_them(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    inside = await make_project(migrated, workspace.id)
    outside = await make_project(migrated, workspace.id)
    base = f"{PROBE}/{workspace.id}/projects"
    viewer = await _signed_in(resources, migrated, workspace, "viewer", project_ids=[inside])
    everything = await _signed_in(resources, migrated, workspace, "viewer")

    assert (await api.get(f"{base}/{inside}", headers=viewer)).status_code == 200
    assert _problem(await api.get(f"{base}/{outside}", headers=viewer)) == (404, "not_found")
    # Scope is checked before the permission: a 403 would confirm the project exists.
    assert _problem(await api.patch(f"{base}/{outside}", headers=viewer)) == (404, "not_found")
    assert _problem(await api.patch(f"{base}/{inside}", headers=viewer)) == (403, "forbidden")
    assert (await api.get(f"{base}/{outside}", headers=everything)).status_code == 200
    assert _problem(await api.get(f"{base}/not-an-id", headers=viewer)) == (404, "not_found")


async def test_a_session_cached_for_one_workspace_never_opens_another(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    mine, theirs = await make_workspace(migrated), await make_workspace(migrated)
    headers = await _signed_in(resources, migrated, mine)

    before = await api.get(f"{PROBE}/{theirs.id}/member", headers=headers)
    # The session is in the Redis cache from here on.
    assert (await api.get(f"{PROBE}/{mine.id}/member", headers=headers)).status_code == 200
    after = await api.get(f"{PROBE}/{theirs.id}/member", headers=headers)

    assert _problem(before) == _problem(after) == (404, "not_found")


async def test_log_lines_of_a_workspace_request_name_the_workspace(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    headers = await _signed_in(resources, migrated, workspace)
    stream = io.StringIO()
    configure_logging(service="api", version="test", level="info", stream=stream)

    foreign = uuid.uuid4()
    await api.get(f"{PROBE}/{workspace.id}/log", headers=headers)
    await api.get(f"{PROBE}/{workspace.id}/boom", headers=headers)
    await api.get(f"{PROBE}/{foreign}/member", headers=headers)
    await api.get("/api/v1/_probe/current", headers=headers)

    lines = [json.loads(line) for line in stream.getvalue().splitlines() if line.strip()]
    finished = [line for line in lines if line["msg"] == "request finished"]
    # A refused attempt names the workspace that was tried, so a probe can be traced.
    assert [line.get("workspace_id") for line in finished] == [
        str(workspace.id),
        str(workspace.id),
        str(foreign),
        None,
    ]
    (unhandled,) = [line for line in lines if line["msg"] == "unhandled exception"]
    assert unhandled["workspace_id"] == str(workspace.id)
    (inside,) = [line for line in lines if line["msg"] == "inside the handler"]
    assert inside["workspace_id"] == str(workspace.id)


async def test_a_suspended_workspace_can_be_read_and_not_changed(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project_id = await make_project(migrated, workspace.id)
    owner = await _signed_in(resources, migrated, workspace, "owner", fresh=True)
    viewer = await _signed_in(resources, migrated, workspace, "viewer")
    stranger = await _signed_in(resources, migrated)
    await execute(
        migrated, "UPDATE auth.workspaces SET status = 'suspended' WHERE id = $1", workspace.id
    )
    base = f"{PROBE}/{workspace.id}"

    assert (await api.get(f"{base}/member", headers=owner)).status_code == 200
    assert (await api.get(f"{base}/projects/{project_id}", headers=viewer)).status_code == 200
    for response in (
        await api.post(f"{base}/manage", json={"value": 1}, headers=owner),
        await api.post(f"{base}/delete", headers=owner),
        await api.patch(f"{base}/projects/{project_id}", headers=owner),
        # Said before the permission is looked at: nobody can write, whatever their role.
        await api.post(f"{base}/manage", json={"value": 1}, headers=viewer),
    ):
        assert _problem(response) == (403, "workspace_suspended")
    # Someone outside still learns nothing.
    outside = await api.post(f"{base}/manage", json={"value": 1}, headers=stranger)
    assert _problem(outside) == (404, "not_found")


async def test_the_workspace_is_only_ever_taken_from_the_path(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    headers = await _signed_in(resources, migrated, workspace)

    malformed = await api.get(f"{PROBE}/not-an-id/member", headers=headers)
    # A route that forgot the workspace in its path cannot be given one in the query.
    forgotten = await api.get(
        "/api/v1/_probe/no-workspace", params={"workspace_id": str(workspace.id)}, headers=headers
    )

    assert _problem(malformed) == (422, "validation_failed")
    assert malformed.json()["errors"][0]["location"] == "path"
    assert forgotten.status_code >= 400
    assert "role" not in forgotten.text
