"""Workspace audit entries (docs/24-security.md section 12).

Written in the transaction of the change they describe, so an entry exists exactly when the change
does. The id and the time come from the database; the API has no grant to set them. Auth events
have no workspace and go through `ops.record_auth_event` instead (idraft.api.auth.repository).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.api.request_info import RequestInfo
from idraft.db.tables import audit_logs

type Snapshot = Mapping[str, str | int | bool | list[str] | None]
# A statement carries at most 32,767 parameters (asyncpg), and an entry takes 11.
ROWS_PER_STATEMENT = 1000
AuditAction = Literal[
    "workspace.created",
    "workspace.updated",
    "member.updated",
    "member.removed",
    "invitation.created",
    "invitation.cancelled",
    "invitation.accepted",
    "project.created",
    "project.updated",
    "entity.created",
    "entity.updated",
    "entity.deleted",
    "entity_alias.created",
    "entity_alias.updated",
    "entity_alias.deleted",
    "entity_domain.created",
    "entity_domain.deleted",
    "project_entity.created",
    "project_entity.updated",
    "project_entity.removed",
    "vocabulary.created",
    "vocabulary.updated",
    "vocabulary.deleted",
    "term.created",
    "term.updated",
    "term.deleted",
    "tracked_keyword.created",
    "tracked_keyword.updated",
    "tracked_keyword.deleted",
    "tracked_keyword.competitors_changed",
    "tracked_keyword.bulk_changed",
    "keyword_group.created",
    "keyword_group.updated",
    "keyword_group.deleted",
    "keyword_group.members_added",
    "keyword_group.members_removed",
    "collection_run.requested",
    "collection_run.cancelled",
    "schedule.created",
    "schedule.updated",
    "schedule.deleted",
    "schedule.paused",
    "schedule.resumed",
    "project.settings_updated",
    "keyword_import.created",
    "keyword_import.updated",
    "keyword_import.confirmed",
    "keyword_import.cancelled",
]


@dataclass(frozen=True, slots=True)
class Entry:
    """One target of `record_each`."""

    target_id: UUID
    before: Snapshot | None = None
    after: Snapshot | None = None


async def record_each(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    actor_id: UUID,
    action: AuditAction,
    target_type: str,
    info: RequestInfo,
    entries: Sequence[Entry],
) -> None:
    """One entry per target, in as few statements as the driver allows (a batch of aliases or
    terms is one request)."""
    rows = [
        {
            "workspace_id": workspace_id,
            "actor_type": "user",
            "actor_id": str(actor_id),
            "action": action,
            "target_type": target_type,
            "target_id": str(entry.target_id),
            "before": None if entry.before is None else dict(entry.before),
            "after": None if entry.after is None else dict(entry.after),
            "ip": info.ip,
            "user_agent": info.user_agent,
            "request_id": info.request_id,
        }
        for entry in entries
    ]
    for start in range(0, len(rows), ROWS_PER_STATEMENT):
        await db.execute(insert(audit_logs).values(rows[start : start + ROWS_PER_STATEMENT]))


async def record(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    actor_id: UUID,
    action: AuditAction,
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
