"""Rules for invitations (docs/19-api-specification.md section 3.2.2).

An invitation is sent to an address, and only an account with that address can accept it. The
link carries a token; the database keeps its hash. Accepting is by token, not by id: someone who
is not yet a member cannot see the invitation row, and the only lookup the database offers them
is by token hash.

An invitation grants nothing until it is accepted, so what the inviter may grant is judged
twice: when it is sent, and again when it is accepted.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.api import audit, limits
from sightline.api.auth import repository as users
from sightline.api.auth.repository import UserRecord
from sightline.api.auth.sessions import REAUTH_URL, SessionContext
from sightline.api.auth.throttle import LoginThrottle
from sightline.api.auth.tokens import hash_token, new_token
from sightline.api.permissions import Role
from sightline.api.problems import (
    DuplicateError,
    EmailNotVerifiedError,
    ForbiddenError,
    FreshSessionRequiredError,
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
from sightline.api.workspaces.members import (
    UNSCOPED_ROLES,
    check_project_scope,
    manages_members,
    scope_snapshot,
)
from sightline.api.workspaces.repository import (
    InvitationPendingError,
    InvitationRecord,
    MemberRecord,
    TokenInvitation,
    WorkspaceRecord,
)
from sightline.db.engine import user_transaction, workspace_transaction
from sightline.providers.email import EmailMessage, EmailSender

INVITATION_LIFETIME = timedelta(days=7)
# An invitation makes the platform send mail to an address of the caller's choosing. All per
# hour. The third protects one address from many senders, or from invite, withdraw, invite.
INVITATIONS_PER_HOUR_PER_INVITER = 20
INVITATIONS_PER_HOUR_PER_WORKSPACE = 50
INVITATIONS_PER_HOUR_PER_RECIPIENT = 3
_HOUR = 3600
_log = structlog.get_logger(__name__)


def _may_grant(inviter: Role, invited: Role) -> bool:
    """Whether a member with the inviter's role may give someone the invited role."""
    return manages_members(inviter) and (invited is not Role.OWNER or inviter is Role.OWNER)


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
        now = datetime.now(UTC)
        if role in UNSCOPED_ROLES and not access.session.is_fresh(now):
            # Inviting someone to manage the workspace is as sensitive as promoting a member.
            raise FreshSessionRequiredError(reauth_url=REAUTH_URL)
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
                if not manages_members(Role(inviter.role)):
                    raise ForbiddenError
                if not _may_grant(Role(inviter.role), role):
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
                # Counted last, so an attempt refused above costs nothing, and before the
                # transaction commits, so an invitation over the allowance is never stored.
                await self._count(access, email)
                await audit.record(
                    db,
                    workspace_id=access.workspace_id,
                    actor_id=access.user_id,
                    action="invitation.created",
                    target_type="invitation",
                    target_id=invitation_id,
                    info=info,
                    after={
                        "email": email,
                        "role": role.value,
                        "project_ids": scope_snapshot(project_ids),
                    },
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
            inviter_email=inviter.email,
            role=role.value,
            token=token,
            days=INVITATION_LIFETIME.days,
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
        """Withdraw an open invitation, so its link stops working. Safe to repeat."""
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
                status = invitation.status_at(now)
                if status != "cancelled":
                    raise InvalidStateTransitionError(f"The invitation is {status}, not pending.")
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
    ) -> tuple[WorkspaceRecord, MemberRecord]:
        """Join the workspace the token invites to. Returns the workspace and the membership;
        accepting again returns the same.

        One answer, `invalid_token`, covers a token that is unknown, withdrawn, void or
        addressed to someone else, so a token tells a stranger nothing.
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
        if invitation.status == "expired" or (
            invitation.status == "pending" and invitation.expires_at <= now
        ):
            raise InvitationExpiredError("Ask for a new invitation.")
        if invitation.status not in ("pending", "accepted"):
            raise InvalidTokenError
        if invitation.status == "pending" and user.email_verified_at is None:
            raise EmailNotVerifiedError("Verify your email address first.")
        async with workspace_transaction(
            self._sessions, invitation.workspace_id, user_id=user.id
        ) as db:
            # The lock that membership changes and new invitations take: what is read after it
            # is what they left.
            await repository.lock_member_changes(db, invitation.workspace_id)
            workspace = await repository.get(db, invitation.workspace_id)
            if workspace is None or workspace.status == "deleting":
                raise InvalidTokenError
            if invitation.status == "pending":
                if workspace.status == "suspended":
                    raise WorkspaceSuspendedError
                await self._join(db, invitation, user, now, info)
            member = await repository.get_member(db, invitation.workspace_id, user.id)
            if member is None:
                # Accepted once and removed since, or withdrawn a moment ago: the token is spent.
                raise InvalidTokenError
            return workspace, member

    async def _join(
        self,
        db: AsyncSession,
        invitation: TokenInvitation,
        user: UserRecord,
        now: datetime,
        info: RequestInfo,
    ) -> None:
        """Turn a pending invitation into a membership, if the inviter may still grant it."""
        inviter = await repository.active_member_role(
            db, invitation.workspace_id, invitation.invited_by
        )
        if inviter is None or not _may_grant(Role(inviter), Role(invitation.role)):
            # Sent by someone who has since left, been disabled or lost the right to grant this.
            raise InvalidTokenError
        if not await repository.accept_invitation(
            db, workspace_id=invitation.workspace_id, invitation_id=invitation.id, now=now
        ):
            # Accepted or withdrawn since it was read. The caller finds out which.
            return
        project_ids = invitation.project_ids
        if project_ids is not None:
            # A project deleted since the invitation was sent is left out of the scope. A scope
            # that loses every project stays a scope: it never widens to every project.
            gone = set(await repository.unknown_projects(db, invitation.workspace_id, project_ids))
            project_ids = [project_id for project_id in project_ids if project_id not in gone]
        joined = await repository.insert_membership_if_absent(
            db,
            workspace_id=invitation.workspace_id,
            user_id=user.id,
            role=invitation.role,
            project_ids=project_ids,
        )
        held = await repository.membership(db, invitation.workspace_id, user.id)
        if held is None:  # pragma: no cover - inserted or found by the statement above
            raise InvalidTokenError
        await audit.record(
            db,
            workspace_id=invitation.workspace_id,
            actor_id=user.id,
            action="invitation.accepted",
            target_type="invitation",
            target_id=invitation.id,
            info=info,
            # What the member holds now. Someone who already belonged keeps what they had.
            after={
                "role": held.role,
                "project_ids": scope_snapshot(held.project_ids),
                "already_member": not joined,
            },
        )

    async def deliver(self, message: EmailMessage) -> None:
        """Send a message after the response has gone out. A failure is logged, never raised."""
        try:
            await self._email.send(message)
        except Exception as error:
            _log.error(
                "email was not sent", error_kind=type(error).__name__, subject=message.subject
            )

    async def _count(self, access: WorkspaceAccess, email: str) -> None:
        """Count one invitation against the inviter, the workspace and the recipient, or against
        none of them when one allowance is used up."""
        await limits.enforce_all(
            self._throttle,
            [
                ("invite:inviter", access.user_id, INVITATIONS_PER_HOUR_PER_INVITER),
                ("invite:workspace", access.workspace_id, INVITATIONS_PER_HOUR_PER_WORKSPACE),
                ("invite:recipient", email.casefold(), INVITATIONS_PER_HOUR_PER_RECIPIENT),
            ],
            window_seconds=_HOUR,
        )
