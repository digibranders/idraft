"""The database, read-only, for code the collectors call but do not own.

A workload plans runs and builds provider requests through the worker's session, as `app_worker`,
which bypasses row-level security. What it wrote there would commit with the ledger's own
writes, in any workspace. While it runs, the transaction is read-only.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@asynccontextmanager
async def read_only(db: AsyncSession) -> AsyncIterator[None]:
    """Inside the block the transaction cannot write. After it, it can again, and the caller's
    earlier work is untouched: the block is a savepoint that is always rolled back, which is
    what ends the read-only setting. A block that reads has nothing to keep."""
    savepoint = await db.begin_nested()
    try:
        await db.execute(text("SET LOCAL transaction_read_only = on"))
        yield
    finally:
        await savepoint.rollback()
