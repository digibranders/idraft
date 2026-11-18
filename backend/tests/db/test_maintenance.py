"""Planner statistics for the AI tables (release A follow-up F-12).

A restored, upgraded or bulk loaded database has no statistics until something analyzes it, and the
planner then nests the joins of the AI reads (62.8 to 69 s for the co-mentions self join, against
a 15 s statement timeout). These tests pin the rule: the owner role analyzes the AI tables after
every upgrade, bounded in time, and never fails a deploy.
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import subprocess
import sys
import time
from collections.abc import Awaitable, Callable
from types import TracebackType
from typing import Any, Self

import asyncpg
import pytest
from structlog.testing import capture_logs

from idraft.api.resources import Resources
from idraft.db import maintenance
from idraft.db.maintenance import AI_ANALYZE_TABLES, analyze_ai_tables
from idraft.db.migrate import main, migration_state, upgrade_to_head
from tests.api.ai.sources_support import full_project
from tests.api.conftest import auth_app, import_store, mailbox, resources
from tests.conftest import PostgresServer
from tests.db.support import connection

__all__ = ["auth_app", "import_store", "mailbox", "resources"]

PARTITIONED = ("ai.observations", "ai.citations", "ai.entity_mentions", "ai.observation_facts")


def _migrated_database(pg: PostgresServer, name: str) -> str:
    """A new database upgraded to the head by the owner role; returns the migrator's URL."""
    asyncio.run(pg.create_database(name))
    url = pg.url("migrator", name)
    upgrade_to_head(url)
    return url


def _run[T](url: str, work: Callable[[asyncpg.Connection[asyncpg.Record]], Awaitable[T]]) -> T:
    """`work(connection)` on one connection of that URL."""

    async def scenario() -> T:
        connected = await asyncpg.connect(url)
        try:
            return await work(connected)
        finally:
            await connected.close()

    return asyncio.run(scenario())


async def _statistics_rows(connected: asyncpg.Connection[asyncpg.Record], table: str) -> int:
    schema, name = table.split(".")
    count: int = await connected.fetchval(
        "SELECT count(*) FROM pg_stats WHERE schemaname = $1 AND tablename = $2", schema, name
    )
    return count


async def _forget(connected: asyncpg.Connection[asyncpg.Record], parents: tuple[str, ...]) -> None:
    """Statistics gone for the parents and every partition, as in a restored database."""
    for parent in parents:
        await connected.execute(
            "DELETE FROM pg_statistic WHERE starelid IN "
            "(SELECT relid FROM pg_partition_tree($1::regclass))",
            parent,
        )


async def _loaded_leaves(
    connected: asyncpg.Connection[asyncpg.Record], parent: str, project: Any
) -> list[str]:
    rows = await connected.fetch(
        f"SELECT DISTINCT c.relname FROM {parent} t JOIN pg_class c ON c.oid = t.tableoid "
        "WHERE t.project_id = $1",
        project,
    )
    return [f"ai.{row['relname']}" for row in rows]


def _lines(captured: str) -> list[dict[str, Any]]:
    return [json.loads(raw) for raw in io.StringIO(captured)]


# --- the table list ---------------------------------------------------------------------------


def test_the_table_list_names_only_existing_tables(migrated: PostgresServer) -> None:
    found = _run(
        migrated.url("migrator"),
        lambda c: c.fetch(
            "SELECT t, to_regclass(t) IS NOT NULL AS found FROM unnest($1::text[]) t",
            list(AI_ANALYZE_TABLES),
        ),
    )
    assert AI_ANALYZE_TABLES
    assert [row["t"] for row in found if not row["found"]] == []


def test_the_table_list_covers_every_partitioned_ai_table(migrated: PostgresServer) -> None:
    """A new partitioned AI table registered for monthly partitions must be analyzed too."""
    parents = _run(
        migrated.url("migrator"),
        lambda c: c.fetch(
            "SELECT parent::text AS parent FROM ops.partitioned_tables "
            "WHERE parent::text LIKE 'ai.%'"
        ),
    )
    registered = {row["parent"] for row in parents}
    assert set(PARTITIONED) <= registered
    assert registered <= set(AI_ANALYZE_TABLES)


# --- the helper -------------------------------------------------------------------------------


async def test_analyze_ai_tables_gives_every_listed_table_statistics(
    resources: Resources, migrated: PostgresServer
) -> None:
    """Forget the statistics of a loaded project, run the helper, and every partitioned table has
    them again. The parent is analyzed and so are the loaded leaf partitions under it (F8): the
    planner reads the leaves, not the parent. Nothing is changed in the data."""
    world = await full_project(resources, migrated, citations=2)
    async with connection(migrated) as admin:
        # full_project writes no mentions: the own brand and the rival, named in every answer
        await admin.execute(
            "INSERT INTO ai.entity_mentions (observation_id, observed_at, entity_id, "
            "derivation_id, workspace_id, project_id, engine_code, role, mention_count, "
            "first_char_offset, mention_order, prominence, match_method, confidence, "
            "evidence_spans) SELECT f.observation_id, f.observed_at, e.id, f.derivation_id, "
            "f.workspace_id, f.project_id, f.engine_code, "
            "CASE WHEN e.id = $2 THEN 'own' ELSE 'competitor' END, 1, 0, e.position::smallint, "
            "1, 'alias_word', 1, ARRAY['[0,8)'::int4range] FROM ai.observation_facts f "
            "CROSS JOIN unnest($3::uuid[]) WITH ORDINALITY AS e(id, position) "
            "WHERE f.project_id = $1",
            world.project.id,
            world.own,
            [world.own, world.rival],
        )
        await _forget(admin, PARTITIONED)
        leaves = {
            parent: await _loaded_leaves(admin, parent, world.project.id) for parent in PARTITIONED
        }
        counts_before = {
            table: await admin.fetchval(f"SELECT count(*) FROM {table}") for table in PARTITIONED
        }
        for parent, names in leaves.items():
            assert names, parent
            assert [await _statistics_rows(admin, name) for name in names] == [0] * len(names)
        assert [await _statistics_rows(admin, t) for t in PARTITIONED] == [0] * len(PARTITIONED)

        async with connection(migrated, "migrator") as owner:
            analyzed = await analyze_ai_tables(owner)

        assert analyzed == len(AI_ANALYZE_TABLES)
        for table in PARTITIONED:
            assert await _statistics_rows(admin, table) > 0, table
        for parent, names in leaves.items():
            for name in names:
                assert await _statistics_rows(admin, name) > 0, (parent, name)
        for table in ("ai.prompts", "ai.prompt_versions", "core.urls", "core.domains"):
            assert table in AI_ANALYZE_TABLES
            assert await _statistics_rows(admin, table) > 0, table
        counts_after = {
            table: await admin.fetchval(f"SELECT count(*) FROM {table}") for table in PARTITIONED
        }
        assert counts_after == counts_before


async def test_a_runtime_role_cannot_analyze_the_ai_tables(migrated: PostgresServer) -> None:
    """ANALYZE needs ownership (no MAINTAIN grant exists): as the worker it only warns and skips.
    That is why the rule runs as the owner, and why a worker job needs a grant first."""
    messages: list[str] = []
    async with connection(migrated, "app_worker") as worker:
        worker.add_log_listener(lambda _c, message: messages.append(message.message))
        await worker.execute("ANALYZE ai.observations")
    assert any("skipping" in message and "observations" in message for message in messages), (
        messages
    )


async def test_an_empty_database_has_no_tables_to_analyze_and_the_helper_returns_zero(
    pg: PostgresServer,
) -> None:
    await pg.create_database("maintenance_empty")
    connected = await asyncpg.connect(pg.url("migrator", "maintenance_empty"))
    try:
        assert await analyze_ai_tables(connected) == 0
    finally:
        await connected.close()


async def test_a_table_that_cannot_be_locked_is_skipped_with_a_warning_and_the_rest_go_on(
    pg: PostgresServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The bound: a table held under an exclusive lock is given up after the lock timeout, logged,
    and the other tables are still analyzed. Nothing waits for a migration or a long query."""
    url = await _async_migrated(pg, "maintenance_lock")
    monkeypatch.setattr(maintenance, "LOCK_TIMEOUT_MS", 200)
    holder = await asyncpg.connect(url)
    owner = await asyncpg.connect(url)
    try:
        async with holder.transaction():
            await holder.execute("LOCK TABLE ai.prompts IN ACCESS EXCLUSIVE MODE")
            with capture_logs() as logs:
                analyzed = await analyze_ai_tables(owner)
    finally:
        await holder.close()
        await owner.close()

    assert analyzed == len(AI_ANALYZE_TABLES) - 1
    (skipped,) = [entry for entry in logs if entry["event"] == "analyze table skipped"]
    assert skipped["table"] == "ai.prompts"
    assert skipped["log_level"] == "warning"


async def test_the_whole_run_gives_up_after_its_total_budget(
    pg: PostgresServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The deploy never waits long: past the total budget the run raises instead of waiting out
    the lock timeout of every table."""
    url = await _async_migrated(pg, "maintenance_budget")
    monkeypatch.setattr(maintenance, "TOTAL_BUDGET_SECONDS", 0.5)
    monkeypatch.setattr(maintenance, "LOCK_TIMEOUT_MS", 60_000)
    holder = await asyncpg.connect(url)
    try:
        async with holder.transaction():
            await holder.execute("LOCK TABLE ai.observations IN ACCESS EXCLUSIVE MODE")
            started = time.monotonic()
            with pytest.raises(TimeoutError):
                await maintenance.analyze_database(url)
            assert time.monotonic() - started < 10
    finally:
        await holder.close()


class _Recorder:
    """The two calls the helper makes on a connection, written down."""

    def __init__(self) -> None:
        self.statements: list[str] = []

    async def fetchval(self, query: str, *args: Any) -> str:
        return str(args[0])

    async def execute(self, query: str, *args: Any) -> str:
        self.statements.append(query)
        return "ANALYZE"

    def transaction(self) -> _Transaction:
        return _Transaction(self)


class _Transaction:
    def __init__(self, owner: _Recorder) -> None:
        self.owner = owner

    async def __aenter__(self) -> Self:
        self.owner.statements.append("BEGIN")
        return self

    async def __aexit__(
        self,
        kind: type[BaseException] | None,
        error: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.owner.statements.append("END")


async def test_every_analyze_runs_in_its_own_transaction_under_both_timeouts() -> None:
    recorder = _Recorder()
    await analyze_ai_tables(recorder)  # type: ignore[arg-type]

    per_table = [s for s in recorder.statements if s != "BEGIN" and s != "END"]
    assert recorder.statements.count("BEGIN") == len(AI_ANALYZE_TABLES)
    assert any("statement_timeout" in s for s in per_table[:2])
    assert any("lock_timeout" in s for s in per_table[:2])
    assert [s for s in per_table if s.startswith("ANALYZE")] == [
        f"ANALYZE {table}" for table in AI_ANALYZE_TABLES
    ]
    assert all("VACUUM" not in s and "ALTER" not in s and "DROP" not in s for s in per_table)


async def _async_migrated(pg: PostgresServer, name: str) -> str:
    await pg.create_database(name)
    url = pg.url("migrator", name)
    await asyncio.to_thread(upgrade_to_head, url)
    return url


# --- the entry points -------------------------------------------------------------------------


def test_main_on_an_empty_database_analyzes_after_the_upgrade(
    pg: PostgresServer, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """The deploy runs main() on whatever database it finds. On an empty one the upgrade creates
    the tables first, and `statistics refreshed` is logged after `migrations applied`."""
    asyncio.run(pg.create_database("maintenance_main_empty"))
    url = pg.url("migrator", "maintenance_main_empty")
    monkeypatch.setenv("DATABASE_URL", url)

    main()

    lines = _lines(capsys.readouterr().out)
    events = [line["msg"] for line in lines]
    assert events.index("migrations applied") < events.index("statistics refreshed")
    (refreshed,) = [line for line in lines if line["msg"] == "statistics refreshed"]
    assert refreshed["tables"] == len(AI_ANALYZE_TABLES)
    assert _run(url, lambda c: c.fetchval("SELECT version_num FROM ops.alembic_version")) == (
        migration_state().head
    )


def test_main_on_an_already_migrated_database_leaves_it_with_statistics(
    pg: PostgresServer, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """Nothing to upgrade, and the statistics are still taken: a plain redeploy refreshes them.
    reltuples is -1 until a table has been analyzed once."""
    url = _migrated_database(pg, "maintenance_main_migrated")
    monkeypatch.setenv("DATABASE_URL", url)
    never = "SELECT count(*) FROM pg_class WHERE oid = ANY($1::regclass[]) AND reltuples >= 0"
    tables = list(AI_ANALYZE_TABLES)
    assert _run(url, lambda c: c.fetchval(never, tables)) < len(tables)

    main()

    assert _run(url, lambda c: c.fetchval(never, tables)) == len(tables)
    leaf = _run(
        url,
        lambda c: c.fetchval(
            "SELECT count(*) FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid "
            "WHERE i.inhparent = 'ai.observations'::regclass AND c.reltuples >= 0"
        ),
    )
    assert leaf > 0
    assert "statistics refreshed" in [line["msg"] for line in _lines(capsys.readouterr().out)]


@pytest.mark.parametrize(
    "failing", ["idraft.db.migrate.analyze_database", "idraft.db.maintenance.analyze_ai_tables"]
)
def test_a_failed_analyze_does_not_fail_the_migration(
    pg: PostgresServer,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    failing: str,
) -> None:
    """infra/ship.sh runs main() in every deploy: whatever goes wrong while analyzing, the
    upgrade stands, main() returns, and the only trace is one warning."""
    asyncio.run(pg.create_database("maintenance_main_failed"))
    url = pg.url("migrator", "maintenance_main_failed")
    monkeypatch.setenv("DATABASE_URL", url)

    async def broken(*_args: object) -> int:
        raise RuntimeError("the planner is having a day")

    monkeypatch.setattr(failing, broken)

    main()

    lines = _lines(capsys.readouterr().out)
    events = [line["msg"] for line in lines]
    assert "migrations applied" in events
    assert "statistics refreshed" not in events
    (warning,) = [line for line in lines if line["msg"] == "analyze skipped"]
    assert warning["level"] == "warning"
    assert warning["error_kind"] == "RuntimeError"
    assert _run(url, lambda c: c.fetchval("SELECT version_num FROM ops.alembic_version")) == (
        migration_state().head
    )


def test_the_module_entry_analyzes_a_migrated_database(pg: PostgresServer) -> None:
    """`python -m idraft.db.analyze`, as an operator runs it after a restore or a backfill."""
    url = _migrated_database(pg, "maintenance_cli")
    environment = {**os.environ, "DATABASE_URL": url}

    result = subprocess.run(
        [sys.executable, "-m", "idraft.db.analyze"],
        env=environment,
        capture_output=True,
        timeout=120,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    (refreshed,) = [
        line for line in _lines(result.stdout.decode()) if line["msg"] == "statistics refreshed"
    ]
    assert refreshed["tables"] == len(AI_ANALYZE_TABLES)
    analyzed = _run(
        url,
        lambda c: c.fetchval(
            "SELECT count(*) FROM pg_class WHERE oid = ANY($1::regclass[]) AND reltuples >= 0",
            list(AI_ANALYZE_TABLES),
        ),
    )
    assert analyzed == len(AI_ANALYZE_TABLES)


def test_the_module_entry_fails_loudly_when_the_database_is_unreachable() -> None:
    """Unlike a deploy, an operator who asked for statistics must hear that none were taken."""
    environment = {**os.environ, "DATABASE_URL": "postgresql://nobody:x@127.0.0.1:1/none"}

    result = subprocess.run(
        [sys.executable, "-m", "idraft.db.analyze"],
        env=environment,
        capture_output=True,
        timeout=60,
        check=False,
    )

    assert result.returncode != 0
