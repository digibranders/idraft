"""Statements for workspaces, their members and their invitations.

Every function runs in the caller's transaction. Inside `workspace_transaction` row-level security
limits each statement to that workspace; inside `user_transaction` a user sees their own
memberships and the workspaces those belong to (docs/04-data-model.md section 13).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import Row, Select, delete, exists, func, insert, select, text, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from sightline.db.errors import violated_unique_constraint
from sightline.db.tables import (
    invitations,
    memberships,
    projects,
    sessions,
    totp_secrets,
    users,
    workspace_quotas,
    workspaces,
)


class SlugTakenError(Exception):
    """Another workspace has this slug. The transaction cannot be used after it."""


@dataclass(frozen=True, slots=True)
class WorkspaceRecord:
    id: UUID
    name: str
    slug: str
    logo: str | None
    plan_code: str
    timezone: str
    status: str
    created_at: datetime
    purge_after: datetime | None


_WORKSPACE_COLUMNS = (
    workspaces.c.id,
    workspaces.c.name,
    workspaces.c.slug,
    workspaces.c.logo,
    workspaces.c.plan_code,
    workspaces.c.timezone,
    workspaces.c.status,
    workspaces.c.created_at,
    workspaces.c.purge_after,
)


def _workspace(row: Row[tuple[object, ...]]) -> WorkspaceRecord:
    fields = row._mapping
    return WorkspaceRecord(
        id=fields["id"],
        name=fields["name"],
        slug=str(fields["slug"]),
        logo=fields["logo"],
        plan_code=fields["plan_code"],
        timezone=fields["timezone"],
        status=fields["status"],
        created_at=fields["created_at"],
        purge_after=fields["purge_after"],
    )


async def new_id(db: AsyncSession) -> UUID:
    """An id from the database, for a row whose policy compares its id with a setting that has
    to be written before the insert."""
    generated: UUID = (await db.execute(select(func.uuidv7()))).scalar_one()
    return generated


_TIMEZONE_EXISTS = text("SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = :name)")


async def timezone_exists(db: AsyncSession, name: str) -> bool:
    """Whether PostgreSQL knows this time zone by exactly this name."""
    return bool((await db.execute(_TIMEZONE_EXISTS, {"name": name})).scalar_one())


async def list_for_user(db: AsyncSession, user_id: UUID) -> list[WorkspaceRecord]:
    """The workspaces the user belongs to, except ones being deleted. Run in `user_transaction`."""
    statement = (
        select(*_WORKSPACE_COLUMNS)
        .join(memberships, memberships.c.workspace_id == workspaces.c.id)
        .where(memberships.c.user_id == user_id, workspaces.c.status != "deleting")
        .order_by(func.lower(workspaces.c.name), workspaces.c.id)
    )
    return [_workspace(row) for row in await db.execute(statement)]


async def get(
    db: AsyncSession, workspace_id: UUID, *, for_update: bool = False
) -> WorkspaceRecord | None:
    statement = select(*_WORKSPACE_COLUMNS).where(workspaces.c.id == workspace_id)
    if for_update:
        # FOR NO KEY UPDATE: a plain FOR UPDATE would wait for, and block, every insert of a row
        # that references the workspace.
        statement = statement.with_for_update(key_share=True)
    row = (await db.execute(statement)).one_or_none()
    return None if row is None else _workspace(row)


def _raise_if_slug_taken(error: IntegrityError) -> None:
    if violated_unique_constraint(error) == "workspaces_slug_key":
        raise SlugTakenError from None


async def insert_workspace(
    db: AsyncSession, *, workspace_id: UUID, name: str, slug: str, timezone: str
) -> WorkspaceRecord:
    statement = (
        insert(workspaces)
        .values(id=workspace_id, name=name, slug=slug, timezone=timezone)
        .returning(*_WORKSPACE_COLUMNS)
    )
    try:
        row = (await db.execute(statement)).one()
    except IntegrityError as error:
        _raise_if_slug_taken(error)
        raise
    return _workspace(row)


async def update_workspace(
    db: AsyncSession, workspace_id: UUID, changes: Mapping[str, str | None]
) -> WorkspaceRecord:
    statement = (
        update(workspaces)
        .where(workspaces.c.id == workspace_id)
        .values(**changes)
        .returning(*_WORKSPACE_COLUMNS)
    )
    try:
        row = (await db.execute(statement)).one()
    except IntegrityError as error:
        _raise_if_slug_taken(error)
        raise
    return _workspace(row)


async def insert_membership(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    user_id: UUID,
    role: str,
    project_ids: list[UUID] | None = None,
) -> None:
    await db.execute(
        insert(memberships).values(
            workspace_id=workspace_id, user_id=user_id, role=role, project_ids=project_ids
        )
    )


async def insert_default_quotas(db: AsyncSession, workspace_id: UUID) -> None:
    """The limits come from the column defaults (docs/04-data-model.md section 4.1)."""
    await db.execute(insert(workspace_quotas).values(workspace_id=workspace_id))


# ---------------------------------------------------------------------------------------------
# Members
#
# The policy on auth.memberships also shows a user their own memberships of other workspaces, so
# every statement here names the workspace. Row-level security is the second line, not the first.


@dataclass(frozen=True, slots=True)
class MemberRecord:
    user_id: UUID
    name: str
    email: str
    role: str
    project_ids: list[UUID] | None
    two_factor_enabled: bool
    joined_at: datetime
    last_active_at: datetime | None


def _members(workspace_id: UUID) -> Select[tuple[object, ...]]:
    two_factor = exists().where(
        totp_secrets.c.user_id == users.c.id, totp_secrets.c.confirmed_at.is_not(None)
    )
    last_active = (
        select(func.max(sessions.c.last_seen_at))
        .where(sessions.c.user_id == users.c.id)
        .scalar_subquery()
    )
    return (
        select(
            users.c.id,
            users.c.name,
            users.c.email,
            memberships.c.role,
            memberships.c.project_ids,
            two_factor.label("two_factor_enabled"),
            memberships.c.created_at,
            last_active.label("last_active_at"),
        )
        .join(users, users.c.id == memberships.c.user_id)
        .where(memberships.c.workspace_id == workspace_id)
    )


def _member(row: Row[tuple[object, ...]]) -> MemberRecord:
    fields = row._mapping
    project_ids = fields["project_ids"]
    return MemberRecord(
        user_id=fields["id"],
        name=fields["name"],
        email=str(fields["email"]),
        role=fields["role"],
        project_ids=None if project_ids is None else list(project_ids),
        two_factor_enabled=fields["two_factor_enabled"],
        joined_at=fields["created_at"],
        last_active_at=fields["last_active_at"],
    )


async def list_members(
    db: AsyncSession, workspace_id: UUID, *, offset: int, limit: int
) -> tuple[list[MemberRecord], int]:
    total: int = (
        await db.execute(
            select(func.count())
            .select_from(memberships)
            .where(memberships.c.workspace_id == workspace_id)
        )
    ).scalar_one()
    page = (
        _members(workspace_id)
        .order_by(func.lower(users.c.name), users.c.id)
        .offset(offset)
        .limit(limit)
    )
    return [_member(row) for row in await db.execute(page)], total


async def get_member(
    db: AsyncSession, workspace_id: UUID, user_id: UUID, *, for_update: bool = False
) -> MemberRecord | None:
    statement = _members(workspace_id).where(memberships.c.user_id == user_id)
    if for_update:
        statement = statement.with_for_update(of=memberships, key_share=True)
    row = (await db.execute(statement)).one_or_none()
    return None if row is None else _member(row)


async def lock_owners(db: AsyncSession, workspace_id: UUID) -> list[UUID]:
    """The workspace's owners, their membership rows locked until the transaction ends.

    Every change to a membership takes this lock first and in the same order, so two changes
    that would each remove an owner run one after the other, and the second sees the first.
    """
    statement = (
        select(memberships.c.user_id)
        .where(memberships.c.workspace_id == workspace_id, memberships.c.role == "owner")
        .order_by(memberships.c.id)
        .with_for_update(key_share=True)
    )
    return list((await db.execute(statement)).scalars())


async def update_member(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    user_id: UUID,
    role: str,
    project_ids: list[UUID] | None,
) -> None:
    await db.execute(
        update(memberships)
        .where(memberships.c.workspace_id == workspace_id, memberships.c.user_id == user_id)
        .values(role=role, project_ids=project_ids)
    )


async def delete_member(db: AsyncSession, *, workspace_id: UUID, user_id: UUID) -> None:
    await db.execute(
        delete(memberships).where(
            memberships.c.workspace_id == workspace_id, memberships.c.user_id == user_id
        )
    )


async def unknown_projects(
    db: AsyncSession, workspace_id: UUID, project_ids: list[UUID]
) -> list[UUID]:
    """Which of these are not projects of the workspace. A deleted project counts as unknown."""
    known: set[UUID] = set(
        (
            await db.execute(
                select(projects.c.id).where(
                    projects.c.workspace_id == workspace_id,
                    projects.c.id.in_(project_ids),
                    projects.c.deleted_at.is_(None),
                )
            )
        ).scalars()
    )
    return [project_id for project_id in project_ids if project_id not in known]


# ---------------------------------------------------------------------------------------------
# Invitations


class InvitationPendingError(Exception):
    """This address already has a pending invitation to the workspace. The transaction cannot be
    used after it."""


@dataclass(frozen=True, slots=True)
class InvitationRecord:
    id: UUID
    email: str
    role: str
    project_ids: list[UUID] | None
    status: str
    invited_by_id: UUID
    invited_by_name: str
    invited_by_email: str
    expires_at: datetime
    created_at: datetime

    def status_at(self, now: datetime) -> str:
        """A pending invitation past its date is expired, whether or not a row says so yet."""
        return "expired" if self.status == "pending" and self.expires_at <= now else self.status


def _invitations(workspace_id: UUID) -> Select[tuple[object, ...]]:
    return (
        select(
            invitations.c.id,
            invitations.c.email,
            invitations.c.role,
            invitations.c.project_ids,
            invitations.c.status,
            invitations.c.expires_at,
            invitations.c.created_at,
            users.c.id.label("invited_by_id"),
            users.c.name.label("invited_by_name"),
            users.c.email.label("invited_by_email"),
        )
        .join(users, users.c.id == invitations.c.invited_by)
        .where(invitations.c.workspace_id == workspace_id)
    )


def _invitation(row: Row[tuple[object, ...]]) -> InvitationRecord:
    fields = row._mapping
    project_ids = fields["project_ids"]
    return InvitationRecord(
        id=fields["id"],
        email=str(fields["email"]),
        role=fields["role"],
        project_ids=None if project_ids is None else list(project_ids),
        status=fields["status"],
        invited_by_id=fields["invited_by_id"],
        invited_by_name=fields["invited_by_name"],
        invited_by_email=str(fields["invited_by_email"]),
        expires_at=fields["expires_at"],
        created_at=fields["created_at"],
    )


async def is_member_email(db: AsyncSession, workspace_id: UUID, email: str) -> bool:
    """Whether an account with this address belongs to the workspace. The column is citext, so
    the comparison ignores case."""
    statement = select(
        exists()
        .where(memberships.c.workspace_id == workspace_id)
        .where(memberships.c.user_id == users.c.id)
        .where(users.c.email == email)
    )
    return bool((await db.execute(statement)).scalar_one())


async def expire_stale_invitations(
    db: AsyncSession, *, workspace_id: UUID, email: str, now: datetime
) -> None:
    """Mark this address's pending invitations that are past their date, so a new one can be
    sent: only one pending invitation per address can exist."""
    await db.execute(
        update(invitations)
        .where(
            invitations.c.workspace_id == workspace_id,
            invitations.c.email == email,
            invitations.c.status == "pending",
            invitations.c.expires_at <= now,
        )
        .values(status="expired", responded_at=now)
    )


async def insert_invitation(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    email: str,
    role: str,
    project_ids: list[UUID] | None,
    token_hash: bytes,
    invited_by: UUID,
    expires_at: datetime,
) -> UUID:
    statement = (
        insert(invitations)
        .values(
            workspace_id=workspace_id,
            email=email,
            role=role,
            project_ids=project_ids,
            token_hash=token_hash,
            invited_by=invited_by,
            expires_at=expires_at,
        )
        .returning(invitations.c.id)
    )
    try:
        invitation_id: UUID = (await db.execute(statement)).scalar_one()
    except IntegrityError as error:
        if violated_unique_constraint(error) == "invitations_workspace_id_email_idx":
            raise InvitationPendingError from None
        raise
    return invitation_id


async def get_invitation(
    db: AsyncSession, workspace_id: UUID, invitation_id: UUID
) -> InvitationRecord | None:
    statement = _invitations(workspace_id).where(invitations.c.id == invitation_id)
    row = (await db.execute(statement)).one_or_none()
    return None if row is None else _invitation(row)


async def list_invitations(
    db: AsyncSession, workspace_id: UUID, *, offset: int, limit: int
) -> tuple[list[InvitationRecord], int]:
    total: int = (
        await db.execute(
            select(func.count())
            .select_from(invitations)
            .where(invitations.c.workspace_id == workspace_id)
        )
    ).scalar_one()
    page = (
        _invitations(workspace_id)
        .order_by(invitations.c.created_at.desc(), invitations.c.id.desc())
        .offset(offset)
        .limit(limit)
    )
    return [_invitation(row) for row in await db.execute(page)], total


async def cancel_invitation(
    db: AsyncSession, *, workspace_id: UUID, invitation_id: UUID, now: datetime
) -> bool:
    """Cancel a pending invitation. False when it is not pending any more."""
    statement = (
        update(invitations)
        .where(
            invitations.c.workspace_id == workspace_id,
            invitations.c.id == invitation_id,
            invitations.c.status == "pending",
        )
        .values(status="cancelled", responded_at=now)
        .returning(invitations.c.id)
    )
    return (await db.execute(statement)).one_or_none() is not None


@dataclass(frozen=True, slots=True)
class TokenInvitation:
    """An invitation as its token holder sees it, before they belong to the workspace."""

    id: UUID
    workspace_id: UUID
    role: str
    project_ids: list[UUID] | None
    status: str
    expires_at: datetime
    # Whether it was sent to the address asked about, compared as the database compares emails.
    addressed: bool


# The policy on auth.invitations hides the row from someone who is not yet a member, so the lookup
# goes through the definer function, which returns the one row with this token hash.
_BY_TOKEN = text(
    "SELECT id, workspace_id, role, project_ids, status, expires_at, "
    "email = CAST(:email AS citext) AS addressed "
    "FROM auth.invitation_by_token(:token_hash)"
)


async def find_invitation_by_token(
    db: AsyncSession, *, token_hash: bytes, email: str
) -> TokenInvitation | None:
    row = (await db.execute(_BY_TOKEN, {"token_hash": token_hash, "email": email})).one_or_none()
    if row is None:
        return None
    return TokenInvitation(
        id=row.id,
        workspace_id=row.workspace_id,
        role=row.role,
        project_ids=None if row.project_ids is None else list(row.project_ids),
        status=row.status,
        expires_at=row.expires_at,
        addressed=bool(row.addressed),
    )


async def accept_invitation(
    db: AsyncSession, *, workspace_id: UUID, invitation_id: UUID, now: datetime
) -> bool:
    """Mark a pending, unexpired invitation accepted. False when it no longer is one."""
    statement = (
        update(invitations)
        .where(
            invitations.c.workspace_id == workspace_id,
            invitations.c.id == invitation_id,
            invitations.c.status == "pending",
            invitations.c.expires_at > now,
        )
        .values(status="accepted", responded_at=now)
        .returning(invitations.c.id)
    )
    return (await db.execute(statement)).one_or_none() is not None


async def insert_membership_if_absent(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    user_id: UUID,
    role: str,
    project_ids: list[UUID] | None,
) -> None:
    """Add the member. Someone who already belongs keeps the membership they have."""
    await db.execute(
        upsert(memberships)
        .values(workspace_id=workspace_id, user_id=user_id, role=role, project_ids=project_ids)
        .on_conflict_do_nothing(index_elements=["workspace_id", "user_id"])
    )
