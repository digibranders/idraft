"""The reconciler and the partition job (docs/21-scheduler-workers.md sections 8.2 and 10).

The reconciler brings the ledger back to what is true, every 5 minutes. Nothing it does depends
on Redis. Each step is its own transaction, and a step that fails is logged and named in the
report while the others go on.

1. A task dispatched 10 minutes ago and still `pending` lost its message, or the message is
   still waiting behind others. It is released and dispatched again. If the old message turns
   up after all, the ledger lets one of the two take the task and the other take nothing.
   Released in batches for up to a minute a pass, so a backlog after Redis was lost comes back
   within a few passes.
2. A task the provider has had longer than it keeps results, or whose submission was never
   confirmed within that time, is `dead`. One never confirmed is charged its share of its
   run's estimate, since the provider may have charged for it.
3. The unsent tasks of a run that ended are `cancelled`, then any task not sent 24 hours after
   its run's window closed.
4. A running run whose tasks have all ended is completed. A cancelled run is given its totals
   once the tasks the provider still had when it was cancelled have ended.

Fetching what providers have finished, and resolving `submit_unknown` by asking the provider,
come with the first real adapter.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors import ledger
from sightline.collectors.registry import Registry

STALE_DISPATCH = timedelta(minutes=10)
# How long a provider keeps a task's result when it does not say. DataForSEO: three days.
RESULT_LIFETIME = timedelta(hours=72)
# The longest one pass spends releasing stale dispatches, and how many it releases at a time.
RELEASE_FOR = timedelta(minutes=1)
RELEASE_BATCH = ledger.DISPATCH_LIMIT
_log = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class ReconcileReport:
    released: int = 0
    dead: int = 0
    run_ended: int = 0
    missed: int = 0
    completed: int = 0
    # Cancelled runs given their totals once their last task ended.
    settled: int = 0
    # Steps that failed in this pass. The next pass tries them again.
    failed: tuple[str, ...] = ()

    @property
    def quiet(self) -> bool:
        return self == ReconcileReport()


async def _release(sessions: async_sessionmaker[AsyncSession], now: datetime) -> int:
    released = 0
    deadline = time.monotonic() + RELEASE_FOR.total_seconds()
    while True:
        async with sessions() as db, db.begin():
            stale = await ledger.stale_dispatches(
                db, older_than=STALE_DISPATCH, now=now, limit=RELEASE_BATCH
            )
            await ledger.release(db, [task.ref for task in stale])
        released += len(stale)
        if len(stale) < RELEASE_BATCH or time.monotonic() >= deadline:
            return released


async def _lifetimes(
    sessions: async_sessionmaker[AsyncSession], registry: Registry
) -> dict[tuple[str, str], timedelta]:
    """The result lifetime of every provider and endpoint with work in flight, where its
    provider is known to this worker."""
    async with sessions() as db:
        endpoints = await ledger.in_flight_endpoints(db)
    lifetimes: dict[tuple[str, str], timedelta] = {}
    for code, endpoint in endpoints:
        if code not in registry.providers:
            continue
        try:
            lifetimes[(code, endpoint)] = registry.provider(code).result_lifetime(endpoint)
        except Exception as error:
            # One adapter's fault is not the others': this endpoint gets the usual lifetime.
            _log.error("result lifetime unknown", provider=code, endpoint=endpoint, exc_info=error)
    return lifetimes


async def reconcile(
    sessions: async_sessionmaker[AsyncSession], registry: Registry, *, now: datetime
) -> ReconcileReport:
    """One pass."""
    counts: dict[str, int] = {}
    failed: list[str] = []

    async def step(name: str, action: Callable[[], Awaitable[int]]) -> None:
        try:
            counts[name] = await action()
        except Exception as error:
            _log.error("reconcile step failed", step=name, exc_info=error)
            failed.append(name)

    async def in_transaction(
        work: Callable[[AsyncSession], Awaitable[int]],
    ) -> int:
        async with sessions() as db, db.begin():
            return await work(db)

    async def end_old() -> int:
        lifetimes = await _lifetimes(sessions, registry)
        return await in_transaction(
            lambda db: ledger.end_old_submissions(
                db, older_than=RESULT_LIFETIME, lifetimes=lifetimes, now=now
            )
        )

    async def close_runs() -> int:
        return await in_transaction(lambda db: ledger.complete_finished_runs(db, now=now))

    await step("released", lambda: _release(sessions, now))
    await step("dead", end_old)
    # A run that ended says why its tasks were not sent; only then is lateness the reason.
    await step(
        "run_ended", lambda: in_transaction(lambda db: ledger.cancel_for_ended_runs(db, now=now))
    )
    await step("missed", lambda: in_transaction(lambda db: ledger.cancel_missed(db, now=now)))
    # Last, so a run whose final tasks were ended above is completed in the same pass.
    await step("completed", close_runs)
    await step("settled", lambda: in_transaction(ledger.settle_cancelled_runs))
    return ReconcileReport(**counts, failed=tuple(failed))


async def ensure_partitions(sessions: async_sessionmaker[AsyncSession]) -> int:
    """Make the monthly partitions of every partitioned table for the months ahead. Returns
    how many were made; most days none."""
    async with sessions() as db, db.begin():
        made: int = (await db.execute(select(func.ops.maintain_partitions()))).scalar_one()
    return made
