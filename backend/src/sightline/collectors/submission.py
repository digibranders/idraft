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

Step 3 is where a paid answer could be lost, so it is made hard to lose: each task is recorded
in a savepoint of its own, so one bad row does not sink the batch; the step is tried again
when it fails as a whole (every write in it is conditional on `submit_unknown`, so trying
again cannot record anything twice); and if it still fails, the provider's ids are logged.
"""

from __future__ import annotations

import asyncio
import random
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from functools import partial
from itertools import groupby

import structlog
from sqlalchemy import func, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors import ledger
from sightline.collectors.dispatcher import ProviderPauses, SubmitBatch
from sightline.collectors.ledger import Cost, LedgerTask, TaskRef
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
NO_ANSWER = "The provider's answer did not mention the task."
# Kinds that pause the provider: it refuses everyone, not this batch.
_PAUSING = frozenset(
    {ProviderErrorKind.AUTH, ProviderErrorKind.PAYMENT, ProviderErrorKind.ACCOUNT_LIMIT}
)
# Tries at recording an answer, and the wait before each try after the first.
RECORD_ATTEMPTS = 3
RECORD_RETRY_AFTER_SECONDS = 0.5
_log = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class SubmitReport:
    submitted: int = 0
    # Refused by the provider or never built: back in line, or ended, as the policy says.
    refused: int = 0
    # The provider may have them. They wait for the provider to be asked.
    unknown: int = 0
    # Not sent because the provider is paused: back in line for when the pause is over.
    released: int = 0


async def _clock(db: AsyncSession) -> datetime:
    now: datetime = (await db.execute(select(func.now()))).scalar_one()
    return now


async def _build(
    db: AsyncSession, registry: Registry, tasks: Sequence[LedgerTask]
) -> dict[TaskRef, CanonicalRequest]:
    """The requests of the tasks, workload by workload, with the database read-only.

    A workload that fails, or a request that does not carry its own task's id, leaves those
    tasks out: they are recorded as not built rather than sent again every ten minutes until
    their window runs out. A database error is not the workload's fault, and rolls back.
    """
    requests: dict[TaskRef, CanonicalRequest] = {}

    def workload_of(task: LedgerTask) -> str:
        return task.workload.value

    for name, of_workload in groupby(sorted(tasks, key=workload_of), key=workload_of):
        group = list(of_workload)
        try:
            async with read_only(db):
                built = await registry.workload(group[0].workload).build_requests(db, group)
        except DBAPIError:
            raise
        except Exception as error:
            _log.error("requests not built", workload=name, tasks=len(group), exc_info=error)
            continue
        for task in group:
            request = built.get(task.ref)
            if request is None:
                continue
            if request.task_id != str(task.ref.id) or request.run_id != task.run_id:
                # Answers are matched by this id: a wrong one would put another task's
                # provider id and cost, perhaps another workspace's, on this one.
                _log.error("request names another task", task_id=task.ref.id, workload=name)
                continue
            # The attempt this submission is, so the provider's answer is bound to it.
            requests[task.ref] = request.model_copy(update={"attempt": task.attempts})
    return requests


def _pause_reason(result: SubmitResult | None, failure: ProviderError | None) -> str | None:
    errors = [failure] if failure is not None else []
    if result is not None:
        errors.extend(rejected.error for rejected in result.rejected)
    for error in errors:
        if error.kind in _PAUSING:
            return error.kind.value
    return None


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
    if await pauses.paused([batch.provider]):
        # Sent before the pause began. Back in line; the dispatcher sends them when it is over.
        async with sessions() as db, db.begin():
            await ledger.release(db, batch.refs)
        return SubmitReport(released=len(batch.tasks))

    async with sessions() as db, db.begin():
        started = await _clock(db)
        tasks = await ledger.begin_submission(db, batch.refs, now=started)
        requests = await _build(db, registry, tasks)
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
        _log.warning(
            "provider refused the call", kind=failure.kind.value, message=failure.message, **context
        )
    except Exception as error:
        # The adapter did not say what happened, so the request may have arrived.
        _log.error("submission failed unclassified", exc_info=error, **context)
        failure = ProviderError(kind=ProviderErrorKind.TIMEOUT, message=type(error).__name__)

    # Before the outcome is recorded, so the tasks it puts back in line are not claimed
    # again in the moment between.
    pause_reason = _pause_reason(result, failure)
    if pause_reason is not None:
        try:
            await pauses.pause(batch.provider, reason=pause_reason)
        except Exception as error:
            _log.warning("provider not paused", error_kind=type(error).__name__, **context)
        _log.error("provider paused", reason=pause_reason, **context)

    outcome = await _record(sessions, to_send, result, failure, jitter=jitter, context=context)
    return SubmitReport(
        submitted=outcome.submitted,
        refused=outcome.refused + len(not_built),
        unknown=outcome.unknown,
    )


async def _record(
    sessions: async_sessionmaker[AsyncSession],
    tasks: Sequence[LedgerTask],
    result: SubmitResult | None,
    failure: ProviderError | None,
    *,
    jitter: Callable[[], float],
    context: dict[str, object],
) -> _Outcome:
    """Step 3, tried again if it fails as a whole."""
    accepted = {
        answer.task_id: answer.provider_task_id
        for answer in (result.accepted if result is not None else ())
    }
    for attempt in range(1, RECORD_ATTEMPTS + 1):
        outcome = _Outcome(jitter=jitter)
        try:
            async with sessions() as db, db.begin():
                now = await _clock(db)
                if result is not None:
                    await outcome.apply(db, tasks, result, now=now)
                elif failure is not None:
                    await outcome.apply_to_all(db, tasks, failure, now=now)
        except asyncio.CancelledError:
            # Stopped (the handler's time limit, or the worker stopping): what the provider
            # said is kept here all the same.
            _log.error("answer not recorded", accepted=accepted, reason="cancelled", **context)
            raise
        except Exception as error:
            if attempt == RECORD_ATTEMPTS:
                # The tasks stay `submit_unknown`. What the provider said is kept here, so
                # its paid tasks can still be found.
                _log.error("answer not recorded", accepted=accepted, exc_info=error, **context)
                raise
            _log.warning("answer not recorded, trying again", attempt=attempt, **context)
            await asyncio.sleep(RECORD_RETRY_AFTER_SECONDS * attempt)
            continue
        return outcome
    raise AssertionError("unreachable")  # pragma: no cover


@dataclass(slots=True)
class _Outcome:
    jitter: Callable[[], float]
    submitted: int = 0
    refused: int = 0
    unknown: int = 0
    seen: set[str] = field(default_factory=set)

    async def _one(
        self,
        db: AsyncSession,
        task: LedgerTask,
        record: Callable[[], Awaitable[bool]],
        **details: object,
    ) -> bool:
        """Record one task's outcome in its own savepoint. A task whose row cannot be written
        stays `submit_unknown`, and the others are recorded all the same. False for that, and
        for a task no longer waiting for this answer; both are logged with what the provider
        said, so a task it may charge for can still be found."""
        try:
            async with db.begin_nested():
                recorded = await record()
        except Exception as error:
            _log.error("outcome not recorded", task_id=task.ref.id, exc_info=error, **details)
            self.unknown += 1
            return False
        if not recorded:
            # Recorded already, on a try whose commit reply was lost, and the task has moved
            # on since: a later attempt is under way and this answer is not for it.
            _log.error(
                "answer for an attempt that is over",
                task_id=task.ref.id,
                attempt=task.attempts,
                **details,
            )
        return recorded

    async def _refuse(
        self, db: AsyncSession, task: LedgerTask, error: ProviderError, message: str, now: datetime
    ) -> None:
        if error.kind is ProviderErrorKind.TIMEOUT:
            await self._unknown(db, [task], message)
            return
        kind = error.kind
        if kind is ProviderErrorKind.EMPTY_RESULT:
            # Not an answer a submission can give; read as the provider going wrong.
            kind = ProviderErrorKind.PROVIDER_ERROR
        decision = decide(
            kind,
            attempts=task.attempts,
            jitter=self.jitter(),
            window_open=now < task.window_end,
            retry_after=error.retry_after,
        )

        record = partial(
            ledger.record_failure,
            db,
            task.ref,
            kind=kind,
            message=message,
            decision=decision,
            now=now,
            attempt=task.attempts,
        )
        if await self._one(db, task, record, refused=kind.value):
            self.refused += 1

    async def _unknown(self, db: AsyncSession, tasks: Sequence[LedgerTask], message: str) -> None:
        await ledger.note_unknown_outcome(db, [task.ref for task in tasks], message)
        self.unknown += len(tasks)

    async def apply_to_all(
        self, db: AsyncSession, tasks: Sequence[LedgerTask], error: ProviderError, *, now: datetime
    ) -> None:
        """The call failed as a whole. The provider's message may quote any request of the
        batch, and a batch holds tasks of several workspaces: each task gets a message that
        names only what happened. The provider's own words are in the log."""
        if error.kind is ProviderErrorKind.TIMEOUT:
            message = "No answer from the provider; it may have the task."
        else:
            message = f"The provider refused the whole call ({error.kind.value})."
        for task in tasks:
            await self._refuse(db, task, error, message, now)

    async def apply(
        self, db: AsyncSession, tasks: Sequence[LedgerTask], result: SubmitResult, *, now: datetime
    ) -> None:
        by_id = {str(task.ref.id): task for task in tasks}
        for accepted in result.accepted:
            task = by_id.get(accepted.task_id)
            if task is None or accepted.task_id in self.seen:
                # A provider task we may be paying for and cannot put on a task of ours.
                _log.error(
                    "accepted task not matched",
                    task_id=accepted.task_id,
                    provider_task_id=accepted.provider_task_id,
                    cost_usd=None if accepted.cost_usd is None else str(accepted.cost_usd),
                    reason="named twice" if task is not None else "not in the batch",
                )
                continue
            self.seen.add(accepted.task_id)
            cost = (
                None
                if accepted.cost_usd is None
                else Cost(usd=accepted.cost_usd, source="provider_reported")
            )
            submit = partial(
                ledger.mark_submitted,
                db,
                task.ref,
                provider_task_id=accepted.provider_task_id,
                cost=cost,
                now=now,
                attempt=task.attempts,
            )
            details = {
                "provider_task_id": accepted.provider_task_id,
                "cost_usd": None if accepted.cost_usd is None else str(accepted.cost_usd),
            }
            if await self._one(db, task, submit, **details):
                self.submitted += 1
        for rejected in result.rejected:
            task = by_id.get(rejected.task_id)
            if task is None or rejected.task_id in self.seen:
                _log.warning(
                    "rejected task not matched",
                    task_id=rejected.task_id,
                    reason="already answered" if task is not None else "not in the batch",
                )
                continue
            self.seen.add(rejected.task_id)
            # About this task alone, so its own words are kept.
            await self._refuse(db, task, rejected.error, rejected.error.message, now)
        left_out = [task for key, task in by_id.items() if key not in self.seen]
        if left_out:
            await self._unknown(db, left_out, NO_ANSWER)
