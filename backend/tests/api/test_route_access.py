"""Every route says who may call it (docs/24-security.md section 3.2).

The table is the contract. A new route must be added here with its access, and a route whose
access changes must change here too, so both show up in review.
"""

import re
from typing import Annotated

import pytest
from fastapi import Depends, FastAPI
from fastapi.responses import PlainTextResponse
from fastapi.routing import APIRoute, iter_route_contexts

from sightline.api.access import AccessRule, declare, public, route_access
from sightline.api.main import create_app
from sightline.api.openapi import placeholder_settings
from sightline.api.pagination import _query_names
from sightline.api.permissions import Permission

EXPECTED: dict[tuple[str, str], str] = {
    ("GET", "/api/healthz"): "public",
    ("GET", "/api/readyz"): "public",
    ("GET", "/api/v1/openapi.json"): "authenticated",
    ("POST", "/api/v1/auth/register"): "public",
    ("POST", "/api/v1/auth/verify-email/request"): "public",
    ("POST", "/api/v1/auth/verify-email"): "public",
    ("POST", "/api/v1/auth/sign-in"): "public",
    ("POST", "/api/v1/auth/sign-out"): "public",
    ("POST", "/api/v1/auth/password-reset/request"): "public",
    ("POST", "/api/v1/auth/password-reset/confirm"): "public",
    ("POST", "/api/v1/auth/password/change"): "authenticated fresh",
    ("POST", "/api/v1/auth/totp/setup"): "authenticated fresh",
    ("POST", "/api/v1/auth/totp/setup/confirm"): "authenticated",
    ("POST", "/api/v1/auth/totp/verify"): "authenticated",
    ("POST", "/api/v1/auth/totp/recovery-codes"): "authenticated fresh",
    ("POST", "/api/v1/auth/totp/disable"): "authenticated fresh",
    ("GET", "/api/v1/auth/sessions"): "authenticated",
    ("POST", "/api/v1/auth/sessions/revoke-others"): "authenticated",
    ("DELETE", "/api/v1/auth/sessions/{session_id}"): "authenticated",
    ("GET", "/api/v1/me"): "authenticated",
    ("PATCH", "/api/v1/me"): "authenticated",
    ("POST", "/api/v1/me/reauthenticate"): "authenticated",
    ("GET", "/api/v1/workspaces"): "authenticated",
    ("POST", "/api/v1/workspaces"): "authenticated",
    ("GET", "/api/v1/workspaces/{workspace_id}"): "member",
    ("PATCH", "/api/v1/workspaces/{workspace_id}"): "workspace:update",
    ("GET", "/api/v1/workspaces/{workspace_id}/members"): "member",
    ("PATCH", "/api/v1/workspaces/{workspace_id}/members/{user_id}"): "members:manage fresh",
    ("DELETE", "/api/v1/workspaces/{workspace_id}/members/{user_id}"): "members:manage fresh",
    ("GET", "/api/v1/workspaces/{workspace_id}/invitations"): "members:manage",
    ("POST", "/api/v1/workspaces/{workspace_id}/invitations"): "members:manage",
    (
        "DELETE",
        "/api/v1/workspaces/{workspace_id}/invitations/{invitation_id}",
    ): "members:manage",
    ("POST", "/api/v1/invitations/accept"): "authenticated",
    ("GET", "/api/v1/locations"): "authenticated",
    ("GET", "/api/v1/domain-categories"): "authenticated",
    ("GET", "/api/v1/workspaces/{workspace_id}/projects"): "member",
    ("POST", "/api/v1/workspaces/{workspace_id}/projects"): "projects:write every-project",
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}"): "member",
    ("PATCH", "/api/v1/workspaces/{workspace_id}/projects/{project_id}"): "projects:write",
    # A role belongs to one project, so a member limited to it may change it.
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/entities"): "data:read",
    ("POST", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/entities"): "entities:write",
    (
        "PATCH",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/entities/{entity_id}",
    ): "entities:write",
    (
        "DELETE",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/entities/{entity_id}",
    ): "entities:write",
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/domains"): "data:read",
    ("POST", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/alias-test"): "data:read",
    # Entities are shared by the workspace's projects, so changing one needs every project.
    ("GET", "/api/v1/workspaces/{workspace_id}/entities"): "data:read",
    ("POST", "/api/v1/workspaces/{workspace_id}/entities"): "entities:write every-project",
    ("GET", "/api/v1/workspaces/{workspace_id}/entities/{entity_id}"): "data:read",
    (
        "PATCH",
        "/api/v1/workspaces/{workspace_id}/entities/{entity_id}",
    ): "entities:write every-project",
    (
        "DELETE",
        "/api/v1/workspaces/{workspace_id}/entities/{entity_id}",
    ): "entities:write every-project",
    ("GET", "/api/v1/workspaces/{workspace_id}/entities/{entity_id}/aliases"): "data:read",
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/entities/{entity_id}/aliases",
    ): "entities:write every-project",
    (
        "PATCH",
        "/api/v1/workspaces/{workspace_id}/entities/{entity_id}/aliases/{alias_id}",
    ): "entities:write every-project",
    (
        "DELETE",
        "/api/v1/workspaces/{workspace_id}/entities/{entity_id}/aliases/{alias_id}",
    ): "entities:write every-project",
    ("GET", "/api/v1/workspaces/{workspace_id}/entities/{entity_id}/domains"): "data:read",
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/entities/{entity_id}/domains",
    ): "entities:write every-project",
    (
        "DELETE",
        "/api/v1/workspaces/{workspace_id}/entities/{entity_id}/domains/{entity_domain_id}",
    ): "entities:write every-project",
}


def _declared(app: FastAPI) -> dict[tuple[str, str], str | None]:
    found: dict[tuple[str, str], str | None] = {}
    for route in iter_route_contexts(app.routes):
        assert isinstance(route.original_route, APIRoute), f"{route} is not an API route"
        assert route.path is not None
        assert route.methods
        for method in sorted(route.methods):
            found[(method, route.path)] = route_access(route)
    return found


def test_every_route_declares_who_may_call_it() -> None:
    declared = _declared(create_app(placeholder_settings()))
    assert [route for route, label in declared.items() if label is None] == []


def test_the_declared_access_is_the_documented_access() -> None:
    app = create_app(placeholder_settings())
    assert _declared(app) == EXPECTED
    # An override would replace a check without changing what the route declares.
    assert app.dependency_overrides == {}


# The path parameters routes may use. The membership dependency checks the project scope for the
# one named `project_id`, so a project must never travel under another name: a new name is added
# here only after confirming it is not a project, or a thing inside one project, in disguise. A
# route for something inside a project carries `{project_id}` before it.
PATH_PARAMETERS = {
    "workspace_id",
    "project_id",
    "user_id",
    "invitation_id",
    "session_id",
    # Workspace-level: an entity is shared by projects, never inside one.
    "entity_id",
    "alias_id",
    "entity_domain_id",
}
# `{name}` or `{name:converter}`.
PATH_PARAMETER = re.compile(r"\{(\w+)(?::\w+)?\}")


def test_a_path_parameter_is_recognised_with_or_without_a_converter() -> None:
    path = "/api/v1/workspaces/{workspace_id}/projects/{pid:uuid}/files/{name:path}"
    assert PATH_PARAMETER.findall(path) == ["workspace_id", "pid", "name"]
    assert re.findall(r"/projects/\{(\w+)", path) == ["pid"]


def test_path_parameters_come_from_a_known_set_and_a_project_is_called_project_id() -> None:
    for route in iter_route_contexts(create_app(placeholder_settings()).routes):
        assert route.path is not None
        names = PATH_PARAMETER.findall(route.path)
        # Every brace was understood: a `{name:converter}` must not slip past as no parameter.
        assert len(names) == route.path.count("{"), route.path
        assert set(names) <= PATH_PARAMETERS, route.path
        after_projects = re.findall(r"/projects/\{(\w+)", route.path)
        assert after_projects in ([], ["project_id"]), route.path
        if "project_id" in names:
            assert names[:2] == ["workspace_id", "project_id"], route.path


def test_no_router_adds_a_query_parameter_to_the_routes_it_includes() -> None:
    """`reject_unknown_query` reads the parameters of the route itself. A dependency given to
    `include_router` would declare one it cannot see."""
    for route in iter_route_contexts(create_app(placeholder_settings()).routes):
        assert isinstance(route.original_route, APIRoute)
        assert set(_query_names(route.dependant)) == set(
            _query_names(route.original_route.dependant)
        ), route.path


def test_every_requirement_of_a_route_is_reported() -> None:
    @declare(AccessRule("authenticated"))
    def signed_in() -> None: ...

    @declare(AccessRule("authenticated", fresh=True))
    def recently(_: Annotated[None, Depends(signed_in)]) -> None: ...

    @declare(AccessRule("member"))
    def member(_: Annotated[None, Depends(signed_in)]) -> None: ...

    @declare(AccessRule("permission", Permission.MEMBERS_MANAGE, fresh=True))
    def manager(_: Annotated[None, Depends(member)]) -> None: ...

    @declare(AccessRule("permission", Permission.AUDIT_READ))
    def auditor(_: Annotated[None, Depends(member)]) -> None: ...

    app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)

    @app.get("/open", dependencies=[Depends(public)])
    def open_route() -> None: ...

    @app.get("/managed", dependencies=[Depends(public)])
    def managed(_: Annotated[None, Depends(manager)]) -> None: ...

    @app.get("/member-fresh", dependencies=[Depends(recently)])
    def member_fresh(_: Annotated[None, Depends(member)]) -> None: ...

    @app.get("/audited-fresh", dependencies=[Depends(recently)])
    def audited_fresh(_: Annotated[None, Depends(auditor)]) -> None: ...

    @app.get("/both", dependencies=[Depends(manager), Depends(auditor)])
    def both() -> None: ...

    @app.get("/undeclared")
    def undeclared() -> None: ...

    # Not an API route, so it has no dependencies to declare anything with.
    app.add_route("/plain", lambda request: PlainTextResponse("ok"))

    labels = {route.path: route_access(route) for route in iter_route_contexts(app.routes)}
    assert labels == {
        "/open": "public",
        "/managed": "members:manage fresh",
        "/member-fresh": "member fresh",
        "/audited-fresh": "audit:read fresh",
        "/both": "audit:read + members:manage fresh",
        "/undeclared": None,
        "/plain": None,
    }


def test_a_rule_names_a_permission_exactly_when_it_is_a_permission_rule() -> None:
    with pytest.raises(ValueError, match="permission"):
        AccessRule("permission")
    with pytest.raises(ValueError, match="permission"):
        AccessRule("member", Permission.DATA_READ)
