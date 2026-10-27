"""Statements for collection runs, as the API reads and asks for them. Every function runs
inside `workspace_transaction`, and every statement names the workspace as well."""

from __future__ import annotations

from collections.abc import Collection, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import (
    Row,
    Select,
    Text,
    and_,
    cast,
    func,
    insert,
    literal,
    select,
    tuple_,
    update,
)
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.db.tables import (
    collection_runs,
    collection_tasks,
    keywords,
    tracked_keywords,
    users,
    workspace_quotas,
)
from idraft.keywords.text import KEYWORD_MAX
from idraft.providers.dataforseo.serp import SERP_ORGANIC_LIVE
from idraft.ranks.depth import UNAVAILABLE


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


@dataclass(frozen=True, slots=True)
class RunFilter:
    """What the run list is narrowed to; an empty member narrows nothing."""

    schedule_id: UUID | None = None
    workloads: frozenset[str] = frozenset()
    statuses: frozenset[str] = frozenset()
    triggers: frozenset[str] = frozenset()
    created_from: datetime | None = None
    created_to: datetime | None = None


async def list_runs(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    given: RunFilter,
    *,
    after: tuple[datetime, UUID] | None,
    limit: int,
) -> list[RunRecord]:
    """The project's runs newest first, after the (created_at, id) of the last row of the page
    before; `limit` rows at most. The `collection_runs_project_created` index serves it."""
    r = collection_runs.c
    statement = _runs(workspace_id).where(r.project_id == project_id)
    if given.schedule_id is not None:
        statement = statement.where(r.schedule_id == given.schedule_id)
    if given.workloads:
        statement = statement.where(r.workload.in_(sorted(given.workloads)))
    if given.statuses:
        statement = statement.where(r.status.in_(sorted(given.statuses)))
    if given.triggers:
        statement = statement.where(r.trigger.in_(sorted(given.triggers)))
    if given.created_from is not None:
        statement = statement.where(r.created_at >= given.created_from)
    if given.created_to is not None:
        statement = statement.where(r.created_at < given.created_to)
    if after is not None:
        statement = statement.where(tuple_(r.created_at, r.id) < tuple_(*after))
    rows = await db.execute(statement.order_by(r.created_at.desc(), r.id.desc()).limit(limit))
    return [_run(row) for row in rows]


async def lock_run(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, run_id: UUID
) -> RunRecord | None:
    """The run, held (FOR UPDATE) until the transaction ends, so a cancel and the planner do
    not cross: whichever comes second sees what the first did."""
    row = (
        await db.execute(
            _runs(workspace_id)
            .where(collection_runs.c.project_id == project_id, collection_runs.c.id == run_id)
            .with_for_update(of=collection_runs)
        )
    ).one_or_none()
    return None if row is None else _run(row)


async def cancel_run(db: AsyncSession, workspace_id: UUID, run_id: UUID, *, reason: str) -> None:
    """Cancelled with `reason` as its status reason. Its pending tasks are cancelled by the
    reconciler; tasks the provider has are still fetched, and their cost counted when the last
    of them ends."""
    await db.execute(
        update(collection_runs)
        .where(collection_runs.c.workspace_id == workspace_id, collection_runs.c.id == run_id)
        .values(status="cancelled", status_reason=reason, completed_at=func.now())
    )


async def task_counts(db: AsyncSession, workspace_id: UUID, run_id: UUID) -> dict[str, int]:
    """How many of the run's tasks are in each status; statuses with none are left out."""
    t = collection_tasks.c
    rows = await db.execute(
        select(t.status, func.count().label("tasks"))
        .where(t.workspace_id == workspace_id, t.run_id == run_id)
        .group_by(t.status)
    )
    return {row.status: row.tasks for row in rows}


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


async def active_tracked_ids(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, tracked_ids: Collection[UUID]
) -> set[UUID]:
    """The tracked keywords among these that the project collects rank checks for: not archived,
    not deleted, on Google, with a profile that can be checked and a keyword the provider takes
    (the same rules the rank workload selects by, so a 202 never ends in a run of no tasks)."""
    t, k = tracked_keywords.c, keywords.c
    rows = await db.execute(
        select(t.id)
        .select_from(
            tracked_keywords.join(
                keywords, and_(k.id == t.keyword_id, k.workspace_id == t.workspace_id)
            )
        )
        .where(
            t.workspace_id == workspace_id,
            t.project_id == project_id,
            t.deleted_at.is_(None),
            t.is_active,
            t.search_engine == "google",
            t.depth_profile.not_in(sorted(UNAVAILABLE)),
            func.char_length(k.text) <= KEYWORD_MAX,
            t.id.in_(list(tracked_ids)),
        )
    )
    return {row.id for row in rows}


async def lock_serp_check_limit(db: AsyncSession, workspace_id: UUID) -> int:
    """The workspace's monthly limit of live SERP checks, its quota row locked until the
    transaction ends, so two requests count one after the other. A workspace without a row
    gets the defaults."""
    await db.execute(
        upsert(workspace_quotas).values(workspace_id=workspace_id).on_conflict_do_nothing()
    )
    limit: int = (
        await db.execute(
            select(workspace_quotas.c.max_serp_checks_per_month)
            .where(workspace_quotas.c.workspace_id == workspace_id)
            .with_for_update(key_share=True)
        )
    ).scalar_one()
    return limit


async def live_serp_checks_since(db: AsyncSession, workspace_id: UUID, since: datetime) -> int:
    """Live SERP checks the workspace has asked for since `since`: the tasks that were made
    (one that was cancelled never reached the provider), and the keywords of runs not yet
    planned into tasks."""
    t, r = collection_tasks.c, collection_runs.c
    selector = r.config_snapshot["selector"]
    made = (
        select(func.count())
        .where(
            t.workspace_id == workspace_id,
            t.provider_endpoint == SERP_ORGANIC_LIVE,
            t.created_at >= since,
            t.status.not_in(("cancelled", "skipped_cached")),
        )
        .scalar_subquery()
    )
    waiting = (
        select(func.coalesce(func.sum(func.jsonb_array_length(selector["tracked_keyword_ids"])), 0))
        .where(
            r.workspace_id == workspace_id,
            r.status == "planned",
            r.workload == "seo_rank",
            selector["live"].as_boolean().is_(True),
            r.created_at >= since,
        )
        .scalar_subquery()
    )
    # One statement, so one snapshot: the planner turns a waiting run into tasks in one commit,
    # and two statements could see neither or both.
    total: int = (await db.execute(select(made + waiting))).scalar_one()
    return total


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
