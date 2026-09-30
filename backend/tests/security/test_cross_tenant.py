"""The cross-tenant suite (docs/26-testing-quality.md section 6.1, cases XT-01 to XT-05).

Workspaces A and B are built alike. Every route with a workspace in its path is taken from the
application itself and called as A's owner with B's ids, so a new route is covered without being
added here. A route whose path has a parameter this suite has no id for fails, and so does a
route that is neither workspace-scoped nor listed in cross_tenant_exceptions.py.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from typing import Any

import httpx
import pytest
from fastapi.routing import iter_route_contexts

from sightline.api.auth.tokens import hash_token, new_token
from sightline.api.main import create_app
from sightline.api.openapi import placeholder_settings
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
from tests.api.test_route_access import PATH_PARAMETER
from tests.api.workspaces.support import make_project
from tests.conftest import PostgresServer
from tests.security.cross_tenant_exceptions import NOT_PATH_SCOPED

_W = "/api/v1/workspaces/{workspace_id}"
_READ = ("GET", "HEAD")


def _routes() -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    for route in iter_route_contexts(create_app(placeholder_settings()).routes):
        assert route.path is not None
        assert route.methods
        found.extend((method, route.path) for method in sorted(route.methods))
    return found


ALL_ROUTES = _routes()


def _names(path: str) -> list[str]:
    """The path's parameters, written `{name}` or `{name:converter}`."""
    return PATH_PARAMETER.findall(path)


WORKSPACE_ROUTES = [(method, path) for method, path in ALL_ROUTES if "workspace_id" in _names(path)]
# Routes that also name something inside the workspace: a project, a member, an invitation.
CHILD_ROUTES = [
    (method, path) for method, path in WORKSPACE_ROUTES if set(_names(path)) - {"workspace_id"}
]
# Every GET that returns tenant data without naming a child: the lists, and the two routes
# that list the caller's workspaces.
LIST_ROUTES = [
    (method, path)
    for method, path in WORKSPACE_ROUTES
    if method == "GET" and (method, path) not in CHILD_ROUTES
] + [("GET", "/api/v1/me"), ("GET", "/api/v1/workspaces")]

# A body each mutating route accepts, so a request that is let through would change something.
BODIES: dict[tuple[str, str], dict[str, Any]] = {
    ("PATCH", _W): {"name": "Taken over"},
    ("PATCH", _W + "/members/{user_id}"): {"role": "viewer"},
    ("POST", _W + "/invitations"): {"email": "intruder@evil.example", "role": "admin"},
    ("POST", _W + "/projects"): {"name": "Planted", "slug": "planted"},
    ("PATCH", _W + "/projects/{project_id}"): {"name": "Taken over"},
}


@dataclass(frozen=True)
class Tenant:
    workspace: Workspace
    owner: User
    headers: dict[str, str]
    member: User
    project_id: uuid.UUID
    invitation_id: uuid.UUID
    invitee: str

    def ids(self) -> dict[str, str]:
        return {
            "workspace_id": str(self.workspace.id),
            "project_id": str(self.project_id),
            "user_id": str(self.member.id),
            "invitation_id": str(self.invitation_id),
        }

    def secrets(self) -> list[str]:
        """Everything that identifies this tenant and must never reach another."""
        return [
            *self.ids().values(),
            str(self.owner.id),
            self.workspace.slug,
            self.owner.email,
            self.member.email,
            self.invitee,
        ]


async def _tenant(resources: Resources, pg: PostgresServer, label: str) -> Tenant:
    """One workspace with an owner, a second member, a project and a pending invitation. The two
    tenants collide where they can: same names, same project slug."""
    workspace = await make_workspace(pg, name="Acme")
    owner, member = await make_user(pg, name="Owner"), await make_user(pg, name="Member")
    await add_member(pg, workspace, owner, "owner")
    await add_member(pg, workspace, member, "editor")
    project_id = await make_project(pg, workspace.id, name="crm software", slug="crm-software")
    await execute(pg, "INSERT INTO core.workspace_quotas (workspace_id) VALUES ($1)", workspace.id)
    invitee = f"{label}-invitee-{uuid.uuid4().hex[:8]}@client.example"
    invitation = await fetchrow(
        pg,
        "INSERT INTO auth.invitations (workspace_id, email, role, token_hash, invited_by, "
        "expires_at) VALUES ($1, $2, 'viewer', $3, $4, now() + interval '7 days') RETURNING id",
        workspace.id,
        invitee,
        hash_token(new_token()),
        owner.id,
    )
    # Fresh, so that a route wanting a recent credential is not refused for that instead.
    token, _ = await open_session(resources, owner, fresh=True)
    return Tenant(
        workspace=workspace,
        owner=owner,
        headers=cookie(token),
        member=member,
        project_id=project_id,
        invitation_id=invitation["id"],
        invitee=invitee,
    )


@pytest.fixture
async def tenants(resources: Resources, migrated: PostgresServer) -> tuple[Tenant, Tenant]:
    return await _tenant(resources, migrated, "a"), await _tenant(resources, migrated, "b")


def _fill(path: str, ids: dict[str, str]) -> str:
    def value(match: re.Match[str]) -> str:
        name = match.group(1)
        assert name in ids, f"the cross-tenant suite has no id for the path parameter {name!r}"
        return ids[name]

    filled = PATH_PARAMETER.sub(value, path)
    assert "{" not in filled, f"a path parameter of {path} was not understood"
    return filled


async def _call(
    api: httpx.AsyncClient, method: str, path: str, ids: dict[str, str], headers: dict[str, str]
) -> httpx.Response:
    body = None if method in _READ else BODIES.get((method, path), {})
    return await api.request(method, _fill(path, ids), json=body, headers=headers)


def _problem(response: httpx.Response) -> tuple[int, str]:
    return response.status_code, response.json()["code"]


def _without_request_details(response: httpx.Response) -> dict[str, Any]:
    body: dict[str, Any] = response.json()
    return {key: value for key, value in body.items() if key not in ("instance", "request_id")}


_TENANT_ROWS = {
    "auth.workspaces": "id",
    "auth.memberships": "workspace_id",
    "auth.invitations": "workspace_id",
    "core.projects": "workspace_id",
    "core.workspace_quotas": "workspace_id",
    "ops.audit_logs": "workspace_id",
}


async def _checksum(pg: PostgresServer, *workspaces: Workspace) -> dict[str, str | None]:
    """A digest of every row the two tenants have, table by table."""
    ids = [workspace.id for workspace in workspaces]
    digests = {}
    for table, column in _TENANT_ROWS.items():
        row = await fetchrow(
            pg,
            f"SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) AS digest FROM {table} t "
            f"WHERE t.{column} = ANY($1::uuid[])",
            ids,
        )
        digests[table] = row["digest"]
    return digests


def test_every_route_is_scoped_by_a_workspace_or_accounted_for() -> None:
    unscoped = {route for route in ALL_ROUTES if "workspace_id" not in _names(route[1])}
    assert unscoped == set(NOT_PATH_SCOPED)
    assert all(path.startswith("/api/v1/workspaces/{workspace_id}") for _, path in WORKSPACE_ROUTES)
    # Each mutating route has a body that would do something if it were let through.
    mutating_with_body = {
        (method, path) for method, path in WORKSPACE_ROUTES if method in ("POST", "PATCH", "PUT")
    }
    assert mutating_with_body == set(BODIES)


@pytest.mark.parametrize(("method", "path"), WORKSPACE_ROUTES)
async def test_another_workspaces_path_is_not_found(
    api: httpx.AsyncClient, tenants: tuple[Tenant, Tenant], method: str, path: str
) -> None:
    """XT-01, XT-02 and XT-03: B's ids in the path, as A's owner. Always 404, never 403, and
    the same answer as for a workspace that does not exist."""
    a, b = tenants
    missing = {name: str(uuid.uuid4()) for name in b.ids()}

    foreign = await _call(api, method, path, b.ids(), a.headers)
    nowhere = await _call(api, method, path, missing, a.headers)

    assert _problem(foreign) == _problem(nowhere) == (404, "not_found")
    assert _without_request_details(foreign) == _without_request_details(nowhere)


@pytest.mark.parametrize(("method", "path"), CHILD_ROUTES)
async def test_another_workspaces_child_in_the_callers_own_path_is_not_found(
    api: httpx.AsyncClient, tenants: tuple[Tenant, Tenant], method: str, path: str
) -> None:
    """XT-01 and XT-02 for child ids: A's workspace in the path, B's project, member or
    invitation after it."""
    a, b = tenants
    ids = {**b.ids(), "workspace_id": str(a.workspace.id)}
    missing = {**{name: str(uuid.uuid4()) for name in b.ids()}, "workspace_id": str(a.workspace.id)}

    foreign = await _call(api, method, path, ids, a.headers)
    nowhere = await _call(api, method, path, missing, a.headers)

    assert _problem(foreign) == _problem(nowhere) == (404, "not_found")
    assert _without_request_details(foreign) == _without_request_details(nowhere)


PROJECT_ROUTES = [
    (method, path) for method, path in WORKSPACE_ROUTES if "project_id" in _names(path)
]


@pytest.mark.parametrize(("method", "path"), PROJECT_ROUTES)
async def test_a_project_outside_the_members_scope_is_not_found(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    tenants: tuple[Tenant, Tenant],
    method: str,
    path: str,
) -> None:
    """The same isolation inside one workspace: a member limited to one project gets 404 for
    another project of their own workspace, on every route that names a project, whatever
    their role would otherwise allow."""
    a, _ = tenants
    hidden = await make_project(migrated, a.workspace.id, name="Hidden", slug="hidden")
    limited = await make_user(migrated, name="Limited")
    await add_member(migrated, a.workspace, limited, "editor", [a.project_id])
    token, _ = await open_session(resources, limited, fresh=True)

    outside = await _call(api, method, path, {**a.ids(), "project_id": str(hidden)}, cookie(token))
    nowhere = await _call(
        api, method, path, {**a.ids(), "project_id": str(uuid.uuid4())}, cookie(token)
    )
    inside = await _call(api, method, path, a.ids(), cookie(token))

    assert _problem(outside) == _problem(nowhere) == (404, "not_found")
    assert _without_request_details(outside) == _without_request_details(nowhere)
    assert inside.status_code < 300, inside.text
    row = await fetchrow(migrated, "SELECT name FROM core.projects WHERE id = $1", hidden)
    assert row["name"] == "Hidden"


async def test_no_request_with_another_workspaces_ids_changes_anything(
    api: httpx.AsyncClient, migrated: PostgresServer, tenants: tuple[Tenant, Tenant]
) -> None:
    """XT-02: every mutating route, both ways, leaves every tenant row as it was."""
    a, b = tenants
    before = await _checksum(migrated, a.workspace, b.workspace)
    assert all(digest is not None for table, digest in before.items() if table != "ops.audit_logs")

    for method, path in WORKSPACE_ROUTES:
        if method in _READ:
            continue
        await _call(api, method, path, b.ids(), a.headers)
        if (method, path) in CHILD_ROUTES:
            await _call(
                api, method, path, {**b.ids(), "workspace_id": str(a.workspace.id)}, a.headers
            )

    assert await _checksum(migrated, a.workspace, b.workspace) == before


@pytest.mark.parametrize(("method", "path"), LIST_ROUTES)
async def test_a_list_holds_nothing_of_another_workspace(
    api: httpx.AsyncClient, tenants: tuple[Tenant, Tenant], method: str, path: str
) -> None:
    """XT-04: every list for A is scanned for every id, slug and address of B."""
    a, b = tenants

    response = await api.get(_fill(path, a.ids()), headers=a.headers)

    assert response.status_code == 200, response.text
    for secret in b.secrets():
        assert secret not in response.text, f"{path} shows {secret} of another workspace"
    # The list is not empty for a trivial reason: it shows A's own data.
    assert str(a.workspace.id) in response.text or str(a.owner.id) in response.text


async def test_the_same_holds_once_the_session_is_cached_and_for_a_member_of_both(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    tenants: tuple[Tenant, Tenant],
) -> None:
    """XT-05, and the case row-level security alone would not stop: someone who belongs to both
    workspaces sees, in each, only that workspace."""
    a, b = tenants
    # The session is in the Redis cache after the first request.
    assert (await api.get(_fill(_W, a.ids()), headers=a.headers)).status_code == 200
    assert _problem(await api.get(_fill(_W, b.ids()), headers=a.headers)) == (404, "not_found")

    both = await make_user(migrated, name="Both")
    await add_member(migrated, a.workspace, both, "owner")
    await add_member(migrated, b.workspace, both, "owner")
    token, _ = await open_session(resources, both, fresh=True)
    for path in (_W + "/members", _W + "/projects", _W + "/invitations"):
        response = await api.get(_fill(path, a.ids()), headers=cookie(token))
        assert response.status_code == 200
        for secret in (str(b.project_id), str(b.member.id), str(b.invitation_id), b.invitee):
            assert secret not in response.text, path
    # B's children are not reachable through A's path even for a member of both.
    for method, path in CHILD_ROUTES:
        ids = {**b.ids(), "workspace_id": str(a.workspace.id)}
        response = await _call(api, method, path, ids, cookie(token))
        assert _problem(response) == (404, "not_found"), (method, path)
    rows = await fetch(migrated, "SELECT name FROM core.projects WHERE id = $1", b.project_id)
    assert [row["name"] for row in rows] == ["crm software"]
    await execute(migrated, "DELETE FROM auth.memberships WHERE user_id = $1", both.id)
