"""Workspace audit entries (docs/24-security.md section 12).

Written in the transaction of the change they describe, so an entry exists exactly when the change
does. The id and the time come from the database; the API has no grant to set them. Auth events
have no workspace and go through `ops.record_auth_event` instead (sightline.api.auth.repository).
"""

from __future__ import annotations

from collections.abc import Mapping
from uuid import UUID

from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncSession

from sightline.api.request_info import RequestInfo
from sightline.db.tables import audit_logs

type Snapshot = Mapping[str, str | int | bool | list[str] | None]


async def record(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    actor_id: UUID,
    action: str,
    target_type: str,
    target_id: UUID,
    info: RequestInfo,
    before: Snapshot | None = None,
    after: Snapshot | None = None,
) -> None:
    """One entry, by a signed-in user. Run inside `workspace_transaction` for `workspace_id`."""
    await db.execute(
        insert(audit_logs).values(
            workspace_id=workspace_id,
            actor_type="user",
            actor_id=str(actor_id),
            action=action,
            target_type=target_type,
            target_id=str(target_id),
            before=None if before is None else dict(before),
            after=None if after is None else dict(after),
            ip=info.ip,
            user_agent=info.user_agent,
            request_id=info.request_id,
        )
    )
