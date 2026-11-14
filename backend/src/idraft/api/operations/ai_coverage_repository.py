"""Statements for the AI coverage of a run (WP-30; contract C3). Every function runs inside
`workspace_transaction`, and every statement names the workspace and the project as well."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final
from uuid import UUID

from sqlalchemy import ColumnElement, Uuid, and_, cast, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.db.tables import (
    ai_observations,
    ai_prompt_versions,
    collection_runs,
    collection_tasks,
)

# A task that was never sent (cancelled) or never needed an answer (a cache hit) is not planned:
# the exclusion the quota and cost counters make.
NOT_PLANNED: Final = ("cancelled", "skipped_cached")
# An answer's time is the provider's own when it is believable, up to 7 days before the fetch
# (`snapshot_time`): the answers of a run are searched from a little before the run began.
ANSWER_LEAD: Final = timedelta(days=8)

_T, _O, _V = collection_tasks.c, ai_observations.c, ai_prompt_versions.c


@dataclass(frozen=True, slots=True)
class RunHead:
    workload: str
    created_at: datetime


@dataclass(frozen=True, slots=True)
class EngineCounts:
    engine_code: str
    planned: int
    observed: int
    complete: int
    partial: int
    empty: int
    refused: int
    error: int


@dataclass(frozen=True, slots=True)
class MissingTask:
    prompt_id: UUID
    engine_code: str
    location_id: int | None
    replicate_index: int
    task_status: str


async def run_head(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, run_id: UUID
) -> RunHead | None:
    r = collection_runs.c
    row = (
        await db.execute(
            select(r.workload, r.created_at).where(
                r.workspace_id == workspace_id, r.project_id == project_id, r.id == run_id
            )
        )
    ).one_or_none()
    return None if row is None else RunHead(row.workload, row.created_at)


def _current_answer(since: datetime) -> ColumnElement[bool]:
    """The task's answer that counts: not replaced by a newer one. The task key and the lower
    bound on the time let the planner read only the partitions the run can have written."""
    return and_(
        _O.workspace_id == _T.workspace_id,
        _O.project_id == _T.project_id,
        _O.collection_task_id == _T.id,
        _O.observed_at >= since - ANSWER_LEAD,
        _O.superseded_by.is_(None),
    )


async def engine_counts(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, run_id: UUID, since: datetime
) -> list[EngineCounts]:
    """One grouped statement: the run's planned tasks per engine, each joined to its current
    answer, counted by the answer's status."""
    rows = await db.execute(
        select(
            _T.engine_code,
            func.count().label("planned"),
            func.count(_O.id).label("observed"),
            func.count().filter(_O.status == "complete").label("complete"),
            func.count().filter(_O.status == "partial").label("partial"),
            func.count().filter(_O.status == "empty").label("empty"),
            func.count().filter(_O.status == "refused").label("refused"),
            func.count().filter(_O.status == "error").label("error"),
        )
        .select_from(collection_tasks.outerjoin(ai_observations, _current_answer(since)))
        .where(
            _T.workspace_id == workspace_id,
            _T.project_id == project_id,
            _T.run_id == run_id,
            _T.status.not_in(NOT_PLANNED),
        )
        .group_by(_T.engine_code)
        .order_by(_T.engine_code)
    )
    return [
        EngineCounts(
            engine_code=row.engine_code,
            planned=row.planned,
            observed=row.observed,
            complete=row.complete,
            partial=row.partial,
            empty=row.empty,
            refused=row.refused,
            error=row.error,
        )
        for row in rows
    ]


async def missing_tasks(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, run_id: UUID, since: datetime
) -> list[MissingTask]:
    """The run's planned tasks that have no current answer, whatever their task status, with the
    prompt their version belongs to."""
    rows = await db.execute(
        select(
            _V.prompt_id,
            _T.engine_code,
            _T.location_id,
            _T.replicate_index,
            _T.status.label("task_status"),
        )
        .select_from(
            collection_tasks.join(
                ai_prompt_versions,
                and_(_V.workspace_id == _T.workspace_id, _V.id == cast(_T.subject_id, Uuid)),
            )
        )
        .where(
            _T.workspace_id == workspace_id,
            _T.project_id == project_id,
            _T.run_id == run_id,
            _T.subject_type == "prompt_version",
            _T.status.not_in(NOT_PLANNED),
            ~exists().where(_current_answer(since)),
        )
        .order_by(
            _V.prompt_id,
            _T.engine_code,
            _T.location_id.asc().nulls_last(),
            _T.replicate_index,
            _T.id,
        )
    )
    return [
        MissingTask(
            prompt_id=row.prompt_id,
            engine_code=row.engine_code,
            location_id=row.location_id,
            replicate_index=row.replicate_index,
            task_status=row.task_status,
        )
        for row in rows
    ]
