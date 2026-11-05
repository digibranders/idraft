"""Reads of a workspace's quotas."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.keywords import writer


@dataclass(frozen=True, slots=True)
class TrackedKeywordUsage:
    limit: int
    used: int


class QuotaService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    async def tracked_keywords(self, access: WorkspaceAccess) -> TrackedKeywordUsage:
        """The tracked keyword limit and use of the whole workspace, the figures a write over
        the limit is refused with (`quota_exceeded`)."""
        async with workspace_transaction(
            self._sessions, access.workspace_id, user_id=access.user_id
        ) as db:
            limit, used = await writer.quota_usage(db, access.workspace_id)
        return TrackedKeywordUsage(limit=limit, used=used)
