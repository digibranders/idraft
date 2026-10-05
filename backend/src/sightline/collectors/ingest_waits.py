"""What every ingest tick shares: its report, and what to do with an answer that cannot be
ingested now. A task whose answer could not be read from storage or written waits and is tried
again; once it has waited long enough it fails, so its run can finish."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors import ledger
from sightline.collectors.ledger import FetchedTask


@dataclass(frozen=True, slots=True)
class IngestReport:
    ingested: int = 0
    failed: int = 0
    # Whose answer could not be ingested this time: tried again after the retry wait.
    waiting: int = 0

    @property
    def quiet(self) -> bool:
        return self == IngestReport()


async def not_now(
    sessions: async_sessionmaker[AsyncSession],
    tasks: Sequence[FetchedTask],
    *,
    code: str,
    message: str,
    retry: timedelta,
    give_up: timedelta,
) -> tuple[int, int]:
    """Tasks whose answer could not be ingested: those fetched `give_up` ago fail, the others
    wait `retry`. Returns how many wait and how many failed."""
    async with sessions() as db, db.begin():
        now = await ledger.transaction_time(db)
        stale = [task for task in tasks if task.fetched_at <= now - give_up]
        failed = 0
        for task in stale:
            failed += await ledger.ingest_failed(db, task.ref, code=code, message=message, now=now)
        later = await ledger.ingest_later(
            db,
            [task.ref for task in tasks if task not in stale],
            code=code,
            message=message,
            wait=retry,
            now=now,
        )
    return later, failed
