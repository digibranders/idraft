"""What an AI task costs by the price book (docs/27-cost-model.md section 1; docs/07 section
7.1). Prices are global, read in any transaction."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.db.tables import provider_price_book
from idraft.domain.ai_engines import ENGINES, PROVIDER_CODE, Queue


async def task_prices(db: AsyncSession, *, queue: Queue, on: date) -> dict[str, Decimal]:
    """The price of one task on each engine's endpoint and this queue, valid on `on`, by
    endpoint. An endpoint the book has no price for is left out:
    an estimate is never made from a guess of zero."""
    p = provider_price_book.c
    rows = await db.execute(
        select(p.endpoint, p.unit_price_usd, p.conditions)
        .where(
            p.provider_code == PROVIDER_CODE,
            p.endpoint.in_(sorted(engine.endpoint for engine in ENGINES.values())),
            p.price_unit == "task",
            p.valid_from <= on,
            (p.valid_to.is_(None)) | (p.valid_to > on),
        )
        # The newest row for a price wins, whatever order the database returns them in.
        .order_by(p.valid_from, p.unit_price_usd)
    )
    found: dict[str, Decimal] = {}
    for row in rows:
        if (row.conditions or {}).get("queue") == queue:
            found[row.endpoint] = Decimal(row.unit_price_usd)
    return found
