"""The task ledger: runs and tasks in PostgreSQL (docs/21-scheduler-workers.md section 1).

Every unit of paid work is a row here before anything is sent to a provider, and every step of
its life is a change of `status` that names the status it comes from. A step that finds the row
elsewhere changes nothing and says so, which is what makes each step safe to run twice.

A task is submitted at most once. Before the provider is called the task moves from `pending`
to `submit_unknown`, in its own short transaction, so no database transaction is held open
across a network call. From there it becomes `submitted` with the provider's id, or goes back
through the retry policy when the provider refused it. If the process dies in between, the task
stays `submit_unknown`, which is the truth: the provider may have it.

The worker connects as `app_worker`, which bypasses row-level security. Every row written here
takes its workspace and project from the run it belongs to, never from a message or a provider.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import Row, Select, and_, func, or_, select, tuple_, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from sightline.db.tables import collection_runs, collection_tasks, provider_cost_events, schedules
from sightline.domain.retries import ProviderErrorKind, RetryDecision
from sightline.domain.tasks import idempotency_key, partition_month
from sightline.domain.workloads import TaskWorkload, cost_channel

INSERT_BATCH = 5000
# Tasks a dispatcher tick takes in all, and from one project (docs/21 section 4).
DISPATCH_LIMIT = 2000
DISPATCH_PER_PROJECT = 500
ERROR_MESSAGE_MAX = 500
# A run with this share of failed and dead tasks or more completed with errors (docs/21
# section 6).
ERROR_SHARE = Decimal("0.02")
TERMINAL_STATUSES = ("ingested", "failed", "dead", "cancelled", "skipped_cached")
_FAILED_STATUSES = ("failed", "dead")

Priority = Literal["high", "standard", "low"]
Trigger = Literal["schedule", "manual", "backfill", "retry"]
CostSource = Literal["provider_reported", "computed_from_tokens", "price_book_estimate"]


@dataclass(frozen=True, slots=True)
class TaskRef:
    """A task's key. The ledger is partitioned by `created_at`, so it is part of the key, and
    naming it lets PostgreSQL go straight to the partition."""

    id: int
    created_at: datetime


@dataclass(frozen=True, slots=True)
class NewRun:
    workspace_id: UUID
    project_id: UUID
    schedule_id: UUID | None
    workload: TaskWorkload
    window_start: datetime
    window_end: datetime
    trigger: Trigger
    config_snapshot: Mapping[str, Any]


@dataclass(frozen=True, slots=True)
class NewTask:
    subject_type: str
    subject_id: str
    engine_code: str | None
    location_id: int | None
    replicate_index: int
    # Part of the task's identity (a rank check to depth 20 is not the same task as to 100).
    depth: int | None
    request_fingerprint: bytes
    provider_code: str
    provider_endpoint: str
    scheduled_for: datetime


@dataclass(frozen=True, slots=True)
class LedgerTask:
    ref: TaskRef
    run_id: UUID
    workspace_id: UUID
    project_id: UUID
    workload: TaskWorkload
    subject_type: str
    subject_id: str
    engine_code: str | None
    location_id: int | None
    replicate_index: int
    provider_code: str
    provider_endpoint: str
    provider_task_id: str | None
    status: str
    attempts: int
    scheduled_for: datetime
    # From the task's run and its schedule. A run without a schedule is someone waiting.
    priority: Priority
    window_end: datetime


_tasks = collection_tasks
_runs = collection_runs


def _task_query() -> Select[tuple[Any, ...]]:
    return (
        select(
            _tasks.c.id,
            _tasks.c.created_at,
            _tasks.c.run_id,
            _tasks.c.workspace_id,
            _tasks.c.project_id,
            _tasks.c.workload,
            _tasks.c.subject_type,
            _tasks.c.subject_id,
            _tasks.c.engine_code,
            _tasks.c.location_id,
            _tasks.c.replicate_index,
            _tasks.c.provider_code,
            _tasks.c.provider_endpoint,
            _tasks.c.provider_task_id,
            _tasks.c.status,
            _tasks.c.attempts,
            _tasks.c.scheduled_for,
            func.coalesce(schedules.c.priority, "high").label("priority"),
            _runs.c.window_end,
        )
        .join(_runs, _runs.c.id == _tasks.c.run_id)
        .outerjoin(schedules, schedules.c.id == _runs.c.schedule_id)
    )


def _task(row: Row[tuple[Any, ...]]) -> LedgerTask:
    fields = row._mapping
    return LedgerTask(
        ref=TaskRef(id=fields["id"], created_at=fields["created_at"]),
        run_id=fields["run_id"],
        workspace_id=fields["workspace_id"],
        project_id=fields["project_id"],
        workload=TaskWorkload(fields["workload"]),
        subject_type=fields["subject_type"],
        subject_id=fields["subject_id"],
        engine_code=fields["engine_code"],
        location_id=fields["location_id"],
        replicate_index=fields["replicate_index"],
        provider_code=fields["provider_code"],
        provider_endpoint=fields["provider_endpoint"],
        provider_task_id=fields["provider_task_id"],
        status=fields["status"],
        attempts=fields["attempts"],
        scheduled_for=fields["scheduled_for"],
        priority=fields["priority"],
        window_end=fields["window_end"],
    )


def _named(refs: Collection[TaskRef]) -> Any:
    return tuple_(_tasks.c.id, _tasks.c.created_at).in_([(ref.id, ref.created_at) for ref in refs])


# ---------------------------------------------------------------------------------------------
# Runs


async def create_run(
    db: AsyncSession,
    run: NewRun,
    *,
    status: Literal["planned", "cancelled"] = "planned",
    status_reason: str | None = None,
    now: datetime,
) -> UUID | None:
    """Record a run. None when this schedule already has a run for this window: planning twice
    plans once."""
    statement = (
        insert(_runs)
        .values(
            workspace_id=run.workspace_id,
            project_id=run.project_id,
            schedule_id=run.schedule_id,
            workload=run.workload,
            window_start=run.window_start,
            window_end=run.window_end,
            trigger=run.trigger,
            status=status,
            status_reason=status_reason,
            created_by_type="system",
            config_snapshot=dict(run.config_snapshot),
            completed_at=now if status == "cancelled" else None,
        )
        .on_conflict_do_nothing(index_elements=["schedule_id", "window_start"])
        .returning(_runs.c.id)
    )
    run_id: UUID | None = (await db.execute(statement)).scalar_one_or_none()
    return run_id


async def insert_tasks(
    db: AsyncSession, run_id: UUID, run: NewRun, tasks: Sequence[NewTask]
) -> int:
    """Add the run's tasks, all `pending`. A task that is already there is left as it is, so a
    second planning of the run adds nothing. Returns how many were new."""
    created_at = partition_month(run.window_start)
    rows = [
        {
            "created_at": created_at,
            "run_id": run_id,
            "workspace_id": run.workspace_id,
            "project_id": run.project_id,
            "workload": run.workload,
            "subject_type": task.subject_type,
            "subject_id": task.subject_id,
            "engine_code": task.engine_code,
            "location_id": task.location_id,
            "replicate_index": task.replicate_index,
            "idempotency_key": idempotency_key(
                run_id=str(run_id),
                subject_type=task.subject_type,
                subject_id=task.subject_id,
                engine_code=task.engine_code,
                location_id=task.location_id,
                replicate_index=task.replicate_index,
                depth=task.depth,
            ),
            "request_fingerprint": task.request_fingerprint,
            "provider_code": task.provider_code,
            "provider_endpoint": task.provider_endpoint,
            "scheduled_for": task.scheduled_for,
            "status": "pending",
        }
        for task in tasks
    ]
    added = 0
    for start in range(0, len(rows), INSERT_BATCH):
        statement = (
            insert(_tasks)
            .values(rows[start : start + INSERT_BATCH])
            .on_conflict_do_nothing(index_elements=["idempotency_key", "created_at"])
            .returning(_tasks.c.id)
        )
        added += len((await db.execute(statement)).all())
    return added


async def start_run(
    db: AsyncSession, run_id: UUID, *, tasks_total: int, estimated_cost_usd: Decimal
) -> None:
    await db.execute(
        update(_runs)
        .where(_runs.c.id == run_id, _runs.c.status == "planned")
        .values(status="running", tasks_total=tasks_total, estimated_cost_usd=estimated_cost_usd)
    )


async def block_run(
    db: AsyncSession, run_id: UUID, *, budget_id: UUID, estimated_cost_usd: Decimal, now: datetime
) -> None:
    """The run would take its budget past the hard limit: it is recorded and nothing is sent."""
    await db.execute(
        update(_runs)
        .where(_runs.c.id == run_id, _runs.c.status == "planned")
        .values(
            status="budget_blocked",
            status_reason="budget_exceeded",
            blocked_by_budget_id=budget_id,
            estimated_cost_usd=estimated_cost_usd,
            completed_at=now,
        )
    )


async def note_budget_hold(db: AsyncSession, run_ids: Collection[UUID], budget_id: UUID) -> None:
    """Say on a running run that its remaining tasks are held back by a budget."""
    if not run_ids:
        return
    await db.execute(
        update(_runs)
        .where(_runs.c.id.in_(run_ids), _runs.c.status == "running")
        .values(status_reason="budget_exceeded", blocked_by_budget_id=budget_id)
    )


async def complete_finished_runs(db: AsyncSession, *, now: datetime) -> int:
    """Close every running run whose tasks have all ended. Returns how many were closed."""
    open_task = (
        select(_tasks.c.id)
        .where(_tasks.c.run_id == _runs.c.id, _tasks.c.status.not_in(TERMINAL_STATUSES))
        .exists()
    )
    finished = (
        select(_runs.c.id)
        .where(_runs.c.status == "running", _runs.c.tasks_total > 0, ~open_task)
        .with_for_update(skip_locked=True)
    )
    closed = 0
    for (run_id,) in (await db.execute(finished)).all():
        counts = (
            await db.execute(
                select(
                    func.count().filter(_tasks.c.status.in_(_FAILED_STATUSES)),
                    func.count().filter(_tasks.c.status.in_(("ingested", "skipped_cached"))),
                    func.count(),
                    func.coalesce(func.sum(_tasks.c.cost_usd), 0),
                ).where(_tasks.c.run_id == run_id)
            )
        ).one()
        failed, succeeded, total, cost = counts
        with_errors = total > 0 and Decimal(failed) / Decimal(total) >= ERROR_SHARE
        await db.execute(
            update(_runs)
            .where(_runs.c.id == run_id)
            .values(
                status="completed_with_errors" if with_errors else "completed",
                tasks_succeeded=succeeded,
                tasks_failed=failed,
                actual_cost_usd=cost,
                completed_at=now,
            )
        )
        closed += 1
    return closed


# ---------------------------------------------------------------------------------------------
# Dispatch


def _due(now: datetime, paused_providers: Collection[str]) -> Any:
    conditions = [
        _tasks.c.status == "pending",
        _tasks.c.dispatched_at.is_(None),
        _tasks.c.scheduled_for <= now,
        or_(_tasks.c.next_attempt_at.is_(None), _tasks.c.next_attempt_at <= now),
    ]
    if paused_providers:
        conditions.append(_tasks.c.provider_code.not_in(paused_providers))
    return and_(*conditions)


async def claim_due(
    db: AsyncSession,
    *,
    now: datetime,
    paused_providers: Collection[str] = (),
    limit: int = DISPATCH_LIMIT,
    per_project: int = DISPATCH_PER_PROJECT,
) -> list[LedgerTask]:
    """Lock and return the tasks that are due, oldest first, fairly across projects.

    Each project with due work gets an equal share of `limit`, at most `per_project`; what is
    left over after that goes to the projects that still have more, in the same order. One
    large project cannot use a whole tick while a small one waits. The rows stay locked until
    the transaction ends, and rows another dispatcher holds are skipped.
    """
    due = _due(now, paused_providers)
    projects = [
        project_id
        for (project_id,) in await db.execute(
            select(_tasks.c.project_id)
            .where(due)
            .group_by(_tasks.c.project_id)
            .order_by(func.min(_tasks.c.scheduled_for))
        )
    ]
    if not projects:
        return []
    share = max(1, min(per_project, limit // len(projects)))
    claimed: dict[UUID, list[LedgerTask]] = {project_id: [] for project_id in projects}
    remaining = limit
    # Two passes: an equal share each, then the leftover to those with more to do.
    for allowance in (share, per_project):
        for project_id in projects:
            held = claimed[project_id]
            take = min(allowance - len(held), remaining)
            if take <= 0:
                continue
            # SKIP LOCKED passes over rows other transactions hold, not the ones this one
            # took in the first pass, so those are named.
            mine = [due, _tasks.c.project_id == project_id]
            if held:
                mine.append(~_named([task.ref for task in held]))
            rows = await db.execute(
                _task_query()
                .where(*mine)
                .order_by(_tasks.c.scheduled_for, _tasks.c.id)
                .limit(take)
                .with_for_update(of=_tasks, skip_locked=True)
            )
            found = [_task(row) for row in rows]
            held.extend(found)
            remaining -= len(found)
    tasks = [task for found in claimed.values() for task in found]
    return sorted(tasks, key=lambda task: (task.scheduled_for, task.ref.id))


async def mark_dispatched(db: AsyncSession, refs: Collection[TaskRef], *, now: datetime) -> None:
    """The tasks are on their way to the queue. They are not selected again until a handler
    ends them or the reconciler finds the message lost."""
    if not refs:
        return
    await db.execute(
        update(_tasks).where(_named(refs), _tasks.c.status == "pending").values(dispatched_at=now)
    )


async def release(db: AsyncSession, refs: Collection[TaskRef]) -> None:
    """Undo `mark_dispatched` for tasks whose message was not sent or was lost."""
    if not refs:
        return
    await db.execute(
        update(_tasks).where(_named(refs), _tasks.c.status == "pending").values(dispatched_at=None)
    )


# ---------------------------------------------------------------------------------------------
# Submission


async def begin_submission(
    db: AsyncSession, refs: Collection[TaskRef], *, now: datetime
) -> list[LedgerTask]:
    """Take the tasks for one provider call. Only tasks still `pending` and dispatched are
    taken, and they leave `pending` here, before the call: whatever happens next, no second
    handler can take them. Returns the tasks taken, which may be fewer than named."""
    if not refs:
        return []
    taken = (
        await db.execute(
            update(_tasks)
            .where(_named(refs), _tasks.c.status == "pending", _tasks.c.dispatched_at.is_not(None))
            .values(status="submit_unknown", attempts=_tasks.c.attempts + 1, submitted_at=now)
            .returning(_tasks.c.id, _tasks.c.created_at)
        )
    ).all()
    if not taken:
        return []
    rows = await db.execute(
        _task_query()
        .where(_named([TaskRef(id=row.id, created_at=row.created_at) for row in taken]))
        .order_by(_tasks.c.scheduled_for, _tasks.c.id)
    )
    return [_task(row) for row in rows]


async def mark_submitted(
    db: AsyncSession, ref: TaskRef, *, provider_task_id: str, cost_usd: Decimal | None
) -> bool:
    """The provider accepted the task. False when the task was not waiting for that answer."""
    result = await db.execute(
        update(_tasks)
        .where(_named([ref]), _tasks.c.status == "submit_unknown")
        .values(
            status="submitted",
            provider_task_id=provider_task_id,
            cost_usd=cost_usd,
            dispatched_at=None,
            next_attempt_at=None,
            last_error_code=None,
            last_error_message=None,
        )
        .returning(_tasks.c.id)
    )
    return result.one_or_none() is not None


async def record_failure(
    db: AsyncSession,
    ref: TaskRef,
    *,
    kind: ProviderErrorKind,
    message: str,
    decision: RetryDecision,
    now: datetime,
) -> bool:
    """The provider refused the task, or was never reached: apply what the retry policy decided.

    `pending` puts the task back for the dispatcher, after the delay if there is one. `failed`
    and `dead` end it. False when the task was not in a provider call.
    """
    values: dict[str, Any] = {
        "status": decision.status,
        "dispatched_at": None,
        "submitted_at": None,
        "last_error_code": kind.value,
        "last_error_message": message[:ERROR_MESSAGE_MAX],
        "next_attempt_at": None if decision.delay is None else now + decision.delay,
    }
    if decision.status != "pending":
        values["completed_at"] = now
    if not decision.counts:
        # The provider is paused for everyone: this was not an attempt at the task.
        values["attempts"] = _tasks.c.attempts - 1
    result = await db.execute(
        update(_tasks)
        .where(_named([ref]), _tasks.c.status == "submit_unknown")
        .values(**values)
        .returning(_tasks.c.id)
    )
    return result.one_or_none() is not None


async def note_unknown_outcome(db: AsyncSession, refs: Collection[TaskRef], message: str) -> None:
    """The call may have reached the provider and its answer was lost. The tasks stay
    `submit_unknown`; this only records why."""
    if not refs:
        return
    await db.execute(
        update(_tasks)
        .where(_named(refs), _tasks.c.status == "submit_unknown")
        .values(
            last_error_code=ProviderErrorKind.TIMEOUT.value,
            last_error_message=message[:ERROR_MESSAGE_MAX],
        )
    )


async def record_cost(
    db: AsyncSession,
    task: LedgerTask,
    *,
    cost_usd: Decimal,
    cost_source: CostSource,
    now: datetime,
) -> None:
    """One cost event for one task, attributed to the task's own workspace and project."""
    occurred = now.astimezone(UTC)
    await db.execute(
        provider_cost_events.insert().values(
            occurred_at=occurred,
            workspace_id=task.workspace_id,
            project_id=task.project_id,
            provider_code=task.provider_code,
            endpoint=task.provider_endpoint,
            workload=task.workload,
            channel=cost_channel(task.workload),
            run_id=task.run_id,
            task_id=task.ref.id,
            subject_type=task.subject_type,
            subject_id=task.subject_id,
            engine_code=task.engine_code,
            units=1,
            price_unit="task",
            cost_usd=cost_usd,
            cost_source=cost_source,
            billing_period=occurred.date().replace(day=1),
        )
    )


# ---------------------------------------------------------------------------------------------
# Reconciliation


async def release_stale_dispatches(
    db: AsyncSession, *, older_than: timedelta, now: datetime, limit: int = DISPATCH_LIMIT
) -> list[LedgerTask]:
    """Lock the tasks that were sent to the queue long ago and are still `pending`. The caller
    decides which of them have really lost their message and releases those."""
    rows = await db.execute(
        _task_query()
        .where(_tasks.c.status == "pending", _tasks.c.dispatched_at < now - older_than)
        .order_by(_tasks.c.dispatched_at)
        .limit(limit)
        .with_for_update(of=_tasks, skip_locked=True)
    )
    return [_task(row) for row in rows]


async def end_old_submissions(db: AsyncSession, *, older_than: timedelta, now: datetime) -> int:
    """A task the provider has had for this long will never come back: it is `dead`."""
    result = await db.execute(
        update(_tasks)
        .where(_tasks.c.status == "submitted", _tasks.c.submitted_at < now - older_than)
        .values(
            status="dead",
            completed_at=now,
            last_error_code="provider_never_answered",
            last_error_message="No result from the provider within the time it allows.",
        )
        .returning(_tasks.c.id)
    )
    return len(result.all())


async def cancel_missed(db: AsyncSession, *, after_window: timedelta, now: datetime) -> int:
    """A task never sent, this long after its run's window closed, belongs to the next run."""
    closed_runs = select(_runs.c.id).where(_runs.c.window_end < now - after_window)
    result = await db.execute(
        update(_tasks)
        .where(
            _tasks.c.status == "pending",
            _tasks.c.provider_task_id.is_(None),
            _tasks.c.run_id.in_(closed_runs),
        )
        .values(
            status="cancelled",
            completed_at=now,
            dispatched_at=None,
            last_error_code="window_missed",
            last_error_message="Not sent before its run's window had been closed for a day.",
        )
        .returning(_tasks.c.id)
    )
    return len(result.all())
