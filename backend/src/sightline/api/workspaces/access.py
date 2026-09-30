"""What a request may do inside one workspace."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sightline.api.auth.sessions import SessionContext
from sightline.api.permissions import ROLE_PERMISSIONS, Permission, Role


@dataclass(frozen=True, slots=True)
class WorkspaceAccess:
    session: SessionContext
    workspace_id: UUID
    role: Role
    # None: every project of the workspace.
    project_ids: frozenset[UUID] | None

    @property
    def user_id(self) -> UUID:
        return self.session.user_id

    def holds(self, permission: Permission) -> bool:
        return permission in ROLE_PERMISSIONS[self.role]

    def sees(self, project_id: UUID) -> bool:
        return self.project_ids is None or project_id in self.project_ids
