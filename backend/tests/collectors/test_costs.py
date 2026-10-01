"""The hourly cost rollup (plan decision D14): `ops.cost_daily` for today and yesterday (UTC),
recomputed from the cost events. As `app_worker`."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors.costs import roll_up_costs
from tests.api.auth.support import execute, fetch
from tests.collectors.support import Project, another_project, empty_ledger, make_tenant
from tests.conftest import PostgresServer

Ledger = async_sessionmaker[AsyncSession]
# Mid-afternoon, so an hour either way stays on the same day.
NOW = datetime.now(UTC).replace(hour=15, minute=0, second=0, microsecond=0)
DAY = timedelta(days=1)


async def _event(
    pg: PostgresServer,
    project: Project | None,
    cost: str,
    *,
    when: datetime = NOW,
    workload: str = "keyword_metrics",
    endpoint: str = "dataforseo_labs/google/keyword_overview",
    engine: str | None = None,
    subject: str | None = "k1:en",
    source: str = "provider_reported",
    workspace_id: Any = None,
) -> None:
    await execute(
        pg,
        "INSERT INTO ops.provider_cost_events (occurred_at, workspace_id, project_id, "
        "provider_code, endpoint, workload, channel, engine_code, subject_type, subject_id, "
        "request_count, cost_usd, cost_source, billing_period) VALUES ($1, $2, $3, "
        "'dataforseo', $4, $5, 'research', $6, 'keyword', $7, 1, $8, $9, $10)",
        when,
        workspace_id if project is None else project.workspace_id,
        None if project is None else project.id,
        endpoint,
        workload,
        engine,
        subject,
        Decimal(cost),
        source,
        when.date().replace(day=1),
    )


async def _daily(pg: PostgresServer) -> list[tuple[Any, ...]]:
    rows = await fetch(
        pg,
        "SELECT cost_date, project_id, endpoint, workload, engine_code, request_count, cost_usd, "
        "subjects FROM ops.cost_daily ORDER BY cost_date, project_id, endpoint",
    )
    return [tuple(row) for row in rows]


async def test_today_and_yesterday_are_summed_per_project_endpoint_and_workload(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    await empty_ledger(migrated)
    await execute(migrated, "TRUNCATE ops.cost_daily")
    project = await make_tenant(migrated)
    other = await another_project(migrated, project)
    await _event(migrated, project, "0.000120", subject="k1:en")
    await _event(migrated, project, "0.000120", subject="k2:en")
    # The same subject twice is one subject.
    await _event(migrated, project, "0.000120", subject="k2:en", source="price_book_estimate")
    await _event(migrated, project, "0.012000", subject=None, when=NOW - DAY)
    await _event(migrated, other, "0.000600", endpoint="serp/google/organic", workload="seo_rank")
    # Older than yesterday: left as the rollup found it.
    await _event(migrated, project, "1.000000", when=NOW - 3 * DAY)
    # No project: platform overhead, not a project's cost.
    await _event(migrated, None, "5.000000", workspace_id=project.workspace_id)

    written = await roll_up_costs(worker_db, now=NOW)

    assert written == 3
    today, yesterday = NOW.date(), (NOW - DAY).date()
    labs = "dataforseo_labs/google/keyword_overview"
    assert sorted(await _daily(migrated), key=lambda row: (row[0], str(row[1]))) == sorted(
        [
            (yesterday, project.id, labs, "keyword_metrics", "", 1, Decimal("0.012000"), 0),
            (today, project.id, labs, "keyword_metrics", "", 3, Decimal("0.000360"), 2),
            (today, other.id, "serp/google/organic", "seo_rank", "", 1, Decimal("0.000600"), 1),
        ],
        key=lambda row: (row[0], str(row[1])),
    )


async def test_a_wider_rebuild_counts_days_the_hourly_rollup_missed(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    await empty_ledger(migrated)
    await execute(migrated, "TRUNCATE ops.cost_daily")
    project = await make_tenant(migrated)
    await _event(migrated, project, "0.000600", when=NOW - 3 * DAY, engine="google")

    hourly = await roll_up_costs(worker_db, now=NOW)
    rebuilt = await roll_up_costs(worker_db, now=NOW, days=5)

    assert (hourly, rebuilt) == (0, 1)
    ((day, _, _, _, engine, _, cost, _),) = await _daily(migrated)
    assert (day, engine, cost) == ((NOW - 3 * DAY).date(), "google", Decimal("0.000600"))


async def test_the_rollup_covers_at_least_today(worker_db: Ledger) -> None:
    with pytest.raises(ValueError, match="today"):
        await roll_up_costs(worker_db, now=NOW, days=0)
    with pytest.raises(ValueError, match="aware"):
        await roll_up_costs(worker_db, now=NOW.replace(tzinfo=None))


async def test_running_twice_gives_the_same_rows_and_a_late_event_is_picked_up(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    await empty_ledger(migrated)
    await execute(migrated, "TRUNCATE ops.cost_daily")
    project = await make_tenant(migrated)
    await _event(migrated, project, "0.000120")

    await roll_up_costs(worker_db, now=NOW)
    once = await _daily(migrated)
    await roll_up_costs(worker_db, now=NOW)
    twice = await _daily(migrated)
    # An event recorded late, for earlier today.
    await _event(migrated, project, "0.000120", when=NOW - timedelta(hours=2), subject="k9:en")
    await roll_up_costs(worker_db, now=NOW + timedelta(hours=1))

    assert once == twice
    ((_, _, _, _, _, requests, cost, subjects),) = await _daily(migrated)
    assert (requests, cost, subjects) == (2, Decimal("0.000240"), 2)
