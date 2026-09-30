"""Monthly partitions (docs/26-testing-quality.md: DB-PART-01 to 04)."""

import asyncio
from datetime import UTC, datetime, timedelta

import asyncpg
import pytest

from tests.conftest import PostgresServer
from tests.db.support import connection, scoped

PARENTS = ["ops.collection_tasks", "ops.provider_cost_events"]
PARTITIONS = (
    "SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid "
    "WHERE i.inhparent = $1::regclass ORDER BY c.relname"
)


def _month(offset: int) -> datetime:
    """The first instant (UTC) of the month `offset` months from now."""
    now = datetime.now(UTC)
    index = now.year * 12 + (now.month - 1) + offset
    return datetime(index // 12, index % 12 + 1, 1, tzinfo=UTC)


def _suffixes(first: int, last: int) -> list[str]:
    return [f"_p{_month(offset):%Y%m}" for offset in range(first, last + 1)]


@pytest.mark.parametrize("parent", PARENTS)
async def test_partitions_exist_from_one_month_back_to_three_ahead(
    migrated: PostgresServer, parent: str
) -> None:
    """DB-PART-01."""
    async with connection(migrated) as db:
        rows = await db.fetch(PARTITIONS, parent)
    table = parent.split(".")[1]
    assert [row["relname"] for row in rows] == [table + suffix for suffix in _suffixes(-1, 3)]


async def test_maintenance_is_idempotent_for_the_worker(migrated: PostgresServer) -> None:
    """DB-PART-01: the second call creates nothing."""
    async with scoped(migrated, "app_worker") as db:
        assert await db.fetchval("SELECT ops.maintain_partitions()") == 0


async def test_a_timestamp_lands_in_its_utc_month(migrated: PostgresServer) -> None:
    """DB-PART-02: the last millisecond of a month and the first instant of the next."""
    boundary = _month(2)
    insert = (
        "INSERT INTO ops.provider_cost_events (occurred_at, provider_code, endpoint, workload, "
        "channel, cost_usd, cost_source, billing_period) VALUES ($1, 'dataforseo', 'x', "
        "'seo_rank', 'seo', 0, 'provider_reported', $2) RETURNING tableoid::regclass::text"
    )
    async with scoped(migrated, "app_worker") as db:
        before = await db.fetchval(insert, boundary - timedelta(milliseconds=1), boundary.date())
        after = await db.fetchval(insert, boundary, boundary.date())
    assert before == f"ops.provider_cost_events_p{_month(1):%Y%m}"
    assert after == f"ops.provider_cost_events_p{_month(2):%Y%m}"


async def test_bounds_are_utc_whatever_the_session_time_zone(migrated: PostgresServer) -> None:
    """DB-PART-03."""
    async with scoped(migrated, "superuser") as db:
        await db.execute("SET LOCAL TimeZone = 'America/New_York'")
        await db.execute("CREATE TABLE ops.tz_probe (at timestamptz) PARTITION BY RANGE (at)")
        created = await db.fetchval("SELECT ops.ensure_monthly_partitions('ops.tz_probe')")
        await db.execute("SET LOCAL TimeZone = 'UTC'")
        bounds = await db.fetch(
            "SELECT c.relname, pg_get_expr(c.relpartbound, c.oid) AS bound FROM pg_inherits i "
            "JOIN pg_class c ON c.oid = i.inhrelid "
            "WHERE i.inhparent = 'ops.tz_probe'::regclass ORDER BY c.relname"
        )
    assert created == 5
    assert [row["bound"] for row in bounds] == [
        f"FOR VALUES FROM ('{_month(offset):%Y-%m-%d} 00:00:00+00') "
        f"TO ('{_month(offset + 1):%Y-%m-%d} 00:00:00+00')"
        for offset in range(-1, 4)
    ]


async def test_there_is_no_default_partition(migrated: PostgresServer) -> None:
    """DB-PART-04: a row outside the prepared range fails loudly."""
    async with scoped(migrated, "app_worker") as db:
        with pytest.raises(asyncpg.CheckViolationError, match="no partition of relation"):
            await db.execute(
                "INSERT INTO ops.provider_cost_events (occurred_at, provider_code, endpoint, "
                "workload, channel, cost_usd, cost_source, billing_period) VALUES ($1, "
                "'dataforseo', 'x', 'seo_rank', 'seo', 0, 'provider_reported', $2)",
                _month(6),
                _month(6).date(),
            )


async def test_a_registered_table_is_maintained(migrated: PostgresServer) -> None:
    async with scoped(migrated, "superuser") as db:
        await db.execute("SET LOCAL ROLE migrator")  # tables are owned by migrator
        await db.execute("CREATE TABLE ops.probe_days (day date) PARTITION BY RANGE (day)")
        await db.execute(
            "INSERT INTO ops.partitioned_tables (parent, key_is_date, months_back, months_ahead) "
            "VALUES ('ops.probe_days', true, 0, 2)"
        )
        created = await db.fetchval("SELECT ops.maintain_partitions()")
        rows = await db.fetch(PARTITIONS, "ops.probe_days")
    assert created == 3
    assert [row["relname"] for row in rows] == ["probe_days" + s for s in _suffixes(0, 2)]


async def test_new_partitions_carry_the_autovacuum_settings(migrated: PostgresServer) -> None:
    async with connection(migrated) as db:
        options = await db.fetchval(
            "SELECT reloptions FROM pg_class WHERE oid = $1::regclass",
            f"ops.collection_tasks_p{_month(0):%Y%m}",
        )
    assert set(options) == {
        "autovacuum_vacuum_insert_scale_factor=0.05",
        "autovacuum_analyze_scale_factor=0.02",
    }


async def test_the_worker_cannot_create_partitions_on_a_table_of_its_choice(
    migrated: PostgresServer,
) -> None:
    async with scoped(migrated, "app_worker") as db:
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await db.fetchval("SELECT ops.ensure_monthly_partitions('ops.collection_tasks')")


@pytest.mark.parametrize(
    "call",
    ["SELECT ops.maintain_partitions()", "SELECT ops.ensure_monthly_partitions('ops.audit_logs')"],
)
async def test_the_api_cannot_maintain_partitions(migrated: PostgresServer, call: str) -> None:
    async with scoped(migrated, "app_api") as db:
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await db.fetchval(call)


async def test_two_maintainers_at_once_take_turns(migrated: PostgresServer) -> None:
    """Two workers starting their daily maintenance together must not collide."""
    async with connection(migrated, "migrator") as db:
        await db.execute("DROP TABLE IF EXISTS ops.race_probe")
        await db.execute("CREATE TABLE ops.race_probe (at timestamptz) PARTITION BY RANGE (at)")
    try:

        async def maintain() -> int:
            async with connection(migrated, "migrator") as db:
                created: int = await db.fetchval(
                    "SELECT ops.ensure_monthly_partitions('ops.race_probe')"
                )
                return created

        results = await asyncio.gather(*(maintain() for _ in range(4)))
    finally:
        async with connection(migrated, "migrator") as db:
            await db.execute("DROP TABLE ops.race_probe")
    assert sorted(results) == [0, 0, 0, 5]


async def test_a_registry_row_for_a_dropped_table_does_not_stop_maintenance(
    migrated: PostgresServer,
) -> None:
    async with scoped(migrated, "superuser") as db:
        await db.execute("SET LOCAL ROLE migrator")
        await db.execute("CREATE TABLE ops.gone (at timestamptz) PARTITION BY RANGE (at)")
        await db.execute("INSERT INTO ops.partitioned_tables (parent) VALUES ('ops.gone')")
        await db.execute("DROP TABLE ops.gone")
        assert await db.fetchval("SELECT ops.maintain_partitions()") == 0


async def test_a_table_name_that_needs_quoting_is_partitioned(migrated: PostgresServer) -> None:
    async with scoped(migrated, "superuser") as db:
        await db.execute('CREATE TABLE ops."Odd Name" (at timestamptz) PARTITION BY RANGE (at)')
        created = await db.fetchval("""SELECT ops.ensure_monthly_partitions('ops."Odd Name"')""")
        rows = await db.fetch(PARTITIONS, 'ops."Odd Name"')
    assert created == 5
    assert [row["relname"] for row in rows] == ["Odd Name" + suffix for suffix in _suffixes(-1, 3)]


async def test_partitions_belong_to_migrator_and_carry_no_grants_of_their_own(
    migrated: PostgresServer,
) -> None:
    async with connection(migrated) as db:
        rows = await db.fetch(
            "SELECT pg_get_userbyid(c.relowner) AS owner, c.relacl IS NULL AS no_grants "
            "FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid "
            "WHERE i.inhparent = ANY($1::regclass[])",
            PARENTS,
        )
    assert len(rows) == 10
    assert {(row["owner"], row["no_grants"]) for row in rows} == {("migrator", True)}
