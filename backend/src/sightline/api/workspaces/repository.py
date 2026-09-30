"""Statements for workspaces, memberships and invitations.

Every function runs in the caller's transaction. Inside `workspace_transaction` row-level security
limits each statement to that workspace; inside `user_transaction` a user sees their own
memberships and the workspaces those belong to (docs/04-data-model.md section 13).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import Row, func, insert, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from sightline.db.tables import memberships, workspace_quotas, workspaces

_UNIQUE_VIOLATION = "23505"


class SlugTakenError(Exception):
    """Another workspace has this slug. The transaction cannot be used after it."""


@dataclass(frozen=True, slots=True)
class WorkspaceRecord:
    id: UUID
    name: str
    slug: str
    logo: str | None
    plan_code: str
    timezone: str
    status: str
    created_at: datetime
    purge_after: datetime | None


_WORKSPACE_COLUMNS = (
    workspaces.c.id,
    workspaces.c.name,
    workspaces.c.slug,
    workspaces.c.logo,
    workspaces.c.plan_code,
    workspaces.c.timezone,
    workspaces.c.status,
    workspaces.c.created_at,
    workspaces.c.purge_after,
)


def _workspace(row: Row[tuple[object, ...]]) -> WorkspaceRecord:
    fields = row._mapping
    return WorkspaceRecord(
        id=fields["id"],
        name=fields["name"],
        slug=str(fields["slug"]),
        logo=fields["logo"],
        plan_code=fields["plan_code"],
        timezone=fields["timezone"],
        status=fields["status"],
        created_at=fields["created_at"],
        purge_after=fields["purge_after"],
    )


async def new_id(db: AsyncSession) -> UUID:
    """An id from the database, for a row whose policy compares its id with a setting that has
    to be written before the insert."""
    generated: UUID = (await db.execute(select(func.uuidv7()))).scalar_one()
    return generated


_TIMEZONE_EXISTS = text("SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = :name)")


async def timezone_exists(db: AsyncSession, name: str) -> bool:
    """Whether PostgreSQL knows this time zone by exactly this name."""
    return bool((await db.execute(_TIMEZONE_EXISTS, {"name": name})).scalar_one())


async def list_for_user(db: AsyncSession, user_id: UUID) -> list[WorkspaceRecord]:
    """The workspaces the user belongs to, except ones being deleted. Run in `user_transaction`."""
    statement = (
        select(*_WORKSPACE_COLUMNS)
        .join(memberships, memberships.c.workspace_id == workspaces.c.id)
        .where(memberships.c.user_id == user_id, workspaces.c.status != "deleting")
        .order_by(func.lower(workspaces.c.name), workspaces.c.id)
    )
    return [_workspace(row) for row in await db.execute(statement)]


async def get(
    db: AsyncSession, workspace_id: UUID, *, for_update: bool = False
) -> WorkspaceRecord | None:
    statement = select(*_WORKSPACE_COLUMNS).where(workspaces.c.id == workspace_id)
    if for_update:
        statement = statement.with_for_update()
    row = (await db.execute(statement)).one_or_none()
    return None if row is None else _workspace(row)


def _raise_if_slug_taken(error: IntegrityError) -> None:
    if getattr(error.orig, "sqlstate", None) == _UNIQUE_VIOLATION:
        raise SlugTakenError from None


async def insert_workspace(
    db: AsyncSession, *, workspace_id: UUID, name: str, slug: str, timezone: str
) -> WorkspaceRecord:
    statement = (
        insert(workspaces)
        .values(id=workspace_id, name=name, slug=slug, timezone=timezone)
        .returning(*_WORKSPACE_COLUMNS)
    )
    try:
        row = (await db.execute(statement)).one()
    except IntegrityError as error:
        _raise_if_slug_taken(error)
        raise
    return _workspace(row)


async def update_workspace(
    db: AsyncSession, workspace_id: UUID, changes: Mapping[str, str | None]
) -> WorkspaceRecord:
    statement = (
        update(workspaces)
        .where(workspaces.c.id == workspace_id)
        .values(**changes)
        .returning(*_WORKSPACE_COLUMNS)
    )
    try:
        row = (await db.execute(statement)).one()
    except IntegrityError as error:
        _raise_if_slug_taken(error)
        raise
    return _workspace(row)


async def insert_membership(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    user_id: UUID,
    role: str,
    project_ids: list[UUID] | None = None,
) -> None:
    await db.execute(
        insert(memberships).values(
            workspace_id=workspace_id, user_id=user_id, role=role, project_ids=project_ids
        )
    )


async def insert_default_quotas(db: AsyncSession, workspace_id: UUID) -> None:
    """The limits come from the column defaults (docs/04-data-model.md section 4.1)."""
    await db.execute(insert(workspace_quotas).values(workspace_id=workspace_id))
