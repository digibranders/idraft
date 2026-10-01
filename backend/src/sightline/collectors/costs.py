"""The hourly cost rollup (plan decision D14; docs/27-cost-model.md): `ops.cost_daily` for
today and yesterday (UTC), recomputed from `ops.provider_cost_events`.

Each run computes the two days whole and writes them over what is there, so it is safe to run
twice, and an event recorded late for either day is counted on the next run. Cost events are
never deleted, so a day's rows only ever grow. Events without a project (platform overhead)
are not a project's cost and stay out. The worker bypasses row-level security; the rollup
covers every workspace on purpose.
"""

from __future__ import annotations

from datetime import UTC, datetime, time, timedelta

from sqlalchemy import Date, cast, distinct, func, literal, select
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.db.tables import cost_daily, provider_cost_events

DAYS = 2


async def roll_up_costs(sessions: async_sessionmaker[AsyncSession], *, now: datetime) -> int:
    """Recompute today's and yesterday's rows (UTC). Returns how many rows were written."""
    if now.tzinfo is None:
        raise ValueError("`now` must be an aware datetime")
    today = now.astimezone(UTC).date()
    since = datetime.combine(today - timedelta(days=DAYS - 1), time(), tzinfo=UTC)
    until = datetime.combine(today + timedelta(days=1), time(), tzinfo=UTC)
    e = provider_cost_events.c
    day = cast(func.timezone("UTC", e.occurred_at), Date)
    engine = func.coalesce(e.engine_code, literal(""))
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
            # A subject is one thing collected about: counted once however often it cost.
            func.count(distinct(e.subject_type + ":" + e.subject_id)).label("subjects"),
        )
        .where(
            e.occurred_at >= since,
            e.occurred_at < until,
            e.workspace_id.is_not(None),
            e.project_id.is_not(None),
        )
        .group_by(
            day, e.workspace_id, e.project_id, e.provider_code, e.endpoint, e.workload, engine
        )
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
