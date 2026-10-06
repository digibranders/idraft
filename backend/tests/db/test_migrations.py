import asyncio
import io
import json
import os
import subprocess
import sys

import asyncpg
import pytest
from alembic import command
from alembic.script import ScriptDirectory

from sightline.db.migrate import (
    MigrationState,
    alembic_config,
    main,
    migration_state,
    upgrade_to_head,
)
from tests.conftest import PostgresServer

SCHEMAS = {"auth", "core", "seo", "ai", "fp", "ops"}
EXTENSIONS = {"citext", "pg_trgm", "pgcrypto", "btree_gist"}


def _fresh_database(pg: PostgresServer, name: str) -> str:
    """A new empty database owned by migrator; returns the migrator's URL for it."""
    asyncio.run(pg.create_database(name))
    return pg.url("migrator", name)


def _query(url: str, sql: str) -> list[str]:
    async def run() -> list[str]:
        connection = await asyncpg.connect(url)
        try:
            return [str(row[0]) for row in await connection.fetch(sql)]
        finally:
            await connection.close()

    return asyncio.run(run())


def _version(url: str) -> list[str]:
    return _query(url, "SELECT version_num FROM ops.alembic_version")


def test_the_history_is_linear_with_a_single_head() -> None:
    script = ScriptDirectory.from_config(alembic_config())
    state = migration_state()
    assert script.get_heads() == [state.head]
    assert len(script.get_bases()) == 1
    assert state.head in state.known


def test_upgrade_creates_schemas_extensions_and_the_version_row(pg: PostgresServer) -> None:
    url = _fresh_database(pg, "migrate_fresh")
    upgrade_to_head(url)

    schemas = set(_query(url, "SELECT schema_name FROM information_schema.schemata"))
    extensions = set(_query(url, "SELECT extname FROM pg_extension"))

    assert schemas >= SCHEMAS
    assert extensions >= EXTENSIONS
    assert _version(url) == [migration_state().head]


def test_upgrade_is_idempotent(pg: PostgresServer) -> None:
    url = _fresh_database(pg, "migrate_twice")
    upgrade_to_head(url)
    upgrade_to_head(url)
    assert _version(url) == [migration_state().head]


def test_the_history_can_be_walked_down_and_up_again(pg: PostgresServer) -> None:
    """Downgrades are for local development, and they must still work."""
    url = _fresh_database(pg, "migrate_walk")
    upgrade_to_head(url)

    command.downgrade(alembic_config(url), "0001")
    tables = _query(
        url,
        "SELECT schemaname || '.' || tablename FROM pg_tables "
        "WHERE schemaname IN ('auth', 'core', 'ops') AND tablename <> 'alembic_version'",
    )
    assert tables == []
    assert _version(url) == ["0001"]

    upgrade_to_head(url)
    assert _version(url) == [migration_state().head]


def test_schedules_and_runs_from_before_the_ledger_revisions_are_carried_over(
    pg: PostgresServer,
) -> None:
    """0006 to 0008 change rules on tables that may hold rows: every row that was valid
    before is valid after, and takes the day its cadence now has to name."""
    url = _fresh_database(pg, "migrate_ledger")
    command.upgrade(alembic_config(url), "0005")
    (workspace,) = _query(
        url, "INSERT INTO auth.workspaces (name, slug) VALUES ('w', 'w') RETURNING id"
    )
    (project,) = _query(
        url,
        "INSERT INTO core.projects (workspace_id, name, slug) "
        f"VALUES ('{workspace}', 'p', 'p') RETURNING id",
    )

    def schedule(cadence: str, zone: str, next_run_at: str, weekday: str = "NULL") -> str:
        (schedule_id,) = _query(
            url,
            "INSERT INTO ops.schedules (workspace_id, project_id, workload, name, cadence, "
            f"timezone, weekday, next_run_at) VALUES ('{workspace}', '{project}', 'seo_rank', "
            f"'{cadence}', '{cadence}', '{zone}', {weekday}, '{next_run_at}') RETURNING id",
        )
        return schedule_id

    daily = schedule("daily", "UTC", "2026-10-08 02:00+00")
    # 20:30 UTC on Wednesday the 7th is 02:00 on Thursday the 8th in India.
    weekly = schedule("weekly", "Asia/Kolkata", "2026-10-07 20:30+00")
    weekly_named = schedule("weekly", "UTC", "2026-10-08 02:00+00", weekday="2")
    # A month may have no 31st: the schedule takes the last day every month has.
    monthly = schedule("monthly", "UTC", "2026-10-31 02:00+00")
    monthly_early = schedule("monthly", "UTC", "2026-10-05 02:00+00")
    run = (
        "INSERT INTO ops.collection_runs (workspace_id, project_id, schedule_id, workload, "
        "window_start, window_end, trigger, status, config_snapshot, blocked_by_budget_id) "
        f"VALUES ('{workspace}', '{project}', {{schedule}}, 'seo_rank', '2026-10-08 02:00+00', "
        "'2026-10-08 08:00+00', '{trigger}', 'planned', '{{}}', {budget}) RETURNING id"
    )
    (budget,) = _query(
        url,
        "INSERT INTO ops.budgets (workspace_id, workload, limit_usd) "
        f"VALUES ('{workspace}', 'all', 1) RETURNING id",
    )
    (scheduled,) = _query(
        url, run.format(schedule=f"'{daily}'", trigger="schedule", budget=f"'{budget}'")
    )
    _query(url, run.format(schedule="NULL", trigger="manual", budget="NULL"))

    upgrade_to_head(url)

    days = dict(
        row.split("=")
        for row in _query(
            url,
            "SELECT id || '=' || coalesce(weekday::text, '-') || ',' || "
            "coalesce(month_day::text, '-') FROM ops.schedules",
        )
    )
    assert days == {
        daily: "-,-",
        weekly: "4,-",
        weekly_named: "2,-",
        monthly: "-,28",
        monthly_early: "-,5",
    }
    # A second run without a schedule may now share the window; a schedule's may not.
    _query(url, run.format(schedule="NULL", trigger="manual", budget="NULL"))
    with pytest.raises(asyncpg.UniqueViolationError):
        _query(url, run.format(schedule=f"'{daily}'", trigger="schedule", budget="NULL"))
    # The budget that blocked a run can be deleted, and the run forgets it.
    _query(url, f"DELETE FROM ops.budgets WHERE id = '{budget}' RETURNING id")
    assert _query(
        url,
        f"SELECT blocked_by_budget_id IS NULL FROM ops.collection_runs WHERE id = '{scheduled}'",
    ) == ["True"]


def test_projects_that_already_track_keywords_get_the_default_rank_schedule(
    pg: PostgresServer,
) -> None:
    """0013 gives the schedule a first tracked keyword makes to every project that tracked
    keywords before it: otherwise they would be checked once, as new keywords, and never again."""
    url = _fresh_database(pg, "migrate_rank_schedules")
    command.upgrade(alembic_config(url), "0012")
    (workspace,) = _query(
        url, "INSERT INTO auth.workspaces (name, slug) VALUES ('w', 'w') RETURNING id"
    )
    _query(
        url,
        "INSERT INTO core.locations (id, name, country_iso, location_type) "
        "VALUES (2840, 'United States', 'US', 'Country') RETURNING id",
    )

    def project(slug: str, zone: str = "UTC", status: str = "active", deleted: bool = False) -> str:
        (project_id,) = _query(
            url,
            "INSERT INTO core.projects (workspace_id, name, slug, timezone, status, deleted_at) "
            f"VALUES ('{workspace}', '{slug}', '{slug}', '{zone}', '{status}', "
            f"{'now()' if deleted else 'NULL'}) RETURNING id",
        )
        return project_id

    def track(project_id: str, text: str, active: bool = True) -> None:
        (keyword,) = _query(
            url,
            "INSERT INTO seo.keywords (workspace_id, text, normalized_text, language_code) "
            f"VALUES ('{workspace}', '{text}', '{text}', 'en') RETURNING id",
        )
        _query(
            url,
            "INSERT INTO seo.tracked_keywords (workspace_id, project_id, keyword_id, "
            "location_id, language_code, device, is_active) "
            f"VALUES ('{workspace}', '{project_id}', '{keyword}', 2840, 'en', 'desktop', "
            f"{active}) RETURNING id",
        )

    tracking = project("tracking", "Asia/Kolkata")
    track(tracking, "crm")
    has_schedule = project("has-schedule")
    track(has_schedule, "erp")
    _query(
        url,
        "INSERT INTO ops.schedules (workspace_id, project_id, workload, name, cadence, timezone, "
        f"is_active, next_run_at) VALUES ('{workspace}', '{has_schedule}', 'seo_rank', 'Mine', "
        "'daily', 'UTC', false, now() + interval '3 days') RETURNING id",
    )
    project("empty")
    archived_only = project("archived-only")
    track(archived_only, "hr", active=False)
    track(project("paused", status="paused"), "payroll")
    track(project("deleted", deleted=True), "benefits")

    upgrade_to_head(url)

    made = _query(
        url,
        "SELECT p.slug || '|' || s.name || '|' || s.cadence || '|' || s.window_start_local || '|' "
        "|| s.window_hours || '|' || s.provider_mode || '|' || s.selector::text || '|' || "
        "s.is_active FROM ops.schedules s JOIN core.projects p ON p.id = s.project_id "
        "WHERE s.workload = 'seo_rank' ORDER BY p.slug",
    )
    assert made == [
        "has-schedule|Mine|daily|02:00:00|6|standard_queue|{}|false",
        'tracking|Daily rank checks|daily|02:00:00|6|standard_queue|{"all": true}|true',
    ]
    # The next 02:00 in the project's own time, within a day from now.
    (next_run,) = _query(
        url,
        "SELECT ((next_run_at AT TIME ZONE 'Asia/Kolkata')::time = time '02:00' "
        "AND next_run_at > now() AND next_run_at <= now() + interval '1 day 1 hour')::text "
        f"FROM ops.schedules WHERE project_id = '{tracking}'",
    )
    assert next_run == "true"


def test_concurrent_migrators_take_turns(pg: PostgresServer) -> None:
    """Four migrator processes against an empty database: the advisory lock makes them queue."""
    url = _fresh_database(pg, "migrate_race")
    environment = {**os.environ, "DATABASE_URL": url}
    command = [sys.executable, "-m", "sightline.db.migrate"]
    processes = [
        subprocess.Popen(command, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        for _ in range(4)
    ]
    outcomes = [(process.communicate(timeout=60), process.returncode) for process in processes]

    assert [code for _, code in outcomes] == [0, 0, 0, 0], [err for (_, err), _ in outcomes]
    assert _version(url) == [migration_state().head]


def test_a_percent_sign_in_the_password_survives_the_config() -> None:
    config = alembic_config("postgresql://user:p%40ss%25@host/db")
    assert config.get_main_option("sqlalchemy.url") == "postgresql+asyncpg://user:p%40ss%25@host/db"


@pytest.mark.parametrize(
    ("database_revision", "expected"),
    [
        ("0003", True),  # at this build's head
        ("0004", True),  # a newer build migrated the database; this build still serves
        ("0002", False),  # a known older revision: behind
        ("0001", False),
        (None, False),  # never migrated
    ],
)
def test_a_schema_is_current_at_or_ahead_of_the_head(
    database_revision: str | None, expected: bool
) -> None:
    state = MigrationState(head="0003", known=frozenset({"0001", "0002", "0003"}))
    assert state.is_current(database_revision) is expected


def test_main_needs_only_a_database_url_and_logs_what_it_did(
    pg: PostgresServer, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    url = _fresh_database(pg, "migrate_main")
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("RELEASE_SHA", "abc123")

    main()

    assert _version(url) == [migration_state().head]
    lines = [json.loads(raw) for raw in io.StringIO(capsys.readouterr().out)]
    (summary,) = [line for line in lines if line["msg"] == "migrations applied"]
    assert summary["service"] == "migrator"
    assert summary["version"] == "abc123"
    assert summary["from_revision"] is None
    assert summary["to_revision"] == migration_state().head
    assert all("msg" in line and "ts" in line for line in lines)
