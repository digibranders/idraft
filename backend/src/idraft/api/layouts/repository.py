"""Reads and writes of `core.layouts` (docs/04-data-model.md section 11.6a; WP-11).

Runs in the caller's transaction as the API role. Every statement names the workspace and, for a
personal layout, the caller: that is the application half of the privacy rule (owner decision
D-09); the policy `layouts_owner` is the database half.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import delete, func, insert, literal, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.api.request_info import RequestInfo
from idraft.db.tables import audit_logs, layouts, users

TeamChange = Literal["layout.default.set", "layout.default.remove"]


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


async def lock_screen(db: AsyncSession, workspace_id: UUID, screen: str) -> None:
    """Writers of one screen of one workspace take turns until the transaction ends, so a read,
    its If-Match comparison and the write are never overtaken (plan decision L8)."""
    await db.execute(
        select(
            func.pg_advisory_xact_lock(
                func.hashtextextended(literal(f"layouts:{workspace_id}:{screen}"), 0)
            )
        )
    )


async def insert_layout(
    db: AsyncSession,
    workspace_id: UUID,
    owner_user_id: UUID | None,
    screen: str,
    document: dict[str, Any],
    user_id: UUID,
) -> UUID:
    layout_id: UUID = (
        await db.execute(
            insert(layouts)
            .values(
                workspace_id=workspace_id,
                owner_user_id=owner_user_id,
                screen=screen,
                document=document,
                schema_version=document["schema"],
                updated_by=user_id,
            )
            .returning(layouts.c.id)
        )
    ).scalar_one()
    return layout_id


async def update_layout(
    db: AsyncSession, workspace_id: UUID, layout_id: UUID, document: dict[str, Any], user_id: UUID
) -> None:
    await db.execute(
        update(layouts)
        .where(layouts.c.workspace_id == workspace_id, layouts.c.id == layout_id)
        .values(
            document=document,
            schema_version=document["schema"],
            updated_by=user_id,
            updated_at=datetime.now(UTC),
        )
    )


async def delete_layout(
    db: AsyncSession, workspace_id: UUID, owner_user_id: UUID | None, screen: str
) -> tuple[UUID, object] | None:
    """Removes the caller's personal layout, or the team default for `owner_user_id=None`; the
    id and the document removed, or None."""
    owner = (
        layouts.c.owner_user_id.is_(None)
        if owner_user_id is None
        else layouts.c.owner_user_id == owner_user_id
    )
    row = (
        await db.execute(
            delete(layouts)
            .where(layouts.c.workspace_id == workspace_id, layouts.c.screen == screen, owner)
            .returning(layouts.c.id, layouts.c.document)
        )
    ).one_or_none()
    return None if row is None else (row.id, row.document)


async def record_team_change(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    actor_id: UUID,
    action: TeamChange,
    layout_id: UUID,
    info: RequestInfo,
    before: dict[str, object] | None,
    after: dict[str, object] | None,
) -> None:
    """An entry of `ops.audit_logs` in the columns `idraft.api.audit.record` writes; the documents
    are nested, which `audit.Snapshot` does not hold (plan decision L10). Run it in the
    transaction of the change, so the entry exists exactly when the change does."""
    await db.execute(
        insert(audit_logs).values(
            workspace_id=workspace_id,
            actor_type="user",
            actor_id=str(actor_id),
            action=action,
            target_type="layout",
            target_id=str(layout_id),
            before=before,
            after=after,
            ip=info.ip,
            user_agent=info.user_agent,
            request_id=info.request_id,
        )
    )
