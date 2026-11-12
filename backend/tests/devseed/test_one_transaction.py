"""`put_engine` and `pause_schedule` run in the caller's transaction: what they write commits or
rolls back with it, so the schedules an engine makes can be paused before they ever commit."""

from __future__ import annotations

from uuid import UUID

import pytest

from idraft.api.ai.engine_service import put_engine
from idraft.api.operations import schedules_repository
from idraft.api.operations.schedules import pause_schedule
from idraft.api.schemas.ai import EngineUpdate
from idraft.api.schemas.operations import SchedulePause
from idraft.db.engine import workspace_transaction
from idraft.devseed.context import SEED_INFO, Sessions, seed_access
from idraft.domain.ai_engines import EngineCode
from tests.api.ai.support import ai_project
from tests.api.auth.support import User, Workspace, fetch
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
