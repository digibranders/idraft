"""A batch sent to a live endpoint (DataForSEO Labs): asked and answered in one call, so its
tasks go from `submit_unknown` straight to `fetched` (plan decision D6).

The answer is stored once as a raw payload, and every task of the call names it, with its share
of what the call cost. A task whose call failed goes to the retry policy; a timeout is an
attempt like any other, because a live call leaves nothing to fetch later. An answer that could
not be stored is lost: its tasks go to the retry policy too, and are paid for again when they
are sent again.

Recording is made hard to lose, as for task submissions: each task in its own savepoint, the
whole step tried again when it fails, and what was paid for logged when it still fails.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors import ledger
from idraft.collectors.fetching import RETENTION_CLASS
from idraft.collectors.ledger import Cost, LedgerTask
from idraft.collectors.raw_payloads import RawPayload, store_raw_payload
from idraft.domain.retries import ProviderErrorKind, RetryDecision, decide
from idraft.providers.contract import (
    CanonicalRequest,
    LiveResult,
    Provider,
    ProviderCallError,
    ProviderError,
)
from idraft.providers.dataforseo.serp import SERP_ORGANIC_LIVE
from idraft.storage.raw import ObjectStore, RawStorageError

K = ProviderErrorKind

# A live search is paid for by the call, and a call that failed may still have been charged
# with no cost event to show it (a read timeout), so a few are tried twice at most, not as
# often as the policy allows. A person can ask again.
MAX_LIVE_ATTEMPTS: Final = {SERP_ORGANIC_LIVE: 2}

NO_ANSWER = "The provider's answer did not mention the task."
NOT_STORED = "The answer could not be stored; the task is asked for again."
RECORD_ATTEMPTS = 3
RECORD_RETRY_AFTER_SECONDS = 0.5
_log = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class LiveOutcome:
    fetched: int = 0
    # Failed, or answered and not stored: back in line, or ended, as the policy says.
    refused: int = 0
    # Whose row could not be written; they stay `submit_unknown` for the reconciler.
    unknown: int = 0
    # The errors of the call, for the caller to pause the provider on.
    errors: tuple[ProviderError, ...] = ()


async def call_live(
    provider: Provider,
    endpoint: str,
    tasks: Sequence[LedgerTask],
    requests: Mapping[ledger.TaskRef, CanonicalRequest],
    *,
    context: Mapping[str, object],
) -> list[LiveResult]:
    """Ask the provider; a call that fails as a whole fails every task of it."""
    try:
        return list(await provider.live(endpoint, [requests[task.ref] for task in tasks]))
    except ProviderCallError as error:
        failure = error.error
        _log.warning(
            "live call refused", kind=failure.kind.value, message=failure.message, **context
        )
    except Exception as error:
        _log.error("live call failed unclassified", exc_info=error, **context)
        failure = ProviderError(kind=K.TIMEOUT, message=type(error).__name__)
    return [LiveResult(task_id=str(task.ref.id), status="failed", error=failure) for task in tasks]


async def _store(
    sessions: async_sessionmaker[AsyncSession],
    store: ObjectStore,
    provider: Provider,
    endpoint: str,
    tasks: Sequence[LedgerTask],
    results: Sequence[LiveResult],
    context: Mapping[str, object],
) -> dict[bytes, int | None]:
    """Each distinct answer stored once: its payload id, or None when it could not be."""
    workload_of = {str(task.ref.id): task.workload for task in tasks}
    stored: dict[bytes, int | None] = {}
    for result in results:
        if result.body is None or result.body in stored or result.task_id not in workload_of:
            continue
        payload = RawPayload(
            body=result.body,
            content_type=result.content_type,
            provider_code=provider.code,
            provider_endpoint=endpoint,
            endpoint_slug=provider.payload_slug(endpoint),
            retention_class=RETENTION_CLASS[workload_of[result.task_id]],
        )
        try:
            stored[result.body] = await store_raw_payload(sessions, store, payload)
        except RawStorageError as error:
            _log.error("live answer not stored", error=str(error), **context)
            stored[result.body] = None
    return stored


async def record_live(
    sessions: async_sessionmaker[AsyncSession],
    store: ObjectStore,
    provider: Provider,
    endpoint: str,
    tasks: Sequence[LedgerTask],
    results: Sequence[LiveResult],
    *,
    jitter: Callable[[], float],
    context: Mapping[str, object],
) -> LiveOutcome:
    """Keep the answers, then record what became of each task."""
    payloads = await _store(sessions, store, provider, endpoint, tasks, results, context)
    by_task = {result.task_id: result for result in results}
    paid = {
        result.task_id: str(result.cost_usd)
        for result in results
        if result.status == "ready" and result.cost_usd is not None
    }
    for attempt in range(1, RECORD_ATTEMPTS + 1):
        try:
            async with sessions() as db, db.begin():
                now: datetime = (await db.execute(select(func.now()))).scalar_one()
                counts = _Counts()
                for task in tasks:
                    await _record_one(
                        db,
                        task,
                        by_task.get(str(task.ref.id)),
                        payloads,
                        now,
                        jitter=jitter,
                        counts=counts,
                    )
        except asyncio.CancelledError:
            _log.error("live answer not recorded", paid=paid, reason="cancelled", **context)
            raise
        except Exception as error:
            if attempt == RECORD_ATTEMPTS:
                # The tasks stay `submit_unknown`; what was paid for is kept here.
                _log.error("live answer not recorded", paid=paid, exc_info=error, **context)
                raise
            _log.warning("live answer not recorded, trying again", attempt=attempt, **context)
            await asyncio.sleep(RECORD_RETRY_AFTER_SECONDS * attempt)
            continue
        errors = tuple(r.error for r in results if r.error is not None)
        return LiveOutcome(
            fetched=counts.fetched, refused=counts.refused, unknown=counts.unknown, errors=errors
        )
    raise AssertionError("unreachable")  # pragma: no cover


@dataclass(slots=True)
class _Counts:
    fetched: int = 0
    refused: int = 0
    unknown: int = 0


async def _record_one(
    db: AsyncSession,
    task: LedgerTask,
    result: LiveResult | None,
    payloads: Mapping[bytes, int | None],
    now: datetime,
    *,
    jitter: Callable[[], float],
    counts: _Counts,
) -> None:
    """One task's outcome, in a savepoint of its own: a row that cannot be written stays
    `submit_unknown`, and the others are recorded all the same."""
    try:
        async with db.begin_nested():
            if result is not None and result.status == "ready" and result.body is not None:
                payload_id = payloads.get(result.body)
                if payload_id is not None:
                    cost = (
                        None
                        if result.cost_usd is None
                        else Cost(usd=result.cost_usd, source="provider_reported")
                    )
                    if await ledger.mark_live_fetched(
                        db,
                        task.ref,
                        attempt=task.attempts,
                        raw_payload_id=payload_id,
                        cost=cost,
                        now=now,
                    ):
                        counts.fetched += 1
                    return
                error = ProviderError(kind=K.PROVIDER_ERROR, message=NOT_STORED)
            elif result is None or result.error is None:
                error = ProviderError(kind=K.PROVIDER_ERROR, message=NO_ANSWER)
            else:
                error = result.error
            if await _fail(db, task, error, now, jitter=jitter):
                counts.refused += 1
    except Exception as failure:
        _log.error("live outcome not recorded", task_id=task.ref.id, exc_info=failure)
        counts.unknown += 1


def _message(error: ProviderError) -> str:
    """What the task records. A live call holds keywords of several workspaces and the
    provider's words may quote any of them, so each task gets a message that names only what
    happened; the provider's own words are in the log."""
    if error.message in (NO_ANSWER, NOT_STORED):
        return error.message
    if error.kind is K.TIMEOUT:
        return "No answer from the provider; the task is asked for again."
    if error.kind is K.NOT_SENT:
        return "Not sent: the provider could not be called just now."
    return f"The provider refused the call ({error.kind.value})."


async def _fail(
    db: AsyncSession,
    task: LedgerTask,
    error: ProviderError,
    now: datetime,
    *,
    jitter: Callable[[], float],
) -> bool:
    kind = error.kind
    if kind is K.EMPTY_RESULT:
        # Not an answer a call can give; read as the provider going wrong.
        kind = K.PROVIDER_ERROR
    decision = decide(
        kind,
        attempts=max(task.attempts, 1),
        jitter=jitter(),
        window_open=now < task.window_end,
        retry_after=error.retry_after,
    )
    cap = MAX_LIVE_ATTEMPTS.get(task.provider_endpoint)
    if (
        cap is not None
        and decision.status == "pending"
        and decision.counts
        and task.attempts >= cap
    ):
        # Ended: a live call that failed may have been paid for, and nothing records that.
        decision = RetryDecision(status="failed")
    return await ledger.record_failure(
        db,
        task.ref,
        kind=kind,
        message=_message(error),
        decision=decision,
        now=now,
        attempt=task.attempts,
        live=True,
    )
