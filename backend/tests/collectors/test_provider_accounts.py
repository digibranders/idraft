"""The balance check and the daily cost reconcile (rank collection plan Task 10, decision R11):
what `user_data` says against our own books."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest
from redis.asyncio import Redis

from sightline.collectors.provider_accounts import (
    AccountSource,
    balance_key,
    check_balance,
    reconcile_costs,
    reconciliation_key,
    severity_for,
    spend_key,
)
from sightline.providers.dataforseo.provider import AccountState
from tests.api.auth.support import execute, fetch
from tests.collectors.rank_support import Ledger
from tests.conftest import PostgresServer

NOW = datetime(2026, 10, 6, 12, 0, tzinfo=UTC)
TODAY = NOW.date()
YESTERDAY = TODAY - timedelta(days=1)
CODE = "dataforseo"


class FakeAccount:
    def __init__(self, balance: str, spent_today: str | None = "0") -> None:
        self.state = AccountState(
            balance_usd=Decimal(balance),
            calls_per_minute=2000,
            spent_today_usd=None if spent_today is None else Decimal(spent_today),
        )
        self.reads = 0

    async def account_state(self) -> AccountState:
        self.reads += 1
        return self.state


@pytest.fixture
async def redis(redis_url: str) -> AsyncIterator[Redis]:
    client = Redis.from_url(redis_url)
    await client.flushdb()
    yield client
    await client.flushdb()
    await client.aclose()


@pytest.fixture(autouse=True)
async def clean_books(migrated: PostgresServer) -> None:
    await execute(migrated, "TRUNCATE ops.cost_daily")
    await execute(migrated, "TRUNCATE ops.provider_cost_events")


async def _spend(pg: PostgresServer, day: date, usd: str) -> None:
    """A day's cost in the rollup, as the hourly rollup leaves it."""
    await execute(
        pg,
        "INSERT INTO ops.cost_daily (cost_date, workspace_id, project_id, provider_code, "
        "endpoint, workload, request_count, cost_usd, subjects) "
        "VALUES ($1, gen_random_uuid(), gen_random_uuid(), 'dataforseo', "
        "'serp/google/organic', 'seo_rank', 1, $2, 1)",
        day,
        Decimal(usd),
    )


async def _event(pg: PostgresServer, at: datetime, usd: str, *, provider: str = CODE) -> None:
    await execute(
        pg,
        "INSERT INTO ops.provider_cost_events (occurred_at, provider_code, endpoint, workload, "
        "channel, cost_usd, cost_source, billing_period) "
        "VALUES ($1, $2, 'serp/google/organic', 'seo_rank', 'seo', $3, 'provider_reported', $4)",
        at,
        provider,
        Decimal(usd),
        at.date().replace(day=1),
    )


def test_the_runway_is_judged_by_days_left() -> None:
    assert severity_for(None) == "ok"
    assert severity_for(Decimal(14)) == "ok"
    assert severity_for(Decimal("13.9")) == "warning"
    assert severity_for(Decimal(5)) == "warning"
    assert severity_for(Decimal("4.9")) == "critical"


async def test_the_balance_is_measured_in_days_of_the_trailing_weeks_spend(
    worker_db: Ledger, migrated: PostgresServer, redis: Redis
) -> None:
    # $70 over the seven whole days before today is $10 a day; today's spend is not in it.
    for offset in range(1, 8):
        await _spend(migrated, TODAY - timedelta(days=offset), "10")
    await _spend(migrated, TODAY, "99")
    await _spend(migrated, TODAY - timedelta(days=8), "99")
    account = FakeAccount("100", spent_today="3.5")

    report = await check_balance(worker_db, redis, account, provider_code=CODE, now=NOW)

    assert (report.trailing_spend_usd, report.daily_average_usd) == (Decimal(70), Decimal(10))
    assert report.days_remaining == Decimal(10)
    assert report.severity == "warning"
    kept = json.loads(await redis.get(balance_key(CODE)) or "{}")
    assert (kept["balance_usd"], kept["severity"], kept["checked_at"]) == (
        "100",
        "warning",
        NOW.isoformat(),
    )
    reading = json.loads(await redis.get(spend_key(CODE, TODAY)) or "{}")
    assert (reading["spent_usd"], reading["read_at"]) == ("3.5", NOW.isoformat())


async def test_a_balance_is_judged_by_how_low_it_is(
    worker_db: Ledger, migrated: PostgresServer, redis: Redis
) -> None:
    for offset in range(1, 8):
        await _spend(migrated, TODAY - timedelta(days=offset), "10")

    healthy = await check_balance(worker_db, redis, FakeAccount("500"), provider_code=CODE, now=NOW)
    critical = await check_balance(worker_db, redis, FakeAccount("40"), provider_code=CODE, now=NOW)

    assert (healthy.severity, critical.severity) == ("ok", "critical")
    assert critical.days_remaining == Decimal(4)


async def test_an_account_that_has_spent_nothing_does_not_run_down(
    worker_db: Ledger, redis: Redis
) -> None:
    report = await check_balance(
        worker_db, redis, FakeAccount("5", spent_today=None), provider_code=CODE, now=NOW
    )

    assert (report.days_remaining, report.daily_average_usd, report.severity) == (None, None, "ok")
    # A provider that did not say what was spent leaves no reading to reconcile.
    assert await redis.get(spend_key(CODE, TODAY)) is None


async def test_a_naive_clock_is_refused(worker_db: Ledger, redis: Redis) -> None:
    source: AccountSource = FakeAccount("5")
    with pytest.raises(ValueError, match="aware"):
        await check_balance(
            worker_db, redis, source, provider_code=CODE, now=datetime(2026, 10, 6, 12, 0)
        )


async def test_the_last_reading_of_the_day_is_the_days_spend(
    worker_db: Ledger, migrated: PostgresServer, redis: Redis
) -> None:
    morning = datetime(2026, 10, 5, 8, 0, tzinfo=UTC)
    late = datetime(2026, 10, 5, 23, 50, tzinfo=UTC)
    await check_balance(
        worker_db, redis, FakeAccount("90", spent_today="1.00"), provider_code=CODE, now=morning
    )
    await check_balance(
        worker_db, redis, FakeAccount("85", spent_today="4.20"), provider_code=CODE, now=late
    )

    reading = json.loads(await redis.get(spend_key(CODE, date(2026, 10, 5))) or "{}")

    assert (reading["spent_usd"], reading["read_at"]) == ("4.20", late.isoformat())


async def test_the_difference_is_reported_per_day_and_running_twice_counts_nothing_twice(
    worker_db: Ledger, migrated: PostgresServer, redis: Redis
) -> None:
    read_at = datetime(2026, 10, 5, 23, 50, tzinfo=UTC)
    await redis.set(
        spend_key(CODE, YESTERDAY),
        json.dumps({"spent_usd": "10.00", "read_at": read_at.isoformat()}),
    )
    await _event(migrated, datetime(2026, 10, 5, 3, 0, tzinfo=UTC), "6.00")
    await _event(migrated, datetime(2026, 10, 5, 20, 0, tzinfo=UTC), "3.00")
    # After the reading, the day before it and another provider's are not this comparison.
    await _event(migrated, datetime(2026, 10, 5, 23, 55, tzinfo=UTC), "50")
    await _event(migrated, datetime(2026, 10, 4, 23, 59, tzinfo=UTC), "50")
    await _event(migrated, datetime(2026, 10, 5, 4, 0, tzinfo=UTC), "50", provider="internal")

    first = await reconcile_costs(worker_db, redis, provider_code=CODE, day=YESTERDAY)
    again = await reconcile_costs(worker_db, redis, provider_code=CODE, day=YESTERDAY)

    assert first == again
    assert first is not None
    assert (first.provider_spend_usd, first.our_cost_usd) == (Decimal("10.00"), Decimal("9.00"))
    assert first.difference_usd == Decimal("1.00")
    assert first.flagged
    kept = json.loads(await redis.get(reconciliation_key(CODE, YESTERDAY)) or "{}")
    assert (Decimal(kept["difference_usd"]), kept["flagged"]) == (Decimal(1), True)
    # Nothing is booked: the events are as they were.
    assert len(await _events(migrated)) == 5


async def _events(pg: PostgresServer) -> list[object]:
    return list(await fetch(pg, "SELECT id FROM ops.provider_cost_events"))


async def test_a_small_difference_is_not_a_finding(
    worker_db: Ledger, migrated: PostgresServer, redis: Redis
) -> None:
    read_at = datetime(2026, 10, 5, 23, 50, tzinfo=UTC)
    await redis.set(
        spend_key(CODE, YESTERDAY),
        json.dumps({"spent_usd": "100.00", "read_at": read_at.isoformat()}),
    )
    # 4% under: inside the tolerance of 5% of the day's spend.
    await _event(migrated, datetime(2026, 10, 5, 10, 0, tzinfo=UTC), "96.00")

    found = await reconcile_costs(worker_db, redis, provider_code=CODE, day=YESTERDAY)

    assert found is not None
    assert (found.difference_usd, found.flagged) == (Decimal("4.00"), False)


async def test_a_day_without_a_reading_reconciles_to_nothing(
    worker_db: Ledger, redis: Redis
) -> None:
    assert await reconcile_costs(worker_db, redis, provider_code=CODE, day=YESTERDAY) is None
    assert await redis.get(reconciliation_key(CODE, YESTERDAY)) is None
