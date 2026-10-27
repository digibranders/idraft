"""Every SQL statement the auth module runs, composed from the table metadata.

Functions take the caller's session so a use case stays in one transaction. Nothing here commits.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import (
    Row,
    and_,
    any_,
    bindparam,
    delete,
    exists,
    func,
    insert,
    literal,
    or_,
    select,
    text,
    update,
)
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.db.tables import (
    memberships,
    sessions,
    totp_secrets,
    users,
    verification_tokens,
    workspaces,
)

SessionState = Literal["pending_totp", "active"]


@dataclass(frozen=True, slots=True)
class SessionRecord:
    id: UUID
    token_hash: bytes
    user_id: UUID
    state: SessionState
    fresh_until: datetime | None
    idle_expires_at: datetime
    absolute_expires_at: datetime
    last_seen_at: datetime
    created_at: datetime
    ip: str | None
    user_agent: str | None


_SESSION_COLUMNS = (
    sessions.c.id,
    sessions.c.token_hash,
    sessions.c.user_id,
    sessions.c.state,
    sessions.c.fresh_until,
    sessions.c.idle_expires_at,
    sessions.c.absolute_expires_at,
    sessions.c.last_seen_at,
    sessions.c.created_at,
    sessions.c.ip,
    sessions.c.user_agent,
)


def _state(value: object) -> SessionState:
    if value == "pending_totp":
        return "pending_totp"
    if value == "active":
        return "active"
    raise ValueError("unexpected session state in the database")


def _session_record(row: Row[tuple[object, ...]]) -> SessionRecord:
    fields = row._mapping
    return SessionRecord(
        id=fields["id"],
        token_hash=bytes(fields["token_hash"]),
        user_id=fields["user_id"],
        state=_state(fields["state"]),
        fresh_until=fields["fresh_until"],
        idle_expires_at=fields["idle_expires_at"],
        absolute_expires_at=fields["absolute_expires_at"],
        last_seen_at=fields["last_seen_at"],
        created_at=fields["created_at"],
        ip=None if fields["ip"] is None else str(fields["ip"]),
        user_agent=fields["user_agent"],
    )


async def insert_session(
    db: AsyncSession,
    *,
    token_hash: bytes,
    user_id: UUID,
    state: SessionState,
    fresh_until: datetime | None,
    idle_expires_at: datetime,
    absolute_expires_at: datetime,
    ip: str | None,
    user_agent: str | None,
    now: datetime,
) -> SessionRecord:
    statement = (
        insert(sessions)
        .values(
            token_hash=token_hash,
            user_id=user_id,
            state=state,
            fresh_until=fresh_until,
            idle_expires_at=idle_expires_at,
            absolute_expires_at=absolute_expires_at,
            ip=ip,
            user_agent=user_agent,
            last_seen_at=now,
        )
        .returning(*_SESSION_COLUMNS)
    )
    return _session_record((await db.execute(statement)).one())


async def find_live_session(db: AsyncSession, token_hash: bytes) -> SessionRecord | None:
    """The unrevoked session with this token hash, if its user is not disabled.

    Expiry is not checked here: the caller tells "expired" from "unknown".
    """
    statement = (
        select(*_SESSION_COLUMNS)
        .join(users, users.c.id == sessions.c.user_id)
        .where(
            sessions.c.token_hash == token_hash,
            sessions.c.revoked_at.is_(None),
            users.c.disabled_at.is_(None),
        )
    )
    row = (await db.execute(statement)).one_or_none()
    return None if row is None else _session_record(row)


async def touch_session(
    db: AsyncSession, *, session_id: UUID, last_seen_at: datetime, idle_expires_at: datetime
) -> SessionRecord | None:
    """Record activity and slide the idle lifetime.

    None when the session was revoked or its user disabled meanwhile: this write is the moment a
    cached copy is checked against the database again.
    """
    statement = (
        update(sessions)
        .where(
            sessions.c.id == session_id,
            sessions.c.revoked_at.is_(None),
            users.c.id == sessions.c.user_id,
            users.c.disabled_at.is_(None),
        )
        .values(last_seen_at=last_seen_at, idle_expires_at=idle_expires_at)
        .returning(*_SESSION_COLUMNS)
    )
    row = (await db.execute(statement)).one_or_none()
    return None if row is None else _session_record(row)


async def revoke_session(
    db: AsyncSession, *, session_id: UUID, user_id: UUID, now: datetime
) -> bytes | None:
    """Revoke one session of this user. Returns its token hash, or None if nothing was revoked."""
    statement = (
        update(sessions)
        .where(
            sessions.c.id == session_id,
            sessions.c.user_id == user_id,
            sessions.c.revoked_at.is_(None),
        )
        .values(revoked_at=now)
        .returning(sessions.c.token_hash)
    )
    token_hash = (await db.execute(statement)).scalar_one_or_none()
    return None if token_hash is None else bytes(token_hash)


async def revoke_user_sessions(
    db: AsyncSession, *, user_id: UUID, except_session_id: UUID | None, now: datetime
) -> list[bytes]:
    """Revoke every live session of the user, optionally sparing one. Returns the token hashes."""
    conditions = [sessions.c.user_id == user_id, sessions.c.revoked_at.is_(None)]
    if except_session_id is not None:
        conditions.append(sessions.c.id != except_session_id)
    statement = (
        update(sessions)
        .where(and_(*conditions))
        .values(revoked_at=now)
        .returning(sessions.c.token_hash)
    )
    return [bytes(token_hash) for token_hash in (await db.execute(statement)).scalars()]


# ---------------------------------------------------------------------------------------------
# Users

TokenPurpose = Literal["email_verification", "password_reset"]
_UNIQUE_VIOLATION = "23505"


class EmailTakenError(Exception):
    """An account with this email already exists."""


@dataclass(frozen=True, slots=True)
class UserRecord:
    id: UUID
    email: str
    name: str
    image: str | None
    password_hash: str
    email_verified_at: datetime | None
    is_platform_operator: bool
    disabled_at: datetime | None
    created_at: datetime


_USER_COLUMNS = (
    users.c.id,
    users.c.email,
    users.c.name,
    users.c.image,
    users.c.password_hash,
    users.c.email_verified_at,
    users.c.is_platform_operator,
    users.c.disabled_at,
    users.c.created_at,
)


def _user_record(row: Row[tuple[object, ...]]) -> UserRecord:
    fields = row._mapping
    return UserRecord(
        id=fields["id"],
        email=fields["email"],
        name=fields["name"],
        image=fields["image"],
        password_hash=fields["password_hash"],
        email_verified_at=fields["email_verified_at"],
        is_platform_operator=fields["is_platform_operator"],
        disabled_at=fields["disabled_at"],
        created_at=fields["created_at"],
    )


async def find_user_by_email(db: AsyncSession, email: str) -> UserRecord | None:
    """The column is citext, so the comparison ignores case."""
    row = (await db.execute(select(*_USER_COLUMNS).where(users.c.email == email))).one_or_none()
    return None if row is None else _user_record(row)


async def get_user(db: AsyncSession, user_id: UUID) -> UserRecord | None:
    row = (await db.execute(select(*_USER_COLUMNS).where(users.c.id == user_id))).one_or_none()
    return None if row is None else _user_record(row)


async def insert_user(db: AsyncSession, *, email: str, name: str, password_hash: str) -> UUID:
    """Create the account. Raises EmailTakenError, leaving the transaction unusable."""
    statement = (
        insert(users)
        .values(email=email, name=name, password_hash=password_hash)
        .returning(users.c.id)
    )
    try:
        user_id: UUID = (await db.execute(statement)).scalar_one()
    except IntegrityError as error:
        if getattr(error.orig, "sqlstate", None) == _UNIQUE_VIOLATION:
            raise EmailTakenError from None
        raise
    return user_id


async def mark_email_verified(db: AsyncSession, *, user_id: UUID, now: datetime) -> None:
    await db.execute(
        update(users)
        .where(users.c.id == user_id, users.c.email_verified_at.is_(None))
        .values(email_verified_at=now, updated_at=now)
    )


async def lock_password_hash(db: AsyncSession, user_id: UUID, *, exclusive: bool) -> str | None:
    """The user's current password hash, holding a lock on the row until commit.

    Sign-in takes this lock before it creates a session, and a password change updates the same
    row before it revokes sessions. So the two cannot interleave: either the new session exists
    when the revocation runs and is revoked, or the sign-in sees the new hash.

    `exclusive` is for a caller that will also write the row. Two callers that each took a shared
    lock and then tried to write would deadlock. It is the lock an UPDATE of a non-key column
    takes (FOR NO KEY UPDATE), so it does not hold up the foreign-key check of a session insert.

    None for a user who is gone or disabled.
    """
    statement = select(users.c.password_hash).where(
        users.c.id == user_id, users.c.disabled_at.is_(None)
    )
    statement = (
        statement.with_for_update(key_share=True)
        if exclusive
        else statement.with_for_update(read=True)
    )
    password_hash: str | None = (await db.execute(statement)).scalar_one_or_none()
    return password_hash


async def set_password_hash(
    db: AsyncSession, *, user_id: UUID, password_hash: str, now: datetime
) -> None:
    await db.execute(
        update(users)
        .where(users.c.id == user_id)
        .values(password_hash=password_hash, updated_at=now)
    )


# ---------------------------------------------------------------------------------------------
# Verification and reset tokens


async def supersede_tokens(
    db: AsyncSession, *, user_id: UUID, purpose: TokenPurpose, now: datetime
) -> None:
    """A new link replaces the old ones: only the newest email works."""
    await db.execute(
        update(verification_tokens)
        .where(
            verification_tokens.c.user_id == user_id,
            verification_tokens.c.purpose == purpose,
            verification_tokens.c.consumed_at.is_(None),
        )
        .values(consumed_at=now)
    )


async def insert_token(
    db: AsyncSession,
    *,
    user_id: UUID,
    purpose: TokenPurpose,
    token_hash: bytes,
    expires_at: datetime,
) -> None:
    await db.execute(
        insert(verification_tokens).values(
            user_id=user_id, purpose=purpose, token_hash=token_hash, expires_at=expires_at
        )
    )


async def consume_token(
    db: AsyncSession, *, token_hash: bytes, purpose: TokenPurpose, now: datetime
) -> UUID | None:
    """Use a token once. One UPDATE decides, so two requests with the same token cannot both win."""
    statement = (
        update(verification_tokens)
        .where(
            verification_tokens.c.token_hash == token_hash,
            verification_tokens.c.purpose == purpose,
            verification_tokens.c.consumed_at.is_(None),
            verification_tokens.c.expires_at > now,
        )
        .values(consumed_at=now)
        .returning(verification_tokens.c.user_id)
    )
    user_id: UUID | None = (await db.execute(statement)).scalar_one_or_none()
    return user_id


# ---------------------------------------------------------------------------------------------
# Invitations (read only here; the workspace routes write them)


# The policy on auth.invitations hides the row from someone who is not yet a member, so the lookup
# goes through the definer function, which returns the row whatever its state. The checks are
# here, and the email is compared by the database: the column is citext, so this is the same
# comparison that makes auth.users.email unique. Comparing in Python would call two addresses
# equal that PostgreSQL stores as different accounts. The parameter is declared citext so it is
# never sent with a text cast, which would make the comparison case-sensitive.
_PENDING_INVITATION = text(
    "SELECT 1 FROM auth.invitation_by_token(:token_hash) "
    "WHERE email = :email AND status = 'pending' AND expires_at > :now"
).bindparams(bindparam("email", type_=CITEXT))


async def holds_pending_invitation(
    db: AsyncSession, *, token_hash: bytes, email: str, now: datetime
) -> bool:
    """Whether this token is a pending, unexpired invitation addressed to exactly this email."""
    found = await db.execute(
        _PENDING_INVITATION, {"token_hash": token_hash, "email": email, "now": now}
    )
    return found.first() is not None


# ---------------------------------------------------------------------------------------------
# Two-factor and memberships


async def has_confirmed_totp(db: AsyncSession, user_id: UUID) -> bool:
    statement = select(
        exists().where(totp_secrets.c.user_id == user_id, totp_secrets.c.confirmed_at.is_not(None))
    )
    return bool((await db.execute(statement)).scalar_one())


@dataclass(frozen=True, slots=True)
class MembershipRecord:
    workspace_id: UUID
    workspace_name: str
    workspace_slug: str
    workspace_status: str
    role: str
    project_ids: list[UUID] | None


async def list_memberships(db: AsyncSession, user_id: UUID) -> list[MembershipRecord]:
    """The user's memberships. Run inside `user_transaction`: row-level security then shows the
    caller their own rows and the workspaces those belong to, and nothing else."""
    statement = (
        select(
            workspaces.c.id,
            workspaces.c.name,
            workspaces.c.slug,
            workspaces.c.status,
            memberships.c.role,
            memberships.c.project_ids,
        )
        .join(workspaces, workspaces.c.id == memberships.c.workspace_id)
        .where(memberships.c.user_id == user_id)
        .order_by(func.lower(workspaces.c.name), workspaces.c.id)
    )
    return [
        MembershipRecord(
            workspace_id=row.id,
            workspace_name=row.name,
            workspace_slug=str(row.slug),
            workspace_status=row.status,
            role=row.role,
            project_ids=None if row.project_ids is None else list(row.project_ids),
        )
        for row in await db.execute(statement)
    ]


# ---------------------------------------------------------------------------------------------
# Audit

_RECORD_AUTH_EVENT = text(
    "SELECT ops.record_auth_event(:action, :user_id, :target_type, :target_id, "
    "CAST(:ip AS inet), :user_agent, :request_id, CAST(:details AS jsonb))"
)


async def record_auth_event(
    db: AsyncSession,
    *,
    action: str,
    user_id: UUID | None,
    target_type: str,
    target_id: str,
    ip: str | None,
    user_agent: str | None,
    request_id: str | None,
    details: str | None,
) -> None:
    """Write an auth event to the audit log, in the caller's transaction. `details` is JSON text."""
    await db.execute(
        _RECORD_AUTH_EVENT,
        {
            "action": action,
            "user_id": user_id,
            "target_type": target_type,
            "target_id": target_id,
            "ip": ip,
            "user_agent": user_agent,
            "request_id": request_id,
            "details": details,
        },
    )


# ---------------------------------------------------------------------------------------------
# Password reset, the session list, the profile


async def find_token_user(
    db: AsyncSession, *, token_hash: bytes, purpose: TokenPurpose, now: datetime
) -> UUID | None:
    """Whose token this is, if it could be used now. Does not use it."""
    statement = select(verification_tokens.c.user_id).where(
        verification_tokens.c.token_hash == token_hash,
        verification_tokens.c.purpose == purpose,
        verification_tokens.c.consumed_at.is_(None),
        verification_tokens.c.expires_at > now,
    )
    user_id: UUID | None = (await db.execute(statement)).scalar_one_or_none()
    return user_id


async def list_live_sessions(
    db: AsyncSession, *, user_id: UUID, now: datetime
) -> list[SessionRecord]:
    """The user's signed-in sessions that still work, most recently used first."""
    statement = (
        select(*_SESSION_COLUMNS)
        .where(
            sessions.c.user_id == user_id,
            sessions.c.state == "active",
            sessions.c.revoked_at.is_(None),
            sessions.c.idle_expires_at > now,
            sessions.c.absolute_expires_at > now,
        )
        .order_by(sessions.c.last_seen_at.desc(), sessions.c.id.desc())
    )
    return [_session_record(row) for row in await db.execute(statement)]


async def update_profile(
    db: AsyncSession, *, user_id: UUID, changes: Mapping[str, str | None], now: datetime
) -> None:
    """Set `name` and `image`, whichever are given. The caller has validated both."""
    allowed = {key: value for key, value in changes.items() if key in ("name", "image")}
    await db.execute(
        update(users)
        .where(users.c.id == user_id, users.c.disabled_at.is_(None))
        .values(**allowed, updated_at=now)
    )


# ---------------------------------------------------------------------------------------------
# Two-factor


@dataclass(frozen=True, slots=True)
class TotpRecord:
    secret_encrypted: bytes
    confirmed: bool
    recovery_codes_left: int


async def get_totp(db: AsyncSession, user_id: UUID) -> TotpRecord | None:
    statement = select(
        totp_secrets.c.secret_encrypted,
        totp_secrets.c.confirmed_at,
        func.cardinality(totp_secrets.c.recovery_code_hashes),
    ).where(totp_secrets.c.user_id == user_id)
    row = (await db.execute(statement)).one_or_none()
    if row is None:
        return None
    return TotpRecord(
        secret_encrypted=bytes(row[0]),
        confirmed=row[1] is not None,
        recovery_codes_left=int(row[2]),
    )


async def store_unconfirmed_totp(
    db: AsyncSession, *, user_id: UUID, secret_encrypted: bytes
) -> bool:
    """Start enrolment, replacing a secret that was never confirmed. False if two-factor is on."""
    statement = (
        postgresql_insert(totp_secrets)
        .values(user_id=user_id, secret_encrypted=secret_encrypted)
        .on_conflict_do_update(
            index_elements=[totp_secrets.c.user_id],
            set_={
                "secret_encrypted": secret_encrypted,
                "last_used_step": None,
                "recovery_code_hashes": [],
            },
            where=totp_secrets.c.confirmed_at.is_(None),
        )
        .returning(totp_secrets.c.user_id)
    )
    return (await db.execute(statement)).scalar_one_or_none() is not None


async def confirm_totp(
    db: AsyncSession,
    *,
    user_id: UUID,
    secret_encrypted: bytes,
    step: int,
    recovery_code_hashes: list[str],
    now: datetime,
) -> bool:
    """Turn two-factor on for the secret the code was checked against.

    The secret is part of the condition: a setup that replaced it after the code was checked
    must not be confirmed by that code. The step is recorded, so the code cannot be replayed.
    """
    statement = (
        update(totp_secrets)
        .where(
            totp_secrets.c.user_id == user_id,
            totp_secrets.c.confirmed_at.is_(None),
            totp_secrets.c.secret_encrypted == secret_encrypted,
        )
        .values(confirmed_at=now, last_used_step=step, recovery_code_hashes=recovery_code_hashes)
        .returning(totp_secrets.c.user_id)
    )
    return (await db.execute(statement)).scalar_one_or_none() is not None


async def claim_totp_step(db: AsyncSession, *, user_id: UUID, step: int) -> int | None:
    """Use a time step once. One UPDATE decides, so the same code cannot be accepted twice.

    Returns how many recovery codes are left, or None if the step was already used.
    """
    statement = (
        update(totp_secrets)
        .where(
            totp_secrets.c.user_id == user_id,
            totp_secrets.c.confirmed_at.is_not(None),
            or_(totp_secrets.c.last_used_step.is_(None), totp_secrets.c.last_used_step < step),
        )
        .values(last_used_step=step)
        .returning(func.cardinality(totp_secrets.c.recovery_code_hashes))
    )
    left: int | None = (await db.execute(statement)).scalar_one_or_none()
    return left


async def use_recovery_code(db: AsyncSession, *, user_id: UUID, code_hash: str) -> int | None:
    """Remove a recovery code. Returns how many are left, or None if the code was not there."""
    statement = (
        update(totp_secrets)
        .where(
            totp_secrets.c.user_id == user_id,
            totp_secrets.c.confirmed_at.is_not(None),
            literal(code_hash) == any_(totp_secrets.c.recovery_code_hashes),
        )
        .values(
            recovery_code_hashes=func.array_remove(totp_secrets.c.recovery_code_hashes, code_hash)
        )
        .returning(func.cardinality(totp_secrets.c.recovery_code_hashes))
    )
    left: int | None = (await db.execute(statement)).scalar_one_or_none()
    return left


async def replace_recovery_codes(
    db: AsyncSession, *, user_id: UUID, recovery_code_hashes: list[str]
) -> bool:
    statement = (
        update(totp_secrets)
        .where(totp_secrets.c.user_id == user_id, totp_secrets.c.confirmed_at.is_not(None))
        .values(recovery_code_hashes=recovery_code_hashes)
        .returning(totp_secrets.c.user_id)
    )
    return (await db.execute(statement)).scalar_one_or_none() is not None


async def delete_totp(db: AsyncSession, user_id: UUID) -> bool:
    statement = (
        delete(totp_secrets)
        .where(totp_secrets.c.user_id == user_id)
        .returning(totp_secrets.c.user_id)
    )
    return (await db.execute(statement)).scalar_one_or_none() is not None


async def holds_role(db: AsyncSession, *, user_id: UUID, roles: Sequence[str]) -> bool:
    """Whether the user has one of `roles` in any workspace. Run inside `user_transaction`."""
    statement = select(
        exists().where(memberships.c.user_id == user_id, memberships.c.role.in_(roles))
    )
    return bool((await db.execute(statement)).scalar_one())
