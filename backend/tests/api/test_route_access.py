"""Every route says who may call it (docs/24-security.md section 3.2).

The table is the contract. A new route must be added here with its access, and a route whose
access changes must change here too, so both show up in review.
"""

from typing import Annotated

import pytest
from fastapi import Depends, FastAPI
from fastapi.responses import PlainTextResponse
from fastapi.routing import APIRoute, iter_route_contexts

from sightline.api.access import AccessRule, declare, public, route_access
from sightline.api.main import create_app
from sightline.api.openapi import placeholder_settings
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
}


def _declared(app: FastAPI) -> dict[tuple[str, str], str | None]:
    found: dict[tuple[str, str], str | None] = {}
    for route in iter_route_contexts(app.routes):
        assert isinstance(route.original_route, APIRoute), f"{route} is not an API route"
        assert route.path is not None
        assert route.methods
        rule = route_access(route)
        for method in sorted(route.methods):
            found[(method, route.path)] = None if rule is None else rule.label
    return found


def test_every_route_declares_who_may_call_it() -> None:
    declared = _declared(create_app(placeholder_settings()))
    assert [route for route, label in declared.items() if label is None] == []


def test_the_declared_access_is_the_documented_access() -> None:
    assert _declared(create_app(placeholder_settings())) == EXPECTED


def test_the_strictest_declaration_of_a_route_is_the_one_reported() -> None:
    @declare(AccessRule("authenticated"))
    def signed_in() -> None: ...

    @declare(AccessRule("permission", Permission.MEMBERS_MANAGE, fresh=True))
    def manager(_: Annotated[None, Depends(signed_in)]) -> None: ...

    app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)

    @app.get("/open", dependencies=[Depends(public)])
    def open_route() -> None: ...

    @app.get("/managed", dependencies=[Depends(public)])
    def managed(_: Annotated[None, Depends(manager)]) -> None: ...

    @app.get("/undeclared")
    def undeclared() -> None: ...

    # Not an API route, so it has no dependencies to declare anything with.
    app.add_route("/plain", lambda request: PlainTextResponse("ok"))

    labels = {
        route.path: None if (rule := route_access(route)) is None else rule.label
        for route in iter_route_contexts(app.routes)
    }
    assert labels == {
        "/open": "public",
        "/managed": "members:manage fresh",
        "/undeclared": None,
        "/plain": None,
    }


def test_a_rule_names_a_permission_exactly_when_it_is_a_permission_rule() -> None:
    with pytest.raises(ValueError, match="permission"):
        AccessRule("permission")
    with pytest.raises(ValueError, match="permission"):
        AccessRule("member", Permission.DATA_READ)
