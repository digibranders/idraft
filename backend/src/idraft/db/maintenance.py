"""Planner statistics for the AI tables (release A follow-up F-12).

Runbook: docs/ops/planner-statistics.md. A database restored from a logical dump, upgraded, or
bulk loaded has no statistics until something analyzes it. The planner then reads every table as
one row and nests the joins of the AI reads: the co-mentions self join took 62.8 to 69 s against
the 15 s statement timeout, and 0.4 s once the partitions were analyzed. The owner role runs this
after every upgrade, and an operator runs it after a restore or a backfill. It reads data and
changes only statistics: no DDL, no locks that block reads or writes (ANALYZE takes SHARE UPDATE
EXCLUSIVE).

The work is bounded and never database wide: nine named tables, `STATEMENT_TIMEOUT_MS` for each,
`LOCK_TIMEOUT_MS` to wait for a lock, and `TOTAL_BUDGET_SECONDS` for the whole run.
"""

from __future__ import annotations

import asyncio

import asyncpg
import structlog

# ANALYZE of a partitioned parent also analyzes each of its partitions (the planner reads the
# leaves), so the four partitioned tables are listed by their parent. Table names are constants:
# nothing here is built from input.
AI_ANALYZE_TABLES: tuple[str, ...] = (
    "ai.observations",
    "ai.citations",
    "ai.entity_mentions",
    "ai.observation_facts",
    "ai.prompts",
    "ai.prompt_versions",
    "ai.prompt_terms",
    "core.urls",
    "core.domains",
)
STATEMENT_TIMEOUT_MS = 30_000
LOCK_TIMEOUT_MS = 5_000
TOTAL_BUDGET_SECONDS = 120.0
_CONNECT_TIMEOUT_SECONDS = 10.0
_log = structlog.get_logger(__name__)


async def analyze_ai_tables(connection: asyncpg.Connection[asyncpg.Record]) -> int:
    """ANALYZE each table of `AI_ANALYZE_TABLES`, as the owner. Returns how many were analyzed.

    A table that does not exist yet (a database not migrated) is skipped. A table that cannot be
    analyzed (a lock held past the timeout, a statement past its limit, no privilege) is logged
    and skipped, so one table never stops the others.
    """
    analyzed = 0
    for table in AI_ANALYZE_TABLES:
        if await connection.fetchval("SELECT to_regclass($1)", table) is None:
            _log.info("analyze table absent", table=table)
            continue
        try:
            # One transaction per table: the timeouts are local to it, so they never leak into
            # the caller's session.
            async with connection.transaction():
                await connection.execute(
                    "SELECT set_config('statement_timeout', $1, true), "
                    "set_config('lock_timeout', $2, true)",
                    str(STATEMENT_TIMEOUT_MS),
                    str(LOCK_TIMEOUT_MS),
                )
                await connection.execute(f"ANALYZE {table}")
        except asyncpg.PostgresError as error:
            _log.warning("analyze table skipped", table=table, error_kind=type(error).__name__)
            continue
        analyzed += 1
    return analyzed


async def analyze_database(dsn: str) -> int:
    """Connect with `dsn` (the owner role), analyze the AI tables, log how many, and return it.

    Raises when the database cannot be reached or the run passes `TOTAL_BUDGET_SECONDS`; the
    deploy catches that and goes on, the operator command lets it end the process.
    """
    async with asyncio.timeout(TOTAL_BUDGET_SECONDS):
        connection = await asyncpg.connect(dsn, timeout=_CONNECT_TIMEOUT_SECONDS)
        try:
            analyzed = await analyze_ai_tables(connection)
        except BaseException:
            connection.terminate()
            raise
        await connection.close(timeout=_CONNECT_TIMEOUT_SECONDS)
    _log.info("statistics refreshed", tables=analyzed)
    return analyzed
