"""Taskiq's scheduler, run by one worker process at a time (docs/21 sections 5.1 and 10).

The scheduler sends the maintenance jobs on their schedule. Every worker process tries to run
it; the one that holds `lock:taskiq-scheduler` does, and keeps the lock alive while it runs. If
it stops, loses Redis or its scheduler ends, the lock is given up or expires and another process
takes over.
"""

from __future__ import annotations

import asyncio
import contextlib
from datetime import timedelta

import structlog
from redis.asyncio import Redis
from taskiq import TaskiqScheduler
from taskiq.api import run_scheduler_task

from sightline.worker.locks import RedisLock
from sightline.worker.queues import SCHEDULED_QUEUE, Queues
from sightline.worker.ticks import wait_or_stop

LOCK_NAME = "taskiq-scheduler"
LOCK_TTL = timedelta(seconds=30)
_RENEW_EVERY = LOCK_TTL / 3
_log = structlog.get_logger(__name__)


async def _end(scheduling: asyncio.Task[None]) -> None:
    """Stop the scheduler if it still runs, and say so if it had ended by itself. Never raises:
    the caller goes on to give the lock up and try again."""
    ended_by_itself = scheduling.done()
    scheduling.cancel()
    try:
        await scheduling
    except asyncio.CancelledError:
        current = asyncio.current_task()
        if not scheduling.cancelled() or (current is not None and current.cancelling()):
            # It is this task that is being cancelled, not only the scheduler.
            raise
    except Exception as error:
        _log.error("scheduler ended", exc_info=error)
    else:
        if ended_by_itself:
            _log.error("scheduler ended")


async def run_scheduler(
    queues: Queues,
    redis: Redis,
    stop: asyncio.Event,
    *,
    lock_ttl: timedelta = LOCK_TTL,
    renew_every: timedelta = _RENEW_EVERY,
) -> None:
    """Hold the scheduler lock and run the scheduler while it is held, until `stop` is set."""
    broker = queues.broker(SCHEDULED_QUEUE)
    scheduler = TaskiqScheduler(broker, sources=[queues.schedule_source()])
    lock = RedisLock(redis, LOCK_NAME, lock_ttl)
    while not stop.is_set():
        try:
            held = await lock.acquire()
        except Exception as error:
            _log.warning("scheduler lock not reachable", error_kind=type(error).__name__)
            held = False
        if held:
            scheduling = asyncio.create_task(run_scheduler_task(scheduler))
            try:
                while not stop.is_set() and not scheduling.done():
                    await wait_or_stop(stop, renew_every.total_seconds())
                    if not await lock.extend():
                        # Expired while this process was stalled: another one may hold it now.
                        _log.warning("scheduler lock lost")
                        break
            except Exception as error:
                _log.warning("scheduler lock not reachable", error_kind=type(error).__name__)
            finally:
                await _end(scheduling)
                # Given up at once, so another process need not wait for it to expire.
                with contextlib.suppress(Exception):
                    await lock.release()
        # Not held, or lost, or the scheduler ended: a moment before the next try.
        await wait_or_stop(stop, renew_every.total_seconds())
