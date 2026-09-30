"""What this worker does: its jobs and its ticks.

The one place that knows every part. Each part is built from the context and registered here, so
the process in `app.py` stays the same as parts are added.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import asdict
from datetime import timedelta

import structlog

from sightline.collectors.dispatcher import SubmitBatch, dispatch
from sightline.collectors.ledger import database_time
from sightline.collectors.planner import plan_due
from sightline.collectors.registry import Registry
from sightline.collectors.submission import submit_batch
from sightline.worker.app import WorkerContext
from sightline.worker.pauses import RedisPauses
from sightline.worker.queues import Queues
from sightline.worker.ticks import Tick

# docs/21-scheduler-workers.md sections 3 and 4: the planner every 60 seconds, the dispatcher
# every 15, each under a lock that expires just before its next run.
PLANNER_EVERY = timedelta(seconds=60)
PLANNER_LOCK = timedelta(seconds=55)
DISPATCHER_EVERY = timedelta(seconds=15)
DISPATCHER_LOCK = timedelta(seconds=14)
SUBMIT_JOB = "submit_batch"
_log = structlog.get_logger(__name__)


def production_registry() -> Registry:
    """The workloads and providers of this worker. None yet: the first arrive with the
    DataForSEO client and rank collection, and until then the worker plans nothing and
    spends nothing."""
    return Registry()


class _QueueSender:
    """The dispatcher's way onto the `collect` queue."""

    def __init__(self, queues: Queues) -> None:
        self._queues = queues

    async def send(self, batch: SubmitBatch) -> bool:
        return await self._queues.enqueue(SUBMIT_JOB, batch, dedupe_key=batch.dedupe_key)


def assemble(context: WorkerContext, registry: Registry | None = None) -> Sequence[Tick]:
    """Register the jobs on `context.queues` and return the ticks."""
    parts = production_registry() if registry is None else registry
    pauses = RedisPauses(context.redis)
    sender = _QueueSender(context.queues)

    async def submit(batch: SubmitBatch) -> None:
        report = await submit_batch(context.sessions, parts, pauses, batch)
        _log.info("batch submitted", provider=batch.provider, **asdict(report))

    context.queues.register("collect", SUBMIT_JOB, submit)

    async def plan() -> None:
        now = await database_time(context.sessions)
        report = await plan_due(context.sessions, parts, now=now)
        if not report.quiet:
            _log.info("planner tick", **asdict(report))

    async def send() -> None:
        now = await database_time(context.sessions)
        report = await dispatch(context.sessions, parts, sender, pauses, now=now)
        if not report.quiet:
            _log.info("dispatcher tick", **asdict(report))

    return (
        Tick(name="planner", interval=PLANNER_EVERY, action=plan, lock_ttl=PLANNER_LOCK),
        Tick(name="dispatcher", interval=DISPATCHER_EVERY, action=send, lock_ttl=DISPATCHER_LOCK),
    )
