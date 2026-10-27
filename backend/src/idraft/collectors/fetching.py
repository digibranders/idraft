"""Finding what providers have finished and fetching it (docs/06-dataforseo-seo-integration.md
sections 4.2 and 4.3, docs/21-scheduler-workers.md section 8.1).

`poll_ready` asks each provider which of its tasks are finished, moves those from `submitted`
to `ready`, and sends one `fetch_task` for each task that moved; a task listed twice moves once.
It never fetches itself. `fetch_task` fetches one result, keeps its exact bytes in object
storage and moves the task to `fetched`. Both are safe to run twice: every step names the
status it comes from.

A fetch that cannot be made or finds nothing yet puts the task back to `submitted`: the
provider still has it, the next listing or the sweeper asks again, and nothing is sent twice.
Only a result the provider dropped, or a fetch it refuses for good, goes to the retry policy.
"""

from __future__ import annotations

import random
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from types import MappingProxyType
from typing import Final, Literal, Protocol

import structlog
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors import ledger
from idraft.collectors.ledger import FetchOrder, LedgerTask, ReadyMatch, TaskRef
from idraft.collectors.raw_payloads import RawPayload, store_raw_payload
from idraft.collectors.registry import Registry
from idraft.domain.retries import ProviderErrorKind, decide
from idraft.domain.workloads import TaskWorkload
from idraft.providers.contract import ProviderCallError, ProviderError, ReadyTask
from idraft.storage.raw import ObjectStore, RawStorageError, RetentionClass

K = ProviderErrorKind

FETCH_JOB: Final = "fetch_task"
# How long a task the provider has not finished waits before it is asked for directly.
NOT_READY_WAIT: Final = timedelta(minutes=30)
# How long a fetch that may work next time waits.
FETCH_AGAIN_AFTER: Final = timedelta(minutes=5)
PROVIDER_NOT_REGISTERED: Final = "provider_not_registered"
# Failures that no second fetch mends. A result the provider dropped is handled apart.
_FOR_GOOD: Final = frozenset({K.INVALID_REQUEST, K.SCHEMA_MISMATCH})
# How long each workload's raw results are kept (doc 23 section 9.2).
RETENTION_CLASS: Final[Mapping[TaskWorkload, RetentionClass]] = MappingProxyType(
    {
        TaskWorkload.SEO_RANK: "serp_raw",
        TaskWorkload.KEYWORD_METRICS: "serp_raw",
        TaskWorkload.DISCOVERY: "serp_raw",
        TaskWorkload.AI_PROMPT: "ai_raw",
        TaskWorkload.AI_MODE_KEYWORD: "ai_raw",
        TaskWorkload.AI_BENCHMARK: "ai_raw",
        TaskWorkload.GSC_SYNC: "first_party_raw",
        TaskWorkload.BING_SYNC: "first_party_raw",
        TaskWorkload.GA4_SYNC: "first_party_raw",
        TaskWorkload.CLOUDFLARE_SYNC: "first_party_raw",
    }
)
_log = structlog.get_logger(__name__)

FetchOutcome = Literal["fetched", "not_ready", "retry", "failed", "skipped"]


class FetchTask(BaseModel):
    """The message: one task to fetch, under the provider id it was `ready` with."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    task_id: int = Field(ge=1)
    created_at: datetime
    provider: str = Field(min_length=1, max_length=64)
    endpoint: str = Field(min_length=1, max_length=128)
    provider_task_id: str = Field(min_length=1, max_length=128)

    @classmethod
    def of(cls, order: FetchOrder) -> FetchTask:
        return cls(
            task_id=order.ref.id,
            created_at=order.ref.created_at,
            provider=order.provider_code,
            endpoint=order.provider_endpoint,
            provider_task_id=order.provider_task_id,
        )

    @property
    def ref(self) -> TaskRef:
        return TaskRef(id=self.task_id, created_at=self.created_at)

    @property
    def dedupe_key(self) -> str:
        return f"fetch:{self.task_id}:{self.provider_task_id}"


class FetchSender(Protocol):
    async def send(self, order: FetchTask) -> bool:
        """Put the fetch on the queue. False when one for the same task is waiting already."""
        ...


@dataclass(frozen=True, slots=True)
class PollReport:
    listed: int = 0
    ready: int = 0
    # Provider and endpoint pairs whose listing failed this time.
    failed: tuple[str, ...] = ()

    @property
    def quiet(self) -> bool:
        return self == PollReport()


def _matches(listed: Sequence[ReadyTask]) -> list[ReadyMatch]:
    """The listed tasks whose tag names one of ours, whole: task, run and attempt."""
    matches = []
    for task in listed:
        echo = task.echo
        if echo.task_id is None or echo.run_id is None or echo.attempt is None:
            continue
        matches.append(
            ReadyMatch(
                task_id=int(echo.task_id),
                run_id=echo.run_id,
                attempt=echo.attempt,
                provider_task_id=task.provider_task_id,
            )
        )
    return matches


async def send_fetches(
    sessions: async_sessionmaker[AsyncSession],
    sender: FetchSender,
    orders: Sequence[FetchOrder],
    *,
    now: datetime,
) -> int:
    """Send one fetch per task. A task whose fetch could not be sent goes back to `submitted`,
    to be swept at once. Returns how many were sent or already waiting."""
    sent = 0
    for order in orders:
        try:
            await sender.send(FetchTask.of(order))
        except Exception as error:
            _log.warning("fetch not sent", task_id=order.ref.id, error_kind=type(error).__name__)
            async with sessions() as db, db.begin():
                await ledger.not_fetched_yet(
                    db,
                    order.ref,
                    provider_task_id=order.provider_task_id,
                    ask_again_after=timedelta(0),
                    now=now,
                    grows=False,
                )
            continue
        sent += 1
    return sent


async def poll_ready(
    sessions: async_sessionmaker[AsyncSession],
    registry: Registry,
    sender: FetchSender,
    *,
    now: datetime,
) -> PollReport:
    """One look at what the providers have finished."""
    async with sessions() as db:
        endpoints = await ledger.submitted_endpoints(db)
    listed = ready = 0
    failed: list[str] = []
    for code, endpoint in endpoints:
        if code not in registry.providers:
            continue
        try:
            finished = await registry.provider(code).list_ready(endpoint)
        except Exception as error:
            # One provider's trouble is not the others'. Its tasks are listed next time, or
            # swept.
            _log.warning("ready tasks not listed", provider=code, endpoint=endpoint, exc_info=error)
            failed.append(f"{code}/{endpoint}")
            continue
        listed += len(finished)
        async with sessions() as db, db.begin():
            orders = await ledger.mark_ready(db, code, _matches(finished), now=now)
        ready += len(orders)
        await send_fetches(sessions, sender, orders, now=now)
    return PollReport(listed=listed, ready=ready, failed=tuple(failed))


async def fetch_task(
    sessions: async_sessionmaker[AsyncSession],
    registry: Registry,
    store: ObjectStore,
    order: FetchTask,
    *,
    jitter: Callable[[], float] = random.random,
) -> FetchOutcome:
    """Fetch one result and keep it. Returns what became of the task."""
    async with sessions() as db:
        task = await ledger.ready_task(db, order.ref, provider_task_id=order.provider_task_id)
    if task is None:
        # Fetched already, or no longer waiting to be: nothing to ask the provider.
        return "skipped"
    context = {"task_id": order.task_id, "provider": order.provider, "endpoint": order.endpoint}
    if order.provider not in registry.providers:
        # Its credentials were removed while the task was out: kept, for when they are back.
        _log.warning("fetch for a provider this worker does not have", **context)
        await _again(sessions, order, after=NOT_READY_WAIT, code=PROVIDER_NOT_REGISTERED)
        return "retry"
    provider = registry.provider(order.provider)
    try:
        result = await provider.fetch(order.endpoint, order.provider_task_id)
    except ProviderCallError as error:
        return await _failed(sessions, task, order, error.error, jitter=jitter)
    except Exception as error:
        _log.error("fetch failed unclassified", exc_info=error, **context)
        unclassified = ProviderError(kind=K.PROVIDER_ERROR, message=type(error).__name__)
        return await _failed(sessions, task, order, unclassified, jitter=jitter)

    if result.status == "pending":
        await _again(sessions, order, after=NOT_READY_WAIT)
        return "not_ready"
    if result.status != "ready" or result.body is None:
        reason = result.error or ProviderError(kind=K.PROVIDER_ERROR, message="no result")
        # The answer says the task itself failed (a source the provider could not reach):
        # it will never have a result, and is sent again under the retry policy.
        failed_there = reason.kind is K.UPSTREAM_UNAVAILABLE
        return await _failed(sessions, task, order, reason, jitter=jitter, resend=failed_there)
    payload = RawPayload(
        body=result.body,
        content_type=result.content_type,
        provider_code=order.provider,
        provider_endpoint=order.endpoint,
        endpoint_slug=provider.payload_slug(order.endpoint),
        retention_class=RETENTION_CLASS[task.workload],
    )
    return await _keep(sessions, store, order, payload)


async def _keep(
    sessions: async_sessionmaker[AsyncSession],
    store: ObjectStore,
    order: FetchTask,
    payload: RawPayload,
) -> FetchOutcome:
    try:
        payload_id = await store_raw_payload(sessions, store, payload)
    except RawStorageError as error:
        # DataForSEO has handed the result over and no longer lists it as ready, but keeps it
        # for 30 days: the sweeper fetches it again, and the ledger keeps such a task that long.
        _log.warning("result not stored", task_id=order.task_id, error=str(error))
        await _again(
            sessions,
            order,
            after=FETCH_AGAIN_AFTER,
            code=ledger.STORAGE_FAILED,
            message=str(error),
        )
        return "retry"
    async with sessions() as db, db.begin():
        fetched = await ledger.mark_fetched(
            db,
            order.ref,
            provider_task_id=order.provider_task_id,
            raw_payload_id=payload_id,
            now=await ledger.transaction_time(db),
        )
    return "fetched" if fetched else "skipped"


async def _again(
    sessions: async_sessionmaker[AsyncSession],
    order: FetchTask,
    *,
    after: timedelta,
    code: str | None = None,
    message: str | None = None,
) -> None:
    async with sessions() as db, db.begin():
        now = await ledger.transaction_time(db)
        await ledger.not_fetched_yet(
            db,
            order.ref,
            provider_task_id=order.provider_task_id,
            ask_again_after=after,
            now=now,
            code=code,
            message=message,
        )


async def _failed(
    sessions: async_sessionmaker[AsyncSession],
    task: LedgerTask,
    order: FetchTask,
    error: ProviderError,
    *,
    jitter: Callable[[], float],
    resend: bool = False,
) -> FetchOutcome:
    """A fetch that did not bring a result. The retry policy decides when the provider dropped
    the result, refused the fetch for good, or (`resend`) failed the task itself; anything else
    is fetched again later, since the provider may still have the result."""
    if not resend and error.kind is not K.NOT_FOUND_EXPIRED and error.kind not in _FOR_GOOD:
        wait = FETCH_AGAIN_AFTER
        if error.retry_after is not None:
            wait = max(wait, error.retry_after)
        await _again(sessions, order, after=wait, code=error.kind.value, message=error.message)
        return "retry"
    async with sessions() as db, db.begin():
        now = await ledger.transaction_time(db)
        decision = decide(
            error.kind,
            attempts=max(task.attempts, 1),
            jitter=jitter(),
            window_open=now < task.window_end,
        )
        await ledger.fetch_failed(
            db,
            order.ref,
            provider_task_id=order.provider_task_id,
            kind=error.kind,
            message=error.message,
            decision=decision,
            now=now,
        )
    return "failed"
