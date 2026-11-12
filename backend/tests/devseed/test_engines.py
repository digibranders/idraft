"""Both engines go on at India, the UAE and Saudi Arabia, the schedules that makes never commit
active, and a second run changes nothing."""

from __future__ import annotations

import uuid

import pytest

from idraft.devseed.context import Sessions
from idraft.devseed.engines import PAUSE_REASON, EngineChanges, ensure_engines
from idraft.domain.ai_engines import EngineCode
from tests.api.ai.support import enable_engine
from tests.api.auth.support import execute, fetch
from tests.conftest import PostgresServer
from tests.devseed.support import COUNTRY_IDS, FIXTURE, audit_count, seeded_project

_ENGINES = (
    "SELECT engine_code, location_ids, is_enabled FROM ai.project_engines "
    "WHERE project_id = $1 ORDER BY engine_code"
)
_SCHEDULES = (
    "SELECT is_active FROM ops.schedules "
    "WHERE project_id = $1 AND workload = 'ai_prompt' AND deleted_at IS NULL"
)
_GULF = [2356, 2682, 2784]


async def _schedule_states(pg: PostgresServer, project_id: uuid.UUID) -> list[bool]:
    return [row["is_active"] for row in await fetch(pg, _SCHEDULES, project_id)]


async def test_the_engines_go_on_and_their_schedules_are_paused(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)

    changes = await ensure_engines(sessions, access, project_id, FIXTURE.engines, COUNTRY_IDS)

    assert changes == EngineChanges(
        turned_on=(EngineCode.CHATGPT_WEB, EngineCode.GEMINI_WEB), paused=2
    )
    assert [tuple(row) for row in await fetch(migrated, _ENGINES, project_id)] == [
        ("chatgpt_web", _GULF, True),
        ("gemini_web", _GULF, True),
    ]
    assert await _schedule_states(migrated, project_id) == [False, False]
    reasons = await fetch(
        migrated,
        "SELECT after->>'reason' AS reason FROM ops.audit_logs "
        "WHERE workspace_id = $1 AND action = 'schedule.paused'",
        workspace.id,
    )
    assert [row["reason"] for row in reasons] == [PAUSE_REASON, PAUSE_REASON]

    before = await audit_count(migrated, workspace)
    again = await ensure_engines(sessions, access, project_id, FIXTURE.engines, COUNTRY_IDS)
    assert again == EngineChanges(turned_on=(), paused=0)
    assert await audit_count(migrated, workspace) == before
    assert await _schedule_states(migrated, project_id) == [False, False]


async def test_a_schedule_resumed_since_is_paused_again(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, _, project_id = await seeded_project(migrated, sessions)
    await ensure_engines(sessions, access, project_id, FIXTURE.engines, COUNTRY_IDS)
    await execute(
        migrated,
        "UPDATE ops.schedules SET is_active = true WHERE project_id = $1 AND weekday = 1",
        project_id,
    )
    assert sorted(await _schedule_states(migrated, project_id)) == [False, True]

    changes = await ensure_engines(sessions, access, project_id, FIXTURE.engines, COUNTRY_IDS)

    assert changes == EngineChanges(turned_on=(), paused=1)
    assert await _schedule_states(migrated, project_id) == [False, False]


async def test_an_engine_on_in_fewer_countries_is_widened(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)
    await enable_engine(migrated, workspace, project_id, "chatgpt_web", [COUNTRY_IDS["IN"]])

    changes = await ensure_engines(sessions, access, project_id, FIXTURE.engines, COUNTRY_IDS)

    assert changes.turned_on == (EngineCode.CHATGPT_WEB, EngineCode.GEMINI_WEB)
    assert [tuple(row) for row in await fetch(migrated, _ENGINES, project_id)] == [
        ("chatgpt_web", _GULF, True),
        ("gemini_web", _GULF, True),
    ]
    assert await _schedule_states(migrated, project_id) == [False, False]


async def test_a_failure_midway_commits_neither_the_engines_nor_their_schedules(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)
    first, second = FIXTURE.engines
    # `model_copy` skips validation: the second engine names a country with no location id, so
    # the loop fails after the first engine was put and its two schedules were made.
    broken = second.model_copy(update={"countries": ["IN", "ZZ"]})
    before = await audit_count(migrated, workspace)

    with pytest.raises(KeyError, match="ZZ"):
        await ensure_engines(sessions, access, project_id, [first, broken], COUNTRY_IDS)

    assert await fetch(migrated, _ENGINES, project_id) == []
    assert (
        await fetch(migrated, "SELECT 1 FROM ops.schedules WHERE project_id = $1", project_id) == []
    )
    assert await audit_count(migrated, workspace) == before


async def test_a_failing_pause_commits_no_active_schedule(
    migrated: PostgresServer, sessions: Sessions, monkeypatch: pytest.MonkeyPatch
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)
    before = await audit_count(migrated, workspace)

    async def refuse(*_: object, **__: object) -> None:
        raise RuntimeError("pause failed")

    monkeypatch.setattr("idraft.devseed.engines.pause_schedule", refuse)

    with pytest.raises(RuntimeError, match="pause failed"):
        await ensure_engines(sessions, access, project_id, FIXTURE.engines, COUNTRY_IDS)

    assert (
        await fetch(migrated, "SELECT 1 FROM ops.schedules WHERE project_id = $1", project_id) == []
    )
    assert await fetch(migrated, _ENGINES, project_id) == []
    assert await audit_count(migrated, workspace) == before
