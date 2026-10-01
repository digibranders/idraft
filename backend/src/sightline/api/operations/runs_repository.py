"""Statements for collection runs, as the API reads and asks for them. Every function runs
inside `workspace_transaction`, and every statement names the workspace as well."""

from __future__ import annotations

from collections.abc import Collection, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import Row, Select, Text, and_, cast, func, insert, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from sightline.db.tables import collection_runs, tracked_keywords, users


@dataclass(frozen=True, slots=True)
class RunRecord:
    id: UUID
    project_id: UUID
    schedule_id: UUID | None
    workload: str
    trigger: str
    status: str
    status_reason: str | None
    window_start: datetime
    window_end: datetime
    tasks_total: int
    tasks_succeeded: int
    tasks_failed: int
    estimated_cost_usd: Decimal | None
    actual_cost_usd: Decimal | None
    blocked_by_budget_id: UUID | None
    created_by_type: str | None
    created_by_id: str | None
    created_by_name: str | None
    created_at: datetime
    completed_at: datetime | None
    config_snapshot: Mapping[str, Any]


def _runs(workspace_id: UUID) -> Select[tuple[object, ...]]:
    r = collection_runs.c
    # A run a person asked for names them; their name is shown with it. Compared as text: the
    # id of an API key or of the system is not a user's.
    person = and_(r.created_by_type == "user", cast(users.c.id, Text) == r.created_by_id)
    return (
        select(collection_runs, users.c.name.label("created_by_name"))
        .select_from(collection_runs.outerjoin(users, person))
        .where(r.workspace_id == workspace_id)
    )


def _run(row: Row[tuple[object, ...]]) -> RunRecord:
    return RunRecord(
        id=row.id,
        project_id=row.project_id,
        schedule_id=row.schedule_id,
        workload=row.workload,
        trigger=row.trigger,
        status=row.status,
        status_reason=row.status_reason,
        window_start=row.window_start,
        window_end=row.window_end,
        tasks_total=row.tasks_total,
        tasks_succeeded=row.tasks_succeeded,
        tasks_failed=row.tasks_failed,
        estimated_cost_usd=row.estimated_cost_usd,
        actual_cost_usd=row.actual_cost_usd,
        blocked_by_budget_id=row.blocked_by_budget_id,
        created_by_type=row.created_by_type,
        created_by_id=row.created_by_id,
        created_by_name=row.created_by_name,
        created_at=row.created_at,
        completed_at=row.completed_at,
        config_snapshot=row.config_snapshot or {},
    )


async def get_run(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, run_id: UUID
) -> RunRecord | None:
    row = (
        await db.execute(
            _runs(workspace_id).where(
                collection_runs.c.project_id == project_id, collection_runs.c.id == run_id
            )
        )
    ).one_or_none()
    return None if row is None else _run(row)


async def lock_manual_runs(db: AsyncSession, project_id: UUID) -> None:
    """Requests for manual runs of one project are counted one at a time until the
    transaction ends, so two at once cannot both take the last run of the day."""
    await db.execute(
        select(
            func.pg_advisory_xact_lock(
                func.hashtextextended(literal(f"manual_runs:{project_id}"), 0)
            )
        )
    )


async def manual_runs_since(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, since: datetime
) -> int:
    """Manual runs people (or their API keys) asked for in the project since `since`. Runs the
    system starts for new keywords do not count."""
    r = collection_runs.c
    count: int = (
        await db.execute(
            select(func.count()).where(
                r.workspace_id == workspace_id,
                r.project_id == project_id,
                r.trigger == "manual",
                r.created_by_type.in_(("user", "api_key")),
                r.created_at >= since,
            )
        )
    ).scalar_one()
    return count


async def tracked_keyword_ids(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, keyword_ids: Collection[UUID]
) -> set[UUID]:
    """The keywords among these that the project tracks actively: an archived keyword is not
    collected, so a run for it would do nothing."""
    t = tracked_keywords.c
    rows = await db.execute(
        select(t.keyword_id)
        .distinct()
        .where(
            t.workspace_id == workspace_id,
            t.project_id == project_id,
            t.deleted_at.is_(None),
            t.is_active,
            t.keyword_id.in_(list(keyword_ids)),
        )
    )
    return {row.keyword_id for row in rows}


async def insert_manual_run(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    project_id: UUID,
    workload: str,
    user_id: UUID,
    request_id: str | None,
    selector: Mapping[str, object],
    window: timedelta,
) -> UUID:
    """A run in status `planned`, for the worker's planner to plan (plan decision D9): the
    API never writes tasks."""
    run_id: UUID = (
        await db.execute(
            insert(collection_runs)
            .values(
                workspace_id=workspace_id,
                project_id=project_id,
                schedule_id=None,
                workload=workload,
                window_start=func.now(),
                window_end=func.now() + window,
                trigger="manual",
                status="planned",
                created_by_type="user",
                created_by_id=str(user_id),
                origin_request_id=request_id,
                config_snapshot={"selector": dict(selector)},
            )
            .returning(collection_runs.c.id)
        )
    ).scalar_one()
    return run_id
