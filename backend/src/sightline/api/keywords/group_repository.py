"""Statements for keyword groups. Every function runs inside `workspace_transaction`, and every
statement names the workspace as well.

A group's path is the names from the root down joined by `/`; a name holds no `/` (a check
says so), so the groups under one are the rows whose path starts with its path and `/`.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    ColumnElement,
    Row,
    Uuid,
    and_,
    delete,
    func,
    insert,
    literal,
    or_,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from sightline.api.keywords.repository import among_ids
from sightline.db.errors import violated_unique_constraint
from sightline.db.tables import keyword_group_members, keyword_groups, tracked_keywords

_SIBLING_NAME = "keyword_groups_sibling_name"


class GroupNameTakenError(Exception):
    """A sibling has this name, in any case. The transaction is spent."""


@dataclass(frozen=True, slots=True)
class GroupRecord:
    id: UUID
    parent_id: UUID | None
    name: str
    path: str
    keyword_count: int
    created_at: datetime


def _raise_if_name_taken(error: IntegrityError) -> None:
    if violated_unique_constraint(error) == _SIBLING_NAME:
        raise GroupNameTakenError from error


def _under_or_at(column: ColumnElement[str], path: ColumnElement[str]) -> ColumnElement[bool]:
    return or_(column == path, func.starts_with(column, path + "/"))


async def lock_groups(db: AsyncSession, project_id: UUID) -> None:
    """Group changes in one project run one at a time until the transaction ends, so a move is
    checked for cycles against a tree no other request is changing."""
    await db.execute(
        select(
            func.pg_advisory_xact_lock(
                func.hashtextextended(literal(f"keyword_groups:{project_id}"), 0)
            )
        )
    )


async def list_groups(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, *, group_id: UUID | None = None
) -> list[GroupRecord]:
    """The project's groups (or the one given), each with the active tracked keywords in it or
    under it, a keyword counted once."""
    g = keyword_groups.alias("g")
    under = keyword_groups.alias("under")
    m, t = keyword_group_members.c, tracked_keywords.c
    counted = (
        select(func.count(func.distinct(t.id)))
        .select_from(
            under.join(
                keyword_group_members,
                and_(m.group_id == under.c.id, m.workspace_id == under.c.workspace_id),
            ).join(
                tracked_keywords,
                and_(t.id == m.tracked_keyword_id, t.workspace_id == m.workspace_id),
            )
        )
        .where(
            under.c.workspace_id == workspace_id,
            under.c.project_id == g.c.project_id,
            _under_or_at(under.c.path, g.c.path),
            t.deleted_at.is_(None),
            t.is_active,
        )
        .scalar_subquery()
    )
    statement = select(
        g.c.id, g.c.parent_id, g.c.name, g.c.path, g.c.created_at, counted.label("keywords")
    ).where(g.c.workspace_id == workspace_id, g.c.project_id == project_id)
    if group_id is not None:
        statement = statement.where(g.c.id == group_id)
    rows = await db.execute(statement.order_by(g.c.path, g.c.id))
    return [_group(row) for row in rows]


def _group(row: Row[tuple[object, ...]]) -> GroupRecord:
    return GroupRecord(
        id=row.id,
        parent_id=row.parent_id,
        name=row.name,
        path=row.path,
        keyword_count=row.keywords,
        created_at=row.created_at,
    )


async def get_group(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, group_id: UUID
) -> GroupRecord | None:
    found = await list_groups(db, workspace_id, project_id, group_id=group_id)
    return found[0] if found else None


async def insert_group(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    project_id: UUID,
    parent_id: UUID | None,
    name: str,
    path: str,
) -> UUID:
    try:
        group_id: UUID = (
            await db.execute(
                insert(keyword_groups)
                .values(
                    workspace_id=workspace_id,
                    project_id=project_id,
                    parent_id=parent_id,
                    name=name,
                    path=path,
                )
                .returning(keyword_groups.c.id)
            )
        ).scalar_one()
    except IntegrityError as error:
        _raise_if_name_taken(error)
        raise
    return group_id


async def change_group(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    group_id: UUID,
    values: Mapping[str, object],
    project_id: UUID,
    old_path: str,
    new_path: str,
) -> None:
    """Sets `values` on the group and rewrites the paths of it and its subtree from `old_path`
    to `new_path`."""
    g = keyword_groups.c
    try:
        await db.execute(
            update(keyword_groups)
            .where(g.workspace_id == workspace_id, g.id == group_id)
            .values(**values)
        )
    except IntegrityError as error:
        _raise_if_name_taken(error)
        raise
    if old_path != new_path:
        await db.execute(
            update(keyword_groups)
            .where(
                g.workspace_id == workspace_id,
                g.project_id == project_id,
                _under_or_at(g.path, literal(old_path)),
            )
            .values(path=literal(new_path) + func.substr(g.path, len(old_path) + 1))
        )


async def delete_group(db: AsyncSession, workspace_id: UUID, group_id: UUID) -> None:
    """Its subgroups and memberships go with it; the tracked keywords stay."""
    await db.execute(
        delete(keyword_groups).where(
            keyword_groups.c.workspace_id == workspace_id, keyword_groups.c.id == group_id
        )
    )


async def add_members(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    project_id: UUID,
    group_id: UUID,
    tracked_ids: Collection[UUID],
) -> list[UUID]:
    """Puts the project's live tracked keywords among `tracked_ids` in the group; those added."""
    t, m = tracked_keywords.c, keyword_group_members.c
    rows = await db.execute(
        upsert(keyword_group_members)
        .from_select(
            ["group_id", "tracked_keyword_id", "project_id", "workspace_id"],
            select(literal(group_id, Uuid), t.id, t.project_id, t.workspace_id).where(
                t.workspace_id == workspace_id,
                t.project_id == project_id,
                t.deleted_at.is_(None),
                among_ids(t.id, tracked_ids),
            ),
        )
        .on_conflict_do_nothing()
        .returning(m.tracked_keyword_id)
    )
    return [row.tracked_keyword_id for row in rows]


async def remove_members(
    db: AsyncSession, workspace_id: UUID, group_id: UUID, tracked_ids: Collection[UUID]
) -> list[UUID]:
    m = keyword_group_members.c
    rows = await db.execute(
        delete(keyword_group_members)
        .where(
            m.workspace_id == workspace_id,
            m.group_id == group_id,
            among_ids(m.tracked_keyword_id, tracked_ids),
        )
        .returning(m.tracked_keyword_id)
    )
    return [row.tracked_keyword_id for row in rows]
