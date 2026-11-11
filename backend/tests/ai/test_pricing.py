"""AI task prices by the price book (docs/07 section 7.1; migration 0018)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.ai.pricing import task_prices
from idraft.domain.ai_engines import ENGINES


async def test_each_engine_has_a_task_price_on_each_queue(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    async with sessions() as db:
        standard = await task_prices(db, queue="standard", on=date(2026, 11, 11))
        priority = await task_prices(db, queue="priority", on=date(2026, 11, 11))
        live = await task_prices(db, queue="live", on=date(2026, 11, 11))
        before = await task_prices(db, queue="standard", on=date(2026, 6, 30))

    endpoints = [engine.endpoint for engine in ENGINES.values()]
    assert standard == dict.fromkeys(endpoints, Decimal("0.0012"))
    assert priority == dict.fromkeys(endpoints, Decimal("0.0024"))
    # No live price is in the book, and none before the prices were valid: no guess of zero.
    assert live == before == {}
