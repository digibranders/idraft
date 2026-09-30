"""The two queues and how messages go on and come off them (docs/21 section 5).

A message carries ids and small keys. It is a Pydantic model, validated when it is received. It
is sent only if its dedupe key was new, and the key is cleared when its handler finishes. A
handler that raises is logged and its message acknowledged: nothing is retried by the queue,
because the queue does not know whether a provider was already paid. The ledger decides what
happens next (the reconciler brings back what is still due).
"""

from __future__ import annotations

import asyncio
import inspect
import time
import typing
from collections.abc import Awaitable, Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from typing import Any, Literal

import structlog
from pydantic import BaseModel, ValidationError
from redis.asyncio import Redis
from taskiq import AsyncTaskiqDecoratedTask
from taskiq.acks import AcknowledgeType
from taskiq.receiver.receiver import Receiver
from taskiq_redis import RedisStreamBroker

QueueName = Literal["collect", "process"]
QUEUE_NAMES: tuple[QueueName, ...] = ("collect", "process")
CONSUMER_GROUP = "sightline"
DEDUPE_PREFIX = "dedupe:"
DEDUPE_TTL = timedelta(hours=1)
# A message a consumer took and never acknowledged goes to another consumer after this long. It
# must exceed the longest handler (120 s for a live call), or a slow handler's message would be
# handed to a second one while the first still runs.
REDELIVER_AFTER = timedelta(minutes=10)
# Acknowledged messages stay in a stream until it is trimmed. Redis has no eviction, so the
# streams are capped; a backlog longer than this loses its oldest messages, and the reconciler
# sends them again from the ledger.
STREAM_MAX_LENGTH = 10_000
_RECONNECT_AFTER_SECONDS = 1.0
_log = structlog.get_logger(__name__)

type Handler[M: BaseModel] = Callable[[M], Awaitable[None]]
type ScheduledHandler = Callable[[], Awaitable[None]]


def _message_type[M: BaseModel](handler: Handler[M]) -> type[BaseModel]:
    """The message model a handler takes, from the annotation of its one parameter."""
    (name,) = inspect.signature(handler).parameters
    found = typing.get_type_hints(handler)[name]
    if not (isinstance(found, type) and issubclass(found, BaseModel)):
        raise TypeError(f"{handler!r} must take one Pydantic model")
    return found


class Queues:
    def __init__(
        self, redis_url: str, redis: Redis, *, redeliver_after: timedelta = REDELIVER_AFTER
    ) -> None:
        self._redis = redis
        self._brokers: dict[QueueName, RedisStreamBroker] = {
            name: RedisStreamBroker(
                redis_url,
                queue_name=name,
                consumer_group_name=CONSUMER_GROUP,
                maxlen=STREAM_MAX_LENGTH,
                idle_timeout=int(redeliver_after.total_seconds() * 1000),
            )
            for name in QUEUE_NAMES
        }
        self._jobs: dict[str, AsyncTaskiqDecoratedTask[Any, Any]] = {}

    def broker(self, queue: QueueName) -> RedisStreamBroker:
        return self._brokers[queue]

    def register[M: BaseModel](self, queue: QueueName, job: str, handler: Handler[M]) -> None:
        """Add a job that producers send with `enqueue`."""

        model = _message_type(handler)

        # The message is validated here and not by Taskiq, which logs the rejected value and
        # then calls the handler with it anyway.
        async def guarded(message: Any, dedupe_key: str) -> None:
            with structlog.contextvars.bound_contextvars(job=job):
                try:
                    try:
                        parsed = model.model_validate(message)
                    except ValidationError as error:
                        _log.error(
                            "message refused",
                            fields=[
                                ".".join(str(part) for part in item["loc"])
                                for item in error.errors()
                            ],
                        )
                        return
                    await handler(parsed)  # type: ignore[arg-type]
                except Exception as error:
                    _log.error("job failed", exc_info=error)
                finally:
                    await self._clear(dedupe_key)

        self._add(queue, job, guarded)

    def register_scheduled(
        self, queue: QueueName, job: str, handler: ScheduledHandler, *, every: timedelta
    ) -> None:
        """Add a job Taskiq's scheduler sends by itself, once every `every`."""
        period = int(every.total_seconds())
        if period < 1:
            raise ValueError("a scheduled job runs at most once a second")

        async def guarded() -> None:
            # One scheduler holds the scheduler lock, but when the lock changes hands two can
            # each send the same run. The first handler to claim the run's slot does it.
            slot = f"{DEDUPE_PREFIX}scheduled:{job}:{int(time.time()) // period}"
            if not await self._redis.set(slot, "1", nx=True, ex=period):
                return
            with structlog.contextvars.bound_contextvars(job=job):
                try:
                    await handler()
                except Exception as error:
                    _log.error("job failed", exc_info=error)

        self._add(queue, job, guarded, schedule=[{"interval": period}])

    def _add(
        self, queue: QueueName, job: str, handler: Callable[..., Awaitable[None]], **labels: Any
    ) -> None:
        if job in self._jobs:
            raise ValueError(f"job {job!r} is registered twice")
        self._jobs[job] = self._brokers[queue].register_task(handler, task_name=job, **labels)

    async def startup(self) -> None:
        for broker in self._brokers.values():
            await broker.startup()

    async def shutdown(self) -> None:
        for broker in self._brokers.values():
            await broker.shutdown()

    async def enqueue(
        self, job: str, message: BaseModel, *, dedupe_key: str, ttl: timedelta = DEDUPE_TTL
    ) -> bool:
        """Send the message unless one with this dedupe key is already waiting or running.

        The key is set before the send. If the send fails the key is cleared again, so the work
        is not blocked until the key expires.
        """
        key = DEDUPE_PREFIX + dedupe_key
        if not await self._redis.set(key, "1", nx=True, ex=int(ttl.total_seconds())):
            return False
        try:
            await self._jobs[job].kiq(message=message, dedupe_key=dedupe_key)
        except BaseException:
            await self._redis.delete(key)
            raise
        return True

    async def is_waiting(self, dedupe_key: str) -> bool:
        """Whether a message with this key is waiting or running, as far as Redis knows."""
        return bool(await self._redis.exists(DEDUPE_PREFIX + dedupe_key))

    async def receive(self, queue: QueueName, *, concurrency: int, finish: asyncio.Event) -> None:
        """Run the queue's handlers, at most `concurrency` at once, until `finish` is set. Then
        stop taking messages and return once the handlers in flight have finished."""
        broker = self._brokers[queue]
        broker.is_worker_process = True
        with ThreadPoolExecutor(max_workers=1) as executor:
            while not finish.is_set():
                receiver = Receiver(
                    broker=broker,
                    executor=executor,
                    max_async_tasks=concurrency,
                    ack_type=AcknowledgeType.WHEN_EXECUTED,
                    run_startup=False,
                )
                try:
                    await receiver.listen(finish)
                except Exception as error:
                    # Redis went away. Messages it still holds come back when it does; the rest
                    # the reconciler sends again.
                    _log.warning("queue listener restarting", queue=queue, exc_info=error)
                    await asyncio.sleep(_RECONNECT_AFTER_SECONDS)

    async def _clear(self, dedupe_key: str) -> None:
        try:
            await self._redis.delete(DEDUPE_PREFIX + dedupe_key)
        except Exception as error:
            # The key expires by itself; until then the reconciler treats the work as in hand.
            _log.warning("dedupe key not cleared", error_kind=type(error).__name__)
