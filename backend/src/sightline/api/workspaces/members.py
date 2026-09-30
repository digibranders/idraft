"""Rules for the members of a workspace (docs/19-api-specification.md section 3.2.2)."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.api import audit
from sightline.api.permissions import ROLE_PERMISSIONS, Permission, Role
from sightline.api.problems import ForbiddenError, LastOwnerError, NotFoundError, invalid_field
from sightline.api.request_info import RequestInfo
from sightline.api.workspaces import repository
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.api.workspaces.repository import MemberRecord
from sightline.db.engine import workspace_transaction

# These roles manage the workspace, so they are never limited to some of its projects.
UNSCOPED_ROLES = frozenset({Role.OWNER, Role.ADMIN})


def _scope(project_ids: list[UUID] | None) -> list[str] | None:
    return None if project_ids is None else [str(project_id) for project_id in project_ids]


async def check_project_scope(
    db: AsyncSession, *, workspace_id: UUID, role: Role, project_ids: list[UUID] | None
) -> None:
    """A scope must suit the role and name projects of this workspace."""
    if project_ids is None:
        return
    if role in UNSCOPED_ROLES:
        raise invalid_field(
            "project_ids", code="scope_not_allowed", message="An owner or admin has every project."
        )
    if await repository.unknown_projects(db, workspace_id, project_ids):
        raise invalid_field(
            "project_ids", code="project_unknown", message="Not a project of this workspace."
        )


class MemberService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    async def page(
        self, access: WorkspaceAccess, *, offset: int, limit: int
    ) -> tuple[list[MemberRecord], int]:
        async with workspace_transaction(
            self._sessions, access.workspace_id, user_id=access.user_id
        ) as db:
            return await repository.list_members(
                db, access.workspace_id, offset=offset, limit=limit
            )

    async def update(
        self,
        *,
        access: WorkspaceAccess,
        user_id: UUID,
        role: Role | None,
        scope_given: bool,
        project_ids: list[UUID] | None,
        info: RequestInfo,
    ) -> MemberRecord:
        """Change a member's role, project scope or both. `role=None` keeps the role."""
        async with workspace_transaction(
            self._sessions, access.workspace_id, user_id=access.user_id
        ) as db:
            owners, actor, target = await self._locked(db, access, user_id)
            new_role = Role(target.role) if role is None else role
            if scope_given:
                new_scope = project_ids
            else:
                # Promotion to a managing role lifts a limit the member had.
                new_scope = None if new_role in UNSCOPED_ROLES else target.project_ids
            if Role.OWNER in (Role(target.role), new_role) and actor is not Role.OWNER:
                raise ForbiddenError("Only an owner can grant or change the owner role.")
            if new_role is not Role.OWNER and owners == [target.user_id]:
                raise LastOwnerError("Make someone else an owner first.")
            await check_project_scope(
                db, workspace_id=access.workspace_id, role=new_role, project_ids=new_scope
            )
            if (new_role, new_scope) == (Role(target.role), target.project_ids):
                return target
            await repository.update_member(
                db,
                workspace_id=access.workspace_id,
                user_id=user_id,
                role=new_role,
                project_ids=new_scope,
            )
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="member.updated",
                target_type="user",
                target_id=user_id,
                info=info,
                before={"role": target.role, "project_ids": _scope(target.project_ids)},
                after={"role": new_role.value, "project_ids": _scope(new_scope)},
            )
            updated = await repository.get_member(db, access.workspace_id, user_id)
        if updated is None:  # pragma: no cover - the row was locked by this transaction
            raise NotFoundError
        return updated

    async def remove(self, *, access: WorkspaceAccess, user_id: UUID, info: RequestInfo) -> None:
        async with workspace_transaction(
            self._sessions, access.workspace_id, user_id=access.user_id
        ) as db:
            owners, actor, target = await self._locked(db, access, user_id)
            if Role(target.role) is Role.OWNER and actor is not Role.OWNER:
                raise ForbiddenError("Only an owner can remove an owner.")
            if owners == [target.user_id]:
                raise LastOwnerError("Make someone else an owner first.")
            await repository.delete_member(db, workspace_id=access.workspace_id, user_id=user_id)
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="member.removed",
                target_type="user",
                target_id=user_id,
                info=info,
                before={"role": target.role, "project_ids": _scope(target.project_ids)},
            )

    @staticmethod
    async def _locked(
        db: AsyncSession, access: WorkspaceAccess, user_id: UUID
    ) -> tuple[list[UUID], Role, MemberRecord]:
        """The owners, the caller's role and the member to change, read under lock.

        The caller's role is read again here: the dependency read it in an earlier transaction,
        and the caller may have been demoted or removed since.
        """
        owners = await repository.lock_owners(db, access.workspace_id)
        actor = await repository.get_member(db, access.workspace_id, access.user_id)
        if actor is None:
            raise NotFoundError
        if Permission.MEMBERS_MANAGE not in ROLE_PERMISSIONS[Role(actor.role)]:
            raise ForbiddenError
        target = await repository.get_member(db, access.workspace_id, user_id, for_update=True)
        if target is None:
            raise NotFoundError
        return owners, Role(actor.role), target
