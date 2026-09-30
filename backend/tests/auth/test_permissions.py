"""The matrix of docs/24-security.md section 3.2, typed out again so a change needs two edits."""

from sightline.api.permissions import (
    ROLE_PERMISSIONS,
    TOTP_REQUIRED_ROLES,
    Permission,
    Role,
    permissions_for,
)

DOC_24_MATRIX = {
    "workspace:delete": "owner",
    "workspace:update": "owner admin",
    "members:manage": "owner admin",
    "integrations:manage": "owner admin",
    "providers:manage": "owner admin",
    "budgets:manage": "owner admin billing",
    "costs:read": "owner admin editor analyst billing",
    "projects:write": "owner admin editor",
    "keywords:write": "owner admin editor",
    "prompts:write": "owner admin editor",
    "entities:write": "owner admin editor",
    "taxonomy:write": "owner admin editor",
    "panels:core:modify": "owner admin",
    "schedules:write": "owner admin editor",
    "runs:trigger": "owner admin editor analyst",
    "data:read": "owner admin editor analyst viewer",
    "raw:read": "owner admin editor analyst",
    "exports:create": "owner admin editor analyst",
    "audit:read": "owner admin",
    "alerts:write": "owner admin editor",
    "views:write": "owner admin editor analyst",
    "imports:write": "owner admin editor",
    "api_keys:manage": "owner admin",
    "ops:read": "owner admin editor",
    "tasks:requeue": "owner admin",
    "fp:logs:write": "",
}


def test_the_permission_keys_are_exactly_the_documented_ones() -> None:
    assert {permission.value for permission in Permission} == set(DOC_24_MATRIX)


def test_the_roles_are_the_six_workspace_roles() -> None:
    assert [role.value for role in Role] == [
        "owner",
        "admin",
        "editor",
        "analyst",
        "viewer",
        "billing",
    ]


def test_each_role_holds_exactly_its_documented_permissions() -> None:
    expected = {
        role: frozenset(
            Permission(key) for key, roles in DOC_24_MATRIX.items() if role in roles.split()
        )
        for role in Role
    }
    assert dict(ROLE_PERMISSIONS) == expected


def test_only_the_log_agent_scope_is_granted_to_no_role() -> None:
    granted = frozenset().union(*ROLE_PERMISSIONS.values())
    assert set(Permission) - granted == {Permission.FP_LOGS_WRITE}


def test_permissions_for_a_role_are_sorted_keys() -> None:
    assert permissions_for(Role.BILLING) == ["budgets:manage", "costs:read"]
    assert permissions_for(Role.VIEWER) == ["data:read"]


def test_owner_and_admin_must_use_two_factor() -> None:
    assert frozenset({Role.OWNER, Role.ADMIN}) == TOTP_REQUIRED_ROLES
