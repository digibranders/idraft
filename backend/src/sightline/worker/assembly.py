"""What this worker does: its jobs and its ticks.

The one place that knows every part. Each part is built from the context and registered here, so
the process in `app.py` stays the same as parts are added.
"""

from __future__ import annotations

from collections.abc import Sequence

from sightline.worker.app import WorkerContext
from sightline.worker.ticks import Tick


def assemble(context: WorkerContext) -> Sequence[Tick]:
    """Register the jobs on `context.queues` and return the ticks."""
    return ()
