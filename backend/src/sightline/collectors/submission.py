"""`submit_batch`: one provider call for one batch of tasks, and what its answer means for each
(docs/21-scheduler-workers.md sections 5 and 6).

Three steps, and only the middle one is outside a transaction:

1. The tasks leave `pending` for `submit_unknown`, and their requests are built. Committed
   before the call, so a second delivery of the same message takes nothing, and no
   transaction is held open across the network.
2. The provider is called.
3. Each task's outcome is recorded. Accepted: `submitted`, with the provider's id and what it
   cost. Refused: the retry policy decides. Not known (the call timed out, failed in a way the
   adapter did not classify, or the answer left the task out): the task stays
   `submit_unknown`, because the provider may have it and may have charged for it. Sending it
   again could pay twice.
"""

from __future__ import annotations

import random
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from itertools import groupby

import structlog
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors import ledger
from sightline.collectors.dispatcher import ProviderPauses, SubmitBatch
from sightline.collectors.ledger import Cost, LedgerTask
from sightline.collectors.read_only import read_only
from sightline.collectors.registry import Registry
from sightline.domain.retries import ProviderErrorKind, RetryDecision, decide
from sightline.providers.contract import (
    CanonicalRequest,
    ProviderCallError,
    ProviderError,
    SubmitResult,
)

NOT_BUILT = "The request for this task could not be built."
_log = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class SubmitReport:
    submitted: int = 0
    # Refused by the provider or never built: back in line, or ended, as the policy says.
    refused: int = 0
    # The provider may have them. They wait for the provider to be asked.
    unknown: int = 0


async def _take(
    db: AsyncSession, registry: Registry, batch: SubmitBatch, now: datetime
) -> tuple[list[LedgerTask], dict[ledger.TaskRef, CanonicalRequest]]:
    """Step 1: the tasks of the batch that are still to be sent, and their requests."""
    tasks = await ledger.begin_submission(db, batch.refs, now=now)
    requests: dict[ledger.TaskRef, CanonicalRequest] = {}
    async with read_only(db):
        for workload, of_workload in groupby(
            sorted(tasks, key=lambda task: task.workload), key=lambda task: task.workload
        ):
            built = await registry.workload(workload).build_requests(db, list(of_workload))
            requests.update(built)
    return tasks, requests


async def _refuse(
    db: AsyncSession,
    task: LedgerTask,
    error: ProviderError,
    *,
    now: datetime,
    jitter: Callable[[], float],
) -> RetryDecision:
    kind = error.kind
    if kind is ProviderErrorKind.EMPTY_RESULT:
        # Not an answer a submission can give; read as the provider going wrong.
        kind = ProviderErrorKind.PROVIDER_ERROR
    decision = decide(
        kind,
        attempts=task.attempts,
        jitter=jitter(),
        window_open=now < task.window_end,
        retry_after=error.retry_after,
    )
    await ledger.record_failure(
        db, task.ref, kind=kind, message=error.message, decision=decision, now=now
    )
    return decision


async def submit_batch(
    sessions: async_sessionmaker[AsyncSession],
    registry: Registry,
    pauses: ProviderPauses,
    batch: SubmitBatch,
    *,
    jitter: Callable[[], float] = random.random,
) -> SubmitReport:
    """Submit one batch, at most once per task."""
    provider = registry.provider(batch.provider)
    started = await ledger.database_time(sessions)
    async with sessions() as db, db.begin():
        tasks, requests = await _take(db, registry, batch, started)
        not_built = [task for task in tasks if task.ref not in requests]
        for task in not_built:
            await ledger.record_failure(
                db,
                task.ref,
                kind=ProviderErrorKind.INVALID_REQUEST,
                message=NOT_BUILT,
                decision=RetryDecision(status="failed"),
                now=started,
            )
    to_send = [task for task in tasks if task.ref in requests]
    if not to_send:
        return SubmitReport(refused=len(not_built))

    context = {"provider": batch.provider, "endpoint": batch.endpoint, "tasks": len(to_send)}
    result: SubmitResult | None = None
    failure: ProviderError | None = None
    try:
        result = await provider.submit(batch.endpoint, [requests[task.ref] for task in to_send])
    except ProviderCallError as error:
        failure = error.error
    except Exception as error:
        # The adapter did not say what happened, so the request may have arrived.
        _log.error("submission failed unclassified", exc_info=error, **context)
        failure = ProviderError(kind=ProviderErrorKind.TIMEOUT, message=type(error).__name__)

    answered = await ledger.database_time(sessions)
    outcome = _Outcome()
    async with sessions() as db, db.begin():
        if result is not None:
            await outcome.apply(db, to_send, result, now=answered, jitter=jitter)
        elif failure is not None:
            await outcome.apply_to_all(db, to_send, failure, now=answered, jitter=jitter)
    if outcome.pause_reason is not None:
        await pauses.pause(batch.provider, reason=outcome.pause_reason)
        _log.error("provider paused", reason=outcome.pause_reason, **context)
    return SubmitReport(
        submitted=outcome.submitted,
        refused=outcome.refused + len(not_built),
        unknown=outcome.unknown,
    )


@dataclass(slots=True)
class _Outcome:
    submitted: int = 0
    refused: int = 0
    unknown: int = 0
    pause_reason: str | None = None

    async def _refuse(
        self,
        db: AsyncSession,
        task: LedgerTask,
        error: ProviderError,
        *,
        now: datetime,
        jitter: Callable[[], float],
    ) -> None:
        if error.kind is ProviderErrorKind.TIMEOUT:
            await self._unknown(db, [task], error.message)
            return
        decision = await _refuse(db, task, error, now=now, jitter=jitter)
        self.refused += 1
        if decision.pause_provider:
            self.pause_reason = error.kind.value

    async def _unknown(self, db: AsyncSession, tasks: Sequence[LedgerTask], message: str) -> None:
        await ledger.note_unknown_outcome(db, [task.ref for task in tasks], message)
        self.unknown += len(tasks)

    async def apply_to_all(
        self,
        db: AsyncSession,
        tasks: Sequence[LedgerTask],
        error: ProviderError,
        *,
        now: datetime,
        jitter: Callable[[], float],
    ) -> None:
        for task in tasks:
            await self._refuse(db, task, error, now=now, jitter=jitter)

    async def apply(
        self,
        db: AsyncSession,
        tasks: Sequence[LedgerTask],
        result: SubmitResult,
        *,
        now: datetime,
        jitter: Callable[[], float],
    ) -> None:
        by_id = {str(task.ref.id): task for task in tasks}
        answered: set[str] = set()
        for accepted in result.accepted:
            task = by_id.get(accepted.task_id)
            if task is None or accepted.task_id in answered:
                _log.warning("answer for a task not in the batch", task_id=accepted.task_id)
                continue
            answered.add(accepted.task_id)
            cost = (
                None
                if accepted.cost_usd is None
                else Cost(usd=accepted.cost_usd, source="provider_reported")
            )
            await ledger.mark_submitted(
                db, task.ref, provider_task_id=accepted.provider_task_id, cost=cost, now=now
            )
            self.submitted += 1
        for rejected in result.rejected:
            task = by_id.get(rejected.task_id)
            if task is None or rejected.task_id in answered:
                _log.warning("answer for a task not in the batch", task_id=rejected.task_id)
                continue
            answered.add(rejected.task_id)
            await self._refuse(db, task, rejected.error, now=now, jitter=jitter)
        left_out = [task for key, task in by_id.items() if key not in answered]
        if left_out:
            await self._unknown(db, left_out, "The provider's answer did not mention the task.")
