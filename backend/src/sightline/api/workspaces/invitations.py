"""Rules for invitations (docs/19-api-specification.md section 3.2.2).

An invitation is sent to an address, and only an account with that address can accept it. The
link carries a token; the database keeps its hash. Accepting is by token, not by id: someone who
is not yet a member cannot see the invitation row, and the only lookup the database offers them
is by token hash.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.api import audit, limits
from sightline.api.auth import repository as users
from sightline.api.auth.sessions import SessionContext
from sightline.api.auth.throttle import LoginThrottle
from sightline.api.auth.tokens import hash_token, new_token
from sightline.api.permissions import ROLE_PERMISSIONS, Permission, Role
from sightline.api.problems import (
    DuplicateError,
    EmailNotVerifiedError,
    ForbiddenError,
    InvalidStateTransitionError,
    InvalidTokenError,
    InvitationExpiredError,
    NotFoundError,
    UnauthenticatedError,
    WorkspaceSuspendedError,
)
from sightline.api.request_info import RequestInfo
from sightline.api.workspaces import repository
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.api.workspaces.mail import invitation_email
from sightline.api.workspaces.members import check_project_scope
from sightline.api.workspaces.repository import (
    InvitationPendingError,
    InvitationRecord,
    MemberRecord,
    TokenInvitation,
)
from sightline.db.engine import user_transaction, workspace_transaction
from sightline.providers.email import EmailMessage, EmailSender

INVITATION_LIFETIME = timedelta(days=7)
# An invitation makes the platform send mail to an address of the caller's choosing.
INVITATIONS_PER_HOUR_PER_WORKSPACE = 50
INVITATIONS_PER_HOUR_PER_INVITER = 20
_HOUR = 3600
_log = structlog.get_logger(__name__)


def _scope(project_ids: list[UUID] | None) -> list[str] | None:
    return None if project_ids is None else [str(project_id) for project_id in project_ids]


class InvitationService:
    def __init__(
        self,
        *,
        sessions: async_sessionmaker[AsyncSession],
        throttle: LoginThrottle,
        email: EmailSender,
        app_origin: str,
    ) -> None:
        self._sessions = sessions
        self._throttle = throttle
        self._email = email
        self._origin = app_origin

    async def create(
        self,
        *,
        access: WorkspaceAccess,
        email: str,
        role: Role,
        project_ids: list[UUID] | None,
        info: RequestInfo,
    ) -> tuple[InvitationRecord, EmailMessage]:
        """Invite an address. Returns the invitation and the message to send it with."""
        # The inviter first: a refused attempt then costs the workspace nothing.
        await limits.enforce(
            self._throttle,
            "invite:inviter",
            access.user_id,
            limit=INVITATIONS_PER_HOUR_PER_INVITER,
            window_seconds=_HOUR,
        )
        await limits.enforce(
            self._throttle,
            "invite:workspace",
            access.workspace_id,
            limit=INVITATIONS_PER_HOUR_PER_WORKSPACE,
            window_seconds=_HOUR,
        )
        now = datetime.now(UTC)
        token = new_token()
        try:
            async with workspace_transaction(
                self._sessions, access.workspace_id, user_id=access.user_id
            ) as db:
                # Taken with the lock that membership changes take, and read again here: the
                # dependency read the role in an earlier transaction, and a manager who is being
                # demoted or removed must not get an invitation out past that change.
                await repository.lock_member_changes(db, access.workspace_id)
                inviter = await repository.get_member(db, access.workspace_id, access.user_id)
                workspace = await repository.get(db, access.workspace_id)
                if inviter is None or workspace is None:
                    raise NotFoundError
                if Permission.MEMBERS_MANAGE not in ROLE_PERMISSIONS[Role(inviter.role)]:
                    raise ForbiddenError
                if role is Role.OWNER and Role(inviter.role) is not Role.OWNER:
                    raise ForbiddenError("Only an owner can invite an owner.")
                await check_project_scope(
                    db, workspace_id=access.workspace_id, role=role, project_ids=project_ids
                )
                if await repository.is_member_email(db, access.workspace_id, email):
                    raise DuplicateError("This person is already a member.")
                await repository.expire_stale_invitations(
                    db, workspace_id=access.workspace_id, email=email, now=now
                )
                invitation_id = await repository.insert_invitation(
                    db,
                    workspace_id=access.workspace_id,
                    email=email,
                    role=role,
                    project_ids=project_ids,
                    token_hash=hash_token(token),
                    invited_by=access.user_id,
                    expires_at=now + INVITATION_LIFETIME,
                )
                await audit.record(
                    db,
                    workspace_id=access.workspace_id,
                    actor_id=access.user_id,
                    action="invitation.created",
                    target_type="invitation",
                    target_id=invitation_id,
                    info=info,
                    after={"email": email, "role": role.value, "project_ids": _scope(project_ids)},
                )
                invitation = await repository.get_invitation(db, access.workspace_id, invitation_id)
        except InvitationPendingError:
            raise DuplicateError("An invitation to this address is already pending.") from None
        if invitation is None:  # pragma: no cover - inserted by this transaction
            raise NotFoundError
        message = invitation_email(
            origin=self._origin,
            to=email,
            workspace_name=workspace.name,
            inviter_name=inviter.name,
            role=role.value,
            token=token,
        )
        return invitation, message

    async def page(
        self, access: WorkspaceAccess, *, offset: int, limit: int
    ) -> tuple[list[InvitationRecord], int]:
        async with workspace_transaction(
            self._sessions, access.workspace_id, user_id=access.user_id
        ) as db:
            return await repository.list_invitations(
                db, access.workspace_id, offset=offset, limit=limit
            )

    async def cancel(
        self, *, access: WorkspaceAccess, invitation_id: UUID, info: RequestInfo
    ) -> None:
        """Withdraw a pending invitation, so its link stops working. Safe to repeat."""
        now = datetime.now(UTC)
        async with workspace_transaction(
            self._sessions, access.workspace_id, user_id=access.user_id
        ) as db:
            cancelled = await repository.cancel_invitation(
                db, workspace_id=access.workspace_id, invitation_id=invitation_id, now=now
            )
            if not cancelled:
                invitation = await repository.get_invitation(db, access.workspace_id, invitation_id)
                if invitation is None:
                    raise NotFoundError
                if invitation.status != "cancelled":
                    raise InvalidStateTransitionError(
                        f"The invitation is {invitation.status}, not pending."
                    )
                return
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="invitation.cancelled",
                target_type="invitation",
                target_id=invitation_id,
                info=info,
            )

    async def accept(
        self, *, session: SessionContext, token: str, info: RequestInfo
    ) -> tuple[UUID, MemberRecord]:
        """Join the workspace the token invites to. Returns the workspace and the membership.

        One answer, `invalid_token`, covers a token that is unknown, withdrawn or addressed to
        someone else, so a token tells a stranger nothing.
        """
        now = datetime.now(UTC)
        async with user_transaction(self._sessions, session.user_id) as db:
            user = await users.get_user(db, session.user_id)
            if user is None or user.disabled_at is not None:
                # The account was removed or disabled while its session was cached.
                raise UnauthenticatedError
            invitation = await repository.find_invitation_by_token(
                db, token_hash=hash_token(token), email=user.email
            )
            if invitation is None or not invitation.addressed:
                raise InvalidTokenError
            if invitation.status == "accepted":
                return invitation.workspace_id, await self._existing(db, invitation, user.id)
            if invitation.status == "expired" or (
                invitation.status == "pending" and invitation.expires_at <= now
            ):
                raise InvitationExpiredError("Ask for a new invitation.")
            if invitation.status != "pending":
                raise InvalidTokenError
            if user.email_verified_at is None:
                raise EmailNotVerifiedError("Verify your email address first.")
        async with workspace_transaction(
            self._sessions, invitation.workspace_id, user_id=user.id
        ) as db:
            workspace = await repository.get(db, invitation.workspace_id)
            if workspace is None or workspace.status == "deleting":
                raise InvalidTokenError
            if workspace.status == "suspended":
                raise WorkspaceSuspendedError
            accepted = await repository.accept_invitation(
                db, workspace_id=invitation.workspace_id, invitation_id=invitation.id, now=now
            )
            if not accepted:
                # Accepted, withdrawn or expired between the two transactions.
                return invitation.workspace_id, await self._existing(db, invitation, user.id)
            project_ids = invitation.project_ids
            if project_ids is not None:
                # A project deleted since the invitation was sent is left out of the scope.
                gone = set(
                    await repository.unknown_projects(db, invitation.workspace_id, project_ids)
                )
                project_ids = [project_id for project_id in project_ids if project_id not in gone]
            await repository.insert_membership_if_absent(
                db,
                workspace_id=invitation.workspace_id,
                user_id=user.id,
                role=invitation.role,
                project_ids=project_ids,
            )
            await audit.record(
                db,
                workspace_id=invitation.workspace_id,
                actor_id=user.id,
                action="invitation.accepted",
                target_type="invitation",
                target_id=invitation.id,
                info=info,
                after={"role": invitation.role, "project_ids": _scope(project_ids)},
            )
            return invitation.workspace_id, await self._existing(db, invitation, user.id)

    async def deliver(self, message: EmailMessage) -> None:
        """Send a message after the response has gone out. A failure is logged, never raised."""
        try:
            await self._email.send(message)
        except Exception as error:
            _log.error(
                "email was not sent", error_kind=type(error).__name__, subject=message.subject
            )

    @staticmethod
    async def _existing(
        db: AsyncSession, invitation: TokenInvitation, user_id: UUID
    ) -> MemberRecord:
        """The membership an accepted invitation led to. Without one, the token is spent."""
        member = await repository.get_member(db, invitation.workspace_id, user_id)
        if member is None:
            raise InvalidTokenError
        return member
