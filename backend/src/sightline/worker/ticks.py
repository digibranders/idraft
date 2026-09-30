"""Work the worker does on an interval: the planner, the dispatcher, the heartbeat
(docs/21-scheduler-workers.md sections 3, 4 and 12).

A tick keeps no state between runs. With two worker processes, each interval still has one run:
the lock lasts almost the whole interval and is not released when the run finishes, only when
the process stops, so a restarted worker does not wait for it to expire.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import timedelta

import structlog
from redis.asyncio import Redis

from sightline.worker.locks import RedisLock

_log = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class Tick:
    name: str
    interval: timedelta
    action: Callable[[], Awaitable[None]]
    # None: every process runs it (the heartbeat). Otherwise one process per interval does.
    lock_ttl: timedelta | None = None

    def __post_init__(self) -> None:
        if self.lock_ttl is not None and self.lock_ttl >= self.interval:
            raise ValueError("a tick's lock must expire before its next run is due")


async def wait_or_stop(stop: asyncio.Event, seconds: float) -> None:
    """Sleep, or return at once when the process is asked to stop."""
    if seconds <= 0:
        return
    try:
        await asyncio.wait_for(stop.wait(), timeout=seconds)
    except TimeoutError:
        return


async def run_tick(tick: Tick, redis: Redis, stop: asyncio.Event) -> None:
    """Run the tick on its interval until `stop` is set. A run that raises is logged and the
    next one still happens: one bad run must not end planning for good."""
    lock = None if tick.lock_ttl is None else RedisLock(redis, tick.name, tick.lock_ttl)
    try:
        while not stop.is_set():
            started = time.monotonic()
            try:
                if lock is None or await lock.acquire():
                    await tick.action()
            except Exception as error:
                _log.error("tick failed", tick=tick.name, exc_info=error)
            await wait_or_stop(stop, tick.interval.total_seconds() - (time.monotonic() - started))
    finally:
        if lock is not None:
            try:
                await lock.release()
            except Exception as error:
                # Redis is gone; the lock expires by itself.
                _log.warning("lock not released", tick=tick.name, error_kind=type(error).__name__)
