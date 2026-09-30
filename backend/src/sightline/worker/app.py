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
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from sightline.config.settings import Settings
from sightline.db.engine import create_engine, create_session_factory
from sightline.worker.queues import Queues
from sightline.worker.scheduler import run_scheduler
from sightline.worker.ticks import Tick, run_tick

REDIS_TIMEOUT_SECONDS = 5.0
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


async def _first_to_end(stop: asyncio.Event, tasks: Sequence[asyncio.Task[None]]) -> None:
    """Wait until the process is asked to stop, or until a part of it ends by itself."""
    stopping = asyncio.create_task(stop.wait())
    try:
        await asyncio.wait([stopping, *tasks], return_when=asyncio.FIRST_COMPLETED)
    finally:
        stopping.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await stopping
    for task in tasks:
        if task.done() and not task.cancelled() and task.exception() is not None:
            _log.error("worker part ended", part=task.get_name(), exc_info=task.exception())


async def run_worker(settings: Settings, assemble: Assemble, stop: asyncio.Event) -> None:
    """Run until `stop` is set, then shut down in order."""
    engine = create_engine(settings)
    redis = Redis.from_url(
        settings.redis_url.get_secret_value(),
        socket_connect_timeout=REDIS_TIMEOUT_SECONDS,
        socket_timeout=REDIS_TIMEOUT_SECONDS,
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
        background.append(
            asyncio.create_task(
                run_scheduler(queues.broker("process"), redis, stop), name="scheduler"
            )
        )
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
        await _first_to_end(stop, [*background, *receivers])
        # A part that ended by itself leaves a worker that looks alive and does half its job:
        # stop the whole process and let the container be restarted.
        stop.set()
        await asyncio.gather(*background, return_exceptions=True)
        finish.set()
        await asyncio.gather(*receivers, return_exceptions=True)
        _log.info("worker stopped")
    finally:
        with contextlib.suppress(Exception):
            await queues.shutdown()
        with contextlib.suppress(Exception):
            await redis.aclose()
        await engine.dispose()
