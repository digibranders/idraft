"""Asking a prompt now: a manual AI run the worker plans and sends through the provider's
standard queue (docs/19 section 3.7.5, cut by the slice 1 spec section 4.3)."""

from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any

import httpx

from idraft.api.operations.runs import MANUAL_RUNS_PER_DAY
from idraft.api.resources import Resources
from idraft.providers.dataforseo.provider import CODE as DATAFORSEO
from tests.api.auth.support import Workspace, execute, fetch, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.keywords.support import errors, project_url
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import Prompt, add_prompt, enable_engine
from tests.collectors.support import Project, make_schedule
from tests.conftest import PostgresServer

QUESTION = "Which managed SOC providers work with mid-size banks?"


async def _setup(
    resources: Resources, pg: PostgresServer
) -> tuple[Workspace, Project, Caller, Prompt]:
    workspace = await make_workspace(pg)
    owner = await member(resources, pg, workspace, "owner")
    project = Project(workspace.id, await make_project(pg, workspace.id))
    prompt = await add_prompt(pg, project, QUESTION)
    for code in ("chatgpt_web", "gemini_web", "google_ai_mode"):
        await enable_engine(pg, project, code)
    return workspace, project, owner, prompt


async def _run_now(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: Project,
    caller: Caller,
    prompt_id: uuid.UUID,
    engines: list[str],
) -> httpx.Response:
    return await api.post(
        project_url(workspace, project.id, "prompts", prompt_id, "run-now"),
        json={"engine_codes": engines},
        headers=caller.headers,
    )


async def _runs(pg: PostgresServer, project: Project) -> list[dict[str, Any]]:
    rows = await fetch(
        pg,
        "SELECT * FROM ops.collection_runs WHERE project_id = $1 ORDER BY created_at",
        project.id,
    )
    return [dict(row) for row in rows]


async def _task_of(
    pg: PostgresServer,
    workspace: Workspace,
    project: Project,
    prompt: Prompt,
    *,
    engine_code: str,
    endpoint: str,
    status: str,
) -> None:
    """A run of a schedule of the ai_prompt workload with one task of the prompt's current
    version on the engine."""
    schedule = await make_schedule(pg, project, workload="ai_prompt")
    run = await fetch(
        pg,
        "INSERT INTO ops.collection_runs (workspace_id, project_id, schedule_id, workload, "
        "window_start, window_end, trigger, status, created_by_type, config_snapshot) VALUES "
        "($1, $2, $3, 'ai_prompt', now(), now() + interval '1 hour', 'schedule', 'running', "
        "'system', '{}') RETURNING id",
        workspace.id,
        project.id,
        schedule,
    )
    await execute(
        pg,
        "INSERT INTO ops.collection_tasks (run_id, workspace_id, project_id, workload, "
        "subject_type, subject_id, engine_code, location_id, idempotency_key, "
        "request_fingerprint, provider_code, provider_endpoint, scheduled_for, status) VALUES "
        "($1, $2, $3, 'ai_prompt', 'prompt_version', $4, $5, 2840, $6, $6, "
        "'dataforseo', $7, now(), $8)",
        run[0]["id"],
        workspace.id,
        project.id,
        str(prompt.version_id),
        engine_code,
        uuid.uuid4().bytes,
        endpoint,
        status,
    )


async def test_run_now_records_a_planned_run_for_the_worker(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner, prompt = await _setup(resources, migrated)

    response = await _run_now(
        api, workspace, project, owner, prompt.id, ["google_ai_mode", "chatgpt_web"]
    )

    assert response.status_code == 202, response.text
    data = response.json()["data"]
    assert (data["workload"], data["trigger"], data["status"]) == ("ai_prompt", "manual", "planned")
    (run,) = await _runs(migrated, project)
    assert json.loads(run["config_snapshot"]) == {
        "selector": {
            "prompt_ids": [str(prompt.id)],
            "engine_codes": ["chatgpt_web", "google_ai_mode"],
        }
    }
    (entry,) = await fetch(
        migrated,
        "SELECT target_id, after FROM ops.audit_logs WHERE workspace_id = $1 "
        "AND action = 'collection_run.requested'",
        workspace.id,
    )
    assert entry["target_id"] == str(run["id"])
    assert json.loads(entry["after"]) == {
        "project_id": str(project.id),
        "workload": "ai_prompt",
        "prompt_id": str(prompt.id),
        "engine_codes": ["chatgpt_web", "google_ai_mode"],
        "queue": "standard",
    }


async def test_an_engine_the_project_has_not_turned_on_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner, prompt = await _setup(resources, migrated)
    await enable_engine(migrated, project, "gemini_web", enabled=False)

    response = await _run_now(api, workspace, project, owner, prompt.id, ["gemini_web"])

    assert problem(response) == (422, "validation_failed")
    assert errors(response) == [("engine_codes", "engine_not_enabled")]
    assert await _runs(migrated, project) == []


async def test_a_prompt_too_long_for_an_engine_is_refused_for_it(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner, _ = await _setup(resources, migrated)
    long = await add_prompt(migrated, project, "Why " + "x" * 700)

    refused = await _run_now(api, workspace, project, owner, long.id, ["google_ai_mode"])
    taken = await _run_now(api, workspace, project, owner, long.id, ["chatgpt_web"])

    assert errors(refused) == [("engine_codes", "prompt_too_long")]
    assert taken.status_code == 202


async def test_a_prompt_of_another_project_or_archived_is_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner, _ = await _setup(resources, migrated)
    elsewhere = Project(workspace.id, await make_project(migrated, workspace.id))
    theirs = await add_prompt(migrated, elsewhere, QUESTION)
    archived = await add_prompt(migrated, project, "Archived, about SOC tools?", active=False)

    for prompt_id in (theirs.id, archived.id, uuid.uuid4()):
        response = await _run_now(api, workspace, project, owner, prompt_id, ["chatgpt_web"])
        assert problem(response) == (404, "not_found")


async def test_an_answer_already_on_its_way_is_not_asked_for_twice(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner, prompt = await _setup(resources, migrated)
    first = await _run_now(api, workspace, project, owner, prompt.id, ["chatgpt_web"])

    again = await _run_now(api, workspace, project, owner, prompt.id, ["chatgpt_web", "gemini_web"])
    other_engine = await _run_now(api, workspace, project, owner, prompt.id, ["gemini_web"])

    assert first.status_code == 202
    assert problem(again) == (409, "check_pending")
    assert again.json()["engine_codes"] == ["chatgpt_web"]
    # The planned run names its engines: another engine is not on its way.
    assert other_engine.status_code == 202


async def test_a_double_click_creates_one_run(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner, prompt = await _setup(resources, migrated)

    responses = await asyncio.gather(
        *(_run_now(api, workspace, project, owner, prompt.id, ["chatgpt_web"]) for _ in range(5))
    )

    assert sorted(response.status_code for response in responses) == [202, 409, 409, 409, 409]
    assert len(await _runs(migrated, project)) == 1


async def test_a_queued_task_of_the_prompt_is_on_its_way(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner, prompt = await _setup(resources, migrated)
    await _task_of(
        migrated,
        workspace,
        project,
        prompt,
        engine_code="gemini_web",
        endpoint="ai_optimization/gemini/llm_scraper",
        status="submitted",
    )

    response = await _run_now(api, workspace, project, owner, prompt.id, ["gemini_web"])

    assert problem(response) == (409, "check_pending")
    assert response.json()["engine_codes"] == ["gemini_web"]


async def test_a_person_may_ask_again_what_a_schedule_already_answered(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    # The planner refuses to ask one (prompt version, engine) in two overlapping schedule
    # windows, but a person who asks is answered by design: only an answer still on its way
    # stops Run now, not one a schedule already took.
    workspace, project, owner, prompt = await _setup(resources, migrated)
    await _task_of(
        migrated,
        workspace,
        project,
        prompt,
        engine_code="chatgpt_web",
        endpoint="ai_optimization/chat_gpt/llm_scraper",
        status="ingested",
    )

    response = await _run_now(api, workspace, project, owner, prompt.id, ["chatgpt_web"])

    assert response.status_code == 202, response.text


async def test_the_days_manual_runs_and_the_months_answers_are_limited(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner, prompt = await _setup(resources, migrated)
    await execute(
        migrated,
        "INSERT INTO core.workspace_quotas (workspace_id, max_ai_observations_per_month) "
        "VALUES ($1, 1) ON CONFLICT (workspace_id) DO UPDATE "
        "SET max_ai_observations_per_month = 1",
        workspace.id,
    )

    over_quota = await _run_now(
        api, workspace, project, owner, prompt.id, ["chatgpt_web", "gemini_web"]
    )
    for _ in range(MANUAL_RUNS_PER_DAY):
        await execute(
            migrated,
            "INSERT INTO ops.collection_runs (workspace_id, project_id, workload, window_start, "
            "window_end, trigger, status, created_by_type, config_snapshot) VALUES "
            "($1, $2, 'keyword_metrics', now(), now(), 'manual', 'completed', 'user', '{}')",
            workspace.id,
            project.id,
        )
    over_day = await _run_now(api, workspace, project, owner, prompt.id, ["chatgpt_web"])

    assert problem(over_quota) == (422, "quota_exceeded")
    assert over_quota.json()["quota"] == "max_ai_observations_per_month"
    assert (over_quota.json()["limit"], over_quota.json()["requested"]) == (1, 2)
    assert problem(over_day) == (429, "manual_run_limit")


async def test_the_months_answers_count_what_was_asked_and_what_is_planned(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner, prompt = await _setup(resources, migrated)
    await execute(
        migrated,
        "INSERT INTO core.workspace_quotas (workspace_id, max_ai_observations_per_month) "
        "VALUES ($1, 3) ON CONFLICT (workspace_id) DO UPDATE "
        "SET max_ai_observations_per_month = 3",
        workspace.id,
    )
    await _task_of(
        migrated,
        workspace,
        project,
        prompt,
        engine_code="gemini_web",
        endpoint="ai_optimization/gemini/llm_scraper",
        status="ingested",
    )
    planned = await _run_now(api, workspace, project, owner, prompt.id, ["chatgpt_web"])
    other = await add_prompt(migrated, project, "Which SOC vendors cover APAC?")

    over = await _run_now(api, workspace, project, owner, other.id, ["chatgpt_web", "gemini_web"])
    fits = await _run_now(api, workspace, project, owner, other.id, ["chatgpt_web"])

    assert planned.status_code == 202
    assert problem(over) == (422, "quota_exceeded")
    assert (over.json()["used"], over.json()["requested"]) == (2, 2)
    assert fits.status_code == 202, fits.text


async def test_a_paused_provider_is_not_asked(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner, prompt = await _setup(resources, migrated)
    await resources.redis.set(f"rl:paused:{DATAFORSEO}", "no_balance", px=60_000)
    try:
        paused = await _run_now(api, workspace, project, owner, prompt.id, ["chatgpt_web"])
    finally:
        await resources.redis.delete(f"rl:paused:{DATAFORSEO}")

    assert problem(paused) == (503, "provider_paused")
    assert paused.headers["retry-after"].isdigit()
    assert await _runs(migrated, project) == []


async def test_a_viewer_cannot_ask_a_prompt_now(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, _, prompt = await _setup(resources, migrated)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await _run_now(api, workspace, project, viewer, prompt.id, ["chatgpt_web"])

    assert problem(response) == (403, "forbidden")
