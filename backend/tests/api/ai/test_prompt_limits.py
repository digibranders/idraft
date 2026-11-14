"""The quota and limits read (contract C1, `GET {P}/ai/limits`; rows PD-N06, BE-PROMPTS-16, CF-11):
the numbers the writes check, read in one read only transaction that writes nothing."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

import httpx

from idraft.api.ai.prompt_repository import MONTHLY_ANSWERS_DEFAULT
from idraft.api.operations.runs import MANUAL_RUNS_PER_DAY
from idraft.api.resources import Resources
from idraft.domain.ai_engines import BASE_PLAN
from tests.api.ai.sources_support import statements
from tests.api.ai.support import ai_project, seed_prompts, set_prompt_quota
from tests.api.auth.support import Workspace, execute, fetch, fetchrow, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.keywords.support import ensure_locations, project_url
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import add_prompt, enable_engine
from tests.collectors.support import Project
from tests.conftest import PostgresServer

ENGINES = ["chatgpt_web", "gemini_web", "google_ai_mode"]
# Statements one read sends, the session and membership checks included.
LIMITS_STATEMENTS = 10


async def _limits(
    api: httpx.AsyncClient, workspace: Workspace, project: uuid.UUID, caller: Caller
) -> httpx.Response:
    return await api.get(project_url(workspace, project, "ai", "limits"), headers=caller.headers)


async def _data(
    api: httpx.AsyncClient, workspace: Workspace, project: uuid.UUID, caller: Caller
) -> dict[str, Any]:
    response = await _limits(api, workspace, project, caller)
    assert response.status_code == 200, response.text
    data: dict[str, Any] = response.json()["data"]
    return data


async def _manual_runs(
    pg: PostgresServer,
    workspace: Workspace,
    project: uuid.UUID,
    count: int,
    created_at: datetime | None = None,
) -> None:
    """Manual runs by a person; `created_at` defaults to now."""
    for _ in range(count):
        await execute(
            pg,
            "INSERT INTO ops.collection_runs (workspace_id, project_id, workload, window_start, "
            "window_end, trigger, status, created_by_type, config_snapshot, created_at) VALUES "
            "($1, $2, 'keyword_metrics', now(), now(), 'manual', 'completed', 'user', '{}', "
            "COALESCE($3::timestamptz, now()))",
            workspace.id,
            project,
            created_at,
        )


async def _answer_task(
    pg: PostgresServer, workspace: Workspace, project: uuid.UUID, created_at: datetime
) -> None:
    """One completed ai_prompt task made at `created_at`, in a run the system started."""
    run = await fetch(
        pg,
        "INSERT INTO ops.collection_runs (workspace_id, project_id, workload, window_start, "
        "window_end, trigger, status, created_by_type, config_snapshot) VALUES "
        "($1, $2, 'ai_prompt', now(), now(), 'manual', 'completed', 'system', '{}') RETURNING id",
        workspace.id,
        project,
    )
    await execute(
        pg,
        "INSERT INTO ops.collection_tasks (created_at, run_id, workspace_id, project_id, "
        "workload, subject_type, subject_id, engine_code, location_id, idempotency_key, "
        "request_fingerprint, provider_code, provider_endpoint, scheduled_for, status) VALUES "
        "($1, $2, $3, $4, 'ai_prompt', 'prompt_version', $5, 'chatgpt_web', 2840, $6, $6, "
        "'dataforseo', 'chatgpt', now(), 'ingested')",
        created_at,
        run[0]["id"],
        workspace.id,
        project,
        str(uuid.uuid4()),
        uuid.uuid4().bytes,
    )


async def _utc_starts(pg: PostgresServer) -> tuple[datetime, datetime]:
    """The start of today and of this month, UTC, by the database clock."""
    row = await fetchrow(
        pg,
        "SELECT date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS day, "
        "date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS month",
    )
    return row["day"], row["month"]


async def test_limits_show_workspace_prompts_across_projects(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    first = await ai_project(migrated, workspace)
    second = await ai_project(migrated, workspace)
    archived_project = await ai_project(migrated, workspace)
    deleted_project = await ai_project(migrated, workspace)
    stranger = await make_workspace(migrated)
    elsewhere = await ai_project(migrated, stranger)
    await set_prompt_quota(migrated, workspace, 40)
    ours = await seed_prompts(migrated, workspace, first, 5)
    await seed_prompts(migrated, workspace, second, 2)
    await seed_prompts(migrated, workspace, archived_project, 3)
    await seed_prompts(migrated, workspace, deleted_project, 5)
    await seed_prompts(migrated, stranger, elsewhere, 7)
    await execute(migrated, "UPDATE ai.prompts SET is_active = false WHERE id = $1", ours[0])
    await execute(migrated, "UPDATE ai.prompts SET deleted_at = now() WHERE id = $1", ours[4])
    await execute(
        migrated,
        "UPDATE core.projects SET status = 'archived' WHERE id = $1",
        archived_project,
    )
    await execute(
        migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", deleted_project
    )

    data = await _data(api, workspace, first, owner)

    # 3 of the first project (one archived and one soft-deleted prompt left out), 2, and the
    # archived project's 3.
    assert data["prompts"] == {"limit": 40, "used": 8}


async def test_limits_month_answers_match_what_run_now_counts(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    await ensure_locations(migrated)
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = Project(workspace.id, await make_project(migrated, workspace.id))
    prompts = [
        await add_prompt(migrated, project, f"Which SOC providers suit bank number {number}?")
        for number in range(2)
    ]
    for code in ENGINES:
        await enable_engine(migrated, project, code)
    before = await _data(api, workspace, project.id, owner)

    run = await api.post(
        project_url(workspace, project.id, "ai", "runs"),
        json={"prompt_ids": [str(prompt.id) for prompt in prompts]},
        headers=owner.headers,
    )
    after = await _data(api, workspace, project.id, owner)

    assert run.status_code == 202, run.text
    assert run.json()["meta"]["answers"] == 6
    assert before["ai_observations_month"]["used"] == 0
    # The planned run is counted before the worker makes its tasks.
    assert after["ai_observations_month"]["used"] == 6
    assert after["ai_observations_month"]["limit"] == MONTHLY_ANSWERS_DEFAULT
    assert after["manual_runs_today"] == {"used": 1, "limit": MANUAL_RUNS_PER_DAY}


async def test_manual_runs_today_count_this_project_only(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await ai_project(migrated, workspace)
    other = await ai_project(migrated, workspace)
    await _manual_runs(migrated, workspace, project, 3)
    await _manual_runs(migrated, workspace, other, 2)

    here = await _data(api, workspace, project, owner)
    there = await _data(api, workspace, other, owner)

    assert here["manual_runs_today"] == {"used": 3, "limit": MANUAL_RUNS_PER_DAY}
    assert there["manual_runs_today"] == {"used": 2, "limit": MANUAL_RUNS_PER_DAY}


async def test_the_day_and_the_month_start_at_utc_midnight_and_count_from_it(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await ai_project(migrated, workspace)
    day, month = await _utc_starts(migrated)
    second = timedelta(seconds=1)
    await _manual_runs(migrated, workspace, project, 1, day - second)
    await _manual_runs(migrated, workspace, project, 2, day)
    await _answer_task(migrated, workspace, project, month - second)
    await _answer_task(migrated, workspace, project, month)
    await _answer_task(migrated, workspace, project, month)

    data = await _data(api, workspace, project, owner)

    # The run a second before midnight and the answer a second before the month are left out.
    assert data["manual_runs_today"]["used"] == 2
    assert data["ai_observations_month"]["used"] == 2


async def test_the_limit_defaults_match_the_database(migrated: PostgresServer) -> None:
    rows = await fetch(
        migrated,
        "SELECT column_name, column_default FROM information_schema.columns "
        "WHERE table_schema = 'core' AND table_name = 'workspace_quotas' "
        "AND column_name IN ('max_ai_observations_per_month', 'max_active_prompts')",
    )

    defaults = {row["column_name"]: row["column_default"] for row in rows}

    assert defaults == {
        "max_ai_observations_per_month": str(MONTHLY_ANSWERS_DEFAULT),
        "max_active_prompts": str(BASE_PLAN.max_prompts),
    }


async def test_limits_write_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await ai_project(migrated, workspace)
    await execute(
        migrated, "DELETE FROM core.workspace_quotas WHERE workspace_id = $1", workspace.id
    )

    data = await _data(api, workspace, project, owner)

    # A workspace without a quota row gets the defaults, and reading does not create the row.
    assert data["ai_observations_month"] == {"limit": MONTHLY_ANSWERS_DEFAULT, "used": 0}
    assert data["prompts"] == {"limit": BASE_PLAN.max_prompts, "used": 0}
    rows = await fetch(
        migrated, "SELECT 1 FROM core.workspace_quotas WHERE workspace_id = $1", workspace.id
    )
    assert rows == []
    entries = await fetch(
        migrated, "SELECT 1 FROM ops.audit_logs WHERE workspace_id = $1", workspace.id
    )
    assert entries == []


async def test_limits_statement_count_is_constant(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace_one = await make_workspace(migrated)
    workspace_many = await make_workspace(migrated)
    owner_one = await member(resources, migrated, workspace_one, "owner")
    owner_many = await member(resources, migrated, workspace_many, "owner")
    one = await ai_project(migrated, workspace_one)
    many = await ai_project(migrated, workspace_many)
    await seed_prompts(migrated, workspace_one, one, 1)
    await seed_prompts(migrated, workspace_many, many, 30)
    await _manual_runs(migrated, workspace_many, many, 5)

    with statements(resources) as small:
        first = await _limits(api, workspace_one, one, owner_one)
    with statements(resources) as large:
        second = await _limits(api, workspace_many, many, owner_many)

    assert first.status_code == second.status_code == 200, second.text
    assert second.json()["data"]["prompts"]["used"] == 30
    assert second.json()["data"]["manual_runs_today"]["used"] == 5
    assert len(small) == len(large) == LIMITS_STATEMENTS, large


async def test_limits_for_a_viewer_200_billing_403_foreign_project_404(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    billing = await member(resources, migrated, workspace, "billing")
    stranger_workspace = await make_workspace(migrated)
    stranger = await member(resources, migrated, stranger_workspace, "owner")
    project = await ai_project(migrated, workspace)
    foreign = await ai_project(migrated, stranger_workspace)
    deleted = await ai_project(migrated, workspace)
    await execute(migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", deleted)

    allowed = await _limits(api, workspace, project, viewer)
    refused = await _limits(api, workspace, project, billing)
    other_workspace = await _limits(api, workspace, foreign, viewer)
    nobody = await _limits(api, workspace, project, stranger)
    gone = await _limits(api, workspace, deleted, viewer)

    assert allowed.status_code == 200, allowed.text
    assert allowed.json() == {
        "data": {
            "prompts": {"limit": BASE_PLAN.max_prompts, "used": 0},
            "ai_observations_month": {"limit": MONTHLY_ANSWERS_DEFAULT, "used": 0},
            "manual_runs_today": {"used": 0, "limit": MANUAL_RUNS_PER_DAY},
        }
    }
    assert problem(refused) == (403, "forbidden")
    assert problem(other_workspace) == problem(nobody) == problem(gone) == (404, "not_found")
