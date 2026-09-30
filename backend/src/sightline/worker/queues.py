"""The two queues and how messages go on and come off them (docs/21 section 5).

A message carries ids and small keys. It is a Pydantic model, checked when it is sent and when
it is received. It is sent only if its dedupe key was new, and the key is cleared when its
handler finishes. A handler that raises is logged and its message acknowledged: nothing is
retried by the queue, because the queue does not know whether a provider was already paid. The
ledger decides what happens next (the reconciler brings back what is still due).

The queues are Redis streams read through Taskiq. How a stream is read is ours (`_Stream`), for
four reasons the broker of taskiq-redis does not cover:

- It takes one message at a time. Taken a hundred at a time, the messages a stopping worker
  had not started yet would sit with a consumer that never returns.
- It claims the messages of a consumer that died on a timer, not only after a new message
  arrived.
- It makes the consumer group again when Redis comes back empty. Redis holds nothing that
  cannot be rebuilt, so it may be wiped; the worker must then read again without a restart.
- It waits out a Redis that does not answer instead of ending. A listener that ends is
  replaced, and the handlers it had started would run on beside the new one's, over the
  queue's concurrency.
"""

from __future__ import annotations

import asyncio
import inspect
import time
import typing
from collections.abc import AsyncGenerator, Awaitable, Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from typing import Any, Literal

import structlog
from pydantic import BaseModel, ValidationError
from redis.asyncio import Redis
from redis.exceptions import RedisError, ResponseError
from taskiq import AckableMessage, AsyncTaskiqDecoratedTask, ScheduledTask
from taskiq.acks import AcknowledgeType
from taskiq.exceptions import ScheduledTaskCancelledError
from taskiq.receiver.receiver import Receiver
from taskiq.schedule_sources import LabelScheduleSource
from taskiq_redis import RedisStreamBroker

QueueName = Literal["collect", "process"]
QUEUE_NAMES: tuple[QueueName, ...] = ("collect", "process")
# Jobs the scheduler sends go to this queue: maintenance is `process` work.
SCHEDULED_QUEUE: QueueName = "process"
CONSUMER_GROUP = "sightline"
DEDUPE_PREFIX = "dedupe:"
DEDUPE_TTL = timedelta(hours=1)
# A message a consumer took and never acknowledged goes to another consumer after this long. It
# must exceed the longest handler (120 s for a live call), or a slow handler's message would be
# handed to a second one while the first still runs.
REDELIVER_AFTER = timedelta(minutes=10)
# How often a busy consumer looks for such messages. An idle one looks every time it finds
# nothing new.
CLAIM_EVERY = timedelta(seconds=30)
# Acknowledged messages stay in a stream until it is trimmed. Redis has no eviction, so the
# streams are capped; a backlog longer than this loses its oldest messages. The reconciler
# sends their work again from the ledger once their dedupe keys have expired.
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


class _Stream(RedisStreamBroker):
    """A queue: the stream broker of taskiq-redis, read the way the module docstring says."""

    def __init__(self, url: str, queue: QueueName, *, redeliver_after: timedelta) -> None:
        super().__init__(
            url,
            queue_name=queue,
            consumer_group_name=CONSUMER_GROUP,
            # From the start of the stream: what was sent before the first worker read is
            # work too.
            consumer_id="0",
            maxlen=STREAM_MAX_LENGTH,
            idle_timeout=int(redeliver_after.total_seconds() * 1000),
        )
        self._claim_at = 0.0

    async def _take(self, redis: Redis) -> list[tuple[Any, Any]]:
        """The next message: one a dead consumer left, when it is time to look, or a new one."""
        if time.monotonic() >= self._claim_at:
            claim: Any = await redis.xautoclaim(
                self.queue_name,
                self.consumer_group_name,
                self.consumer_name,
                min_idle_time=self.idle_timeout,
                count=1,
            )
            # The reply is the next id to scan from, the messages claimed, and the ids of
            # messages that were pending and are gone from the stream.
            if claim[1]:
                # There may be more: look again before reading anything new.
                return list(claim[1])
            self._claim_at = time.monotonic() + CLAIM_EVERY.total_seconds()
        fetched: Any = await redis.xreadgroup(
            self.consumer_group_name,
            self.consumer_name,
            {self.queue_name: ">"},
            block=self.block,
            count=1,
        )
        if not fetched:
            # Nothing new within the blocking time: an idle consumer looks for left messages.
            self._claim_at = 0.0
            return []
        return list(fetched[0][1])

    async def listen(self) -> AsyncGenerator[AckableMessage]:
        async with Redis(connection_pool=self.connection_pool) as redis:
            while True:
                try:
                    messages = await self._take(redis)
                except ResponseError as error:
                    if "NOGROUP" in str(error):
                        # Redis came back empty: the stream and its group are made again.
                        _log.warning("queue made again", queue=self.queue_name)
                        await self._declare_consumer_group()
                    else:
                        _log.error("queue read refused", queue=self.queue_name, exc_info=error)
                        await asyncio.sleep(_RECONNECT_AFTER_SECONDS)
                    continue
                except (RedisError, OSError) as error:
                    # Redis does not answer. What it holds comes back when it does; the rest
                    # the reconciler sends again.
                    _log.warning(
                        "queue not reachable",
                        queue=self.queue_name,
                        error_kind=type(error).__name__,
                    )
                    await asyncio.sleep(_RECONNECT_AFTER_SECONDS)
                    continue
                for message_id, fields in messages:
                    # A message trimmed from the stream while it was pending has no fields.
                    if fields and b"data" in fields:
                        yield AckableMessage(
                            data=fields[b"data"],
                            ack=self._ack_generator(id=message_id, queue_name=self.queue_name),
                        )


class _OncePerPeriod(LabelScheduleSource):
    """The scheduled jobs, each sent at most once in half its period.

    One scheduler holds the scheduler lock, but when the lock changes hands two can each send
    the same run, and a scheduler that starts sends every interval job at once. The claim is
    made when the run is sent, so a run that waits in a busy queue does not take the place of
    the next one.
    """

    def __init__(self, broker: _Stream, redis: Redis, periods: dict[str, timedelta]) -> None:
        super().__init__(broker)
        self._redis = redis
        self._periods = periods

    async def pre_send(self, task: ScheduledTask) -> None:
        half = int(self._periods[task.task_name].total_seconds() * 1000) // 2
        try:
            claimed = await self._redis.set(
                f"{DEDUPE_PREFIX}scheduled:{task.task_name}", "1", nx=True, px=half
            )
        except (RedisError, OSError) as error:
            _log.warning(
                "scheduled run not sent", job=task.task_name, error_kind=type(error).__name__
            )
            claimed = False
        if not claimed:
            raise ScheduledTaskCancelledError


class Queues:
    def __init__(
        self, redis_url: str, redis: Redis, *, redeliver_after: timedelta = REDELIVER_AFTER
    ) -> None:
        self._redis = redis
        self._brokers: dict[QueueName, _Stream] = {
            name: _Stream(redis_url, name, redeliver_after=redeliver_after) for name in QUEUE_NAMES
        }
        self._jobs: dict[str, AsyncTaskiqDecoratedTask[Any, Any]] = {}
        self._models: dict[str, type[BaseModel]] = {}
        self._periods: dict[str, timedelta] = {}

    def broker(self, queue: QueueName) -> RedisStreamBroker:
        return self._brokers[queue]

    def schedule_source(self) -> _OncePerPeriod:
        """What Taskiq's scheduler reads the scheduled jobs from."""
        return _OncePerPeriod(self._brokers[SCHEDULED_QUEUE], self._redis, self._periods)

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
        self._models[job] = model

    def register_scheduled(
        self,
        job: str,
        handler: ScheduledHandler,
        *,
        every: timedelta | None = None,
        cron: str | None = None,
    ) -> None:
        """Add a job Taskiq's scheduler sends by itself: once every `every`, or at the times a
        five-field `cron` expression names, in UTC ("10 0 * * *" is ten past midnight)."""
        if (every is None) == (cron is None):
            raise ValueError("a scheduled job has an interval or a cron expression, one of them")
        if every is not None:
            if every < timedelta(seconds=1):
                raise ValueError("a scheduled job runs at most once a second")
            schedule: dict[str, Any] = {"interval": int(every.total_seconds())}
            period = every
        else:
            schedule = {"cron": cron}
            # Cron times are whole minutes.
            period = timedelta(minutes=1)

        async def guarded() -> None:
            with structlog.contextvars.bound_contextvars(job=job):
                try:
                    await handler()
                except Exception as error:
                    _log.error("job failed", exc_info=error)

        self._add(SCHEDULED_QUEUE, job, guarded, schedule=[schedule])
        self._periods[job] = period

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
        if not isinstance(message, self._models[job]):
            raise TypeError(f"job {job!r} takes a {self._models[job].__name__}")
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
        stop taking messages and return once the handlers in flight have finished.

        Redis going away does not end this: the stream waits it out. If it does end before
        `finish` is set, something is wrong with the listener itself, and the caller stops the
        process rather than run a second listener beside the first one's handlers.
        """
        broker = self._brokers[queue]
        broker.is_worker_process = True
        with ThreadPoolExecutor(max_workers=1) as executor:
            receiver = Receiver(
                broker=broker,
                executor=executor,
                max_async_tasks=concurrency,
                # As many taken ahead as are running, no more: what is taken and not started
                # is what a stopping worker leaves behind.
                max_prefetch=0,
                ack_type=AcknowledgeType.WHEN_EXECUTED,
                run_startup=False,
            )
            await receiver.listen(finish)

    async def _clear(self, dedupe_key: str) -> None:
        try:
            await self._redis.delete(DEDUPE_PREFIX + dedupe_key)
        except Exception as error:
            # The key expires by itself; until then the reconciler treats the work as in hand.
            _log.warning("dedupe key not cleared", error_kind=type(error).__name__)
