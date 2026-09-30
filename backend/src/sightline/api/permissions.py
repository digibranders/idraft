"""Workspace roles and permission keys (docs/24-security.md section 3.2, the canonical matrix).

The enum is emitted in OpenAPI, so the web client gets the same keys. Roles are fixed in V1.
"""

from __future__ import annotations

from collections.abc import Mapping
from enum import StrEnum
from types import MappingProxyType


class Role(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    EDITOR = "editor"
    ANALYST = "analyst"
    VIEWER = "viewer"
    BILLING = "billing"


class Permission(StrEnum):
    WORKSPACE_DELETE = "workspace:delete"
    WORKSPACE_UPDATE = "workspace:update"
    MEMBERS_MANAGE = "members:manage"
    INTEGRATIONS_MANAGE = "integrations:manage"
    PROVIDERS_MANAGE = "providers:manage"
    BUDGETS_MANAGE = "budgets:manage"
    COSTS_READ = "costs:read"
    PROJECTS_WRITE = "projects:write"
    KEYWORDS_WRITE = "keywords:write"
    PROMPTS_WRITE = "prompts:write"
    ENTITIES_WRITE = "entities:write"
    TAXONOMY_WRITE = "taxonomy:write"
    PANELS_CORE_MODIFY = "panels:core:modify"
    SCHEDULES_WRITE = "schedules:write"
    RUNS_TRIGGER = "runs:trigger"
    DATA_READ = "data:read"
    RAW_READ = "raw:read"
    EXPORTS_CREATE = "exports:create"
    AUDIT_READ = "audit:read"
    ALERTS_WRITE = "alerts:write"
    VIEWS_WRITE = "views:write"
    IMPORTS_WRITE = "imports:write"
    API_KEYS_MANAGE = "api_keys:manage"
    OPS_READ = "ops:read"
    TASKS_REQUEUE = "tasks:requeue"
    # An API key scope for the server log agent. No role holds it, and nothing uses it until API
    # keys ship.
    FP_LOGS_WRITE = "fp:logs:write"


_OWNER, _ADMIN, _EDITOR = Role.OWNER, Role.ADMIN, Role.EDITOR
_ANALYST, _VIEWER, _BILLING = Role.ANALYST, Role.VIEWER, Role.BILLING
_MANAGERS = (_OWNER, _ADMIN)
_WRITERS = (_OWNER, _ADMIN, _EDITOR)
_ANALYSTS = (_OWNER, _ADMIN, _EDITOR, _ANALYST)

# One line per row of the doc 24 table, in its order.
_HOLDERS: Mapping[Permission, tuple[Role, ...]] = {
    Permission.WORKSPACE_DELETE: (_OWNER,),
    Permission.WORKSPACE_UPDATE: _MANAGERS,
    Permission.MEMBERS_MANAGE: _MANAGERS,
    Permission.INTEGRATIONS_MANAGE: _MANAGERS,
    Permission.PROVIDERS_MANAGE: _MANAGERS,
    Permission.BUDGETS_MANAGE: (*_MANAGERS, _BILLING),
    Permission.COSTS_READ: (*_ANALYSTS, _BILLING),
    Permission.PROJECTS_WRITE: _WRITERS,
    Permission.KEYWORDS_WRITE: _WRITERS,
    Permission.PROMPTS_WRITE: _WRITERS,
    Permission.ENTITIES_WRITE: _WRITERS,
    Permission.TAXONOMY_WRITE: _WRITERS,
    Permission.PANELS_CORE_MODIFY: _MANAGERS,
    Permission.SCHEDULES_WRITE: _WRITERS,
    Permission.RUNS_TRIGGER: _ANALYSTS,
    Permission.DATA_READ: (*_ANALYSTS, _VIEWER),
    Permission.RAW_READ: _ANALYSTS,
    Permission.EXPORTS_CREATE: _ANALYSTS,
    Permission.AUDIT_READ: _MANAGERS,
    Permission.ALERTS_WRITE: _WRITERS,
    Permission.VIEWS_WRITE: _ANALYSTS,
    Permission.IMPORTS_WRITE: _WRITERS,
    Permission.API_KEYS_MANAGE: _MANAGERS,
    Permission.OPS_READ: _WRITERS,
    Permission.TASKS_REQUEUE: _MANAGERS,
    Permission.FP_LOGS_WRITE: (),
}

ROLE_PERMISSIONS: Mapping[Role, frozenset[Permission]] = MappingProxyType(
    {
        role: frozenset(permission for permission, holders in _HOLDERS.items() if role in holders)
        for role in Role
    }
)
# Two-factor is required for these roles (docs/24-security.md section 2).
TOTP_REQUIRED_ROLES = frozenset({Role.OWNER, Role.ADMIN})


def permissions_for(role: Role) -> list[str]:
    """The role's permission keys, sorted, as the API returns them."""
    return sorted(permission.value for permission in ROLE_PERMISSIONS[role])
