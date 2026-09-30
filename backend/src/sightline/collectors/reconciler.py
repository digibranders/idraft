"""The reconciler and the partition job (docs/21-scheduler-workers.md sections 8.2 and 10).

The reconciler brings the ledger back to what is true, every 5 minutes. Nothing it does depends
on Redis: after Redis is lost, one pass finds all the work that was in flight there. Each step
is its own transaction, so one that fails leaves the others done.

1. A task dispatched 10 minutes ago and still `pending` lost its message, or the message is
   still waiting behind others. It is released and dispatched again. If the old message turns
   up after all, the ledger lets one of the two take the task and the other take nothing.
2. A task the provider has had longer than it keeps results, or whose submission was never
   confirmed within that time, is `dead`.
3. A task not sent 24 hours after its run's window closed is `cancelled`, and so are the unsent
   tasks of a run that ended.
4. A running run whose tasks have all ended is completed.

Fetching what providers have finished, and resolving `submit_unknown` by asking the provider,
come with the first real adapter.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors import ledger

STALE_DISPATCH = timedelta(minutes=10)
# How long a provider keeps a task's result. DataForSEO: three days (docs/21 section 8.2).
RESULT_LIFETIME = timedelta(hours=72)


@dataclass(frozen=True, slots=True)
class ReconcileReport:
    released: int = 0
    dead: int = 0
    missed: int = 0
    run_ended: int = 0
    completed: int = 0

    @property
    def quiet(self) -> bool:
        return self == ReconcileReport()


async def reconcile(
    sessions: async_sessionmaker[AsyncSession],
    *,
    now: datetime,
    lifetimes: Mapping[tuple[str, str], timedelta] | None = None,
) -> ReconcileReport:
    """One pass. `lifetimes` gives the result lifetime per provider and endpoint where it is
    not three days."""
    async with sessions() as db, db.begin():
        stale = await ledger.stale_dispatches(db, older_than=STALE_DISPATCH, now=now)
        await ledger.release(db, [task.ref for task in stale])
    async with sessions() as db, db.begin():
        dead = await ledger.end_old_submissions(
            db, older_than=RESULT_LIFETIME, lifetimes=lifetimes, now=now
        )
    async with sessions() as db, db.begin():
        missed = await ledger.cancel_missed(db, now=now)
    async with sessions() as db, db.begin():
        run_ended = await ledger.cancel_for_ended_runs(db, now=now)
    # Last, so a run whose final tasks were ended above is completed in the same pass.
    async with sessions() as db, db.begin():
        completed = await ledger.complete_finished_runs(db, now=now)
    return ReconcileReport(
        released=len(stale),
        dead=dead,
        missed=missed,
        run_ended=run_ended,
        completed=completed,
    )


async def ensure_partitions(sessions: async_sessionmaker[AsyncSession]) -> int:
    """Make the monthly partitions of every partitioned table for the months ahead. Returns
    how many were made; most days none."""
    async with sessions() as db, db.begin():
        made: int = (await db.execute(select(func.ops.maintain_partitions()))).scalar_one()
    return made
