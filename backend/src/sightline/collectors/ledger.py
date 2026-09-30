"""The task ledger: runs and tasks in PostgreSQL (docs/21-scheduler-workers.md section 1).

Every unit of paid work is a row here before anything is sent to a provider, and every step of
its life is a change of `status` that names the status it comes from. A step that finds the row
elsewhere changes nothing, which is what makes each step safe to run twice. The steps whose
caller has to act on that (taking tasks for a provider call, recording its answer) return what
they changed.

A task is submitted at most once. Before the provider is called the task moves from `pending`
to `submit_unknown`, in its own short transaction, so no database transaction is held open
across a network call. From there it becomes `submitted` with the provider's id, or goes back
through the retry policy when the provider refused it. If the process dies in between, or the
provider's answer is lost, the task stays `submit_unknown`, which is the truth: the provider
may have it. Until the provider can be asked which tasks it has (docs/21 section 6, with the
first real adapter), such a task ends as `dead` when the provider's results would have expired.

The worker connects as `app_worker`, which bypasses row-level security. A task takes its
workspace, project and workload from its run's row, and a cost event from its task's row, read
in the statement that writes them: never from a message, a provider or a caller's copy.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    DateTime,
    Integer,
    Interval,
    LargeBinary,
    Row,
    Select,
    SmallInteger,
    Text,
    Uuid,
    and_,
    bindparam,
    case,
    exists,
    func,
    literal,
    literal_column,
    or_,
    select,
    true,
    tuple_,
    update,
)
from sqlalchemy.dialects.postgresql import ARRAY, insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.db.tables import (
    budgets,
    collection_runs,
    collection_tasks,
    projects,
    provider_cost_events,
    schedules,
    workspaces,
)
from sightline.domain.retries import ProviderErrorKind, RetryDecision
from sightline.domain.tasks import idempotency_key
from sightline.domain.workloads import TaskWorkload, cost_channel

# Rows in one INSERT. Each column is sent as one array, so the size of a batch is bounded by
# memory and not by the number of parameters a statement may have.
INSERT_BATCH = 5000
# A task not sent this long after its run's window closed belongs to the next run: it is
# cancelled, and a window that is this far gone when it is found is not planned at all.
SEND_WITHIN = timedelta(hours=24)
# Tasks a dispatcher tick takes in all, and from one project (docs/21 section 4).
DISPATCH_LIMIT = 2000
DISPATCH_PER_PROJECT = 500
ERROR_MESSAGE_MAX = 500
# A run with this share of tasks that produced nothing, or more, completed with errors
# (docs/21 section 6).
ERROR_SHARE = Decimal("0.02")
TERMINAL_STATUSES = ("ingested", "failed", "dead", "cancelled", "skipped_cached")
_NOTHING_COLLECTED = ("failed", "dead", "cancelled")
_COLLECTED = ("ingested", "skipped_cached")
_BUDGET_EXCEEDED = "budget_exceeded"
PROJECT_NOT_COLLECTING = "project_not_collecting"
NEVER_CONFIRMED = "submission_never_confirmed"
# What `ops.collection_tasks.cost_usd` and the cost events hold: dollars to six places.
_COST_STEP = Decimal("0.000001")
_CHECK_VIOLATION = "23514"

Priority = Literal["high", "standard", "low"]
Trigger = Literal["schedule", "manual", "backfill", "retry"]
CostSource = Literal["provider_reported", "computed_from_tokens", "price_book_estimate"]


class NoPartitionError(ValueError):
    """The run's window is in a month the ledger has no partition for."""


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
    # Set when, and only when, a schedule's window triggered the run.
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
    priority: Priority
    window_end: datetime


@dataclass(frozen=True, slots=True)
class Cost:
    usd: Decimal
    source: CostSource


@dataclass(frozen=True, slots=True)
class Scope:
    """What a budget is checked for: one project's work of one kind."""

    workspace_id: UUID
    project_id: UUID
    workload: TaskWorkload


_tasks = collection_tasks
_runs = collection_runs
_with_run = _tasks.join(_runs, _runs.c.id == _tasks.c.run_id)
# Someone asked for a manual run and is waiting; a backfill is nobody's hurry. Any other run
# has the priority of its schedule.
_priority = case(
    (_runs.c.trigger == "manual", "high"),
    (_runs.c.trigger == "backfill", "low"),
    else_=func.coalesce(schedules.c.priority, "standard"),
).label("priority")


def _task_query() -> Select[tuple[Any, ...]]:
    return select(
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
        _priority,
        _runs.c.window_end,
    ).select_from(_with_run.outerjoin(schedules, schedules.c.id == _runs.c.schedule_id))


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


def _not_among(refs: Collection[TaskRef]) -> Any:
    """None of these tasks, however many they are. The keys go as two arrays: written into
    the statement as a list, a tick's two thousand took PostgreSQL seconds to plan, more with
    every partition."""
    taken = (
        func.unnest(
            bindparam(None, [ref.id for ref in refs], type_=ARRAY(BigInteger)),
            bindparam(None, [ref.created_at for ref in refs], type_=ARRAY(DateTime(timezone=True))),
        )
        .table_valued("id", "created_at", name="taken")
        .render_derived()
    )
    return ~exists().where(taken.c.id == _tasks.c.id, taken.c.created_at == _tasks.c.created_at)


def _aware(now: datetime) -> datetime:
    if now.tzinfo is None:
        # A naive time would be read in the zone of whatever machine runs this.
        raise ValueError("`now` must be an aware datetime")
    return now


_running_runs = select(_runs.c.id).where(_runs.c.status == "running")


async def database_time(sessions: async_sessionmaker[AsyncSession]) -> datetime:
    """The time by the database's clock, which is the one clock every worker shares. A worker
    whose own clock is wrong would otherwise plan windows that have not come, or record ones
    that have as missed."""
    async with sessions() as db:
        now: datetime = (await db.execute(select(func.now()))).scalar_one()
    return now


# Predicates of partial indexes, written out. As a bound parameter PostgreSQL cannot match one
# to its index once the statement runs on a generic plan: the insert of a run then fails with
# "no unique or exclusion constraint matching the ON CONFLICT specification", and the claim of
# due tasks reads every partition from end to end.
_SCHEDULED = _runs.c.trigger == literal_column("'schedule'")
_PENDING = _tasks.c.status == literal_column("'pending'")


def _scope_rows(scopes: Collection[Scope], budget_ids: Sequence[UUID] | None = None) -> Any:
    """Scopes as a row set: one array per column, so a statement has the same text and the
    same few parameters however many scopes there are. A list of thousands written into the
    statement takes PostgreSQL seconds to plan."""
    arrays = [
        bindparam(None, [scope.project_id for scope in scopes], type_=ARRAY(Uuid)),
        bindparam(None, [str(scope.workload) for scope in scopes], type_=ARRAY(Text)),
    ]
    names = ["project_id", "workload"]
    if budget_ids is not None:
        arrays.append(bindparam(None, list(budget_ids), type_=ARRAY(Uuid)))
        names.append("budget_id")
    return func.unnest(*arrays).table_valued(*names, name="scope").render_derived()


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
    """Record a run. None when the schedule already has a run for this window: planning a
    window twice plans it once. A run that no schedule triggered is always recorded; what
    makes it happen once is the request that asked for it."""
    if (run.trigger == "schedule") != (run.schedule_id is not None):
        raise ValueError("a run names a schedule when, and only when, the schedule triggered it")
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
            completed_at=_aware(now) if status == "cancelled" else None,
        )
        .on_conflict_do_nothing(
            index_elements=["schedule_id", "window_start"], index_where=_SCHEDULED
        )
        .returning(_runs.c.id)
    )
    run_id: UUID | None = (await db.execute(statement)).scalar_one_or_none()
    return run_id


def _arrays(run_id: UUID, tasks: Sequence[NewTask]) -> Any:
    """The tasks as one row set, each column sent as one array."""

    def array(name: str, values: list[Any], element: Any) -> Any:
        return bindparam(name, values, type_=ARRAY(element))

    keys = [
        idempotency_key(
            run_id=str(run_id),
            subject_type=task.subject_type,
            subject_id=task.subject_id,
            engine_code=task.engine_code,
            location_id=task.location_id,
            replicate_index=task.replicate_index,
            depth=task.depth,
        )
        for task in tasks
    ]
    return (
        func.unnest(
            array("subject_type", [task.subject_type for task in tasks], Text),
            array("subject_id", [task.subject_id for task in tasks], Text),
            array("engine_code", [task.engine_code for task in tasks], Text),
            array("location_id", [task.location_id for task in tasks], Integer),
            array("replicate_index", [task.replicate_index for task in tasks], SmallInteger),
            array("idempotency_key", keys, LargeBinary),
            array("request_fingerprint", [task.request_fingerprint for task in tasks], LargeBinary),
            array("provider_code", [task.provider_code for task in tasks], Text),
            array("provider_endpoint", [task.provider_endpoint for task in tasks], Text),
            array("scheduled_for", [task.scheduled_for for task in tasks], DateTime(timezone=True)),
        )
        .table_valued(
            "subject_type",
            "subject_id",
            "engine_code",
            "location_id",
            "replicate_index",
            "idempotency_key",
            "request_fingerprint",
            "provider_code",
            "provider_endpoint",
            "scheduled_for",
            name="item",
        )
        .render_derived()
    )


async def insert_tasks(db: AsyncSession, run_id: UUID, tasks: Sequence[NewTask]) -> int:
    """Add the tasks of a run that is being planned, all `pending`. A task that is already
    there is left as it is, so a second planning of the run adds nothing. A run that has been
    started, or has ended, gets none. Returns how many were new.

    The run's row gives every task its workspace, project and workload, and the month of its
    window gives `created_at`: the ledger is partitioned by it and its unique constraint
    includes it, so a run's tasks land in one partition whenever they are planned.
    """
    added = 0
    for start in range(0, len(tasks), INSERT_BATCH):
        item = _arrays(run_id, tasks[start : start + INSERT_BATCH])
        statement = (
            insert(_tasks)
            .from_select(
                [
                    "created_at",
                    "run_id",
                    "workspace_id",
                    "project_id",
                    "workload",
                    *(column.name for column in item.c),
                    "status",
                ],
                select(
                    func.date_trunc("month", _runs.c.window_start, "UTC"),
                    _runs.c.id,
                    _runs.c.workspace_id,
                    _runs.c.project_id,
                    _runs.c.workload,
                    *item.c,
                    literal("pending"),
                )
                .select_from(_runs.join(item, true()))
                # A run gets its tasks while it is being planned, and not after.
                .where(_runs.c.id == run_id, _runs.c.status == "planned"),
            )
            .on_conflict_do_nothing(index_elements=["idempotency_key", "created_at"])
            .returning(_tasks.c.id)
        )
        try:
            added += len((await db.execute(statement)).all())
        except IntegrityError as error:
            if getattr(error.orig, "sqlstate", None) == _CHECK_VIOLATION and "partition" in str(
                error.orig
            ):
                raise NoPartitionError(
                    f"the ledger has no partition for the window of run {run_id}"
                ) from error
            raise
    return added


async def start_run(
    db: AsyncSession, run_id: UUID, *, tasks_total: int, estimated_cost_usd: Decimal
) -> None:
    await db.execute(
        update(_runs)
        .where(_runs.c.id == run_id, _runs.c.status == "planned")
        .values(status="running", tasks_total=tasks_total, estimated_cost_usd=estimated_cost_usd)
    )


def _budget_of_the_runs_workspace(budget_id: UUID) -> Any:
    """`budget_id` if it is a budget of the run's own workspace, NULL otherwise."""
    return (
        select(budgets.c.id)
        .where(budgets.c.id == budget_id, budgets.c.workspace_id == _runs.c.workspace_id)
        .scalar_subquery()
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
            status_reason=_BUDGET_EXCEEDED,
            blocked_by_budget_id=_budget_of_the_runs_workspace(budget_id),
            estimated_cost_usd=estimated_cost_usd,
            completed_at=_aware(now),
        )
    )


async def sync_budget_holds(db: AsyncSession, holds: Mapping[Scope, UUID]) -> None:
    """Make the running runs say which budget holds their tasks back right now.

    `holds` is every scope the dispatcher is holding back in this tick and the budget that
    holds it. Runs in those scopes are marked; a run that was marked and is no longer held is
    cleared, so the mark never outlives the hold.
    """
    held = _scope_rows(list(holds), list(holds.values()))
    in_scope = and_(held.c.project_id == _runs.c.project_id, held.c.workload == _runs.c.workload)
    await db.execute(
        update(_runs)
        .where(
            _runs.c.status == "running",
            _runs.c.status_reason == _BUDGET_EXCEEDED,
            ~exists().where(in_scope),
        )
        .values(status_reason=None, blocked_by_budget_id=None)
    )
    if not holds:
        return
    await db.execute(
        update(_runs)
        .where(
            in_scope,
            _runs.c.status == "running",
            or_(
                _runs.c.status_reason.is_distinct_from(_BUDGET_EXCEEDED),
                _runs.c.blocked_by_budget_id.is_distinct_from(held.c.budget_id),
            ),
        )
        .values(
            status_reason=_BUDGET_EXCEEDED,
            # The budget, if it is one of the run's own workspace.
            blocked_by_budget_id=select(budgets.c.id)
            .where(
                budgets.c.id == held.c.budget_id,
                budgets.c.workspace_id == _runs.c.workspace_id,
            )
            .scalar_subquery(),
        )
    )


async def complete_finished_runs(db: AsyncSession, *, now: datetime) -> int:
    """Close every running run whose tasks have all ended. Returns how many were closed.

    A run that was started with no tasks (its schedule selected nothing) has none still open,
    so it closes here too. A task that produced nothing, cancelled ones included, counts
    against the run.
    """
    still_open = _tasks.alias("still_open")
    finished = (
        select(
            _runs.c.id.label("run_id"),
            func.count(_tasks.c.id).label("total"),
            func.count(_tasks.c.id)
            .filter(_tasks.c.status.in_(_NOTHING_COLLECTED))
            .label("nothing"),
            func.count(_tasks.c.id).filter(_tasks.c.status.in_(_COLLECTED)).label("collected"),
            func.coalesce(func.sum(_tasks.c.cost_usd), 0).label("cost"),
        )
        .select_from(_runs.outerjoin(_tasks, _tasks.c.run_id == _runs.c.id))
        .where(
            _runs.c.status == "running",
            ~select(still_open.c.id)
            .where(
                still_open.c.run_id == _runs.c.id,
                still_open.c.status.not_in(TERMINAL_STATUSES),
            )
            .exists(),
        )
        .group_by(_runs.c.id)
        .subquery("finished")
    )
    with_errors = and_(finished.c.total > 0, finished.c.nothing >= finished.c.total * ERROR_SHARE)
    closed = await db.execute(
        update(_runs)
        .where(_runs.c.id == finished.c.run_id, _runs.c.status == "running")
        .values(
            status=case((with_errors, "completed_with_errors"), else_="completed"),
            status_reason=None,
            blocked_by_budget_id=None,
            tasks_succeeded=finished.c.collected,
            tasks_failed=finished.c.nothing,
            actual_cost_usd=finished.c.cost,
            completed_at=_aware(now),
        )
        .returning(_runs.c.id)
    )
    return len(closed.all())


async def settle_cancelled_runs(db: AsyncSession) -> int:
    """Give a cancelled run its totals once its last task has ended.

    A run cancelled while the provider still had some of its tasks goes on paying for them:
    they are fetched and ingested as usual. Its counts and cost are filled in when the last of
    them ends, and it stays `cancelled`. Returns how many runs were settled.
    """
    still_open = _tasks.alias("still_open")
    finished = (
        select(
            _runs.c.id.label("run_id"),
            func.count(_tasks.c.id)
            .filter(_tasks.c.status.in_(_NOTHING_COLLECTED))
            .label("nothing"),
            func.count(_tasks.c.id).filter(_tasks.c.status.in_(_COLLECTED)).label("collected"),
            func.coalesce(func.sum(_tasks.c.cost_usd), 0).label("cost"),
        )
        .select_from(_runs.outerjoin(_tasks, _tasks.c.run_id == _runs.c.id))
        .where(
            _runs.c.status == "cancelled",
            _runs.c.actual_cost_usd.is_(None),
            ~select(still_open.c.id)
            .where(
                still_open.c.run_id == _runs.c.id,
                still_open.c.status.not_in(TERMINAL_STATUSES),
            )
            .exists(),
        )
        .group_by(_runs.c.id)
        .subquery("finished")
    )
    settled = await db.execute(
        update(_runs)
        .where(
            _runs.c.id == finished.c.run_id,
            _runs.c.status == "cancelled",
            _runs.c.actual_cost_usd.is_(None),
        )
        .values(
            tasks_succeeded=finished.c.collected,
            tasks_failed=finished.c.nothing,
            actual_cost_usd=finished.c.cost,
        )
        .returning(_runs.c.id)
    )
    return len(settled.all())


# ---------------------------------------------------------------------------------------------
# Dispatch


def _due(now: datetime, paused_providers: Collection[str], held: Collection[Scope]) -> Any:
    """A task the dispatcher may send now. Used on tasks joined to their run."""
    conditions = [
        _PENDING,
        _tasks.c.dispatched_at.is_(None),
        _tasks.c.scheduled_for <= now,
        or_(_tasks.c.next_attempt_at.is_(None), _tasks.c.next_attempt_at <= now),
        # A run that was cancelled or blocked sends nothing more.
        _runs.c.status == "running",
    ]
    if paused_providers:
        conditions.append(_tasks.c.provider_code.not_in(paused_providers))
    if held:
        scope = _scope_rows(held)
        conditions.append(
            ~exists().where(
                scope.c.project_id == _tasks.c.project_id, scope.c.workload == _tasks.c.workload
            )
        )
    return and_(*conditions)


async def due_scopes(db: AsyncSession, *, now: datetime) -> list[Scope]:
    """Every project and workload with a task due now: what the dispatcher checks budgets for
    before it claims anything. Tasks of a paused provider count: a budget does not stop
    holding because a provider is out."""
    rows = await db.execute(
        select(_tasks.c.workspace_id, _tasks.c.project_id, _tasks.c.workload)
        .select_from(_with_run)
        .where(_due(_aware(now), (), ()))
        .distinct()
        .order_by(_tasks.c.workspace_id, _tasks.c.project_id, _tasks.c.workload)
    )
    return [
        Scope(
            workspace_id=row.workspace_id,
            project_id=row.project_id,
            workload=TaskWorkload(row.workload),
        )
        for row in rows
    ]


async def claim_due(
    db: AsyncSession,
    *,
    now: datetime,
    paused_providers: Collection[str] = (),
    held: Collection[Scope] = (),
    limit: int = DISPATCH_LIMIT,
    per_project: int = DISPATCH_PER_PROJECT,
    providers: Collection[str] | None = None,
    workloads: Collection[TaskWorkload] | None = None,
) -> list[LedgerTask]:
    """Lock and return the tasks that are due, oldest first, fairly across projects.

    Each project with due work gets an equal share of `limit`, at most `per_project`; what is
    left over after that goes to the projects that still have more, the one that has waited
    longest first. One large project cannot use a whole tick while a small one waits. Tasks
    of a paused provider, of a provider not in `providers` or a workload not in `workloads`
    (when they are given), and of a scope a budget holds back are left where they are, so
    they take nobody's share. The rows stay locked until the transaction ends, and rows
    another dispatcher holds are skipped.

    Two statements, however many projects there are: one for the shares, one for the
    leftover.
    """
    if (providers is not None and not providers) or (workloads is not None and not workloads):
        return []
    due = _due(_aware(now), paused_providers, held)
    if providers is not None:
        due = and_(due, _tasks.c.provider_code.in_(sorted(providers)))
    if workloads is not None:
        due = and_(due, _tasks.c.workload.in_(sorted(workloads)))
    oldest_first = (_tasks.c.scheduled_for, _tasks.c.id)
    waiting = (
        select(_tasks.c.project_id, func.min(_tasks.c.scheduled_for).label("first_due"))
        .select_from(_with_run)
        .where(due)
        .group_by(_tasks.c.project_id)
    )
    projects: int = (
        await db.execute(select(func.count()).select_from(waiting.subquery()))
    ).scalar_one()
    if not projects:
        return []
    share = max(1, min(per_project, limit // projects))

    # No more projects than the tick has room for, so this statement locks no row that it
    # does not return.
    project = waiting.order_by("first_due", _tasks.c.project_id).limit(limit).subquery("project")
    fair = (
        _task_query()
        .where(due, _tasks.c.project_id == project.c.project_id)
        .order_by(*oldest_first)
        .limit(share)
        .with_for_update(of=_tasks, skip_locked=True)
        .correlate(project)
        .lateral("fair")
    )
    rows = await db.execute(
        select(fair)
        .select_from(project.join(fair, true()))
        .order_by(project.c.first_due, project.c.project_id, fair.c.scheduled_for, fair.c.id)
    )
    claimed: dict[UUID, list[LedgerTask]] = {}
    for row in rows:
        task = _task(row)
        claimed.setdefault(task.project_id, []).append(task)
    tasks = [task for taken in claimed.values() for task in taken]

    # Then the leftover, to the projects that had a full share and so may have more.
    remaining = limit - len(tasks)
    more_for = [project_id for project_id, taken in claimed.items() if len(taken) == share]
    if remaining > 0 and more_for and per_project > share:
        task_refs = [task.ref for task in tasks]
        turn = (
            func.unnest(bindparam(None, more_for, type_=ARRAY(Uuid)))
            .table_valued("project_id", with_ordinality="position", name="turn")
            .render_derived()
        )
        more = (
            _task_query()
            # SKIP LOCKED passes over rows other transactions hold, not the ones this one
            # took above, so those are named.
            .where(due, _tasks.c.project_id == turn.c.project_id, _not_among(task_refs))
            .order_by(*oldest_first)
            # No project is looked at for more than the tick still has room for. The outer
            # limit then cuts the total: a few rows may be locked and not returned, until
            # this transaction ends.
            .limit(min(per_project - share, remaining))
            .with_for_update(of=_tasks, skip_locked=True)
            .correlate(turn)
            .lateral("more")
        )
        rows = await db.execute(
            select(more)
            .select_from(turn.join(more, true()))
            .order_by(turn.c.position, more.c.scheduled_for, more.c.id)
            .limit(remaining)
        )
        tasks.extend(_task(row) for row in rows)
    return sorted(tasks, key=lambda task: (task.scheduled_for, task.ref.id))


async def mark_dispatched(db: AsyncSession, refs: Collection[TaskRef], *, now: datetime) -> None:
    """The tasks are on their way to the queue. They are not selected again until a handler
    ends them or the reconciler finds the message lost."""
    if not refs:
        return
    await db.execute(
        update(_tasks)
        .where(_named(refs), _tasks.c.status == "pending")
        .values(dispatched_at=_aware(now))
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
    """Take the tasks for one provider call. Only tasks still `pending` and dispatched, of a
    run that is still running, are taken, and they leave `pending` here, before the call:
    whatever happens next, no second handler can take them. Returns the tasks taken, which may
    be fewer than named."""
    if not refs:
        return []
    taken = (
        await db.execute(
            update(_tasks)
            .where(
                _named(refs),
                _tasks.c.status == "pending",
                _tasks.c.dispatched_at.is_not(None),
                _tasks.c.run_id.in_(_running_runs),
            )
            .values(
                status="submit_unknown", attempts=_tasks.c.attempts + 1, submitted_at=_aware(now)
            )
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


def _awaiting(ref: TaskRef, attempt: int | None) -> Any:
    """The task, if it is waiting for the answer to this attempt. An answer recorded again,
    after a commit whose reply was lost, must not land on a later attempt of the same task."""
    condition = and_(_named([ref]), _tasks.c.status == "submit_unknown")
    if attempt is not None:
        condition = and_(condition, _tasks.c.attempts == attempt)
    return condition


async def mark_submitted(
    db: AsyncSession,
    ref: TaskRef,
    *,
    provider_task_id: str,
    cost: Cost | None,
    now: datetime,
    attempt: int | None = None,
) -> bool:
    """The provider accepted the task. False when the task was not waiting for that answer
    (for `attempt`, when it is given), and then nothing is written.

    What the submission cost is recorded here, in the same step, from the task's own row: a
    message delivered twice cannot charge the budget twice, and the event cannot name another
    workspace than the task's.
    """
    submitted = (
        await db.execute(
            update(_tasks)
            .where(_awaiting(ref, attempt))
            .values(
                status="submitted",
                provider_task_id=provider_task_id,
                # A task sent again after its result expired has been paid for twice.
                cost_usd=_tasks.c.cost_usd
                if cost is None
                else func.coalesce(_tasks.c.cost_usd, 0) + cost.usd,
                dispatched_at=None,
                next_attempt_at=None,
                last_error_code=None,
                last_error_message=None,
            )
            .returning(
                _tasks.c.id,
                _tasks.c.run_id,
                _tasks.c.workspace_id,
                _tasks.c.project_id,
                _tasks.c.workload,
                _tasks.c.subject_type,
                _tasks.c.subject_id,
                _tasks.c.engine_code,
                _tasks.c.provider_code,
                _tasks.c.provider_endpoint,
            )
        )
    ).one_or_none()
    if submitted is None:
        return False
    if cost is not None:
        await db.execute(provider_cost_events.insert().values(_cost_event(submitted, cost, now)))
    return True


def _cost_event(task: Row[tuple[Any, ...]], cost: Cost, now: datetime) -> dict[str, Any]:
    """One cost event for one task, from the task's own row."""
    occurred = _aware(now).astimezone(UTC)
    return {
        "occurred_at": occurred,
        "workspace_id": task.workspace_id,
        "project_id": task.project_id,
        "provider_code": task.provider_code,
        "endpoint": task.provider_endpoint,
        "workload": task.workload,
        "channel": cost_channel(TaskWorkload(task.workload)),
        "run_id": task.run_id,
        "task_id": task.id,
        "subject_type": task.subject_type,
        "subject_id": task.subject_id,
        "engine_code": task.engine_code,
        "units": 1,
        "price_unit": "task",
        "cost_usd": cost.usd,
        "cost_source": cost.source,
        "billing_period": occurred.date().replace(day=1),
    }


async def record_failure(
    db: AsyncSession,
    ref: TaskRef,
    *,
    kind: ProviderErrorKind,
    message: str,
    decision: RetryDecision,
    now: datetime,
    attempt: int | None = None,
) -> bool:
    """The provider refused the task, or was not reached: apply what the retry policy decided.

    `pending` puts the task back for the dispatcher, after the delay if there is one. `failed`
    and `dead` end it. False when the task was not in a provider call (the call of `attempt`,
    when it is given).

    This is for a call that is known not to have submitted the task. A call that timed out
    may have: it is not recorded here but with `note_unknown_outcome`, and the task stays
    `submit_unknown`.
    """
    if kind is ProviderErrorKind.TIMEOUT:
        raise ValueError(
            "a call that timed out may have submitted the task: its outcome is unknown"
        )
    values: dict[str, Any] = {
        "status": decision.status,
        "dispatched_at": None,
        "submitted_at": None,
        "last_error_code": kind.value,
        "last_error_message": message[:ERROR_MESSAGE_MAX],
        "next_attempt_at": None if decision.delay is None else _aware(now) + decision.delay,
    }
    if decision.status != "pending":
        values["completed_at"] = _aware(now)
    if not decision.counts:
        # The provider is paused for everyone: this was not an attempt at the task.
        values["attempts"] = _tasks.c.attempts - 1
    result = await db.execute(
        update(_tasks).where(_awaiting(ref, attempt)).values(**values).returning(_tasks.c.id)
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


# ---------------------------------------------------------------------------------------------
# Reconciliation


async def in_flight_endpoints(db: AsyncSession) -> list[tuple[str, str]]:
    """The providers and endpoints that have tasks `submitted` or `submit_unknown`."""
    rows = await db.execute(
        select(_tasks.c.provider_code, _tasks.c.provider_endpoint)
        .where(_tasks.c.status.in_(("submitted", "submit_unknown")))
        .distinct()
        .order_by(_tasks.c.provider_code, _tasks.c.provider_endpoint)
    )
    return [(row.provider_code, row.provider_endpoint) for row in rows]


async def stale_dispatches(
    db: AsyncSession, *, older_than: timedelta, now: datetime, limit: int = DISPATCH_LIMIT
) -> list[LedgerTask]:
    """Lock and return the tasks that were sent to the queue long ago and are still `pending`.
    Nothing is changed: the caller decides which of them have really lost their message and
    calls `release` for those."""
    rows = await db.execute(
        _task_query()
        .where(_tasks.c.status == "pending", _tasks.c.dispatched_at < _aware(now) - older_than)
        .order_by(_tasks.c.dispatched_at)
        .limit(limit)
        .with_for_update(of=_tasks, skip_locked=True)
    )
    return [_task(row) for row in rows]


async def end_old_submissions(
    db: AsyncSession,
    *,
    older_than: timedelta,
    lifetimes: Mapping[tuple[str, str], timedelta] | None = None,
    now: datetime,
) -> int:
    """End the tasks a provider has had for longer than it keeps results: they will never come
    back. `lifetimes` gives the time per provider and endpoint where it differs from
    `older_than`.

    A task still `submit_unknown` after that time ends the same way. Whether the provider ever
    had it is not known, and by now there is no result to fetch either way. It may have been
    paid for, so it is charged at its share of its run's estimate (`price_book_estimate`): the
    budget counts what may have been spent rather than forget it. So is a task the provider
    accepted without saying what it cost.
    """
    lifetime: Any = literal(older_than, Interval)
    if lifetimes:
        lifetime = case(
            *(
                (
                    and_(_tasks.c.provider_code == code, _tasks.c.provider_endpoint == endpoint),
                    literal(age, Interval),
                )
                for (code, endpoint), age in lifetimes.items()
            ),
            else_=lifetime,
        )
    result = await db.execute(
        update(_tasks)
        .where(
            _tasks.c.status.in_(("submitted", "submit_unknown")),
            _tasks.c.submitted_at < literal(_aware(now), DateTime(timezone=True)) - lifetime,
        )
        .values(
            status="dead",
            completed_at=_aware(now),
            last_error_code=case(
                (_tasks.c.status == "submitted", "provider_never_answered"),
                else_=NEVER_CONFIRMED,
            ),
            last_error_message=case(
                (
                    _tasks.c.status == "submitted",
                    "No result from the provider within the time it keeps results.",
                ),
                else_="The provider never confirmed the submission.",
            ),
        )
        .returning(
            _tasks.c.id,
            _tasks.c.created_at,
            _tasks.c.run_id,
            _tasks.c.workspace_id,
            _tasks.c.project_id,
            _tasks.c.workload,
            _tasks.c.subject_type,
            _tasks.c.subject_id,
            _tasks.c.engine_code,
            _tasks.c.provider_code,
            _tasks.c.provider_endpoint,
            _tasks.c.last_error_code,
            _tasks.c.cost_usd,
        )
    )
    ended = result.all()
    # Never confirmed, or accepted with no cost said: either may have been paid for, and
    # nothing has charged the budget for it.
    uncharged = [
        row for row in ended if row.last_error_code == NEVER_CONFIRMED or row.cost_usd is None
    ]
    if uncharged:
        await _charge_estimates(db, uncharged, now)
    return len(ended)


async def _charge_estimates(
    db: AsyncSession, tasks: Sequence[Row[tuple[Any, ...]]], now: datetime
) -> None:
    """Charge each task its share of its run's estimate, on the task and as a cost event."""
    share = (_runs.c.estimated_cost_usd / func.nullif(_runs.c.tasks_total, 0)).label("share")
    shares = {
        row.id: row.share
        for row in await db.execute(
            select(_runs.c.id, share).where(_runs.c.id.in_({task.run_id for task in tasks}))
        )
    }
    events = []
    for task in tasks:
        estimate = shares.get(task.run_id)
        if estimate is None or estimate <= 0:
            continue
        cost = Cost(usd=Decimal(estimate).quantize(_COST_STEP), source="price_book_estimate")
        await db.execute(
            update(_tasks)
            .where(_named([TaskRef(id=task.id, created_at=task.created_at)]))
            .values(cost_usd=func.coalesce(_tasks.c.cost_usd, 0) + cost.usd)
        )
        events.append(_cost_event(task, cost, now))
    if events:
        await db.execute(provider_cost_events.insert(), events)


async def _cancel(db: AsyncSession, runs: Any, *, code: str, message: str, now: datetime) -> int:
    result = await db.execute(
        update(_tasks)
        .where(_tasks.c.status == "pending", _tasks.c.run_id.in_(runs))
        .values(
            status="cancelled",
            completed_at=_aware(now),
            dispatched_at=None,
            next_attempt_at=None,
            last_error_code=code,
            last_error_message=message,
        )
        .returning(_tasks.c.id)
    )
    return len(result.all())


async def cancel_missed(
    db: AsyncSession, *, now: datetime, after_window: timedelta = SEND_WITHIN
) -> int:
    """A task not sent this long after its run's window closed belongs to the next run."""
    hours = after_window.total_seconds() / 3600
    return await _cancel(
        db,
        select(_runs.c.id).where(_runs.c.window_end < _aware(now) - after_window),
        code="window_missed",
        message=f"Not sent within {hours:g} hours of the end of its run's window.",
        now=now,
    )


async def stop_runs_of_projects_not_collecting(db: AsyncSession, *, now: datetime) -> int:
    """A project that was paused, archived or deleted, or whose workspace was suspended,
    sends nothing more: its running runs are cancelled. What the provider already has is
    still fetched and paid for; the tasks not yet sent are cancelled with the run."""
    project = projects.alias("project")
    # Not "a project that stopped exists", but "no collecting project exists": a project row
    # that is gone altogether stops its runs as well.
    not_collecting = ~(
        select(project.c.id)
        .select_from(project.join(workspaces, workspaces.c.id == project.c.workspace_id))
        .where(
            project.c.id == _runs.c.project_id,
            project.c.status == "active",
            project.c.deleted_at.is_(None),
            workspaces.c.status == "active",
        )
        .exists()
    )
    stopped = await db.execute(
        update(_runs)
        .where(_runs.c.status == "running", not_collecting)
        .values(
            status="cancelled",
            status_reason=PROJECT_NOT_COLLECTING,
            blocked_by_budget_id=None,
            completed_at=_aware(now),
        )
        .returning(_runs.c.id)
    )
    return len(stopped.all())


async def cancel_for_ended_runs(db: AsyncSession, *, now: datetime) -> int:
    """A run that was cancelled leaves tasks that were never sent. They are cancelled with it,
    so they are not counted as waiting."""
    return await _cancel(
        db,
        select(_runs.c.id).where(_runs.c.status.not_in(("planned", "running"))),
        code="run_ended",
        message="Its run ended before it was sent.",
        now=now,
    )
