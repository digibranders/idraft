"""Helpers for ledger tests: tenants, runs and tasks made directly."""

from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from collections.abc import Awaitable, Callable, Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors import ledger
from sightline.collectors.ledger import LedgerTask, NewRun, NewTask, TaskRef, Trigger
from sightline.collectors.registry import Plan, ScheduleWindow
from sightline.domain.retries import ProviderErrorKind
from sightline.domain.tasks import scheduled_for
from sightline.domain.workloads import TaskWorkload
from sightline.providers.contract import (
    AcceptedTask,
    CanonicalRequest,
    Contract,
    FetchResult,
    LiveResult,
    ProviderCallError,
    ProviderError,
    ReadyTask,
    RejectedTask,
    SubmitResult,
    SubmittedTask,
)
from tests.api.auth.support import execute, fetch, fetchrow, make_workspace
from tests.api.workspaces.support import make_project
from tests.conftest import PostgresServer

# The real clock: the ledger's partitions exist for the months around today.
NOW = datetime.now(UTC).replace(microsecond=0)


@dataclass(frozen=True)
class Project:
    workspace_id: uuid.UUID
    id: uuid.UUID


async def empty_ledger(pg: PostgresServer) -> None:
    """Remove every schedule, run, task, cost event, budget and registered payload. Planning,
    claiming and reconciling look at all of them, whoever made them."""
    await execute(
        pg,
        "TRUNCATE ops.collection_tasks, ops.provider_cost_events, ops.collection_runs, "
        "ops.schedules, ops.budgets, ops.raw_payloads CASCADE",
    )


async def make_tenant(pg: PostgresServer) -> Project:
    workspace = await make_workspace(pg)
    return Project(workspace_id=workspace.id, id=await make_project(pg, workspace.id))


async def another_project(pg: PostgresServer, project: Project) -> Project:
    """A second project in the same workspace."""
    return Project(
        workspace_id=project.workspace_id, id=await make_project(pg, project.workspace_id)
    )


def new_run(
    project: Project,
    *,
    schedule_id: uuid.UUID | None = None,
    workload: TaskWorkload = TaskWorkload.SEO_RANK,
    window_start: datetime = NOW,
    hours: int = 6,
    trigger: Trigger | None = None,
) -> NewRun:
    if trigger is None:
        trigger = "schedule" if schedule_id is not None else "manual"
    return NewRun(
        workspace_id=project.workspace_id,
        project_id=project.id,
        schedule_id=schedule_id,
        workload=workload,
        window_start=window_start,
        window_end=window_start + timedelta(hours=hours),
        trigger=trigger,
        config_snapshot={"adapter": 1},
    )


def new_task(
    number: int,
    *,
    scheduled_for: datetime = NOW,
    provider: str = "fake",
    endpoint: str = "serp",
    depth: int | None = 20,
) -> NewTask:
    subject = f"keyword-{number}"
    return NewTask(
        subject_type="tracked_keyword",
        subject_id=subject,
        engine_code=None,
        location_id=2356,
        replicate_index=1,
        depth=depth,
        request_fingerprint=hashlib.sha256(subject.encode()).digest(),
        provider_code=provider,
        provider_endpoint=endpoint,
        scheduled_for=scheduled_for,
    )


async def make_schedule(
    pg: PostgresServer,
    project: Project,
    *,
    next_run_at: datetime = NOW,
    priority: str = "standard",
    workload: str = "seo_rank",
    cadence: str = "daily",
    timezone: str = "UTC",
    window_start_local: str = "02:00",
    window_hours: int = 6,
    weekday: int | None = None,
    month_day: int | None = None,
    is_active: bool = True,
    selector: dict[str, Any] | None = None,
    deleted_at: datetime | None = None,
) -> uuid.UUID:
    row = await fetchrow(
        pg,
        "INSERT INTO ops.schedules (workspace_id, project_id, workload, name, cadence, timezone, "
        "window_start_local, window_hours, weekday, month_day, priority, is_active, "
        "next_run_at, selector, deleted_at) "
        "VALUES ($1, $2, $3, 'Ranks', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14) "
        "RETURNING id",
        project.workspace_id,
        project.id,
        workload,
        cadence,
        timezone,
        time.fromisoformat(window_start_local),
        window_hours,
        weekday,
        month_day,
        priority,
        is_active,
        next_run_at,
        json.dumps(selector or {}),
        deleted_at,
    )
    schedule_id: uuid.UUID = row["id"]
    return schedule_id


async def seed_run(
    sessions: async_sessionmaker[AsyncSession],
    project: Project,
    tasks: int,
    *,
    schedule_id: uuid.UUID | None = None,
    scheduled_for: datetime = NOW,
    window_start: datetime = NOW,
    provider: str = "fake",
    endpoint: str = "serp",
    workload: TaskWorkload = TaskWorkload.SEO_RANK,
    trigger: Trigger | None = None,
    estimate: str = "0",
) -> uuid.UUID:
    """A running run with `tasks` pending tasks, made through the ledger itself."""
    run = new_run(
        project,
        schedule_id=schedule_id,
        window_start=window_start,
        workload=workload,
        trigger=trigger,
    )
    async with sessions() as db, db.begin():
        run_id = await ledger.create_run(db, run, now=window_start)
        assert run_id is not None
        await ledger.insert_tasks(
            db,
            run_id,
            [
                new_task(number, scheduled_for=scheduled_for, provider=provider, endpoint=endpoint)
                for number in range(tasks)
            ],
        )
        await ledger.start_run(db, run_id, tasks_total=tasks, estimated_cost_usd=Decimal(estimate))
    return run_id


async def task_rows(pg: PostgresServer, run_id: uuid.UUID) -> list[dict[str, Any]]:
    rows = await fetch(
        pg, "SELECT * FROM ops.collection_tasks WHERE run_id = $1 ORDER BY subject_id", run_id
    )
    return [dict(row) for row in rows]


async def run_row(pg: PostgresServer, run_id: uuid.UUID) -> dict[str, Any]:
    return dict(await fetchrow(pg, "SELECT * FROM ops.collection_runs WHERE id = $1", run_id))


async def spend(
    pg: PostgresServer,
    project: Project,
    amount: str,
    *,
    workload: str = "seo_rank",
    when: datetime = NOW,
    run_id: uuid.UUID | None = None,
) -> None:
    """A cost event of `amount` dollars for the project."""
    await fetch(
        pg,
        "INSERT INTO ops.provider_cost_events (occurred_at, workspace_id, project_id, "
        "provider_code, endpoint, workload, channel, cost_usd, cost_source, billing_period, "
        "run_id) "
        "VALUES ($1, $2, $3, 'fake', 'serp', $4, 'seo', $5, 'provider_reported', $6, $7)",
        when,
        project.workspace_id,
        project.id,
        workload,
        Decimal(amount),
        when.astimezone(UTC).date().replace(day=1),
        run_id,
    )


async def make_budget(
    pg: PostgresServer,
    project: Project,
    limit: str,
    *,
    workload: str | None = "seo_rank",
    for_project: bool = False,
    soft_limit_pct: int = 80,
    action: str = "pause",
) -> uuid.UUID:
    row = await fetchrow(
        pg,
        "INSERT INTO ops.budgets (workspace_id, project_id, workload, limit_usd, soft_limit_pct, "
        "action_on_hard) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
        project.workspace_id,
        project.id if for_project else None,
        workload,
        Decimal(limit),
        soft_limit_pct,
        action,
    )
    budget_id: uuid.UUID = row["id"]
    return budget_id


class FakeWorkload:
    """Plans one task per subject, spread over the window, at a fixed price."""

    def __init__(
        self,
        subjects: int = 3,
        *,
        price: str = "0.001",
        name: TaskWorkload = TaskWorkload.SEO_RANK,
    ) -> None:
        self.name = name
        self.subjects = subjects
        self.price = Decimal(price)
        self.windows: list[ScheduleWindow] = []
        # Schedules this workload cannot plan.
        self.broken: set[uuid.UUID] = set()
        # Schedules whose planning waits: set when it has begun, goes on when released.
        self.gates: dict[uuid.UUID, tuple[asyncio.Event, asyncio.Event]] = {}
        # A statement this workload runs while it plans, which it has no business running.
        self.writes: str | None = None
        # Whether it plans its first task twice.
        self.repeats = False
        # Subjects it cannot build a request for, and those it has built requests for.
        self.unbuildable: set[str] = set()
        self.built: list[str] = []
        # Subjects whose request is tagged with another task's id, and whether building fails.
        self.mistags: set[str] = set()
        self.misruns: set[str] = set()
        self.fails_to_build = False
        # Whether tasks at different locations go in different batches.
        self.batches_by_location = False

    async def plan(self, db: AsyncSession, window: ScheduleWindow) -> Plan:
        if window.schedule_id in self.broken:
            raise RuntimeError("the selector names a group that is gone")
        if window.schedule_id in self.gates:
            begun, go_on = self.gates[window.schedule_id]
            begun.set()
            await go_on.wait()
        if self.writes is not None:
            await db.execute(text(self.writes))
        self.windows.append(window)
        tasks = [
            NewTask(
                subject_type="tracked_keyword",
                subject_id=f"keyword-{number}",
                engine_code=None,
                location_id=2356,
                replicate_index=1,
                depth=20,
                request_fingerprint=hashlib.sha256(f"keyword-{number}".encode()).digest(),
                provider_code="fake",
                provider_endpoint="serp",
                scheduled_for=scheduled_for(
                    window_start=window.window_start,
                    subject_id=f"keyword-{number}",
                    workload=window.workload,
                    window_hours=window.window_hours,
                ),
            )
            for number in range(self.subjects)
        ]
        if self.repeats:
            tasks.append(tasks[0])
        return Plan(
            tasks=tasks,
            estimated_cost_usd=self.price * len(tasks),
            config_snapshot={"adapter": "fake@1", "provider_mode": window.provider_mode},
        )

    def batch_key(self, task: LedgerTask) -> str:
        # Tasks at one location go together; the default fake has one location.
        return str(task.location_id) if self.batches_by_location else ""

    async def build_requests(
        self, db: AsyncSession, tasks: Sequence[LedgerTask]
    ) -> Mapping[TaskRef, CanonicalRequest]:
        if self.writes is not None:
            await db.execute(text(self.writes))
        if self.fails_to_build:
            raise LookupError("the keyword row is gone")
        self.built.extend(task.subject_id for task in tasks)
        return {
            task.ref: CanonicalRequest(
                # A mistagged request carries the id of another task.
                task_id=str(task.ref.id + (1 if task.subject_id in self.mistags else 0)),
                run_id=uuid.uuid4() if task.subject_id in self.misruns else task.run_id,
                priority="high" if task.priority == "high" else "standard",
                params=SerpParams(keyword=task.subject_id, location_id=task.location_id or 0),
            )
            for task in tasks
            if task.subject_id not in self.unbuildable
        }


class SerpParams(Contract):
    keyword: str
    location_id: int


Answer = Callable[[str, Sequence[CanonicalRequest]], Awaitable[SubmitResult]]
LiveAnswer = Callable[[str, Sequence[CanonicalRequest]], Awaitable[Sequence[LiveResult]]]


class FakeProvider:
    """Answers a submission the way a test tells it to; by default it accepts everything, at
    a price per task."""

    def __init__(
        self, *, code: str = "fake", price: str | None = "0.0006", size: int = 100
    ) -> None:
        self.code = code
        self.price = None if price is None else Decimal(price)
        self.size = size
        self.calls: list[tuple[str, list[CanonicalRequest]]] = []
        self.answer: Answer = self.accept_all
        # What the provider holds and has finished, as a test sets it up.
        self.ready: list[ReadyTask] = []
        self.results: dict[str, FetchResult] = {}
        self.posted: list[SubmittedTask] = []
        self.fetched: list[str] = []
        self.lists_submissions = False
        # What was asked of it besides submissions, and a failure every such call raises.
        self.listed: list[str] = []
        self.looked: list[tuple[str, datetime, datetime]] = []
        self.reading_fails: Exception | None = None
        # Endpoints answered in the call, and what each live call was asked.
        self.live_endpoints: set[str] = set()
        self.live_calls: list[tuple[str, list[CanonicalRequest]]] = []
        self.live_answer: LiveAnswer = self.answer_all

    def batch_size(self, endpoint: str) -> int:
        return self.size

    def is_live(self, endpoint: str) -> bool:
        return endpoint in self.live_endpoints

    async def live(
        self, endpoint: str, requests: Sequence[CanonicalRequest]
    ) -> Sequence[LiveResult]:
        self.live_calls.append((endpoint, list(requests)))
        return await self.live_answer(endpoint, requests)

    async def answer_all(
        self, endpoint: str, requests: Sequence[CanonicalRequest]
    ) -> Sequence[LiveResult]:
        return [
            LiveResult(
                task_id=request.task_id,
                status="ready",
                body=b'{"tasks": []}',
                cost_usd=self.price,
            )
            for request in requests
        ]

    async def list_ready(self, endpoint: str) -> Sequence[ReadyTask]:
        self.listed.append(endpoint)
        if self.reading_fails is not None:
            raise self.reading_fails
        return list(self.ready)

    async def fetch(self, endpoint: str, provider_task_id: str) -> FetchResult:
        self.fetched.append(provider_task_id)
        if self.reading_fails is not None:
            raise self.reading_fails
        return self.results.get(
            provider_task_id,
            FetchResult(
                provider_task_id=provider_task_id,
                status="ready",
                body=f'{{"id": "{provider_task_id}"}}'.encode(),
            ),
        )

    async def find_submitted(
        self, endpoint: str, since: datetime, until: datetime
    ) -> Sequence[SubmittedTask]:
        self.looked.append((endpoint, since, until))
        if self.reading_fails is not None:
            raise self.reading_fails
        return [
            task
            for task in self.posted
            if task.posted_at is None or since <= task.posted_at <= until
        ]

    def result_lifetime(self, endpoint: str) -> timedelta:
        # An endpoint named for LLM Responses keeps its results four hours longer.
        return timedelta(hours=76 if endpoint == "llm" else 72)

    def payload_slug(self, endpoint: str) -> str:
        return f"fake_{endpoint}"

    async def submit(self, endpoint: str, requests: Sequence[CanonicalRequest]) -> SubmitResult:
        self.calls.append((endpoint, list(requests)))
        return await self.answer(endpoint, requests)

    async def accept_all(self, endpoint: str, requests: Sequence[CanonicalRequest]) -> SubmitResult:
        return SubmitResult(
            accepted=[
                AcceptedTask(
                    task_id=request.task_id,
                    provider_task_id=f"p-{request.task_id}",
                    cost_usd=self.price,
                )
                for request in requests
            ]
        )

    def fail_with(self, kind: ProviderErrorKind, message: str = "refused") -> None:
        """Every call fails as a whole."""

        async def fail(endpoint: str, requests: Sequence[CanonicalRequest]) -> SubmitResult:
            raise ProviderCallError(ProviderError(kind=kind, message=message))

        self.answer = fail

    def reject(self, kind: ProviderErrorKind, *positions: int) -> None:
        """Refuse the requests at these positions of each call, accept the rest."""

        async def partly(endpoint: str, requests: Sequence[CanonicalRequest]) -> SubmitResult:
            accepted = await self.accept_all(endpoint, requests)
            refused = {requests[position].task_id for position in positions}
            return SubmitResult(
                accepted=[task for task in accepted.accepted if task.task_id not in refused],
                rejected=[
                    RejectedTask(
                        task_id=task_id, error=ProviderError(kind=kind, message="bad keyword")
                    )
                    for task_id in sorted(refused)
                ],
            )

        self.answer = partly


class Pauses:
    """Provider pauses kept in memory."""

    def __init__(self) -> None:
        self.reasons: dict[str, str] = {}

    async def paused(self, providers: Collection[str]) -> frozenset[str]:
        return frozenset(code for code in providers if code in self.reasons)

    async def pause(self, provider: str, *, reason: str) -> None:
        self.reasons[provider] = reason
