"""The cost rollup (plan decision D14; docs/27-cost-model.md): `ops.cost_daily` recomputed from
`ops.provider_cost_events`, day by day (UTC).

Every hour the rollup recomputes today and yesterday (`HOURLY_DAYS`), and once a day the last
`DAILY_DAYS`, so a day missed while the worker was down, or an event committed late, is still
counted; a wider rebuild (a backfill) is the same call with more `days`. Each run computes its
days whole and writes them over what is there, so it is safe to run twice; runs take turns, so
an older one cannot write over a newer one's totals. Cost events are never deleted, so a day's
rows only ever grow. Events without a project (platform overhead) are not a project's cost and
stay out. The worker bypasses row-level security; the rollup covers every workspace on purpose.
"""

from __future__ import annotations

from datetime import UTC, datetime, time, timedelta
from typing import Final

from sqlalchemy import Date, cast, distinct, func, literal, select
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.db.tables import cost_daily, provider_cost_events

HOURLY_DAYS: Final = 2
# More than a month, so a month's last days are whole again in the next one.
DAILY_DAYS: Final = 35
_TURN: Final = "cost_rollup"


async def roll_up_costs(
    sessions: async_sessionmaker[AsyncSession], *, now: datetime, days: int = HOURLY_DAYS
) -> int:
    """Recompute the rows of the last `days` days up to today (UTC). Returns how many rows
    were written."""
    if now.tzinfo is None:
        raise ValueError("`now` must be an aware datetime")
    if days < 1:
        raise ValueError("the rollup covers at least today")
    today = now.astimezone(UTC).date()
    since = datetime.combine(today - timedelta(days=days - 1), time(), tzinfo=UTC)
    until = datetime.combine(today + timedelta(days=1), time(), tzinfo=UTC)
    e = provider_cost_events.c
    day = cast(func.timezone("UTC", e.occurred_at), Date)
    engine = func.coalesce(e.engine_code, literal(""))
    keys = (day, e.workspace_id, e.project_id, e.provider_code, e.endpoint, e.workload, engine)
    summed = (
        select(
            day.label("cost_date"),
            e.workspace_id,
            e.project_id,
            e.provider_code,
            e.endpoint,
            e.workload,
            engine.label("engine_code"),
            func.sum(e.request_count).label("request_count"),
            func.sum(e.cost_usd).label("cost_usd"),
            # A subject is one thing collected about: counted once a day however often it cost.
            func.count(distinct(e.subject_type + ":" + e.subject_id)).label("subjects"),
        )
        .where(
            e.occurred_at >= since,
            e.occurred_at < until,
            e.workspace_id.is_not(None),
            e.project_id.is_not(None),
        )
        .group_by(*keys)
        # Rows are written in key order, so two writers could not deadlock on them.
        .order_by(*keys)
    )
    statement = upsert(cost_daily).from_select(
        [
            "cost_date",
            "workspace_id",
            "project_id",
            "provider_code",
            "endpoint",
            "workload",
            "engine_code",
            "request_count",
            "cost_usd",
            "subjects",
        ],
        summed,
    )
    async with sessions() as db, db.begin():
        # One rollup at a time: a slow run that read earlier could otherwise commit after a
        # newer one and write its older totals.
        await db.execute(
            select(func.pg_advisory_xact_lock(func.hashtextextended(literal(_TURN), 0)))
        )
        written = await db.execute(
            statement.on_conflict_do_update(
                index_elements=[
                    cost_daily.c.cost_date,
                    cost_daily.c.workspace_id,
                    cost_daily.c.project_id,
                    cost_daily.c.provider_code,
                    cost_daily.c.endpoint,
                    cost_daily.c.workload,
                    cost_daily.c.engine_code,
                ],
                set_={
                    "request_count": statement.excluded.request_count,
                    "cost_usd": statement.excluded.cost_usd,
                    "subjects": statement.excluded.subjects,
                },
            ).returning(cost_daily.c.cost_date)
        )
        return len(written.all())
