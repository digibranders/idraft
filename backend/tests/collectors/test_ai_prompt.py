"""The AI prompt workload (spec section 4.3): what it plans for a window, what it asks the
provider and what that costs. As `app_worker`."""

from __future__ import annotations

import dataclasses
import hashlib
import json
import uuid
from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import event

from idraft.collectors import ledger
from idraft.collectors.ai_prompt import (
    MANUAL_PROMPTS_MAX,
    SUBJECT_TYPE,
    AiPromptWorkload,
    Subject,
    estimate,
    queue_of,
)
from idraft.collectors.ledger import LedgerTask, NewRun, NewTask, TaskRef
from idraft.collectors.registry import Plan, ScheduleWindow
from idraft.domain.workloads import TaskWorkload
from idraft.providers.contract import CanonicalRequest
from idraft.providers.dataforseo.ai import (
    AI_MODE,
    CHATGPT_SCRAPER,
    ENGINE_ENDPOINTS,
    GEMINI_SCRAPER,
    AiAnswerParams,
    ai_mode_body,
    scraper_body,
)
from tests.api.auth.support import execute
from tests.api.keywords.support import LOCATION, OTHER_LOCATION
from tests.collectors.ai_support import AiWorld, Prompt, add_prompt, enable_engine, make_ai_world
from tests.collectors.rank_support import Ledger
from tests.collectors.support import NOW, Project, another_project, make_schedule
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
    with pytest.raises(ValueError, match="at most 150"):
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


# The device of Google AI Mode (WP-31): a saved project setting, read when the request is built.

TAG = "i:test:t:z:a:1:r:0192f0a13c447e108a512b7d9c0e4f11"
SHAPED = '{"keyword":"%s","location_code":%d,"language_code":"en","priority":1,"tag":"%s"%s}'
DESKTOP_TAIL = ',"device":"desktop","os":"windows"'


def _params_of(request: CanonicalRequest) -> AiAnswerParams:
    assert isinstance(request.params, AiAnswerParams)
    return request.params


def _assert_sent(request: CanonicalRequest, *, ai_mode: bool, tail: str = "") -> None:
    """The task body of a request, as the client would serialize it (compact JSON), is the
    literal body of today byte for byte: the prompt, its location, the queue and the tag, then
    `tail` (the device and os of AI Mode)."""
    build = ai_mode_body if ai_mode else scraper_body
    sent = json.dumps(build(request, TAG), separators=(",", ":"), ensure_ascii=False).encode()
    location = _params_of(request).location_code
    assert sent == (SHAPED % (QUESTION, location, TAG, tail)).encode()


async def _build_counting(
    sessions: Ledger, tasks: Sequence[LedgerTask]
) -> tuple[Mapping[TaskRef, CanonicalRequest], list[str]]:
    """`build_requests` with the SQL statements it sent."""
    seen: list[str] = []

    def record(*args: Any) -> None:
        seen.append(args[2])

    async with sessions() as db:
        engine = db.sync_session.get_bind()
        event.listen(engine, "before_cursor_execute", record)
        try:
            requests = await WORKLOAD.build_requests(db, tasks)
        finally:
            event.remove(engine, "before_cursor_execute", record)
    return requests, seen


async def test_an_ai_mode_request_asks_the_device_the_project_chose(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    mobile, desktop = world.project, await another_project(migrated, world.project)
    stranger = (await make_ai_world(migrated)).project
    await enable_engine(migrated, mobile, "google_ai_mode", provider_params='{"device": "mobile"}')
    await enable_engine(
        migrated, desktop, "google_ai_mode", provider_params='{"device": "desktop"}'
    )
    # Another workspace's project turned mobile on; no task of the two above may read it.
    await enable_engine(
        migrated, stranger, "google_ai_mode", provider_params='{"device": "mobile"}'
    )
    tasks: list[LedgerTask] = []
    for number, project in enumerate((mobile, desktop), 1):
        prompt = await add_prompt(migrated, project, QUESTION)
        run_id = await _manual_run(worker_db, project, "standard")
        tasks.append(_ledger_task(project, run_id, prompt, "google_ai_mode", number))

    requests, _ = await _build_counting(worker_db, tasks)

    devices = {task.project_id: _params_of(requests[task.ref]).device for task in tasks}
    assert devices == {mobile.id: "mobile", desktop.id: "desktop"}


async def test_a_task_naming_another_workspace_never_reads_the_project_engine_of_its_project_id(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    """The device row is read by the task's own workspace and project: a task whose workspace is
    not the project's finds no setting and asks the default."""
    project = world.project
    stranger = (await make_ai_world(migrated)).project
    await enable_engine(migrated, project, "google_ai_mode", provider_params='{"device": "mobile"}')
    prompt = await add_prompt(migrated, stranger, QUESTION)
    run_id = await _manual_run(worker_db, stranger, "standard")
    crossed = dataclasses.replace(
        _ledger_task(stranger, run_id, prompt, "google_ai_mode", 1), project_id=project.id
    )

    requests, _ = await _build_counting(worker_db, [crossed])

    assert _params_of(requests[crossed.ref]).device == "desktop"


@pytest.mark.parametrize(
    "saved",
    [None, "{}", '{"device": "tablet"}', '{"device": null}', '"mobile"', "[1]", '{"os": "ios"}'],
)
async def test_a_request_for_an_engine_without_settings_asks_desktop_byte_for_byte(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld, saved: str | None
) -> None:
    """No row, an empty object or junk: the request is what is sent today, byte for byte."""
    project = world.project
    if saved is not None:
        await enable_engine(migrated, project, "google_ai_mode", provider_params=saved)
    prompt = await add_prompt(migrated, project, QUESTION)
    run_id = await _manual_run(worker_db, project, "standard")
    task = _ledger_task(project, run_id, prompt, "google_ai_mode", 1)

    requests, _ = await _build_counting(worker_db, [task])

    params = _params_of(requests[task.ref])
    assert params == AiAnswerParams(
        prompt=QUESTION, location_code=params.location_code, language_code="en", queue="standard"
    )
    _assert_sent(requests[task.ref], ai_mode=True, tail=DESKTOP_TAIL)


async def test_a_saved_desktop_asks_what_is_sent_today_and_mobile_changes_only_device_and_os(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    await enable_engine(
        migrated, project, "google_ai_mode", provider_params='{"device": "desktop"}'
    )
    prompt = await add_prompt(migrated, project, QUESTION)
    run_id = await _manual_run(worker_db, project, "standard")
    task = _ledger_task(project, run_id, prompt, "google_ai_mode", 1)

    requests, _ = await _build_counting(worker_db, [task])
    await enable_engine(migrated, project, "google_ai_mode", provider_params='{"device": "mobile"}')
    on_mobile, _ = await _build_counting(worker_db, [task])

    _assert_sent(requests[task.ref], ai_mode=True, tail=DESKTOP_TAIL)
    _assert_sent(on_mobile[task.ref], ai_mode=True, tail=',"device":"mobile","os":"android"')


async def test_chatgpt_and_gemini_requests_ignore_provider_params(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    for code in ("chatgpt_web", "gemini_web"):
        await enable_engine(migrated, project, code, provider_params='{"device": "mobile"}')
    prompt = await add_prompt(migrated, project, QUESTION)
    run_id = await _manual_run(worker_db, project, "standard")
    tasks = [
        _ledger_task(project, run_id, prompt, code, n)
        for n, code in enumerate(("chatgpt_web", "gemini_web"), 1)
    ]

    requests, statements = await _build_counting(worker_db, tasks)

    assert set(requests) == {task.ref for task in tasks}
    for task in tasks:
        assert _params_of(requests[task.ref]).device == "desktop"
        _assert_sent(requests[task.ref], ai_mode=False)
    # Scrapers take no device: the settings are not even read for them.
    assert not [statement for statement in statements if "provider_params" in statement]


async def test_the_devices_of_a_batch_are_one_query_however_many_ai_mode_tasks_it_holds(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    first, second = world.project, await another_project(migrated, world.project)
    for project in (first, second):
        await enable_engine(
            migrated, project, "google_ai_mode", provider_params='{"device": "mobile"}'
        )
    run_ids = {
        project.id: await _manual_run(worker_db, project, "standard") for project in (first, second)
    }
    tasks: list[LedgerTask] = []
    for number, project in enumerate((first, second, first, second, first), 1):
        prompt = await add_prompt(migrated, project, f"{QUESTION} {number}")
        tasks.append(_ledger_task(project, run_ids[project.id], prompt, "google_ai_mode", number))
    scrapers = [
        _ledger_task(
            first, run_ids[first.id], await add_prompt(migrated, first, "Scraped?"), code, n
        )
        for n, code in enumerate(("chatgpt_web", "gemini_web"), 10)
    ]

    one, one_statements = await _build_counting(worker_db, tasks[:1])
    many, many_statements = await _build_counting(worker_db, tasks)
    none, none_statements = await _build_counting(worker_db, scrapers)

    assert (len(one), len(many), len(none)) == (1, 5, 2)
    reads = [s for s in many_statements if "provider_params" in s]
    assert len(reads) == 1
    assert "project_engines" in reads[0]
    # The device read is the only statement more than a batch of scrapers sends, for 1 task or 5.
    assert len(one_statements) == len(many_statements) == len(none_statements) + 1


# What the plan may spend: these tests guard the money and the tenant boundary.

BEFORE_THE_PRICE_BOOK = date(2000, 1, 1)


async def test_without_a_price_nothing_is_planned_and_no_cost_is_estimated(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    await add_prompt(migrated, project, QUESTION)
    await _all_engines(migrated, project)
    # A window that opens before the price book's first row: no endpoint has a price.
    opens = datetime(2000, 1, 1, tzinfo=UTC)
    window = dataclasses.replace(
        _window(project, schedule_id=uuid.uuid4()),
        window_start=opens,
        window_end=opens + timedelta(hours=12),
    )

    async with worker_db() as db:
        subjects = [
            Subject(uuid.uuid4(), uuid.uuid4(), "google_ai_mode", LOCATION),
            Subject(uuid.uuid4(), uuid.uuid4(), "chatgpt_web", LOCATION),
        ]
        guessed = await estimate(db, subjects, queue="standard", on=BEFORE_THE_PRICE_BOOK)
        plan = await WORKLOAD.plan(db, window)

    assert guessed is None
    assert plan.tasks == []
    assert plan.estimated_cost_usd == Decimal(0)
    assert plan.config_snapshot["queue"] == "standard"


async def test_only_the_live_prompts_of_the_planned_project_are_asked(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    live = await add_prompt(migrated, project, QUESTION)
    archived = await add_prompt(migrated, project, "An archived prompt about SOC pricing?")
    deleted = await add_prompt(migrated, project, "A deleted prompt about SOC pricing?")
    await execute(migrated, "UPDATE ai.prompts SET is_active = false WHERE id = $1", archived.id)
    await execute(migrated, "UPDATE ai.prompts SET deleted_at = now() WHERE id = $1", deleted.id)
    sibling = await another_project(migrated, project)
    await add_prompt(migrated, sibling, "A prompt of the second project in the workspace?")
    stranger = (await make_ai_world(migrated)).project
    await add_prompt(migrated, stranger, "A prompt of another workspace entirely?")
    # Only the others turn on AI Mode, so an engine read across projects would show.
    for code in ("chatgpt_web", "gemini_web"):
        await enable_engine(migrated, project, code)
    for each in (sibling, stranger):
        await _all_engines(migrated, each)

    plan = await _plan(worker_db, _window(project, schedule_id=uuid.uuid4()))
    # The project's id with another workspace's id names no project: nothing is read.
    crossed = await _plan(
        worker_db,
        dataclasses.replace(
            _window(project, schedule_id=uuid.uuid4()), workspace_id=stranger.workspace_id
        ),
    )

    assert _asked(plan) == {(str(live.version_id), code) for code in ENGINES[:2]}
    assert crossed.tasks == []


async def test_an_engine_the_catalogue_has_turned_off_is_not_asked(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    project = world.project
    prompt = await add_prompt(migrated, project, QUESTION)
    await _all_engines(migrated, project)
    await execute(migrated, "UPDATE ai.engines SET is_active = false WHERE code = 'gemini_web'")
    try:
        plan = await _plan(worker_db, _window(project, schedule_id=uuid.uuid4()))
    finally:
        await execute(migrated, "UPDATE ai.engines SET is_active = true WHERE code = 'gemini_web'")

    assert _asked(plan) == {
        (str(prompt.version_id), "chatgpt_web"),
        (str(prompt.version_id), "google_ai_mode"),
    }


async def test_a_full_plan_costs_fifty_four_cents(worker_db: Ledger) -> None:
    """The base plan (150 prompts on 3 engines, standard queue): 450 tasks at 0.0012 USD."""
    subjects = [
        Subject(uuid.uuid4(), uuid.uuid4(), engine, LOCATION)
        for _ in range(150)
        for engine in ENGINE_ENDPOINTS
    ]

    async with worker_db() as db:
        cost = await estimate(db, subjects, queue="standard", on=NOW.date())

    assert len(subjects) == 450
    assert cost == Decimal("0.54")


async def test_an_engine_with_two_locations_in_the_prompts_country_asks_it_at_both(
    worker_db: Ledger, migrated: PostgresServer, world: AiWorld
) -> None:
    """Plan decision A5 as built: every enabled location of the prompt's country is asked, and
    paid for. Pinned so a change to one answer per engine is a decision, not an accident."""
    project = world.project
    second_us = 9990001
    await execute(
        migrated,
        "INSERT INTO core.locations (id, name, country_iso, location_type) "
        "VALUES ($1, 'United States (second)', 'US', 'Country') ON CONFLICT (id) DO NOTHING",
        second_us,
    )
    prompt = await add_prompt(migrated, project, QUESTION)
    await enable_engine(migrated, project, "chatgpt_web", location_ids=[LOCATION, second_us])

    plan = await _plan(worker_db, _window(project, schedule_id=uuid.uuid4()))

    assert {(task.subject_id, task.location_id) for task in plan.tasks} == {
        (str(prompt.version_id), LOCATION),
        (str(prompt.version_id), second_us),
    }
    assert plan.estimated_cost_usd == Decimal("0.0024")
