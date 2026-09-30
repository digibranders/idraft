"""The worker process: two queue receivers, the ticks and the scheduler, in one event loop
(docs/21-scheduler-workers.md sections 5.1 and 12).

Stopping is orderly. When `stop` is set the ticks and the scheduler finish what they are doing
and end; then the receivers stop taking messages and wait for the handlers in flight; then the
connections close. Anything cut short by a crash is brought back from the ledger by the
reconciler, not by this code.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import timedelta

import structlog
from redis.asyncio import BlockingConnectionPool, Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from sightline.config.settings import Settings
from sightline.db.engine import create_engine, create_session_factory
from sightline.worker.queues import Queues
from sightline.worker.scheduler import run_scheduler
from sightline.worker.ticks import Tick, run_tick

REDIS_TIMEOUT_SECONDS = 5.0
# Connections beyond one per handler: ticks, locks, pauses, the scheduler and its claims.
REDIS_CONNECTIONS_SPARE = 20
# How long a stopping worker lets its ticks finish. A tick is short statements under the lock
# timeout; one that runs longer than this at a stop is cut off, and its transaction rolls back.
STOP_TICKS_WITHIN = timedelta(seconds=30)
HEARTBEAT_EVERY = timedelta(seconds=10)
_HEALTH_TIMEOUT_SECONDS = 5.0
_log = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class WorkerContext:
    """What the worker's jobs and ticks are built from."""

    settings: Settings
    engine: AsyncEngine
    sessions: async_sessionmaker[AsyncSession]
    redis: Redis
    queues: Queues


# Registers the worker's jobs on `context.queues` and returns its ticks.
type Assemble = Callable[[WorkerContext], Sequence[Tick]]


def _heartbeat(context: WorkerContext) -> Tick | None:
    path = context.settings.heartbeat_file
    if path is None:
        # A container whose healthcheck reads the file would show unhealthy with no reason.
        _log.warning("no heartbeat file is set: this worker reports no health")
        return None

    async def beat() -> None:
        # Touched only while both stores answer, so a worker cut off from either reads as
        # unhealthy to the container healthcheck.
        async with asyncio.timeout(_HEALTH_TIMEOUT_SECONDS):
            await context.redis.ping()
            async with context.engine.connect() as connection:
                await connection.execute(text("SELECT 1"))
        path.touch()

    return Tick(name="heartbeat", interval=HEARTBEAT_EVERY, action=beat)


async def _first_to_end(stop: asyncio.Event, tasks: Sequence[asyncio.Task[None]]) -> bool:
    """Wait until the process is asked to stop, or until a part of it ends by itself. True
    when a part ended by itself."""
    stopping = asyncio.create_task(stop.wait())
    try:
        await asyncio.wait([stopping, *tasks], return_when=asyncio.FIRST_COMPLETED)
    finally:
        stopping.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await stopping
    if stop.is_set():
        # Asked to stop. Parts that are already done ended because of that.
        return False
    for task in tasks:
        if task.done():
            error = None if task.cancelled() else task.exception()
            _log.error("worker part ended", part=task.get_name(), exc_info=error)
    return True


async def _finish(tasks: Sequence[asyncio.Task[None]], *, within: timedelta) -> None:
    """Let the ticks and the scheduler end what they are doing. One that is still at it after
    `within` is cut off: it would otherwise hold the process until the container is killed,
    with handlers in flight."""
    if not tasks:
        return
    _, late = await asyncio.wait(tasks, timeout=within.total_seconds())
    for task in late:
        _log.warning("worker part cut off at stop", part=task.get_name())
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


async def run_worker(settings: Settings, assemble: Assemble, stop: asyncio.Event) -> bool:
    """Run until `stop` is set, then shut down in order. False when it was not asked to stop
    and a part of it ended by itself: the process exits with an error so it is started again."""
    engine = create_engine(settings)
    # A pool that makes a caller wait for a connection. The default one raises when all are
    # in use, which a burst of sends would hit.
    redis = Redis(
        connection_pool=BlockingConnectionPool.from_url(
            settings.redis_url.get_secret_value(),
            max_connections=settings.collect_concurrency
            + settings.process_concurrency
            + REDIS_CONNECTIONS_SPARE,
            timeout=REDIS_TIMEOUT_SECONDS,
            socket_connect_timeout=REDIS_TIMEOUT_SECONDS,
            socket_timeout=REDIS_TIMEOUT_SECONDS,
        )
    )
    queues = Queues(settings.redis_url.get_secret_value(), redis)
    context = WorkerContext(
        settings=settings,
        engine=engine,
        sessions=create_session_factory(engine),
        redis=redis,
        queues=queues,
    )
    ticks = [tick for tick in (_heartbeat(context), *assemble(context)) if tick is not None]
    finish = asyncio.Event()
    try:
        await queues.startup()
        background = [
            asyncio.create_task(run_tick(tick, redis, stop), name=f"tick:{tick.name}")
            for tick in ticks
        ]
        background.append(asyncio.create_task(run_scheduler(queues, redis, stop), name="scheduler"))
        receivers = [
            asyncio.create_task(
                queues.receive("collect", concurrency=settings.collect_concurrency, finish=finish),
                name="receiver:collect",
            ),
            asyncio.create_task(
                queues.receive("process", concurrency=settings.process_concurrency, finish=finish),
                name="receiver:process",
            ),
        ]
        _log.info("worker started", ticks=[tick.name for tick in ticks])
        part_ended = await _first_to_end(stop, [*background, *receivers])
        # A part that ended by itself leaves a worker that looks alive and does half its job:
        # stop the whole process and let the container be restarted.
        stop.set()
        # From here no new message is taken. The handlers in flight finish while the ticks
        # and the scheduler end what they are doing.
        finish.set()
        await _finish(background, within=STOP_TICKS_WITHIN)
        await asyncio.gather(*receivers, return_exceptions=True)
        _log.info("worker stopped")
        return not part_ended
    finally:
        with contextlib.suppress(Exception):
            await queues.shutdown()
        with contextlib.suppress(Exception):
            # The pool was made here, so it is closed here: the client alone would leave it.
            await redis.aclose(close_connection_pool=True)
        await engine.dispose()
