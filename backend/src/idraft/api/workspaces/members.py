"""Rules for the members of a workspace (docs/19-api-specification.md section 3.2.2)."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api import audit
from idraft.api.permissions import ROLE_PERMISSIONS, Permission, Role
from idraft.api.problems import ForbiddenError, LastOwnerError, NotFoundError, invalid_field
from idraft.api.request_info import RequestInfo
from idraft.api.workspaces import repository
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.repository import MemberRecord, Membership
from idraft.db.engine import workspace_transaction

# These roles manage the workspace, so they are never limited to some of its projects.
UNSCOPED_ROLES = frozenset({Role.OWNER, Role.ADMIN})


def scope_snapshot(project_ids: list[UUID] | None) -> list[str] | None:
    """A scope as the audit log keeps it, in one order whatever order it was stored in."""
    return None if project_ids is None else sorted(str(project_id) for project_id in project_ids)


def manages_members(role: Role) -> bool:
    return Permission.MEMBERS_MANAGE in ROLE_PERMISSIONS[role]


async def check_project_scope(
    db: AsyncSession, *, workspace_id: UUID, role: Role, project_ids: list[UUID] | None
) -> None:
    """A scope must suit the role and name projects of this workspace.

    An empty list is a scope too: a member of no project, who sees the workspace and none of
    its projects.
    """
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
            old_role = Role(target.role)
            new_role = old_role if role is None else role
            if Role.OWNER in (old_role, new_role) and actor is not Role.OWNER:
                raise ForbiddenError("Only an owner can grant or change the owner role.")
            if new_role is not Role.OWNER and owners == [target.user_id]:
                raise LastOwnerError("Make someone else an owner first.")
            if scope_given:
                new_scope = project_ids
                await check_project_scope(
                    db, workspace_id=access.workspace_id, role=new_role, project_ids=new_scope
                )
            else:
                # The scope the member has is kept as it is, not judged again: a project in it
                # may have been deleted since. Promotion to a managing role lifts it.
                new_scope = None if new_role in UNSCOPED_ROLES else target.project_ids
            if (new_role, scope_snapshot(new_scope)) != (
                old_role,
                scope_snapshot(target.project_ids),
            ):
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
                    before={"role": target.role, "project_ids": scope_snapshot(target.project_ids)},
                    after={"role": new_role.value, "project_ids": scope_snapshot(new_scope)},
                )
                await self._withdraw_invitations(
                    db, access, user_id, info, was=old_role, now=new_role
                )
            updated = await repository.get_member(db, access.workspace_id, user_id)
        if updated is None:  # pragma: no cover - read under the lock that guards removal
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
                before={"role": target.role, "project_ids": scope_snapshot(target.project_ids)},
            )
            await self._withdraw_invitations(
                db, access, user_id, info, was=Role(target.role), now=None
            )

    @staticmethod
    async def _withdraw_invitations(
        db: AsyncSession,
        access: WorkspaceAccess,
        user_id: UUID,
        info: RequestInfo,
        *,
        was: Role,
        now: Role | None,
    ) -> None:
        """Withdraw the pending invitations a member can no longer send: all of them when they
        stop managing members (`now=None` is removal), the ones to the owner role when they
        stop being an owner. Each is recorded, by whoever made the change."""
        if not manages_members(was):
            return
        if now is None or not manages_members(now):
            only_role = None
        elif was is Role.OWNER and now is not Role.OWNER:
            only_role = Role.OWNER.value
        else:
            return
        withdrawn = await repository.cancel_invitations_sent_by(
            db,
            workspace_id=access.workspace_id,
            user_id=user_id,
            only_role=only_role,
            now=datetime.now(UTC),
        )
        for invitation_id in withdrawn:
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="invitation.cancelled",
                target_type="invitation",
                target_id=invitation_id,
                info=info,
                # Tells it apart from an invitation someone withdrew by hand.
                after={"reason": "sender_removed" if now is None else "sender_demoted"},
            )

    @staticmethod
    async def _locked(
        db: AsyncSession, access: WorkspaceAccess, user_id: UUID
    ) -> tuple[list[UUID], Role, Membership]:
        """The owners, the caller's role and the member to change, read under the lock that
        lets one membership change run at a time.

        The caller's role is read again here: the dependency read it in an earlier transaction,
        and the caller may have been demoted or removed since.
        """
        await repository.lock_member_changes(db, access.workspace_id)
        owners = await repository.owner_ids(db, access.workspace_id)
        actor = await repository.membership(db, access.workspace_id, access.user_id)
        if actor is None:
            raise NotFoundError
        if not manages_members(Role(actor.role)):
            raise ForbiddenError
        target = await repository.membership(db, access.workspace_id, user_id)
        if target is None:
            raise NotFoundError
        return owners, Role(actor.role), target
