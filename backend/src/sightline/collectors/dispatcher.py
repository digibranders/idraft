"""The dispatcher: due tasks become `submit_batch` messages (docs/21-scheduler-workers.md
section 4).

One tick, in four steps, each in its own short transaction:

1. Runs of projects that stopped collecting are cancelled, so nothing more is sent for them.
2. The budget of every project and workload with due work is checked, the month's spend read
   once. Work whose budget is used up is held back, and its runs say so.
3. Due tasks are claimed, fairly across projects, from providers this worker has and that are
   not paused, and marked as dispatched.
4. They are sent as batches of the provider's size, the highest priority first. A batch whose
   send fails is released at once; if the process dies before it is sent, the reconciler
   releases it later. Either way it is claimed again.
"""

from __future__ import annotations

import hashlib
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import datetime
from itertools import groupby
from typing import Protocol
from uuid import UUID

import structlog
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors import budget, ledger
from sightline.collectors.budget import SpendMemo
from sightline.collectors.ledger import (
    DISPATCH_LIMIT,
    DISPATCH_PER_PROJECT,
    LedgerTask,
    Priority,
    Scope,
    TaskRef,
)
from sightline.collectors.registry import Registry

_PRIORITY_ORDER: dict[Priority, int] = {"high": 0, "standard": 1, "low": 2}
# More than any provider takes in one call.
BATCH_MAX = 1000
_log = structlog.get_logger(__name__)


class TaskKey(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    id: int
    created_at: datetime


class SubmitBatch(BaseModel):
    """The message: which tasks to send to which endpoint. Nothing else travels; the handler
    reads the rest from the ledger."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    provider: str = Field(min_length=1, max_length=64)
    endpoint: str = Field(min_length=1, max_length=128)
    priority: Priority
    tasks: list[TaskKey] = Field(min_length=1, max_length=BATCH_MAX)

    @property
    def refs(self) -> list[TaskRef]:
        return [TaskRef(id=key.id, created_at=key.created_at) for key in self.tasks]

    @property
    def dedupe_key(self) -> str:
        """The same tasks are one message, however they were ordered."""
        names = sorted(f"{key.id}@{key.created_at.isoformat()}" for key in self.tasks)
        return "submit:" + hashlib.sha256("|".join(names).encode()).hexdigest()


class Sender(Protocol):
    async def send(self, batch: SubmitBatch) -> bool:
        """Put the batch on the queue. False when the same batch is already waiting there."""
        ...


class ProviderPauses(Protocol):
    async def paused(self, providers: Collection[str]) -> frozenset[str]:
        """Which of these providers are paused now."""
        ...

    async def pause(self, provider: str, *, reason: str) -> None:
        """Send nothing more to this provider for a while."""
        ...


@dataclass(frozen=True, slots=True)
class DispatchReport:
    # Runs cancelled because their project stopped collecting.
    stopped: int = 0
    # Projects and workloads whose due work a budget holds back.
    held: int = 0
    claimed: int = 0
    batches: int = 0
    # Tasks whose batch could not be sent, back in line for the next tick.
    released: int = 0

    @property
    def quiet(self) -> bool:
        return self == DispatchReport()


def batches(tasks: Sequence[LedgerTask], registry: Registry) -> list[SubmitBatch]:
    """The tasks in batches of their provider's size, one provider, endpoint and priority each,
    the highest priority first and, within it, the batch holding the oldest task first."""

    def group(task: LedgerTask) -> tuple[str, str, Priority]:
        return (task.provider_code, task.provider_endpoint, task.priority)

    made: list[tuple[int, datetime, SubmitBatch]] = []
    for (provider, endpoint, priority), grouped in groupby(sorted(tasks, key=group), key=group):
        ordered = sorted(grouped, key=lambda task: (task.scheduled_for, task.ref.id))
        try:
            size = registry.provider(provider).batch_size(endpoint)
            if size < 1:
                raise ValueError(f"batch size {size} for {provider} {endpoint}")
            size = min(size, BATCH_MAX)
            chunks = [ordered[start : start + size] for start in range(0, len(ordered), size)]
            group_batches = [
                SubmitBatch(
                    provider=provider,
                    endpoint=endpoint,
                    priority=priority,
                    tasks=[
                        TaskKey(id=task.ref.id, created_at=task.ref.created_at) for task in chunk
                    ],
                )
                for chunk in chunks
            ]
        except Exception as error:
            # One provider's fault is not the others': its tasks are left where they are.
            _log.error("tasks not batched", provider=provider, endpoint=endpoint, exc_info=error)
            continue
        for chunk, batch in zip(chunks, group_batches, strict=True):
            made.append((_PRIORITY_ORDER[priority], chunk[0].scheduled_for, batch))
    return [batch for _, _, batch in sorted(made, key=lambda item: (item[0], item[1]))]


async def _holds(db: AsyncSession, *, now: datetime) -> dict[Scope, UUID]:
    """The scopes with due work whose budget is used up, and the budget that holds each."""
    memo: SpendMemo = {}
    holds: dict[Scope, UUID] = {}
    for scope in await ledger.due_scopes(db, now=now):
        verdict = await budget.check(
            db,
            workspace_id=scope.workspace_id,
            project_id=scope.project_id,
            workload=scope.workload,
            now=now,
            memo=memo,
        )
        if verdict.blocked_by is not None:
            holds[scope] = verdict.blocked_by
    return holds


async def dispatch(
    sessions: async_sessionmaker[AsyncSession],
    registry: Registry,
    sender: Sender,
    pauses: ProviderPauses,
    *,
    now: datetime,
    limit: int = DISPATCH_LIMIT,
    per_project: int = DISPATCH_PER_PROJECT,
) -> DispatchReport:
    """One dispatcher tick."""
    async with sessions() as db, db.begin():
        stopped = await ledger.stop_runs_of_projects_not_collecting(db, now=now)
    if not registry.providers:
        return DispatchReport(stopped=stopped)

    async with sessions() as db, db.begin():
        holds = await _holds(db, now=now)
        await ledger.sync_budget_holds(db, holds)

    paused = await pauses.paused(registry.providers)
    async with sessions() as db, db.begin():
        tasks = await ledger.claim_due(
            db,
            now=now,
            paused_providers=sorted(paused),
            held=list(holds),
            providers=registry.providers - paused,
            workloads=registry.workloads,
            limit=limit,
            per_project=per_project,
        )
        # Made before anything is marked: a task that is in no batch is not marked, so it is
        # not left waiting for a message that was never made.
        made = batches(tasks, registry)
        await ledger.mark_dispatched(db, [ref for batch in made for ref in batch.refs], now=now)

    sent = 0
    unsent: list[TaskRef] = []
    for batch in made:
        try:
            # False: a batch of the same tasks holds the key. It is waiting and will take them,
            # or it was lost with the key still held; then the reconciler releases them again
            # and they go once the key has expired.
            await sender.send(batch)
            sent += 1
        except Exception as error:
            _log.warning(
                "batch not sent",
                provider=batch.provider,
                endpoint=batch.endpoint,
                tasks=len(batch.tasks),
                error_kind=type(error).__name__,
            )
            unsent.extend(batch.refs)
    if unsent:
        async with sessions() as db, db.begin():
            await ledger.release(db, unsent)
    return DispatchReport(
        stopped=stopped,
        held=len(holds),
        claimed=len(tasks),
        batches=sent,
        released=len(unsent),
    )
