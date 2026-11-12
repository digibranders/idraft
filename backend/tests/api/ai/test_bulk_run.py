"""Run now for many prompts (plan D2 Task 5): one manual run through the standard queue, one of
the project's 20 a day, its tasks counted against the month's AI answers. What the planner would
skip, and every engine of a prompt with an answer on its way, is left out and listed; the rest
runs."""

from __future__ import annotations

import asyncio
import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import httpx

from idraft.api.operations.runs import MANUAL_RUNS_PER_DAY
from idraft.api.resources import Resources
from idraft.collectors.ai_prompt import AiPromptWorkload
from idraft.collectors.planner import plan_manual_runs
from idraft.collectors.registry import Registry
from idraft.domain.ai_engines import BASE_PLAN
from idraft.providers.dataforseo.provider import CODE as DATAFORSEO
from tests.api.ai.sources_support import statements
from tests.api.auth.support import Workspace, execute, fetch, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.keywords.support import OTHER_LOCATION, ensure_locations, errors, project_url
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import Prompt, add_prompt, enable_engine
from tests.collectors.rank_support import Ledger
from tests.collectors.support import Project, make_budget
from tests.conftest import PostgresServer

ENGINES = ["chatgpt_web", "gemini_web", "google_ai_mode"]
# Over AI Mode's 700 characters, within the others' 2,000.
LONG = "Why " + "x" * 750


@dataclass(frozen=True)
class Scene:
    workspace: Workspace
    project: Project
    owner: Caller
    prompts: list[Prompt]

    def url(self, *parts: object) -> str:
        return project_url(self.workspace, self.project.id, *parts)


async def _setup(resources: Resources, pg: PostgresServer, count: int = 2) -> Scene:
    """A project in the United States with `count` prompts and the three engines on."""
    await ensure_locations(pg)
    workspace = await make_workspace(pg)
    owner = await member(resources, pg, workspace, "owner")
    project = Project(workspace.id, await make_project(pg, workspace.id))
    prompts = [
        await add_prompt(pg, project, f"Which SOC providers suit bank number {number}?")
        for number in range(count)
    ]
    for code in ENGINES:
        await enable_engine(pg, project, code)
    return Scene(workspace, project, owner, prompts)


async def _bulk(
    api: httpx.AsyncClient,
    scene: Scene,
    prompt_ids: list[uuid.UUID],
    engines: list[str] | None = None,
    caller: Caller | None = None,
) -> httpx.Response:
    body: dict[str, Any] = {"prompt_ids": [str(prompt_id) for prompt_id in prompt_ids]}
    if engines is not None:
        body["engine_codes"] = engines
    return await api.post(
        scene.url("ai", "runs"), json=body, headers=(caller or scene.owner).headers
    )


async def _run_now(api: httpx.AsyncClient, scene: Scene, prompt: Prompt) -> httpx.Response:
    return await api.post(
        scene.url("prompts", prompt.id, "run-now"),
        json={"engine_codes": ["chatgpt_web"]},
        headers=scene.owner.headers,
    )


async def _runs(pg: PostgresServer, scene: Scene) -> list[dict[str, Any]]:
    rows = await fetch(
        pg,
        "SELECT * FROM ops.collection_runs WHERE project_id = $1 ORDER BY created_at",
        scene.project.id,
    )
    return [dict(row) for row in rows]


async def _tasks(pg: PostgresServer, scene: Scene) -> int:
    """Tasks of the workspace: a bulk run only records a planned run, the worker makes the tasks."""
    rows = await fetch(
        pg,
        "SELECT count(*) AS n FROM ops.collection_tasks WHERE workspace_id = $1",
        scene.workspace.id,
    )
    return int(rows[0]["n"])


def _skipped(response: httpx.Response) -> list[tuple[str, str, str]]:
    return [
        (item["prompt_id"], item["engine_code"], item["reason"])
        for item in response.json()["meta"]["skipped"]
    ]


async def test_one_request_is_one_planned_run_of_every_prompt_on_every_engine(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await _setup(resources, migrated)

    response = await _bulk(api, scene, [prompt.id for prompt in scene.prompts])

    assert response.status_code == 202, response.text
    body = response.json()
    assert (body["data"]["workload"], body["data"]["trigger"], body["data"]["status"]) == (
        "ai_prompt",
        "manual",
        "planned",
    )
    meta = body["meta"]
    assert (meta["prompts"], meta["answers"], meta["skipped"]) == (2, 6, [])
    # Six tasks at the standard queue's 0.0012 each.
    assert Decimal(meta["estimated_cost_usd"]) == Decimal("0.0072")
    assert meta["manual_runs_today"] == {"used": 1, "limit": MANUAL_RUNS_PER_DAY}
    (run,) = await _runs(migrated, scene)
    assert json.loads(run["config_snapshot"]) == {
        "selector": {
            "prompt_ids": sorted(str(prompt.id) for prompt in scene.prompts),
            "engine_codes": ENGINES,
        }
    }
    assert await _tasks(migrated, scene) == 0
    (entry,) = await fetch(
        migrated,
        "SELECT target_id, after FROM ops.audit_logs WHERE workspace_id = $1 "
        "AND action = 'collection_run.requested'",
        scene.workspace.id,
    )
    assert entry["target_id"] == str(run["id"])
    assert json.loads(entry["after"]) == {
        "project_id": str(scene.project.id),
        "workload": "ai_prompt",
        "prompt_count": 2,
        "engine_codes": ENGINES,
        "answers": 6,
        "skipped_total": 0,
        "queue": "standard",
    }


async def test_without_engine_codes_every_engine_turned_on_is_asked(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await _setup(resources, migrated, count=1)
    await enable_engine(migrated, scene.project, "google_ai_mode", enabled=False)

    response = await _bulk(api, scene, [scene.prompts[0].id])

    assert response.json()["meta"]["answers"] == 2
    (run,) = await _runs(migrated, scene)
    assert json.loads(run["config_snapshot"])["selector"]["engine_codes"] == [
        "chatgpt_web",
        "gemini_web",
    ]


async def test_thirty_prompts_are_one_of_the_days_twenty_manual_runs(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await _setup(resources, migrated, count=31)
    for _ in range(MANUAL_RUNS_PER_DAY - 1):
        await execute(
            migrated,
            "INSERT INTO ops.collection_runs (workspace_id, project_id, workload, window_start, "
            "window_end, trigger, status, created_by_type, config_snapshot) VALUES "
            "($1, $2, 'keyword_metrics', now(), now(), 'manual', 'completed', 'user', '{}')",
            scene.workspace.id,
            scene.project.id,
        )

    twentieth = await _bulk(api, scene, [prompt.id for prompt in scene.prompts[:30]])
    after = await _run_now(api, scene, scene.prompts[30])
    again = await _bulk(api, scene, [scene.prompts[30].id])

    assert twentieth.status_code == 202, twentieth.text
    assert twentieth.json()["meta"]["answers"] == 90
    assert twentieth.json()["meta"]["manual_runs_today"]["used"] == MANUAL_RUNS_PER_DAY
    assert problem(after) == (429, "manual_run_limit")
    assert problem(again) == (429, "manual_run_limit")
    # The 19 stand-ins and the one bulk run: nothing past the limit was recorded.
    assert len(await _runs(migrated, scene)) == MANUAL_RUNS_PER_DAY


async def test_what_the_planner_would_skip_is_listed_and_the_rest_runs(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await _setup(resources, migrated, count=1)
    (short,) = scene.prompts
    long = await add_prompt(migrated, scene.project, LONG)
    await enable_engine(migrated, scene.project, "gemini_web", location_ids=[OTHER_LOCATION])

    response = await _bulk(api, scene, [short.id, long.id])

    assert response.status_code == 202, response.text
    assert _skipped(response) == sorted(
        [
            (str(short.id), "gemini_web", "location_not_enabled"),
            (str(long.id), "gemini_web", "location_not_enabled"),
            (str(long.id), "google_ai_mode", "prompt_too_long"),
        ]
    )
    # The short prompt on ChatGPT and AI Mode, the long one on ChatGPT.
    assert (response.json()["meta"]["prompts"], response.json()["meta"]["answers"]) == (2, 3)


async def test_a_prompt_with_an_answer_on_its_way_is_left_out_on_every_engine(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await _setup(resources, migrated)
    pending, free = scene.prompts
    first = await _run_now(api, scene, pending)

    response = await _bulk(api, scene, [pending.id, free.id], ["chatgpt_web", "gemini_web"])

    assert first.status_code == 202
    assert response.status_code == 202, response.text
    assert _skipped(response) == [
        (str(pending.id), "chatgpt_web", "check_pending"),
        (str(pending.id), "gemini_web", "prompt_pending"),
    ]
    assert response.json()["meta"]["answers"] == 2
    bulk = (await _runs(migrated, scene))[-1]
    assert json.loads(bulk["config_snapshot"])["selector"]["prompt_ids"] == [str(free.id)]


async def test_only_pending_prompts_is_check_pending(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await _setup(resources, migrated)
    pending = scene.prompts[0]
    await _run_now(api, scene, pending)

    response = await _bulk(api, scene, [pending.id], ["chatgpt_web"])

    assert problem(response) == (409, "check_pending")
    assert response.json()["prompt_ids"] == [str(pending.id)]
    assert response.json()["skipped"] == [
        {"prompt_id": str(pending.id), "engine_code": "chatgpt_web", "reason": "check_pending"}
    ]
    assert len(await _runs(migrated, scene)) == 1


async def test_nothing_left_to_ask_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await _setup(resources, migrated, count=0)
    long = await add_prompt(migrated, scene.project, LONG)

    response = await _bulk(api, scene, [long.id], ["google_ai_mode"])

    assert problem(response) == (422, "nothing_to_run")
    assert response.json()["skipped"] == [
        {"prompt_id": str(long.id), "engine_code": "google_ai_mode", "reason": "prompt_too_long"}
    ]
    assert await _runs(migrated, scene) == []


async def test_a_double_click_creates_one_run(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await _setup(resources, migrated)
    ids = [prompt.id for prompt in scene.prompts]

    responses = await asyncio.gather(*(_bulk(api, scene, ids) for _ in range(5)))

    assert sorted(response.status_code for response in responses) == [202, 409, 409, 409, 409]
    assert len(await _runs(migrated, scene)) == 1


async def test_an_engine_not_on_or_a_prompt_the_project_does_not_ask_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await _setup(resources, migrated, count=1)
    (prompt,) = scene.prompts
    await enable_engine(migrated, scene.project, "gemini_web", enabled=False)
    elsewhere = Project(scene.workspace.id, await make_project(migrated, scene.workspace.id))
    theirs = await add_prompt(migrated, elsewhere, "Which SOC providers suit banks?")
    archived = await add_prompt(migrated, scene.project, "An archived SOC question?", active=False)

    off = await _bulk(api, scene, [prompt.id], ["gemini_web"])
    unknown = [
        await _bulk(api, scene, [prompt.id, other])
        for other in (theirs.id, archived.id, uuid.uuid4())
    ]

    assert errors(off) == [("engine_codes", "engine_not_enabled")]
    for response in unknown:
        assert errors(response) == [("prompt_ids", "prompt_unknown")]
    assert await _runs(migrated, scene) == []


async def test_the_months_answers_count_every_task_of_the_run(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await _setup(resources, migrated)
    await execute(
        migrated,
        "INSERT INTO core.workspace_quotas (workspace_id, max_ai_observations_per_month) "
        "VALUES ($1, 5) ON CONFLICT (workspace_id) DO UPDATE "
        "SET max_ai_observations_per_month = 5",
        scene.workspace.id,
    )

    response = await _bulk(api, scene, [prompt.id for prompt in scene.prompts])

    assert problem(response) == (422, "quota_exceeded")
    body = response.json()
    assert (body["limit"], body["used"], body["requested"], body["quota"]) == (
        5,
        0,
        6,
        "max_ai_observations_per_month",
    )
    assert await _runs(migrated, scene) == []
    assert await _tasks(migrated, scene) == 0


async def test_a_bulk_run_counts_against_the_month_with_the_runs_before_it(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Three answers asked by a run now, then a bulk run of three more that does not fit in 5."""
    scene = await _setup(resources, migrated)
    await execute(
        migrated,
        "INSERT INTO core.workspace_quotas (workspace_id, max_ai_observations_per_month) "
        "VALUES ($1, 5) ON CONFLICT (workspace_id) DO UPDATE "
        "SET max_ai_observations_per_month = 5",
        scene.workspace.id,
    )
    first = await api.post(
        scene.url("prompts", scene.prompts[0].id, "run-now"),
        json={"engine_codes": ENGINES},
        headers=scene.owner.headers,
    )

    refused = await _bulk(api, scene, [scene.prompts[1].id])

    assert first.status_code == 202, first.text
    assert problem(refused) == (422, "quota_exceeded")
    body = refused.json()
    assert (body["limit"], body["used"], body["requested"]) == (5, 3, 3)
    assert len(await _runs(migrated, scene)) == 1


async def test_at_most_150_prompts_and_a_repeat_is_dropped(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await _setup(resources, migrated, count=1)
    (prompt,) = scene.prompts

    too_many = await _bulk(api, scene, [uuid.uuid4() for _ in range(BASE_PLAN.max_prompts + 1)])
    twice = await _bulk(api, scene, [prompt.id, prompt.id])

    assert problem(too_many) == (422, "validation_failed")
    assert twice.status_code == 202, twice.text
    assert twice.json()["meta"]["prompts"] == 1


async def test_an_engine_without_a_price_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await _setup(resources, migrated, count=1)
    book = "ops.provider_price_book"
    gemini = "ai_optimization/gemini/llm_scraper"
    original = await fetch(
        migrated, f"SELECT id, valid_from FROM {book} WHERE endpoint = $1", gemini
    )
    await execute(
        migrated, f"UPDATE {book} SET valid_from = current_date + 30 WHERE endpoint = $1", gemini
    )
    try:
        response = await _bulk(api, scene, [scene.prompts[0].id], ["gemini_web"])
    finally:
        for row in original:
            await execute(
                migrated,
                f"UPDATE {book} SET valid_from = $1 WHERE id = $2",
                row["valid_from"],
                row["id"],
            )

    assert errors(response) == [("engine_codes", "price_unavailable")]
    assert await _runs(migrated, scene) == []


async def test_a_paused_provider_is_not_asked(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await _setup(resources, migrated, count=1)
    await resources.redis.set(f"rl:paused:{DATAFORSEO}", "no_balance", px=60_000)
    try:
        paused = await _bulk(api, scene, [scene.prompts[0].id])
    finally:
        await resources.redis.delete(f"rl:paused:{DATAFORSEO}")

    assert problem(paused) == (503, "provider_paused")
    assert await _runs(migrated, scene) == []
    assert await _tasks(migrated, scene) == 0


async def test_a_viewer_cannot_and_a_deleted_project_is_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await _setup(resources, migrated, count=1)
    viewer = await member(resources, migrated, scene.workspace, "viewer")
    ids = [scene.prompts[0].id]

    refused = await _bulk(api, scene, ids, caller=viewer)
    await execute(
        migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", scene.project.id
    )
    deleted = await _bulk(api, scene, ids)

    assert problem(refused) == (403, "forbidden")
    assert problem(deleted) == (404, "not_found")


async def test_150_prompts_read_as_many_statements_as_one(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    one = await _setup(resources, migrated, count=1)
    full = await _setup(resources, migrated, count=BASE_PLAN.max_prompts)

    with statements(resources) as few:
        small = await _bulk(api, one, [prompt.id for prompt in one.prompts])
    with statements(resources) as many:
        large = await _bulk(api, full, [prompt.id for prompt in full.prompts])

    assert small.status_code == large.status_code == 202, large.text
    assert large.json()["meta"]["answers"] == 450
    assert len(many) == len(few), many


async def _plan(worker_db: Ledger) -> None:
    """The worker's step that plans the runs people asked for."""
    registry = Registry()
    registry.add_workload(AiPromptWorkload())
    await plan_manual_runs(worker_db, registry, now=datetime.now(UTC))


async def _run_and_tasks(pg: PostgresServer, scene: Scene) -> tuple[list[str], int]:
    return [run["status"] for run in await _runs(pg, scene)], await _tasks(pg, scene)


async def test_the_worker_plans_exactly_the_tasks_the_response_counted(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
) -> None:
    scene = await _setup(resources, migrated, count=3)
    await make_budget(migrated, scene.project, "10", workload="ai_prompt", for_project=True)

    response = await _bulk(api, scene, [prompt.id for prompt in scene.prompts])
    await _plan(worker_db)

    assert response.status_code == 202, response.text
    assert response.json()["meta"]["answers"] == 9
    assert await _run_and_tasks(migrated, scene) == (["running"], 9)


async def test_a_budget_of_zero_blocks_a_bulk_run_and_no_task_is_made(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
) -> None:
    """The emergency brake of the first-run guide holds for a bulk run: it is recorded (a
    manual run of the day) and the worker blocks it when it plans it."""
    scene = await _setup(resources, migrated, count=3)
    budget_id = await make_budget(
        migrated, scene.project, "0", workload="ai_prompt", for_project=True
    )

    response = await _bulk(api, scene, [prompt.id for prompt in scene.prompts])
    await _plan(worker_db)

    assert response.status_code == 202, response.text
    assert await _run_and_tasks(migrated, scene) == (["budget_blocked"], 0)
    (run,) = await _runs(migrated, scene)
    assert (run["status_reason"], run["blocked_by_budget_id"]) == ("budget_exceeded", budget_id)


async def test_a_bulk_run_dearer_than_the_budget_is_blocked_whole(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
) -> None:
    """Nine answers cost 0.0108 USD: over a budget of 0.01, so none of them is sent."""
    scene = await _setup(resources, migrated, count=3)
    await make_budget(migrated, scene.project, "0.01", workload="ai_prompt", for_project=True)

    response = await _bulk(api, scene, [prompt.id for prompt in scene.prompts])
    await _plan(worker_db)

    assert Decimal(response.json()["meta"]["estimated_cost_usd"]) == Decimal("0.0108")
    assert await _run_and_tasks(migrated, scene) == (["budget_blocked"], 0)
