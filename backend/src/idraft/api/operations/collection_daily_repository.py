"""Statements for daily AI collection (WP-30; contract N5). Every function runs inside
`workspace_transaction`, and every statement names the workspace and the project as well. A day
is the project's local day: each statement turns its instant into a date in the project's zone
inside a subquery and groups on that, so the number of statements does not depend on the number
of days, engines or tasks."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import Date, Select, cast, distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.api.operations.ai_coverage_repository import NOT_PLANNED
from idraft.db.tables import ai_observations, collection_runs, collection_tasks

AI_WORKLOAD = "ai_prompt"

_T, _O, _R = collection_tasks.c, ai_observations.c, collection_runs.c


@dataclass(frozen=True, slots=True)
class PlannedDay:
    day: date
    engine_code: str
    tasks: int


@dataclass(frozen=True, slots=True)
class AnsweredDay:
    day: date
    engine_code: str
    complete: int
    partial: int
    empty: int
    refused: int
    error: int
    runs: tuple[UUID, ...]

    @property
    def answers(self) -> int:
        return self.complete + self.partial + self.empty + self.refused + self.error


@dataclass(frozen=True, slots=True)
class BlockedDay:
    """The AI runs a budget blocked on a day, that asked for the same engines (none named: every
    engine)."""

    day: date
    engine_codes: tuple[str, ...] | None
    runs: tuple[UUID, ...]


def _local_day(instant: Any, zone: str) -> Any:
    return cast(func.timezone(zone, instant), Date)


def _utc_date(instant: datetime, shift: int) -> date:
    return instant.astimezone(UTC).date() + timedelta(days=shift)


async def planned_by_day(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    zone: str,
    since: datetime,
    until: datetime,
    engines: Sequence[str] | None,
) -> list[PlannedDay]:
    """The AI tasks the schedules (or a person) set for each local day, by engine; a task that
    was never sent or never needed an answer does not count."""
    tasks = select(_T.engine_code, _local_day(_T.scheduled_for, zone).label("day")).where(
        _T.workspace_id == workspace_id,
        _T.project_id == project_id,
        _T.workload == AI_WORKLOAD,
        _T.scheduled_for >= since,
        _T.scheduled_for < until,
        _T.status.not_in(NOT_PLANNED),
    )
    if engines is not None:
        tasks = tasks.where(_T.engine_code.in_(list(engines)))
    counted = tasks.subquery()
    rows = await db.execute(
        select(counted.c.day, counted.c.engine_code, func.count().label("tasks")).group_by(
            counted.c.day, counted.c.engine_code
        )
    )
    return [PlannedDay(row.day, row.engine_code, row.tasks) for row in rows]


async def answered_by_day(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    zone: str,
    since: datetime,
    until: datetime,
    engines: Sequence[str] | None,
) -> list[AnsweredDay]:
    """The current answers of each local day, by engine and status, with the runs that stored
    them."""
    answers: Select[Any] = select(
        _O.engine_code,
        _O.status,
        _O.collection_run_id.label("run_id"),
        _local_day(_O.observed_at, zone).label("day"),
    ).where(
        _O.workspace_id == workspace_id,
        _O.project_id == project_id,
        _O.observed_at >= since,
        _O.observed_at < until,
        # An answer's date is its UTC date: a day either side of the instants is safe, and it
        # is what the (project, engine, date) index is searched with.
        _O.observed_date >= _utc_date(since, -1),
        _O.observed_date <= _utc_date(until, 1),
        _O.superseded_by.is_(None),
    )
    if engines is not None:
        answers = answers.where(_O.engine_code.in_(list(engines)))
    counted = answers.subquery()
    c = counted.c
    rows = await db.execute(
        select(
            c.day,
            c.engine_code,
            func.count().filter(c.status == "complete").label("complete"),
            func.count().filter(c.status == "partial").label("partial"),
            func.count().filter(c.status == "empty").label("empty"),
            func.count().filter(c.status == "refused").label("refused"),
            func.count().filter(c.status == "error").label("error"),
            func.array_agg(distinct(c.run_id)).filter(c.run_id.is_not(None)).label("runs"),
        ).group_by(c.day, c.engine_code)
    )
    return [
        AnsweredDay(
            day=row.day,
            engine_code=row.engine_code,
            complete=row.complete,
            partial=row.partial,
            empty=row.empty,
            refused=row.refused,
            error=row.error,
            runs=tuple(row.runs or ()),
        )
        for row in rows
    ]


async def blocked_by_day(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    zone: str,
    since: datetime,
    until: datetime,
) -> list[BlockedDay]:
    """The AI runs a budget blocked, by the local day they ended and the engines they asked for
    (`selector.engine_codes` of the run's snapshot, none when it names none)."""
    blocked = select(
        _R.id.label("run_id"),
        _local_day(_R.completed_at, zone).label("day"),
        _R.config_snapshot["selector"]["engine_codes"].label("engines"),
    ).where(
        _R.workspace_id == workspace_id,
        _R.project_id == project_id,
        _R.workload == AI_WORKLOAD,
        _R.status == "budget_blocked",
        _R.completed_at >= since,
        _R.completed_at < until,
    )
    counted = blocked.subquery()
    c = counted.c
    rows = await db.execute(
        select(c.day, c.engines, func.array_agg(c.run_id).label("runs")).group_by(c.day, c.engines)
    )
    return [
        BlockedDay(
            day=row.day,
            engine_codes=_named(row.engines),
            runs=tuple(row.runs),
        )
        for row in rows
    ]


def _named(engines: object) -> tuple[str, ...] | None:
    """The engines a run's selector names; none when it names none or names something that is
    not a list."""
    if not isinstance(engines, list):
        return None
    return tuple(str(code) for code in engines)
