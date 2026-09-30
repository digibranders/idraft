"""What this worker does: its jobs and its ticks.

The one place that knows every part. Each part is built from the context and registered here, so
the process in `app.py` stays the same as parts are added.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

from sightline.collectors.planner import plan_due
from sightline.collectors.registry import Registry
from sightline.worker.app import WorkerContext
from sightline.worker.ticks import Tick

# docs/21-scheduler-workers.md section 3: every 60 seconds, under a lock of 55.
PLANNER_EVERY = timedelta(seconds=60)
PLANNER_LOCK = timedelta(seconds=55)


def production_registry() -> Registry:
    """The workloads this worker plans. None yet: the first arrives with rank collection, and
    until then the worker plans nothing and spends nothing."""
    return Registry()


def assemble(context: WorkerContext, registry: Registry | None = None) -> Sequence[Tick]:
    """Register the jobs on `context.queues` and return the ticks."""
    workloads = production_registry() if registry is None else registry

    async def plan() -> None:
        await plan_due(context.sessions, workloads, now=datetime.now(UTC))

    return (Tick(name="planner", interval=PLANNER_EVERY, action=plan, lock_ttl=PLANNER_LOCK),)
