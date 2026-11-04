"""What each worker process tells the rest of the system about itself (the full health report,
`GET /api/internal/health`).

The API cannot see the task ledger: it connects as a role bound to one workspace at a time. The
worker bypasses row-level security, so every few seconds it keeps a small report in Redis: that it
is alive, since when, and how collection stands across all workspaces. The key expires on its own,
so a worker that stops, or loses Redis, simply disappears from the report.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from typing import Final

from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

STATUS_PREFIX: Final = "health:worker:"
STATUS_EVERY: Final = timedelta(seconds=30)
# Three missed reports and the worker is gone from the report.
STATUS_TTL: Final = timedelta(seconds=90)

# The ledger is partitioned by month, so a look at the last 35 days stays on two partitions.
_COLLECTION = text(
    """
    SELECT count(*) FILTER (
               WHERE status IN ('pending', 'submit_unknown', 'submitted', 'ready', 'fetched')
           ) AS open_tasks,
           extract(epoch FROM now() - min(scheduled_for) FILTER (
               WHERE status IN ('pending', 'submit_unknown', 'submitted', 'ready', 'fetched')
                 AND scheduled_for <= now()
           )) AS oldest_due_age_s,
           count(*) FILTER (
               WHERE status IN ('failed', 'dead') AND completed_at >= now() - interval '24 hours'
           ) AS failed_24h,
           max(completed_at) FILTER (WHERE status = 'ingested') AS last_ingested_at
    FROM ops.collection_tasks
    WHERE created_at >= date_trunc('month', now() - interval '35 days')
    """
)


@dataclass(frozen=True, slots=True)
class WorkerStatus:
    instance: str
    pid: int
    started_at: str
    reported_at: str
    # Collection across every workspace, as the ledger has it.
    open_tasks: int
    oldest_due_age_s: int | None
    failed_24h: int
    last_ingested_at: str | None
    # Whether this worker has a provider to send to (DataForSEO login set).
    provider_registered: bool


def status_key(instance: str, pid: int) -> str:
    return f"{STATUS_PREFIX}{instance}:{pid}"


async def collect(
    sessions: async_sessionmaker[AsyncSession],
    *,
    instance: str,
    started_at: datetime,
    provider_registered: bool,
) -> WorkerStatus:
    async with sessions() as db:
        row = (await db.execute(_COLLECTION)).one()
    oldest = row.oldest_due_age_s
    last = row.last_ingested_at
    return WorkerStatus(
        instance=instance,
        pid=os.getpid(),
        started_at=started_at.astimezone(UTC).isoformat(),
        reported_at=datetime.now(UTC).isoformat(),
        open_tasks=int(row.open_tasks),
        oldest_due_age_s=None if oldest is None else max(0, int(oldest)),
        failed_24h=int(row.failed_24h),
        last_ingested_at=None if last is None else last.astimezone(UTC).isoformat(),
        provider_registered=provider_registered,
    )


async def publish(redis: Redis, status: WorkerStatus) -> None:
    await redis.set(
        status_key(status.instance, status.pid),
        json.dumps(asdict(status)),
        px=int(STATUS_TTL.total_seconds() * 1000),
    )
