"""The cost forecast: what a project's live AI schedules are expected to cost in a month
(docs/19-api-specification.md section 3.11.2; WP-30 plan decision D10).

For each project the windows its live `ai_prompt` schedules open in the month (the schedule
planner's own rule, `domain.schedules`), times the price of one full run, which is the AI
collector's own estimate over every prompt and engine the planner would ask. So a forecast and a
planned run never disagree. The reads are the planner's, and they only read: nothing is planned,
started or spent. A project whose run has no price in the price book is left out; its forecast is
unknown, not 0.

shortcut: a schedule's windows are each priced as a full run. The planner leaves out what an
overlapping window of another schedule already asked, so two schedules with overlapping windows
are forecast above what is planned; fix with a per-window plan when schedules may overlap.
"""

from __future__ import annotations

from collections import defaultdict
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Final
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.operations import costs_repository as repository
from idraft.api.operations.costs import money
from idraft.api.problems import NotFoundError
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.collectors import ai_prompt
from idraft.collectors.registry import ScheduleWindow
from idraft.db.engine import workspace_transaction
from idraft.domain.schedules import Cadence, ScheduleRule, next_occurrence, occurrences_until

# A moment no run's window spans, so no run of another schedule has already asked a prompt in it
# and the planner's selection is the full one.
_NO_OVERLAP: Final = datetime(2000, 1, 1, tzinfo=UTC)
_ONE_MICROSECOND: Final = timedelta(microseconds=1)


@dataclass(frozen=True, slots=True)
class ForecastLine:
    project_id: UUID
    estimated_cost_usd: Decimal


def windows_in(schedule: repository.LiveSchedule, start: datetime, end: datetime) -> int:
    """How many windows the schedule opens from `start` up to `end` (excluded)."""
    rule = ScheduleRule(
        cadence=Cadence(schedule.cadence),
        timezone=schedule.timezone,
        window_start_local=schedule.window_start_local,
        weekday=schedule.weekday,
        month_day=schedule.month_day,
    )
    first = next_occurrence(rule, start - _ONE_MICROSECOND)
    return len(occurrences_until(rule, first, end - _ONE_MICROSECOND))


class ForecastService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    async def forecast(
        self, access: WorkspaceAccess, month: date | None, project_id: UUID | None
    ) -> list[ForecastLine]:
        """A line per project the caller reaches that has live AI schedules and a price, for
        the month (UTC; this month when none is given)."""
        if project_id is not None and not access.sees(project_id):
            raise NotFoundError
        async with self._transaction(access) as db:
            now: datetime = (await db.execute(select(func.now()))).scalar_one()
            today = now.astimezone(UTC).date()
            first = (today if month is None else month).replace(day=1)
            start = datetime.combine(first, time(), tzinfo=UTC)
            end = datetime.combine((first + timedelta(days=32)).replace(day=1), time(), tzinfo=UTC)
            ids = await repository.visible_projects(
                db, access.workspace_id, access.project_ids, only=project_id
            )
            if project_id is not None and not ids:
                raise NotFoundError
            if not ids:
                return []
            live = await repository.live_ai_schedules(db, access.workspace_id, ids)
            by_project: dict[UUID, list[repository.LiveSchedule]] = defaultdict(list)
            for schedule in live:
                by_project[schedule.project_id].append(schedule)
            lines: list[ForecastLine] = []
            for id_ in ids:
                found = by_project.get(id_)
                if found is None:
                    continue
                cost = await self._project(db, access, id_, found, start, end, today)
                if cost is not None:
                    lines.append(ForecastLine(id_, money(cost)))
        return lines

    @staticmethod
    async def _project(
        db: AsyncSession,
        access: WorkspaceAccess,
        project_id: UUID,
        schedules: list[repository.LiveSchedule],
        start: datetime,
        end: datetime,
        today: date,
    ) -> Decimal | None:
        """The project's windows in the month at the price of one full run, or None when the
        price book has no price for the run. The run is selected once whatever the schedules,
        and priced once for each queue they use."""
        window = ScheduleWindow(
            schedule_id=schedules[0].schedule_id,
            workspace_id=access.workspace_id,
            project_id=project_id,
            workload=ai_prompt.WORKLOAD,
            provider_mode=schedules[0].provider_mode,
            selector={},
            window_start=_NO_OVERLAP,
            window_end=_NO_OVERLAP,
            window_hours=1,
        )
        subjects, _ = await ai_prompt.select_subjects(db, window)
        prices: dict[str, Decimal | None] = {}
        total = Decimal(0)
        for schedule in schedules:
            queue = ai_prompt.queue_of(schedule.provider_mode)
            if queue not in prices:
                prices[queue] = await ai_prompt.estimate(db, subjects, queue=queue, on=today)
            price = prices[queue]
            if price is None:
                return None
            total += price * windows_in(schedule, start, end)
        return total
