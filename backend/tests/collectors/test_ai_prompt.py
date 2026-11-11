"""The AI prompt workload (spec section 4.3): what it plans for a window, what it asks the
provider and what that costs. As `app_worker`."""

from __future__ import annotations

import hashlib
import uuid
from datetime import timedelta
from decimal import Decimal
from typing import Any

import pytest

from idraft.collectors import ledger
from idraft.collectors.ai_prompt import (
    MANUAL_PROMPTS_MAX,
    SUBJECT_TYPE,
    AiPromptWorkload,
    queue_of,
)
from idraft.collectors.ledger import LedgerTask, NewRun, NewTask, TaskRef
from idraft.collectors.registry import Plan, ScheduleWindow
from idraft.domain.workloads import TaskWorkload
from idraft.providers.dataforseo.ai import (
    AI_MODE,
    CHATGPT_SCRAPER,
    GEMINI_SCRAPER,
    AiAnswerParams,
)
from tests.api.auth.support import execute
from tests.api.keywords.support import LOCATION, OTHER_LOCATION
from tests.collectors.ai_support import AiWorld, Prompt, add_prompt, enable_engine, make_ai_world
from tests.collectors.rank_support import Ledger
from tests.collectors.support import NOW, Project, make_schedule
from tests.conftest import PostgresServer

WORKLOAD = AiPromptWorkload()
ENGINES = ("chatgpt_web", "gemini_web", "google_ai_mode")
QUESTION = "Which managed SOC providers work with mid-size banks?"


@pytest.fixture
async def world(migrated: PostgresServer, worker_db: Ledger) -> AiWorld:
    return await make_ai_world(migrated)


def _window(
    project: Project,
    selector: dict[str, Any] | None = None,
    *,
    schedule_id: uuid.UUID | None = None,
    mode: str = "standard_queue",
    hours: int = 12,
) -> ScheduleWindow:
    return ScheduleWindow(
        schedule_id=schedule_id,
        workspace_id=project.workspace_id,
        project_id=project.id,
        workload=TaskWorkload.AI_PROMPT,
        provider_mode=mode,
        selector=selector or {},
        window_start=NOW,
        window_end=NOW + timedelta(hours=hours),
        window_hours=hours,
    )


async def _plan(sessions: Ledger, window: ScheduleWindow) -> Plan:
    async with sessions() as db:
        return await WORKLOAD.plan(db, window)


async def _all_engines(pg: PostgresServer, project: Project) -> None:
    for code in ENGINES:
        await enable_engine(pg, project, code)


def _asked(plan: Plan) -> set[tuple[str, str | None]]:
    return {(task.subject_id, task.engine_code) for task in plan.tasks}


async def test_a_window_asks_each_active_prompt_once_on_each_enabled_engine(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    first = await add_prompt(migrated, project, QUESTION)
    second = await add_prompt(migrated, project, "Who offers 24x7 SOC monitoring in India?")
    await _all_engines(migrated, project)

    plan = await _plan(worker_db, _window(project, schedule_id=uuid.uuid4()))

    assert len(plan.tasks) == 6
    assert _asked(plan) == {
        (str(prompt.version_id), code) for prompt in (first, second) for code in ENGINES
    }
    assert {(task.engine_code, task.provider_endpoint) for task in plan.tasks} == {
        ("chatgpt_web", CHATGPT_SCRAPER),
        ("gemini_web", GEMINI_SCRAPER),
        ("google_ai_mode", AI_MODE),
    }
    assert {task.subject_type for task in plan.tasks} == {SUBJECT_TYPE}
    assert {(task.location_id, task.replicate_index, task.depth) for task in plan.tasks} == {
        (LOCATION, 1, None)
    }
    assert plan.estimated_cost_usd == Decimal("0.0072")
    snapshot = plan.config_snapshot
    assert (snapshot["queue"], snapshot["replicates"], snapshot["skipped_total"]) == (
        "standard",
        1,
        0,
    )


async def test_a_schedules_tasks_are_spread_over_its_window_the_same_way_every_run(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    for number in range(5):
        await add_prompt(migrated, project, f"{QUESTION} Case {number}.")
    await enable_engine(migrated, project, "chatgpt_web")
    window = _window(project, schedule_id=uuid.uuid4())

    once = await _plan(worker_db, window)
    twice = await _plan(worker_db, window)

    due = [task.scheduled_for for task in once.tasks]
    assert due == [task.scheduled_for for task in twice.tasks]
    assert all(NOW <= when < NOW + timedelta(hours=12) for when in due)
    assert len(set(due)) > 1


async def test_a_prompt_too_long_for_ai_mode_is_skipped_there_with_the_reason(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    long = await add_prompt(migrated, project, "Why " + "x" * 700)
    await enable_engine(migrated, project, "chatgpt_web")
    await enable_engine(migrated, project, "google_ai_mode")

    plan = await _plan(worker_db, _window(project, schedule_id=uuid.uuid4()))

    assert _asked(plan) == {(str(long.version_id), "chatgpt_web")}
    assert plan.config_snapshot["skipped"] == [
        {"prompt_id": str(long.id), "engine_code": "google_ai_mode", "reason": "prompt_too_long"}
    ]
    assert plan.config_snapshot["skipped_total"] == 1


async def test_archived_prompts_and_engines_turned_off_are_not_asked(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    live = await add_prompt(migrated, project, QUESTION)
    await add_prompt(migrated, project, "An archived prompt about SOC pricing?", active=False)
    await enable_engine(migrated, project, "chatgpt_web")
    await enable_engine(migrated, project, "gemini_web", enabled=False)

    plan = await _plan(worker_db, _window(project, schedule_id=uuid.uuid4()))

    assert _asked(plan) == {(str(live.version_id), "chatgpt_web")}


async def test_a_prompt_whose_country_no_engine_location_has_is_skipped(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    nowhere = await add_prompt(migrated, project, QUESTION, country="ZZ")
    british = await add_prompt(
        migrated, project, "Best SOC providers for UK retailers?", country="GB"
    )
    await enable_engine(migrated, project, "chatgpt_web", location_ids=[LOCATION])

    plan = await _plan(worker_db, _window(project, schedule_id=uuid.uuid4()))

    assert plan.tasks == []
    assert sorted(
        (item["prompt_id"], item["reason"]) for item in plan.config_snapshot["skipped"]
    ) == sorted(
        [(str(nowhere.id), "location_not_enabled"), (str(british.id), "location_not_enabled")]
    )


async def test_an_engine_in_two_countries_asks_each_prompt_in_its_own(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    american = await add_prompt(migrated, project, QUESTION)
    british = await add_prompt(
        migrated, project, "Best SOC providers for UK retailers?", country="GB"
    )
    await enable_engine(migrated, project, "chatgpt_web", location_ids=[LOCATION, OTHER_LOCATION])

    plan = await _plan(worker_db, _window(project, schedule_id=uuid.uuid4()))

    assert {(task.subject_id, task.location_id) for task in plan.tasks} == {
        (str(american.version_id), LOCATION),
        (str(british.version_id), OTHER_LOCATION),
    }


async def test_a_manual_run_asks_the_prompts_and_engines_it_names_at_once(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    named = await add_prompt(migrated, project, QUESTION)
    await add_prompt(migrated, project, "Who offers 24x7 SOC monitoring in India?")
    await _all_engines(migrated, project)
    selector = {"prompt_ids": [str(named.id)], "engine_codes": ["gemini_web"]}

    plan = await _plan(worker_db, _window(project, selector))

    assert _asked(plan) == {(str(named.version_id), "gemini_web")}
    assert [task.scheduled_for for task in plan.tasks] == [NOW]
    assert plan.estimated_cost_usd == Decimal("0.0012")
    assert plan.config_snapshot["selector"] == selector


async def test_a_manual_run_without_prompts_asks_nothing_and_one_of_too_many_is_refused(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    await add_prompt(migrated, project, QUESTION)
    await _all_engines(migrated, project)
    too_many = {"prompt_ids": [str(uuid.uuid4()) for _ in range(MANUAL_PROMPTS_MAX + 1)]}

    nothing = await _plan(worker_db, _window(project, {}))

    assert nothing.tasks == []
    with pytest.raises(ValueError, match="at most 100"):
        await _plan(worker_db, _window(project, too_many))


async def _scheduled_run(
    sessions: Ledger, project: Project, schedule_id: uuid.UUID, prompt: Prompt, engine: str
) -> None:
    """A run of another schedule whose window overlaps NOW, with a task for the prompt."""
    async with sessions() as db, db.begin():
        run_id = await ledger.create_run(
            db,
            NewRun(
                workspace_id=project.workspace_id,
                project_id=project.id,
                schedule_id=schedule_id,
                workload=TaskWorkload.AI_PROMPT,
                window_start=NOW - timedelta(hours=2),
                window_end=NOW + timedelta(hours=2),
                trigger="schedule",
                config_snapshot={},
            ),
            now=NOW,
        )
        assert run_id is not None
        await ledger.insert_tasks(
            db,
            run_id,
            [
                NewTask(
                    subject_type=SUBJECT_TYPE,
                    subject_id=str(prompt.version_id),
                    engine_code=engine,
                    location_id=LOCATION,
                    replicate_index=1,
                    depth=None,
                    request_fingerprint=hashlib.sha256(uuid.uuid4().bytes).digest(),
                    provider_code="dataforseo",
                    provider_endpoint=CHATGPT_SCRAPER,
                    scheduled_for=NOW,
                )
            ],
        )


async def test_a_prompt_another_schedule_asked_in_this_window_is_not_asked_twice(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    prompt = await add_prompt(migrated, project, QUESTION)
    await enable_engine(migrated, project, "chatgpt_web")
    await enable_engine(migrated, project, "gemini_web")
    other = await make_schedule(migrated, project, workload="ai_prompt")
    await _scheduled_run(worker_db, project, other, prompt, "chatgpt_web")

    plan = await _plan(worker_db, _window(project, schedule_id=uuid.uuid4()))
    manual = await _plan(worker_db, _window(project, {"prompt_ids": [str(prompt.id)]}))

    assert _asked(plan) == {(str(prompt.version_id), "gemini_web")}
    # A person who asks gets an answer, whatever the schedules did.
    assert len(manual.tasks) == 2


async def test_the_priority_queue_is_the_schedules_choice_and_costs_twice(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    await add_prompt(migrated, project, QUESTION)
    await enable_engine(migrated, project, "chatgpt_web")

    plan = await _plan(worker_db, _window(project, schedule_id=uuid.uuid4(), mode="priority_queue"))

    assert plan.config_snapshot["queue"] == "priority"
    assert plan.estimated_cost_usd == Decimal("0.0024")
    assert (queue_of("live"), queue_of("standard_queue")) == ("standard", "standard")


def _ledger_task(
    project: Project, run_id: uuid.UUID, prompt: Prompt, engine: str, number: int
) -> LedgerTask:
    return LedgerTask(
        ref=TaskRef(id=number, created_at=NOW),
        run_id=run_id,
        workspace_id=project.workspace_id,
        project_id=project.id,
        workload=TaskWorkload.AI_PROMPT,
        subject_type=SUBJECT_TYPE,
        subject_id=str(prompt.version_id),
        engine_code=engine,
        location_id=OTHER_LOCATION,
        replicate_index=1,
        provider_code="dataforseo",
        provider_endpoint=CHATGPT_SCRAPER,
        provider_task_id=None,
        status="pending",
        attempts=0,
        scheduled_for=NOW,
        priority="high",
        window_end=NOW + timedelta(hours=1),
    )


async def _manual_run(sessions: Ledger, project: Project, queue: str) -> uuid.UUID:
    async with sessions() as db, db.begin():
        run_id = await ledger.create_run(
            db,
            NewRun(
                workspace_id=project.workspace_id,
                project_id=project.id,
                schedule_id=None,
                workload=TaskWorkload.AI_PROMPT,
                window_start=NOW,
                window_end=NOW + timedelta(hours=1),
                trigger="manual",
                config_snapshot={"queue": queue},
            ),
            now=NOW,
        )
    assert run_id is not None
    return run_id


async def test_a_request_asks_the_prompt_as_saved_at_its_location_and_queue(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    await execute(
        migrated,
        "INSERT INTO core.provider_location_map (provider_code, location_id, provider_value, "
        "supports) VALUES ('dataforseo', $1, '9002826', ARRAY['serp']) "
        "ON CONFLICT (provider_code, location_id) DO UPDATE SET provider_value = '9002826'",
        OTHER_LOCATION,
    )
    prompt = await add_prompt(migrated, project, QUESTION, country="GB", language="de")
    archived = await add_prompt(migrated, project, "Archived later, about SOC tools?")
    run_id = await _manual_run(worker_db, project, "priority")
    tasks = [
        _ledger_task(project, run_id, prompt, "chatgpt_web", 1),
        _ledger_task(project, run_id, archived, "chatgpt_web", 2),
    ]
    await execute(migrated, "UPDATE ai.prompts SET is_active = false WHERE id = $1", archived.id)

    async with worker_db() as db:
        requests = await WORKLOAD.build_requests(db, tasks)

    assert set(requests) == {tasks[0].ref}
    request = requests[tasks[0].ref]
    assert request.params == AiAnswerParams(
        prompt=QUESTION, location_code=9002826, language_code="de", queue="priority"
    )
    assert (request.task_id, request.run_id, request.priority) == ("1", run_id, "high")
    assert WORKLOAD.batch_key(tasks[0]) == ""
