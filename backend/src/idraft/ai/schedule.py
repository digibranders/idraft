"""The project's AI answer schedules (spec 2026-11-11 section 4.3; docs/21-scheduler-workers.md
section 2; plan decision A4).

The base plan asks every active prompt `BASE_PLAN.runs_per_week` times a week. A schedule has one
rule, and `ops.schedules` reserves a `cron` cadence that no rule computes yet
(`idraft.domain.schedules`): the planner passes a cron schedule over. So twice a week is two
weekly schedules, Monday and Thursday, three and four days apart. Each opens at 01:00 project
time for eight hours (doc 21 section 2; doc 07 section 4.3 keeps eight hours after the spike), on
the plan's queue, for every active prompt of the project.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time
from typing import Final
from uuid import UUID

from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.db.tables import projects, schedules
from idraft.domain.ai_engines import BASE_PLAN
from idraft.domain.schedules import Cadence, ScheduleRule, next_occurrence
from idraft.domain.workloads import TaskWorkload


@dataclass(frozen=True, slots=True)
class AiRun:
    # 0 is Sunday, as in `ops.schedules.weekday`.
    weekday: int
    name: str


@dataclass(frozen=True, slots=True)
class AiScheduleRule:
    window_start_local: time
    window_hours: int
    runs: tuple[AiRun, ...]


AI_SCHEDULE: Final = AiScheduleRule(
    window_start_local=time(1, 0),
    window_hours=8,
    runs=(AiRun(1, "AI answers, Monday"), AiRun(4, "AI answers, Thursday")),
)


async def ensure_ai_schedule(
    db: AsyncSession, *, workspace_id: UUID, project_id: UUID, now: datetime
) -> None:
    """The project's AI answer schedules, made when an engine is turned on, so answers start by
    themselves. A project with any `ai_prompt` schedule, one a person paused, changed or deleted
    included, is left as it is. The caller holds the project row, so two of these never run at
    once for one project."""
    found = await db.execute(
        select(schedules.c.id)
        .where(
            schedules.c.workspace_id == workspace_id,
            schedules.c.project_id == project_id,
            schedules.c.workload == TaskWorkload.AI_PROMPT.value,
        )
        .limit(1)
    )
    if found.first() is not None:
        return
    timezone: str = (
        await db.execute(
            select(projects.c.timezone).where(
                projects.c.workspace_id == workspace_id, projects.c.id == project_id
            )
        )
    ).scalar_one()
    for run in AI_SCHEDULE.runs:
        rule = ScheduleRule(
            cadence=Cadence.WEEKLY,
            timezone=timezone,
            window_start_local=AI_SCHEDULE.window_start_local,
            weekday=run.weekday,
        )
        await db.execute(
            insert(schedules).values(
                workspace_id=workspace_id,
                project_id=project_id,
                workload=TaskWorkload.AI_PROMPT.value,
                name=run.name,
                cadence=rule.cadence.value,
                weekday=run.weekday,
                timezone=timezone,
                window_start_local=AI_SCHEDULE.window_start_local,
                window_hours=AI_SCHEDULE.window_hours,
                provider_mode=BASE_PLAN.provider_mode,
                selector={"all": True},
                next_run_at=next_occurrence(rule, now),
            )
        )
