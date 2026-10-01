"""Statements for schedules, as the API reads and writes them. Every function runs inside
`workspace_transaction`, and every statement names the workspace as well. A deleted schedule
keeps its row (`deleted_at`), so its runs keep naming it; nothing here returns one."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, time
from typing import Any
from uuid import UUID

from sqlalchemy import Row, Select, exists, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from sightline.db.tables import schedules, tracked_keywords


@dataclass(frozen=True, slots=True)
class ScheduleRecord:
    id: UUID
    project_id: UUID
    workload: str
    name: str
    cadence: str
    cron_expr: str | None
    timezone: str
    window_start_local: time
    window_hours: int
    weekday: int | None
    month_day: int | None
    priority: str
    provider_mode: str
    selector: Mapping[str, Any]
    is_active: bool
    next_run_at: datetime
    last_run_id: UUID | None
    created_at: datetime


_COLUMNS = (
    schedules.c.id,
    schedules.c.project_id,
    schedules.c.workload,
    schedules.c.name,
    schedules.c.cadence,
    schedules.c.cron_expr,
    schedules.c.timezone,
    schedules.c.window_start_local,
    schedules.c.window_hours,
    schedules.c.weekday,
    schedules.c.month_day,
    schedules.c.priority,
    schedules.c.provider_mode,
    schedules.c.selector,
    schedules.c.is_active,
    schedules.c.next_run_at,
    schedules.c.last_run_id,
    schedules.c.created_at,
)


def _record(row: Row[Any]) -> ScheduleRecord:
    return ScheduleRecord(
        id=row.id,
        project_id=row.project_id,
        workload=row.workload,
        name=row.name,
        cadence=row.cadence,
        cron_expr=row.cron_expr,
        timezone=row.timezone,
        window_start_local=row.window_start_local,
        window_hours=row.window_hours,
        weekday=row.weekday,
        month_day=row.month_day,
        priority=row.priority,
        provider_mode=row.provider_mode,
        selector=row.selector or {},
        is_active=row.is_active,
        next_run_at=row.next_run_at,
        last_run_id=row.last_run_id,
        created_at=row.created_at,
    )


def _live(workspace_id: UUID, project_id: UUID) -> Select[Any]:
    return select(*_COLUMNS).where(
        schedules.c.workspace_id == workspace_id,
        schedules.c.project_id == project_id,
        schedules.c.deleted_at.is_(None),
    )


async def list_schedules(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    *,
    workload: str | None,
    is_active: bool | None,
    offset: int,
    limit: int,
) -> tuple[list[ScheduleRecord], int]:
    """A page of the project's schedules, oldest first, and how many there are."""
    statement = _live(workspace_id, project_id)
    if workload is not None:
        statement = statement.where(schedules.c.workload == workload)
    if is_active is not None:
        statement = statement.where(schedules.c.is_active.is_(is_active))
    total: int = (
        await db.execute(select(func.count()).select_from(statement.subquery()))
    ).scalar_one()
    rows = await db.execute(
        statement.order_by(schedules.c.created_at, schedules.c.id).offset(offset).limit(limit)
    )
    return [_record(row) for row in rows], total


async def get_schedule(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, schedule_id: UUID, *, lock: bool
) -> ScheduleRecord | None:
    """The project's live schedule. With `lock`, held (FOR UPDATE) until the transaction ends:
    a tracked keyword that names it holds it FOR KEY SHARE, so a delete waits for that keyword
    and then sees it."""
    statement = _live(workspace_id, project_id).where(schedules.c.id == schedule_id)
    if lock:
        statement = statement.with_for_update(of=schedules)
    row = (await db.execute(statement)).one_or_none()
    return None if row is None else _record(row)


async def insert_schedule(
    db: AsyncSession, *, workspace_id: UUID, project_id: UUID, values: Mapping[str, object]
) -> ScheduleRecord:
    row = (
        await db.execute(
            insert(schedules)
            .values(workspace_id=workspace_id, project_id=project_id, **values)
            .returning(*_COLUMNS)
        )
    ).one()
    return _record(row)


async def update_schedule(
    db: AsyncSession, workspace_id: UUID, schedule_id: UUID, values: Mapping[str, object]
) -> ScheduleRecord:
    row = (
        await db.execute(
            update(schedules)
            .where(schedules.c.workspace_id == workspace_id, schedules.c.id == schedule_id)
            .values(**values)
            .returning(*_COLUMNS)
        )
    ).one()
    return _record(row)


async def delete_schedule(db: AsyncSession, workspace_id: UUID, schedule_id: UUID) -> None:
    """Deleted by setting `deleted_at`, and no longer planned."""
    await db.execute(
        update(schedules)
        .where(schedules.c.workspace_id == workspace_id, schedules.c.id == schedule_id)
        .values(deleted_at=func.now(), is_active=False)
    )


async def schedule_in_use(db: AsyncSession, workspace_id: UUID, schedule_id: UUID) -> bool:
    """Whether tracked keywords that are not deleted name the schedule (archived ones too: they
    would be collected by it once brought back)."""
    t = tracked_keywords.c
    found: bool = (
        await db.execute(
            select(
                exists().where(
                    t.workspace_id == workspace_id,
                    t.schedule_id == schedule_id,
                    t.deleted_at.is_(None),
                )
            )
        )
    ).scalar_one()
    return found
