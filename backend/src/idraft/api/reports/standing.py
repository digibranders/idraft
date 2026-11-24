"""Whether the person who made a report link or schedule may still stand behind it.

A guest link and a scheduled email speak in the name of whoever made them, to people outside the
workspace. They stop when that person leaves the workspace or is disabled, and when the workspace
is no longer active. The guest read and the digest job both ask here, in a workspace transaction.
"""

from __future__ import annotations

from typing import Final, Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.db.tables import memberships, users, workspaces

type Standing = Literal["ok", "workspace", "maker"]
WORKSPACE_REASON: Final = "the workspace is not active"
MAKER_REASON: Final = "the person who made it can no longer send it"


async def standing_of(db: AsyncSession, workspace_id: UUID, user_id: UUID) -> Standing:
    workspace_active, member, enabled = (
        await db.execute(
            select(
                select(workspaces.c.id)
                .where(workspaces.c.id == workspace_id, workspaces.c.status == "active")
                .exists(),
                select(memberships.c.user_id)
                .where(memberships.c.workspace_id == workspace_id, memberships.c.user_id == user_id)
                .exists(),
                # Named columns: the worker may read only some columns of a user
                select(users.c.id)
                .where(users.c.id == user_id, users.c.disabled_at.is_(None))
                .exists(),
            )
        )
    ).one()
    if not workspace_active:
        return "workspace"
    return "ok" if member and enabled else "maker"
