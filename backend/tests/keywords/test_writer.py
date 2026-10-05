"""Writing tracked keywords, shared by the API and imports (plan decisions D3, D4 and D8)."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.db.engine import workspace_transaction
from sightline.keywords.writer import (
    DEFAULT_TRACKED_KEYWORD_LIMIT,
    WRITE_MAX,
    Device,
    NewTrackedKeyword,
    ProjectGoneError,
    QuotaExceededError,
    WriteResult,
    devices,
    write_tracked_keywords,
)
from tests.api.auth.support import Workspace, execute, fetch, make_user, make_workspace
from tests.api.workspaces.support import make_project
from tests.conftest import PostgresServer

NOW = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)
LOCATION = 2840

type Sessions = async_sessionmaker[AsyncSession]


@pytest.fixture
async def location(migrated: PostgresServer) -> int:
    await execute(
        migrated,
        "INSERT INTO core.locations (id, name, country_iso, location_type) "
        "VALUES ($1, 'United States', 'US', 'Country') ON CONFLICT (id) DO NOTHING",
        LOCATION,
    )
    return LOCATION


def _item(
    text: str, device: Device = "desktop", *, depth_profile: str = "standard"
) -> NewTrackedKeyword:
    return NewTrackedKeyword(
        text=text,
        location_id=LOCATION,
        language_code="en",
        device=device,
        depth_profile=depth_profile,
    )


async def _write(
    sessions: Sessions,
    workspace: Workspace,
    project_id: uuid.UUID,
    items: Sequence[NewTrackedKeyword],
    *,
    created_by: uuid.UUID | None = None,
) -> WriteResult:
    async with workspace_transaction(sessions, workspace.id) as db:
        return await write_tracked_keywords(
            db,
            workspace_id=workspace.id,
            project_id=project_id,
            items=items,
            source="manual",
            created_by=created_by,
            now=NOW,
        )


async def _set_quota(pg: PostgresServer, workspace: Workspace, limit: int) -> None:
    await execute(
        pg,
        "INSERT INTO core.workspace_quotas (workspace_id, max_tracked_keywords) VALUES ($1, $2)",
        workspace.id,
        limit,
    )


def test_both_devices_are_two_measurements() -> None:
    assert devices("both") == ("desktop", "mobile")
    assert devices("mobile") == ("mobile",)


async def test_the_default_limit_is_the_databases(migrated: PostgresServer) -> None:
    """A workspace without a quota row has the column's default limit."""
    rows = await fetch(
        migrated,
        "SELECT column_default FROM information_schema.columns WHERE table_schema = 'core' "
        "AND table_name = 'workspace_quotas' AND column_name = 'max_tracked_keywords'",
    )
    assert rows[0]["column_default"] == str(DEFAULT_TRACKED_KEYWORD_LIMIT)


@pytest.mark.usefixtures("location")
async def test_new_keywords_are_written_with_their_first_config(
    sessions: Sessions, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await make_project(migrated, workspace.id)
    user = await make_user(migrated)

    result = await _write(
        sessions,
        workspace,
        project,
        [_item("CRM Software"), _item("crm  software", "mobile", depth_profile="deep")],
        created_by=user.id,
    )

    assert [created.index for created in result.created] == [0, 1]
    assert result.existing == []
    rows = await fetch(
        migrated,
        "SELECT k.text, k.normalized_text, t.device, t.depth_profile, t.created_by, "
        "h.config_version, h.depth_profile AS history_depth, h.valid_from "
        "FROM seo.tracked_keywords t JOIN seo.keywords k ON k.id = t.keyword_id "
        "JOIN seo.tracked_keyword_config_history h ON h.tracked_keyword_id = t.id "
        "WHERE t.project_id = $1 ORDER BY t.device",
        project,
    )
    # One keyword, entered first as "CRM Software", which is what the provider will receive.
    assert [(r["text"], r["normalized_text"], r["device"]) for r in rows] == [
        ("CRM Software", "crm software", "desktop"),
        ("CRM Software", "crm software", "mobile"),
    ]
    assert [(r["config_version"], r["history_depth"]) for r in rows] == [
        (1, "standard"),
        (1, "deep"),
    ]
    assert {r["created_by"] for r in rows} == {user.id}
    assert {r["valid_from"] for r in rows} == {NOW}


@pytest.mark.usefixtures("location")
async def test_an_existing_identity_is_reported_and_a_deleted_one_comes_back(
    sessions: Sessions, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await make_project(migrated, workspace.id)
    first = await _write(
        sessions, workspace, project, [_item("live"), _item("archived"), _item("deleted")]
    )
    live, archived, deleted = (created.tracked_keyword_id for created in first.created)
    await execute(
        migrated, "UPDATE seo.tracked_keywords SET is_active = false WHERE id = $1", archived
    )
    await execute(
        migrated,
        "UPDATE seo.tracked_keywords SET deleted_at = now(), is_active = false WHERE id = $1",
        deleted,
    )

    again = await _write(
        sessions,
        workspace,
        project,
        [_item("LIVE"), _item("archived"), _item("Deleted"), _item("live")],
    )

    assert [(e.index, e.tracked_keyword_id, e.state) for e in again.existing] == [
        (0, live, "live"),
        (1, archived, "archived"),
        # The same identity twice in one request: the second names the first.
        (3, live, "live"),
    ]
    assert [(c.index, c.tracked_keyword_id, c.restored) for c in again.created] == [
        (2, deleted, True)
    ]
    rows = await fetch(
        migrated,
        "SELECT is_active, deleted_at, updated_at FROM seo.tracked_keywords WHERE id = $1",
        deleted,
    )
    assert (rows[0]["is_active"], rows[0]["deleted_at"], rows[0]["updated_at"]) == (True, None, NOW)


@pytest.mark.usefixtures("location")
async def test_the_quota_counts_active_rows_and_refuses_the_whole_request(
    sessions: Sessions, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await make_project(migrated, workspace.id)
    other_project = await make_project(migrated, workspace.id)
    await _set_quota(migrated, workspace, 3)
    written = await _write(sessions, workspace, project, [_item("a"), _item("b")])
    await execute(
        migrated,
        "UPDATE seo.tracked_keywords SET is_active = false WHERE id = $1",
        written.created[1].tracked_keyword_id,
    )

    # One active of three: two more fit, in another project too; then a live duplicate costs
    # nothing and a new keyword is one too many.
    fits = await _write(sessions, workspace, other_project, [_item("c"), _item("d")])
    assert len(fits.created) == 2
    with pytest.raises(QuotaExceededError) as raised:
        await _write(sessions, workspace, project, [_item("a"), _item("e")])
    assert (raised.value.limit, raised.value.used, raised.value.requested) == (3, 3, 1)
    rows = await fetch(
        migrated,
        "SELECT count(*) AS n FROM seo.keywords WHERE workspace_id = $1 AND text = 'e'",
        workspace.id,
    )
    assert rows[0]["n"] == 0


@pytest.mark.usefixtures("location")
async def test_the_first_tracked_keyword_creates_the_projects_metrics_schedule(
    sessions: Sessions, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await make_project(migrated, workspace.id)
    await execute(
        migrated, "UPDATE core.projects SET timezone = 'Asia/Kolkata' WHERE id = $1", project
    )

    await _write(sessions, workspace, project, [_item("a")])
    await _write(sessions, workspace, project, [_item("b")])

    schedules = await fetch(
        migrated,
        "SELECT workload, cadence, month_day, timezone, window_start_local, window_hours, "
        "provider_mode, selector, next_run_at, is_active FROM ops.schedules "
        "WHERE project_id = $1 AND workload = 'keyword_metrics'",
        project,
    )
    (schedule,) = schedules
    assert (
        schedule["workload"],
        schedule["cadence"],
        schedule["month_day"],
        schedule["timezone"],
        schedule["window_start_local"].isoformat(),
        schedule["window_hours"],
        schedule["provider_mode"],
        schedule["selector"],
        schedule["is_active"],
    ) == (
        "keyword_metrics",
        "monthly",
        20,
        "Asia/Kolkata",
        "03:00:00",
        2,
        "live",
        '{"stale_days": 25}',
        True,
    )
    # 03:00 in Kolkata on 20 October is 21:30 UTC on the 19th.
    assert schedule["next_run_at"] == datetime(2026, 10, 19, 21, 30, tzinfo=UTC)


async def test_the_first_tracked_keyword_also_starts_daily_rank_collection(
    sessions: Sessions, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await make_project(migrated, workspace.id)
    await execute(
        migrated, "UPDATE core.projects SET timezone = 'Asia/Kolkata' WHERE id = $1", project
    )

    await _write(sessions, workspace, project, [_item("a")])
    await _write(sessions, workspace, project, [_item("b")])

    (schedule,) = await fetch(
        migrated,
        "SELECT workload, cadence, timezone, window_start_local, window_hours, provider_mode, "
        "selector, next_run_at, is_active FROM ops.schedules "
        "WHERE project_id = $1 AND workload = 'seo_rank'",
        project,
    )
    assert (
        schedule["cadence"],
        schedule["timezone"],
        schedule["window_start_local"].isoformat(),
        schedule["window_hours"],
        schedule["provider_mode"],
        schedule["selector"],
        schedule["is_active"],
    ) == ("daily", "Asia/Kolkata", "02:00:00", 6, "standard_queue", '{"all": true}', True)
    # 02:00 in Kolkata on 20 October is 20:30 UTC on the 19th (the writes happen on 19 October).
    assert schedule["next_run_at"].utcoffset() is not None
    assert schedule["next_run_at"].astimezone(UTC).time().isoformat() == "20:30:00"


async def test_a_rank_schedule_a_person_deleted_is_not_made_again(
    sessions: Sessions, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await make_project(migrated, workspace.id)
    await _write(sessions, workspace, project, [_item("a")])
    await execute(
        migrated,
        "UPDATE ops.schedules SET deleted_at = now(), is_active = false "
        "WHERE project_id = $1 AND workload = 'seo_rank'",
        project,
    )

    await _write(sessions, workspace, project, [_item("b")])

    rows = await fetch(
        migrated,
        "SELECT deleted_at FROM ops.schedules WHERE project_id = $1 AND workload = 'seo_rank'",
        project,
    )
    assert len(rows) == 1
    assert rows[0]["deleted_at"] is not None


@pytest.mark.usefixtures("location")
async def test_what_was_written_is_reported_and_stored_exactly(
    sessions: Sessions, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    other_workspace = await make_workspace(migrated)
    project = await make_project(migrated, workspace.id)
    other_project = await make_project(migrated, other_workspace.id)
    user = await make_user(migrated)
    # The same keyword in another workspace is another keyword.
    await _write(sessions, other_workspace, other_project, [_item("crm")])
    await _write(sessions, workspace, project, [_item("CRM")])
    later = NOW.replace(hour=13)

    async with workspace_transaction(sessions, workspace.id) as db:
        result = await write_tracked_keywords(
            db,
            workspace_id=workspace.id,
            project_id=project,
            items=[_item("crm", "mobile"), _item("Crm", "mobile"), _item("new one")],
            source="bulk_paste",
            created_by=user.id,
            now=later,
        )

    rows = await fetch(
        migrated,
        "SELECT t.id, t.keyword_id, t.source, t.created_at, k.text, h.changed_by "
        "FROM seo.tracked_keywords t JOIN seo.keywords k ON k.id = t.keyword_id "
        "JOIN seo.tracked_keyword_config_history h ON h.tracked_keyword_id = t.id "
        "WHERE t.project_id = $1 AND t.created_at = $2",
        project,
        later,
    )
    by_id = {row["id"]: row for row in rows}
    assert [(c.index, c.restored) for c in result.created] == [(0, False), (2, False)]
    # A repeat of an identity created in the same call names the new row.
    assert [(e.index, e.tracked_keyword_id) for e in result.existing] == [
        (1, result.created[0].tracked_keyword_id)
    ]
    for created in result.created:
        row = by_id[created.tracked_keyword_id]
        assert (row["keyword_id"], row["source"], row["changed_by"]) == (
            created.keyword_id,
            "bulk_paste",
            user.id,
        )
    # The keyword keeps the casing of the earlier request.
    assert by_id[result.created[0].tracked_keyword_id]["text"] == "CRM"
    counts = await fetch(
        migrated,
        "SELECT workspace_id, count(*) AS n FROM seo.keywords WHERE workspace_id = ANY($1) "
        "GROUP BY workspace_id",
        [workspace.id, other_workspace.id],
    )
    assert {row["workspace_id"]: row["n"] for row in counts} == {
        workspace.id: 2,
        other_workspace.id: 1,
    }


@pytest.mark.usefixtures("location")
async def test_a_restored_row_is_stamped_now(sessions: Sessions, migrated: PostgresServer) -> None:
    workspace = await make_workspace(migrated)
    project = await make_project(migrated, workspace.id)
    first = await _write(sessions, workspace, project, [_item("a")])
    tracked_id = first.created[0].tracked_keyword_id
    await execute(
        migrated,
        "UPDATE seo.tracked_keywords SET deleted_at = now(), is_active = false WHERE id = $1",
        tracked_id,
    )
    later = NOW.replace(day=2)

    async with workspace_transaction(sessions, workspace.id) as db:
        await write_tracked_keywords(
            db,
            workspace_id=workspace.id,
            project_id=project,
            items=[_item("a")],
            source="manual",
            created_by=None,
            now=later,
        )

    rows = await fetch(
        migrated, "SELECT updated_at FROM seo.tracked_keywords WHERE id = $1", tracked_id
    )
    assert rows[0]["updated_at"] == later


@pytest.mark.usefixtures("location")
async def test_a_deleted_project_gets_nothing_and_its_keywords_stop_counting(
    sessions: Sessions, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    gone = await make_project(migrated, workspace.id)
    live = await make_project(migrated, workspace.id)
    await _set_quota(migrated, workspace, 2)
    await _write(sessions, workspace, gone, [_item("a"), _item("b")])
    await execute(migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", gone)

    with pytest.raises(ProjectGoneError):
        await _write(sessions, workspace, gone, [_item("c")])
    written = await _write(sessions, workspace, live, [_item("c"), _item("d")])

    assert len(written.created) == 2
    rows = await fetch(
        migrated, "SELECT count(*) AS n FROM seo.tracked_keywords WHERE project_id = $1", gone
    )
    assert rows[0]["n"] == 2


@pytest.mark.usefixtures("location")
async def test_a_deleted_metrics_schedule_is_not_made_again(
    sessions: Sessions, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await make_project(migrated, workspace.id)
    await _write(sessions, workspace, project, [_item("a")])
    await execute(
        migrated,
        "UPDATE ops.schedules SET deleted_at = now() "
        "WHERE project_id = $1 AND workload = 'keyword_metrics'",
        project,
    )

    await _write(sessions, workspace, project, [_item("b")])

    rows = await fetch(
        migrated,
        "SELECT deleted_at FROM ops.schedules "
        "WHERE project_id = $1 AND workload = 'keyword_metrics'",
        project,
    )
    assert len(rows) == 1
    assert rows[0]["deleted_at"] is not None


async def test_a_call_writes_at_most_its_limit(
    sessions: Sessions, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await make_project(migrated, workspace.id)
    with pytest.raises(ValueError, match="at most"):
        await _write(sessions, workspace, project, [_item(f"k{n}") for n in range(WRITE_MAX + 1)])


@pytest.mark.usefixtures("location")
async def test_a_paused_metrics_schedule_is_left_alone(
    sessions: Sessions, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await make_project(migrated, workspace.id)
    await _write(sessions, workspace, project, [_item("a")])
    await execute(
        migrated,
        "UPDATE ops.schedules SET is_active = false "
        "WHERE project_id = $1 AND workload = 'keyword_metrics'",
        project,
    )

    await _write(sessions, workspace, project, [_item("b")])

    rows = await fetch(
        migrated,
        "SELECT is_active FROM ops.schedules "
        "WHERE project_id = $1 AND workload = 'keyword_metrics'",
        project,
    )
    assert [row["is_active"] for row in rows] == [False]
