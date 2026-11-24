"""Scheduled report emails, as the people who manage them use them. The digest job that sends
them is `reports.digest`."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Final
from uuid import UUID

from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api import audit
from idraft.api.ai.engine_service import live_project
from idraft.api.problems import NotFoundError, ProblemError
from idraft.api.request_info import RequestInfo
from idraft.api.schemas.ai_reports import (
    SCHEDULES_MAX,
    ReportSchedule,
    ReportScheduleCreate,
    ReportScheduleFrequency,
    ReportScheduleUpdate,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.db.tables import ai_report_schedules as schedules

SEND_HOUR_UTC: Final = 6


class ScheduleLimitError(ProblemError):
    status, code, title = 422, "schedule_limit", "Too many scheduled reports"


def next_slot(frequency: ReportScheduleFrequency, now: datetime) -> datetime:
    """The first send time after `now`: Monday 06:00 UTC for weekly, the 1st at 06:00 UTC for
    monthly. The SQL of `ai_report_schedules_claim_due` moves a claimed row to the same slot."""
    now = now.astimezone(UTC)
    if frequency == "weekly":
        monday = (now - timedelta(days=now.weekday())).replace(
            hour=SEND_HOUR_UTC, minute=0, second=0, microsecond=0
        )
        return monday if monday > now else monday + timedelta(days=7)
    first = now.replace(day=1, hour=SEND_HOUR_UTC, minute=0, second=0, microsecond=0)
    if first > now:
        return first
    return (first + timedelta(days=32)).replace(day=1)


_COLUMNS = (
    schedules.c.id,
    schedules.c.frequency,
    schedules.c.recipients,
    schedules.c.paused,
    schedules.c.next_run_at,
    schedules.c.last_sent_at,
    schedules.c.last_error,
    schedules.c.created_by,
    schedules.c.created_at,
)


def _schedule(row: object) -> ReportSchedule:
    return ReportSchedule.model_validate(row, from_attributes=True)


class ReportScheduleService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    async def list(self, access: WorkspaceAccess, project_id: UUID) -> list[ReportSchedule]:
        async with workspace_transaction(
            self._sessions, access.workspace_id, user_id=access.user_id
        ) as db:
            await live_project(db, access, project_id)
            rows = (
                await db.execute(
                    select(*_COLUMNS)
                    .where(
                        schedules.c.workspace_id == access.workspace_id,
                        schedules.c.project_id == project_id,
                    )
                    .order_by(schedules.c.created_at, schedules.c.id)
                    .limit(SCHEDULES_MAX)
                )
            ).all()
        return [_schedule(row) for row in rows]

    async def create(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        body: ReportScheduleCreate,
        info: RequestInfo,
    ) -> ReportSchedule:
        async with workspace_transaction(
            self._sessions, access.workspace_id, user_id=access.user_id
        ) as db:
            # The project row is locked, so two creations count one after the other.
            await live_project(db, access, project_id, lock=True)
            held = (
                await db.execute(
                    select(func.count()).where(
                        schedules.c.workspace_id == access.workspace_id,
                        schedules.c.project_id == project_id,
                    )
                )
            ).scalar_one()
            if held >= SCHEDULES_MAX:
                raise ScheduleLimitError(f"A project holds at most {SCHEDULES_MAX} schedules.")
            row = (
                await db.execute(
                    insert(schedules)
                    .values(
                        workspace_id=access.workspace_id,
                        project_id=project_id,
                        frequency=body.frequency,
                        recipients=body.recipients,
                        next_run_at=next_slot(body.frequency, datetime.now(UTC)),
                        created_by=access.user_id,
                    )
                    .returning(*_COLUMNS)
                )
            ).one()
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="ai_report_schedule.created",
                target_type="ai_report_schedule",
                target_id=row.id,
                info=info,
                after={
                    "project_id": str(project_id),
                    "frequency": body.frequency,
                    "recipients": len(body.recipients),
                },
            )
        return _schedule(row)

    async def update(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        schedule_id: UUID,
        body: ReportScheduleUpdate,
        info: RequestInfo,
    ) -> ReportSchedule:
        values: dict[str, object] = body.model_dump(exclude_none=True)
        async with workspace_transaction(
            self._sessions, access.workspace_id, user_id=access.user_id
        ) as db:
            await live_project(db, access, project_id)
            where = (
                schedules.c.workspace_id == access.workspace_id,
                schedules.c.project_id == project_id,
                schedules.c.id == schedule_id,
            )
            found = (
                await db.execute(select(schedules.c.frequency, schedules.c.paused).where(*where))
            ).first()
            if found is None:
                raise NotFoundError
            if (body.frequency is not None and body.frequency != found.frequency) or (
                body.paused is False and found.paused
            ):
                # A new rhythm, or a schedule that runs again, waits for its next slot: it never
                # sends at once for a slot that passed while it was paused.
                values["next_run_at"] = next_slot(
                    body.frequency or found.frequency, datetime.now(UTC)
                )
            if values:
                result = await db.execute(
                    update(schedules).where(*where).values(**values).returning(*_COLUMNS)
                )
            else:
                result = await db.execute(select(*_COLUMNS).where(*where))
            row = result.one()
            if values:
                await audit.record(
                    db,
                    workspace_id=access.workspace_id,
                    actor_id=access.user_id,
                    action="ai_report_schedule.updated",
                    target_type="ai_report_schedule",
                    target_id=schedule_id,
                    info=info,
                    after={
                        "project_id": str(project_id),
                        "frequency": row.frequency,
                        "recipients": len(row.recipients),
                        "paused": row.paused,
                    },
                )
        return _schedule(row)

    async def delete(
        self, access: WorkspaceAccess, project_id: UUID, schedule_id: UUID, info: RequestInfo
    ) -> None:
        async with workspace_transaction(
            self._sessions, access.workspace_id, user_id=access.user_id
        ) as db:
            await live_project(db, access, project_id)
            gone = (
                await db.execute(
                    delete(schedules)
                    .where(
                        schedules.c.workspace_id == access.workspace_id,
                        schedules.c.project_id == project_id,
                        schedules.c.id == schedule_id,
                    )
                    .returning(schedules.c.id)
                )
            ).first()
            if gone is None:
                raise NotFoundError
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="ai_report_schedule.deleted",
                target_type="ai_report_schedule",
                target_id=schedule_id,
                info=info,
                after={"project_id": str(project_id)},
            )
