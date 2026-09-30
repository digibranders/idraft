"""Every SQL statement the auth module runs, composed from the table metadata.

Functions take the caller's session so a use case stays in one transaction. Nothing here commits.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import Row, and_, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from sightline.db.tables import sessions, users

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


def _session_record(row: Row[tuple[object, ...]]) -> SessionRecord:
    fields = row._mapping
    return SessionRecord(
        id=fields["id"],
        token_hash=bytes(fields["token_hash"]),
        user_id=fields["user_id"],
        state="pending_totp" if fields["state"] == "pending_totp" else "active",
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
    """Record activity and slide the idle lifetime. None when the session was revoked meanwhile."""
    statement = (
        update(sessions)
        .where(sessions.c.id == session_id, sessions.c.revoked_at.is_(None))
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
