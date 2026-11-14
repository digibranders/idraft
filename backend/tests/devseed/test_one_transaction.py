"""`put_engine` and `pause_schedule` run in the caller's transaction: what they write commits or
rolls back with it, so the schedules an engine makes can be paused before they ever commit."""

from __future__ import annotations

import json
import uuid
from uuid import UUID

import pytest

from idraft.api.ai.engine_service import put_engine
from idraft.api.operations import schedules_repository
from idraft.api.operations.schedules import pause_schedule
from idraft.api.problems import NotFoundError
from idraft.api.schemas.ai import EngineUpdate
from idraft.api.schemas.operations import SchedulePause
from idraft.db.engine import workspace_transaction
from idraft.devseed.context import SEED_INFO, Sessions, seed_access
from idraft.domain.ai_engines import EngineCode
from tests.api.ai.support import ai_project
from tests.api.auth.support import User, Workspace, execute, fetch
from tests.conftest import PostgresServer
from tests.devseed.support import COUNTRY_IDS, gulf_locations, owner_workspace


class _RollbackError(Exception):
    pass


async def _put_and_pause(
    sessions: Sessions, user: User, workspace: Workspace, project_id: UUID, *, roll_back: bool
) -> None:
    """Turn ChatGPT on and pause the two schedules that makes, in one transaction."""
    access = seed_access(user.id, workspace.id)
    async with workspace_transaction(sessions, workspace.id, user_id=user.id) as db:
        await put_engine(
            db,
            access,
            project_id,
            EngineCode.CHATGPT_WEB,
            EngineUpdate(location_ids=[COUNTRY_IDS["IN"]]),
            SEED_INFO,
        )
        made, _ = await schedules_repository.list_schedules(
            db,
            workspace.id,
            project_id,
            workload="ai_prompt",
            is_active=True,
            offset=0,
            limit=10,
        )
        assert len(made) == 2
        for schedule in made:
            await pause_schedule(
                db, access, project_id, schedule.id, SchedulePause(reason="test"), SEED_INFO
            )
        if roll_back:
            raise _RollbackError


async def test_what_they_write_rolls_back_with_the_callers_transaction(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    user, workspace = await owner_workspace(migrated)
    await gulf_locations(migrated)
    project_id = await ai_project(migrated, workspace)

    with pytest.raises(_RollbackError):
        await _put_and_pause(sessions, user, workspace, project_id, roll_back=True)

    assert (
        await fetch(migrated, "SELECT 1 FROM ai.project_engines WHERE project_id = $1", project_id)
        == []
    )
    assert (
        await fetch(migrated, "SELECT 1 FROM ops.schedules WHERE project_id = $1", project_id) == []
    )


async def test_committed_together_the_schedules_are_never_active(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    user, workspace = await owner_workspace(migrated)
    await gulf_locations(migrated)
    project_id = await ai_project(migrated, workspace)

    await _put_and_pause(sessions, user, workspace, project_id, roll_back=False)

    rows = await fetch(
        migrated, "SELECT is_active FROM ops.schedules WHERE project_id = $1", project_id
    )
    assert [row["is_active"] for row in rows] == [False, False]
    actions = await fetch(
        migrated,
        "SELECT action FROM ops.audit_logs WHERE workspace_id = $1 ORDER BY id",
        workspace.id,
    )
    assert [row["action"] for row in actions] == [
        "project_engine.updated",
        "schedule.paused",
        "schedule.paused",
    ]


async def _put(
    sessions: Sessions, user: User, workspace: Workspace, project_id: UUID, *countries: str
) -> None:
    """Turn ChatGPT on at these countries and commit, leaving whatever schedules it makes active."""
    async with workspace_transaction(sessions, workspace.id, user_id=user.id) as db:
        await put_engine(
            db,
            seed_access(user.id, workspace.id),
            project_id,
            EngineCode.CHATGPT_WEB,
            EngineUpdate(location_ids=[COUNTRY_IDS[country] for country in countries]),
            SEED_INFO,
        )


async def _audit_count(migrated: PostgresServer, workspace: Workspace) -> int:
    rows = await fetch(
        migrated, "SELECT 1 FROM ops.audit_logs WHERE workspace_id = $1", workspace.id
    )
    return len(rows)


async def test_pausing_a_paused_schedule_writes_nothing_and_returns_it_unchanged(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    user, workspace = await owner_workspace(migrated)
    await gulf_locations(migrated)
    project_id = await ai_project(migrated, workspace)
    await _put_and_pause(sessions, user, workspace, project_id, roll_back=False)
    schedule_id: UUID = (
        await fetch(migrated, "SELECT id FROM ops.schedules WHERE project_id = $1", project_id)
    )[0]["id"]
    audited = await _audit_count(migrated, workspace)

    async with workspace_transaction(sessions, workspace.id, user_id=user.id) as db:
        before = await schedules_repository.get_schedule(
            db, workspace.id, project_id, schedule_id, lock=False
        )
        again = await pause_schedule(
            db,
            seed_access(user.id, workspace.id),
            project_id,
            schedule_id,
            SchedulePause(reason="again"),
            SEED_INFO,
        )

    assert before is not None
    assert not again.is_active
    assert again == before
    assert await _audit_count(migrated, workspace) == audited


async def test_put_engine_on_a_deleted_or_unknown_project_is_not_found(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    user, workspace = await owner_workspace(migrated)
    await gulf_locations(migrated)
    deleted = await ai_project(migrated, workspace)
    await execute(migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", deleted)

    for project_id in (deleted, uuid.uuid4()):
        with pytest.raises(NotFoundError):
            await _put(sessions, user, workspace, project_id, "IN")

    assert await _audit_count(migrated, workspace) == 0


async def test_pausing_another_projects_schedule_is_not_found_and_leaves_it_active(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    user, workspace = await owner_workspace(migrated)
    await gulf_locations(migrated)
    project_id = await ai_project(migrated, workspace)
    other_id = await ai_project(migrated, workspace)
    await _put(sessions, user, workspace, project_id, "IN")
    rows = await fetch(
        migrated, "SELECT id, is_active FROM ops.schedules WHERE project_id = $1", project_id
    )
    assert rows
    audited = await _audit_count(migrated, workspace)

    async with workspace_transaction(sessions, workspace.id, user_id=user.id) as db:
        with pytest.raises(NotFoundError):
            await pause_schedule(
                db,
                seed_access(user.id, workspace.id),
                other_id,
                rows[0]["id"],
                SchedulePause(reason="wrong project"),
                SEED_INFO,
            )

    after = await fetch(
        migrated, "SELECT id, is_active FROM ops.schedules WHERE project_id = $1", project_id
    )
    assert sorted(tuple(row) for row in after) == sorted(tuple(row) for row in rows)
    assert all(row["is_active"] for row in after)
    assert await _audit_count(migrated, workspace) == audited


async def test_an_engine_update_audits_what_it_changed_from(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    user, workspace = await owner_workspace(migrated)
    await gulf_locations(migrated)
    project_id = await ai_project(migrated, workspace)

    await _put(sessions, user, workspace, project_id, "IN")
    await _put(sessions, user, workspace, project_id, "IN", "AE")

    entries = await fetch(
        migrated,
        "SELECT before, after FROM ops.audit_logs "
        "WHERE workspace_id = $1 AND action = 'project_engine.updated' ORDER BY id",
        workspace.id,
    )
    assert [json.loads(row["before"]) if row["before"] else None for row in entries] == [
        None,
        {"engine_code": "chatgpt_web", "location_ids": ["2356"], "is_enabled": True},
    ]
    assert json.loads(entries[1]["after"]) == {
        "engine_code": "chatgpt_web",
        "location_ids": ["2356", "2784"],
        "is_enabled": True,
    }
