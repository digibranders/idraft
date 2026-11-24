"""Shareable links, as the people who manage them use them (internal links plan 06 Task 4; the
client report links use the same service on their own table).

The token is 32 random bytes in URL-safe text; only its SHA-256 is stored, so a copy of the
database cannot be turned into a working link. The token is returned once, by `create`.
"""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Final, Literal
from uuid import UUID

from sqlalchemy import Table, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api import audit
from idraft.api.ai.engine_service import live_project
from idraft.api.problems import NotFoundError
from idraft.api.request_info import RequestInfo
from idraft.api.schemas.internal_links_share import CreatedShare, ExpiryDays, Share, ShareState
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.db.tables import ai_report_shares, client_summary_shares

LIST_MAX: Final = 100
TOKEN_BYTES: Final = 32


@dataclass(frozen=True, slots=True)
class ShareKind:
    """Which table the links live in and what their audit entries are called."""

    table: Table
    target_type: Literal["client_summary_share", "ai_report_share"]
    created: Literal["client_summary_share.created", "ai_report_share.created"]
    revoked: Literal["client_summary_share.revoked", "ai_report_share.revoked"]


SUMMARY_SHARES: Final = ShareKind(
    client_summary_shares,
    "client_summary_share",
    "client_summary_share.created",
    "client_summary_share.revoked",
)
REPORT_SHARES: Final = ShareKind(
    ai_report_shares, "ai_report_share", "ai_report_share.created", "ai_report_share.revoked"
)


def hash_token(token: str) -> bytes:
    return hashlib.sha256(token.encode("utf-8")).digest()


def state_of(expires_at: datetime, revoked_at: datetime | None, *, now: datetime) -> ShareState:
    if revoked_at is not None:
        return "revoked"
    return "expired" if expires_at <= now else "active"


class ShareService:
    def __init__(
        self, *, sessions: async_sessionmaker[AsyncSession], kind: ShareKind = SUMMARY_SHARES
    ) -> None:
        self._sessions = sessions
        self._kind = kind

    async def create(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        expires_in_days: ExpiryDays,
        info: RequestInfo,
    ) -> CreatedShare:
        shares = self._kind.table
        token = secrets.token_urlsafe(TOKEN_BYTES)
        now = datetime.now(UTC)
        expires_at = now + timedelta(days=expires_in_days)
        async with workspace_transaction(
            self._sessions, access.workspace_id, user_id=access.user_id
        ) as db:
            await live_project(db, access, project_id)
            row = (
                await db.execute(
                    insert(shares)
                    .values(
                        workspace_id=access.workspace_id,
                        project_id=project_id,
                        token_hash=hash_token(token),
                        created_by=access.user_id,
                        # Both from one clock, so the link lasts exactly the days that were offered
                        created_at=now,
                        expires_at=expires_at,
                    )
                    .returning(shares.c.id, shares.c.created_at)
                )
            ).one()
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action=self._kind.created,
                target_type=self._kind.target_type,
                target_id=row.id,
                info=info,
                after={"project_id": str(project_id), "expires_in_days": expires_in_days},
            )
        return CreatedShare(
            id=row.id,
            created_at=row.created_at,
            created_by=access.user_id,
            expires_at=expires_at,
            revoked_at=None,
            state="active",
            token=token,
        )

    async def list(self, access: WorkspaceAccess, project_id: UUID) -> list[Share]:
        shares = self._kind.table
        async with workspace_transaction(
            self._sessions, access.workspace_id, user_id=access.user_id
        ) as db:
            await live_project(db, access, project_id)
            rows = (
                await db.execute(
                    select(
                        shares.c.id,
                        shares.c.created_at,
                        shares.c.created_by,
                        shares.c.expires_at,
                        shares.c.revoked_at,
                    )
                    .where(
                        shares.c.workspace_id == access.workspace_id,
                        shares.c.project_id == project_id,
                    )
                    .order_by(shares.c.created_at.desc(), shares.c.id)
                    .limit(LIST_MAX)
                )
            ).all()
        now = datetime.now(UTC)
        return [
            Share(
                id=row.id,
                created_at=row.created_at,
                created_by=row.created_by,
                expires_at=row.expires_at,
                revoked_at=row.revoked_at,
                state=state_of(row.expires_at, row.revoked_at, now=now),
            )
            for row in rows
        ]

    async def revoke(
        self, access: WorkspaceAccess, project_id: UUID, share_id: UUID, info: RequestInfo
    ) -> Share:
        """Revoking again changes nothing and answers with the share as it is."""
        shares = self._kind.table
        async with workspace_transaction(
            self._sessions, access.workspace_id, user_id=access.user_id
        ) as db:
            await live_project(db, access, project_id)
            where = (
                shares.c.workspace_id == access.workspace_id,
                shares.c.project_id == project_id,
                shares.c.id == share_id,
            )
            now = datetime.now(UTC)
            changed = (
                await db.execute(
                    update(shares)
                    .where(*where, shares.c.revoked_at.is_(None))
                    .values(revoked_at=now, revoked_by=access.user_id)
                    .returning(shares.c.id)
                )
            ).first()
            row = (
                await db.execute(
                    select(
                        shares.c.id,
                        shares.c.created_at,
                        shares.c.created_by,
                        shares.c.expires_at,
                        shares.c.revoked_at,
                    ).where(*where)
                )
            ).one_or_none()
            if row is None:
                raise NotFoundError
            if changed is not None:
                await audit.record(
                    db,
                    workspace_id=access.workspace_id,
                    actor_id=access.user_id,
                    action=self._kind.revoked,
                    target_type=self._kind.target_type,
                    target_id=share_id,
                    info=info,
                    after={"project_id": str(project_id)},
                )
        return Share(
            id=row.id,
            created_at=row.created_at,
            created_by=row.created_by,
            expires_at=row.expires_at,
            revoked_at=row.revoked_at,
            state=state_of(row.expires_at, row.revoked_at, now=now),
        )
