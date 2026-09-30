"""Taskiq's scheduler, run by one worker process at a time (docs/21 sections 5.1 and 10).

The scheduler sends the maintenance jobs on their schedule. Every worker process tries to run
it; the one that holds `lock:taskiq-scheduler` does, and keeps the lock alive while it runs. If
it stops or loses Redis, the lock expires and another process takes over.
"""

from __future__ import annotations

import asyncio
import contextlib
from datetime import timedelta

import structlog
from redis.asyncio import Redis
from taskiq import TaskiqScheduler
from taskiq.api import run_scheduler_task
from taskiq.schedule_sources import LabelScheduleSource
from taskiq_redis import RedisStreamBroker

from sightline.worker.locks import RedisLock

LOCK_NAME = "taskiq-scheduler"
LOCK_TTL = timedelta(seconds=30)
_RENEW_EVERY = LOCK_TTL / 3
_log = structlog.get_logger(__name__)


async def _wait(stop: asyncio.Event, delay: timedelta) -> None:
    with contextlib.suppress(TimeoutError):
        await asyncio.wait_for(stop.wait(), timeout=delay.total_seconds())


async def _stop(task: asyncio.Task[None]) -> None:
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


async def run_scheduler(
    broker: RedisStreamBroker,
    redis: Redis,
    stop: asyncio.Event,
    *,
    lock_ttl: timedelta = LOCK_TTL,
    renew_every: timedelta = _RENEW_EVERY,
) -> None:
    """Hold the scheduler lock and run the scheduler while it is held, until `stop` is set."""
    scheduler = TaskiqScheduler(broker, sources=[LabelScheduleSource(broker)])
    lock = RedisLock(redis, LOCK_NAME, lock_ttl)
    try:
        while not stop.is_set():
            try:
                held = await lock.acquire()
            except Exception as error:
                _log.warning("scheduler lock not reachable", error_kind=type(error).__name__)
                held = False
            if not held:
                await _wait(stop, renew_every)
                continue
            running = asyncio.create_task(run_scheduler_task(scheduler))
            try:
                while not stop.is_set() and not running.done():
                    await _wait(stop, renew_every)
                    if not await lock.extend():
                        # Expired while this process was stalled: another one may hold it now.
                        _log.warning("scheduler lock lost")
                        break
            except Exception as error:
                _log.warning("scheduler lock not reachable", error_kind=type(error).__name__)
            finally:
                if running.done() and not running.cancelled() and running.exception() is not None:
                    _log.error("scheduler stopped", exc_info=running.exception())
                await _stop(running)
    finally:
        with contextlib.suppress(Exception):
            await lock.release()
