"""Shareable client summary links, as the people who manage them use them (plan 06 Task 4).

The token is 32 random bytes in URL-safe text; only its SHA-256 is stored, so a copy of the
database cannot be turned into a working link. The token is returned once, by `create`.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Final
from uuid import UUID

from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api import audit
from idraft.api.ai.engine_service import live_project
from idraft.api.problems import NotFoundError
from idraft.api.request_info import RequestInfo
from idraft.api.schemas.internal_links_share import CreatedShare, ExpiryDays, Share, ShareState
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.db.tables import client_summary_shares

LIST_MAX: Final = 100
TOKEN_BYTES: Final = 32


def hash_token(token: str) -> bytes:
    return hashlib.sha256(token.encode("utf-8")).digest()


def state_of(expires_at: datetime, revoked_at: datetime | None, *, now: datetime) -> ShareState:
    if revoked_at is not None:
        return "revoked"
    return "expired" if expires_at <= now else "active"


class ShareService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    async def create(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        expires_in_days: ExpiryDays,
        info: RequestInfo,
    ) -> CreatedShare:
        token = secrets.token_urlsafe(TOKEN_BYTES)
        now = datetime.now(UTC)
        expires_at = now + timedelta(days=expires_in_days)
        async with workspace_transaction(
            self._sessions, access.workspace_id, user_id=access.user_id
        ) as db:
            await live_project(db, access, project_id)
            row = (
                await db.execute(
                    insert(client_summary_shares)
                    .values(
                        workspace_id=access.workspace_id,
                        project_id=project_id,
                        token_hash=hash_token(token),
                        created_by=access.user_id,
                        expires_at=expires_at,
                    )
                    .returning(client_summary_shares.c.id, client_summary_shares.c.created_at)
                )
            ).one()
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="client_summary_share.created",
                target_type="client_summary_share",
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
        async with workspace_transaction(
            self._sessions, access.workspace_id, user_id=access.user_id
        ) as db:
            await live_project(db, access, project_id)
            rows = (
                await db.execute(
                    select(
                        client_summary_shares.c.id,
                        client_summary_shares.c.created_at,
                        client_summary_shares.c.created_by,
                        client_summary_shares.c.expires_at,
                        client_summary_shares.c.revoked_at,
                    )
                    .where(
                        client_summary_shares.c.workspace_id == access.workspace_id,
                        client_summary_shares.c.project_id == project_id,
                    )
                    .order_by(client_summary_shares.c.created_at.desc(), client_summary_shares.c.id)
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
        async with workspace_transaction(
            self._sessions, access.workspace_id, user_id=access.user_id
        ) as db:
            await live_project(db, access, project_id)
            where = (
                client_summary_shares.c.workspace_id == access.workspace_id,
                client_summary_shares.c.project_id == project_id,
                client_summary_shares.c.id == share_id,
            )
            now = datetime.now(UTC)
            changed = (
                await db.execute(
                    update(client_summary_shares)
                    .where(*where, client_summary_shares.c.revoked_at.is_(None))
                    .values(revoked_at=now, revoked_by=access.user_id)
                    .returning(client_summary_shares.c.id)
                )
            ).first()
            row = (
                await db.execute(
                    select(
                        client_summary_shares.c.id,
                        client_summary_shares.c.created_at,
                        client_summary_shares.c.created_by,
                        client_summary_shares.c.expires_at,
                        client_summary_shares.c.revoked_at,
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
                    action="client_summary_share.revoked",
                    target_type="client_summary_share",
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
