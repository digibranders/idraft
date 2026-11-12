"""Reads and writes of `core.layouts` (docs/04-data-model.md section 11.6a; WP-11).

Runs in the caller's transaction as the API role. Every statement names the workspace and, for a
personal layout, the caller: that is the application half of the privacy rule (owner decision
D-09); the policy `layouts_owner` is the database half.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.db.tables import layouts, users


@dataclass(frozen=True, slots=True)
class StoredLayout:
    id: UUID
    owner_user_id: UUID | None
    # As stored; it may not be a layout document at all (layout spec section 6.3).
    document: object
    updated_at: datetime
    updated_by: UUID
    updated_by_name: str


async def stored_layouts(
    db: AsyncSession, workspace_id: UUID, user_id: UUID, screen: str
) -> tuple[StoredLayout | None, StoredLayout | None]:
    """The caller's personal layout and the team default of the screen, in one statement."""
    rows = (
        await db.execute(
            select(
                layouts.c.id,
                layouts.c.owner_user_id,
                layouts.c.document,
                layouts.c.updated_at,
                layouts.c.updated_by,
                users.c.name,
            )
            .join(users, users.c.id == layouts.c.updated_by)
            .where(
                layouts.c.workspace_id == workspace_id,
                layouts.c.screen == screen,
                or_(layouts.c.owner_user_id == user_id, layouts.c.owner_user_id.is_(None)),
            )
        )
    ).all()
    found = [
        StoredLayout(
            row.id, row.owner_user_id, row.document, row.updated_at, row.updated_by, row.name
        )
        for row in rows
    ]
    personal = next((row for row in found if row.owner_user_id is not None), None)
    team = next((row for row in found if row.owner_user_id is None), None)
    return personal, team
