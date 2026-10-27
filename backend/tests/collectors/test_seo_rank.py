"""The rank workload (plan R1, R9, R10 and the depth profiles of docs/06 section 2.2): what it
plans for a window, what it asks the provider, and the tick that checks new keywords. As
`app_worker`."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest

from idraft.collectors import ledger
from idraft.collectors.ledger import LedgerTask, NewRun, TaskRef
from idraft.collectors.registry import ScheduleWindow
from idraft.collectors.seo_rank import (
    SeoRankWorkload,
    is_deep_day,
    local_day,
    parse_subject,
    queue_new_keywords,
    queue_of,
    subject_id,
)
from idraft.collectors.seo_rank_ingest import ingest
from idraft.domain.workloads import TaskWorkload
from idraft.providers.dataforseo.serp import SERP_ORGANIC, SERP_ORGANIC_LIVE, SerpOrganicParams
from tests.api.auth.support import execute, fetch, fetchrow
from tests.api.keywords.support import OTHER_LOCATION
from tests.collectors.rank_support import Ledger, World, answer, fetched_task, make_world, track
from tests.collectors.support import NOW, Project, make_schedule, make_tenant
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

WORKLOAD = SeoRankWorkload()
MONDAY = datetime(2026, 10, 5, 2, 0, tzinfo=UTC)  # the default deep-check weekday
TUESDAY = MONDAY + timedelta(days=1)


def _window(
    project: Project,
    selector: dict[str, Any] | None = None,
    *,
    start: datetime = TUESDAY,
    schedule_id: uuid.UUID | None = None,
    mode: str = "standard_queue",
) -> ScheduleWindow:
    return ScheduleWindow(
        schedule_id=schedule_id,
        workspace_id=project.workspace_id,
        project_id=project.id,
        workload=TaskWorkload.SEO_RANK,
        provider_mode=mode,
        selector={"all": True} if selector is None else selector,
        window_start=start,
        window_end=start + timedelta(hours=6),
        window_hours=6,
    )


async def _plan(sessions: Ledger, window: ScheduleWindow) -> Any:
    async with sessions() as db:
        return await WORKLOAD.plan(db, window)


async def _tracked(
    pg: PostgresServer,
    project: Project,
    text: str,
    *,
    profile: str = "standard",
    priority: int = 3,
    schedule_id: uuid.UUID | None = None,
    active: bool = True,
    deleted: bool = False,
    device: str = "desktop",
    location: int | None = None,
) -> uuid.UUID:
    tracked_id = await track(pg, project, text, device=device, deleted=deleted)
    await execute(
        pg,
        "UPDATE seo.tracked_keywords SET depth_profile = $2, priority = $3, schedule_id = $4, "
        "is_active = $5, location_id = coalesce($6, location_id) WHERE id = $1",
        tracked_id,
        profile,
        priority,
        schedule_id,
        active,
        location,
    )
    return tracked_id


def _depths(plan: Any) -> dict[uuid.UUID, int]:
    found = {}
    for task in plan.tasks:
        parsed = parse_subject(task.subject_id)
        assert parsed is not None
        assert task.depth == parsed[1]
        found[parsed[0]] = parsed[1]
    return found


@pytest.fixture
async def world(migrated: PostgresServer, worker_db: Ledger) -> World:
    return await make_world(migrated)


# Subjects and days.


def test_a_subject_carries_the_depth_and_nothing_else_parses() -> None:
    tracked = uuid.uuid4()

    assert parse_subject(subject_id(tracked, 50)) == (tracked, 50)
    assert parse_subject("not a subject") is None
    assert parse_subject(f"{tracked}:deep") is None
    assert parse_subject(str(tracked)) is None


def test_the_deep_check_falls_on_the_project_local_weekday() -> None:
    assert is_deep_day(date(2026, 10, 5), 1)  # Monday
    assert not is_deep_day(date(2026, 10, 6), 1)
    assert is_deep_day(date(2026, 10, 4), 0)  # Sunday is 0


def test_the_local_day_follows_the_zone_across_a_clock_change() -> None:
    # New York turns its clocks back on 1 November: that day is 25 hours long.
    day, start, end = local_day("America/New_York", datetime(2026, 11, 1, 12, 0, tzinfo=UTC))

    assert day == date(2026, 11, 1)
    assert end - start == timedelta(hours=25)
    # 23:00 on 1 November in New York is 04:00 UTC on the 2nd: still the 1st there.
    assert local_day("America/New_York", datetime(2026, 11, 2, 4, 0, tzinfo=UTC))[0] == date(
        2026, 11, 1
    )
    assert local_day("America/New_York", datetime(2026, 11, 2, 5, 30, tzinfo=UTC))[0] == date(
        2026, 11, 2
    )


def test_only_a_schedule_that_chose_the_priority_queue_uses_it() -> None:
    assert queue_of("priority_queue") == "priority"
    assert {queue_of(mode) for mode in ("standard_queue", "live")} == {"standard"}


def test_a_run_that_asked_for_a_live_check_uses_the_live_call_whatever_its_mode() -> None:
    assert {queue_of(mode, {"live": True}) for mode in ("standard_queue", "live")} == {"live"}
    assert queue_of("priority_queue", {"live": False}) == "priority"
    assert queue_of("standard_queue", {"all": True}) == "standard"


# Planning.


async def test_each_profile_is_planned_at_its_depth_and_the_deep_weekday_replaces_the_daily_check(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    project = world.project
    ids = {
        profile: await _tracked(migrated, project, f"crm {profile}", profile=profile)
        for profile in ("light", "standard", "deep", "full", "weekly", "weekly_light")
    }
    refused = await _tracked(migrated, project, "crm until", profile="until_own_match_100")

    tuesday = _depths(await _plan(worker_db, _window(project, start=TUESDAY)))
    monday = _depths(await _plan(worker_db, _window(project, start=MONDAY)))

    assert tuesday == {
        ids["light"]: 10,
        ids["standard"]: 20,
        ids["deep"]: 50,
        ids["full"]: 100,
    }
    assert monday == {
        ids["light"]: 100,
        ids["standard"]: 100,
        ids["deep"]: 100,
        ids["full"]: 100,
        ids["weekly"]: 100,
        ids["weekly_light"]: 20,
    }
    assert refused not in monday


async def test_the_deep_weekday_is_the_projects_own_and_read_in_its_zone(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    project = world.project
    keyword = await _tracked(migrated, project, "crm")
    await execute(
        migrated,
        "UPDATE core.projects SET timezone = 'America/New_York', deep_check_weekday = 2 "
        "WHERE id = $1",
        project.id,
    )
    # 02:00 UTC on Tuesday 6 October is Monday evening in New York: not deep. Wednesday 02:00
    # UTC is Tuesday evening there, which is.
    monday_evening = _depths(await _plan(worker_db, _window(project, start=TUESDAY)))
    tuesday_evening = _depths(
        await _plan(worker_db, _window(project, start=TUESDAY + timedelta(days=1)))
    )

    assert monday_evening == {keyword: 20}
    assert tuesday_evening == {keyword: 100}


async def test_the_selector_narrows_what_is_planned_and_none_selects_nothing(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    project = world.project
    other = await make_tenant(migrated)
    top = await _tracked(migrated, project, "crm top", priority=1)
    low = await _tracked(migrated, project, "crm low", priority=5)
    await _tracked(migrated, project, "crm archived", active=False)
    await _tracked(migrated, project, "crm deleted", deleted=True)
    await track(migrated, other, "crm foreign")
    grouped = await _tracked(migrated, project, "crm grouped")
    group = await fetch_one(
        migrated,
        "INSERT INTO seo.keyword_groups (workspace_id, project_id, name, path) "
        "VALUES ($1, $2, 'Group', 'group') RETURNING id",
        project.workspace_id,
        project.id,
    )
    await execute(
        migrated,
        "INSERT INTO seo.keyword_group_members (group_id, tracked_keyword_id, project_id, "
        "workspace_id) VALUES ($1, $2, $3, $4)",
        group,
        grouped,
        project.id,
        project.workspace_id,
    )

    everything = _depths(await _plan(worker_db, _window(project, {"all": True})))
    important = _depths(await _plan(worker_db, _window(project, {"priority_lte": 1})))
    in_group = _depths(await _plan(worker_db, _window(project, {"groups": [str(group)]})))
    nothing = await _plan(worker_db, _window(project, {}))

    assert set(everything) == {top, low, grouped}
    assert set(important) == {top}
    assert set(in_group) == {grouped}
    assert list(nothing.tasks) == []
    assert nothing.estimated_cost_usd == Decimal(0)


async def test_a_keyword_that_names_a_schedule_is_left_to_it(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    project = world.project
    mine = await make_schedule(migrated, project, selector={"all": True})
    other_schedule = await make_schedule(migrated, project, selector={"all": True})
    shared = await _tracked(migrated, project, "crm shared")
    pinned = await _tracked(migrated, project, "crm pinned", schedule_id=mine)

    for_mine = _depths(await _plan(worker_db, _window(project, schedule_id=mine)))
    for_other = _depths(await _plan(worker_db, _window(project, schedule_id=other_schedule)))

    assert set(for_mine) == {shared, pinned}
    assert set(for_other) == {shared}


async def test_a_keyword_is_planned_once_a_local_day_across_schedules(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    project = world.project
    first = await make_schedule(migrated, project, selector={"all": True})
    second = await make_schedule(migrated, project, selector={"all": True})
    keyword = await _tracked(migrated, project, "crm daily")
    window = _window(project, schedule_id=first)
    plan = await _plan(worker_db, window)
    async with worker_db() as db, db.begin():
        run_id = await ledger.create_run(
            db,
            NewRun(
                workspace_id=project.workspace_id,
                project_id=project.id,
                schedule_id=first,
                workload=TaskWorkload.SEO_RANK,
                window_start=window.window_start,
                window_end=window.window_end,
                trigger="schedule",
                config_snapshot={},
            ),
            now=NOW,
        )
        assert run_id is not None
        await ledger.insert_tasks(db, run_id, plan.tasks)
        await ledger.start_run(
            db, run_id, tasks_total=len(plan.tasks), estimated_cost_usd=Decimal(0)
        )

    later_that_day = _window(
        project, schedule_id=second, start=window.window_start + timedelta(hours=8)
    )
    next_day = _window(project, schedule_id=second, start=window.window_start + timedelta(days=1))

    assert _depths(plan) == {keyword: 20}
    assert _depths(await _plan(worker_db, later_that_day)) == {}
    assert _depths(await _plan(worker_db, next_day)) == {keyword: 20}
    # The schedule that planned it can plan it again: nothing is added by the second time.
    assert _depths(await _plan(worker_db, window)) == {keyword: 20}
    async with worker_db() as db, db.begin():
        assert await ledger.insert_tasks(db, run_id, plan.tasks) == 0


async def test_new_keywords_are_those_never_checked_and_not_asked_about_lately(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    project = world.project
    fresh = await _tracked(migrated, project, "crm fresh")
    checked = await _tracked(migrated, project, "crm checked")
    store = MemoryStore()
    await fetched_task(
        worker_db,
        migrated,
        world,
        checked,
        answer([f"https://elsewhere-{i}.example/" for i in range(1, 4)]),
        store,
    )
    await ingest(worker_db, store)

    plan = await _plan(worker_db, _window(project, {"new": True}))

    assert set(_depths(plan)) == {fresh}


# Check now.


async def test_check_now_plans_the_named_keywords_live_and_due_at_once(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    project = world.project
    schedule = await make_schedule(migrated, project, selector={"all": True})
    named = await _tracked(migrated, project, "crm named")
    # What a schedule or an earlier check today would leave alone is checked when it is named.
    pinned = await _tracked(migrated, project, "crm pinned", schedule_id=schedule)
    weekly = await _tracked(migrated, project, "crm weekly", profile="weekly")
    left_out = await _tracked(migrated, project, "crm left out")
    archived = await _tracked(migrated, project, "crm archived", active=False)
    foreign = await track(migrated, await make_tenant(migrated), "crm foreign")
    selector = {
        "tracked_keyword_ids": [str(i) for i in (named, pinned, weekly, archived, foreign)],
        "live": True,
    }

    plan = await _plan(worker_db, _window(project, selector))

    assert set(_depths(plan)) == {named, pinned, weekly}
    assert left_out not in _depths(plan)
    # The daily depth of each profile; a weekly one has none today and gets its deep check.
    assert _depths(plan) == {named: 20, pinned: 20, weekly: 100}
    assert {task.provider_endpoint for task in plan.tasks} == {SERP_ORGANIC_LIVE}
    assert {task.scheduled_for for task in plan.tasks} == {TUESDAY}
    assert plan.config_snapshot["queue"] == "live"
    assert plan.config_snapshot["selector"] == selector
    # (2 + 2 + 10) pages at the live price of $0.002, and no asynchronous AI Overview to add.
    assert plan.estimated_cost_usd == Decimal("0.028")


async def test_check_now_checks_at_the_depth_asked_for(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    project = world.project
    first = await _tracked(migrated, project, "crm first", profile="full")
    second = await _tracked(migrated, project, "crm second", profile="light")
    selector = {"tracked_keyword_ids": [str(first), str(second)], "live": True, "depth": 10}

    plan = await _plan(worker_db, _window(project, selector))

    assert _depths(plan) == {first: 10, second: 10}
    assert plan.estimated_cost_usd == Decimal("0.004")


async def test_check_now_plans_a_keyword_again_that_was_checked_today(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    project = world.project
    keyword = await _tracked(migrated, project, "crm again")
    selector = {"tracked_keyword_ids": [str(keyword)], "live": True}
    window = _window(project, selector)
    async with worker_db() as db, db.begin():
        planned = await WORKLOAD.plan(db, window)
        run_id = await ledger.create_run(
            db,
            NewRun(
                workspace_id=project.workspace_id,
                project_id=project.id,
                schedule_id=None,
                workload=TaskWorkload.SEO_RANK,
                window_start=window.window_start,
                window_end=window.window_end,
                trigger="manual",
                config_snapshot=planned.config_snapshot,
            ),
            now=NOW,
        )
        assert run_id is not None
        await ledger.insert_tasks(db, run_id, planned.tasks)
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET status = 'ingested' WHERE run_id = $1",
        run_id,
    )
    schedule = await make_schedule(migrated, project, selector={"all": True})

    scheduled = await _plan(worker_db, _window(project, schedule_id=schedule))
    again = await _plan(worker_db, window)

    # A check now may be shallower than the schedule's and a person asked for it: it does not
    # stand for the day's check.
    assert set(_depths(scheduled)) == {keyword}
    assert set(_depths(again)) == {keyword}


async def test_check_now_without_a_depth_is_the_daily_depth_even_on_the_deep_weekday(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    project = world.project
    standard = await _tracked(migrated, project, "crm standard")
    weekly = await _tracked(migrated, project, "crm weekly", profile="weekly")
    selector = {"tracked_keyword_ids": [str(standard), str(weekly)], "live": True}

    plan = await _plan(worker_db, _window(project, selector, start=MONDAY))

    assert _depths(plan) == {standard: 20, weekly: 100}


@pytest.mark.parametrize(
    "selector",
    [
        {"tracked_keyword_ids": [str(uuid.uuid4())] * 101, "live": True},
        {"tracked_keyword_ids": [str(uuid.uuid4())], "live": True, "depth": 500},
        {"tracked_keyword_ids": [str(uuid.uuid4())], "live": True, "depth": "50"},
    ],
)
async def test_a_check_now_selector_the_api_would_not_write_is_refused(
    worker_db: Ledger, world: World, selector: dict[str, Any]
) -> None:
    with pytest.raises(ValueError, match="check now"):
        await _plan(worker_db, _window(world.project, selector))


# The estimate.


async def test_the_estimate_is_pages_at_the_queues_price_and_the_async_ai_overview(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    project = world.project
    await _tracked(migrated, project, "crm one", profile="standard")
    await _tracked(migrated, project, "crm two", profile="deep")

    standard = await _plan(worker_db, _window(project, mode="standard_queue"))
    priority = await _plan(worker_db, _window(project, mode="priority_queue"))

    # Standard: (2 + 5) pages at $0.0006 and two tasks at $0.0006 for the AI Overview.
    assert standard.estimated_cost_usd == Decimal("0.0054")
    # Priority: 7 pages at $0.0012 and, with no price row of its own, the surcharge at the
    # queue's page price (the additive reading of doc 06 section 6.2).
    assert priority.estimated_cost_usd == Decimal("0.0108")
    assert standard.config_snapshot["queue"] == "standard"
    assert priority.config_snapshot["queue"] == "priority"
    assert standard.config_snapshot["selector"] == {"all": True}


async def test_tasks_are_spread_over_the_window_the_same_way_every_day(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    project = world.project
    await _tracked(migrated, project, "crm spread one")
    await _tracked(migrated, project, "crm spread two")

    first = await _plan(worker_db, _window(project, start=TUESDAY))
    second = await _plan(worker_db, _window(project, start=TUESDAY + timedelta(days=1)))

    offsets = {t.subject_id: t.scheduled_for - TUESDAY for t in first.tasks}
    later = {t.subject_id: t.scheduled_for - TUESDAY - timedelta(days=1) for t in second.tasks}
    assert all(timedelta(0) <= offset < timedelta(hours=6) for offset in offsets.values())
    # The same keyword at the same time of day, whatever its depth that day.
    assert sorted(offsets.values()) == sorted(later.values())


# Requests.


def _ledger_task(
    project: Project, run_id: uuid.UUID, tracked: uuid.UUID, depth: int, location: int, number: int
) -> LedgerTask:
    return LedgerTask(
        ref=TaskRef(id=number, created_at=NOW),
        run_id=run_id,
        workspace_id=project.workspace_id,
        project_id=project.id,
        workload=TaskWorkload.SEO_RANK,
        subject_type="tracked_keyword",
        subject_id=subject_id(tracked, depth),
        engine_code=None,
        location_id=location,
        replicate_index=1,
        provider_code="dataforseo",
        provider_endpoint=SERP_ORGANIC,
        provider_task_id=None,
        status="pending",
        attempts=0,
        scheduled_for=NOW,
        priority="standard",
        window_end=NOW + timedelta(hours=6),
    )


async def _run(sessions: Ledger, project: Project, config: dict[str, Any]) -> uuid.UUID:
    async with sessions() as db, db.begin():
        run_id = await ledger.create_run(
            db,
            NewRun(
                workspace_id=project.workspace_id,
                project_id=project.id,
                schedule_id=None,
                workload=TaskWorkload.SEO_RANK,
                window_start=NOW,
                window_end=NOW + timedelta(hours=6),
                trigger="manual",
                config_snapshot=config,
            ),
            now=NOW,
        )
    assert run_id is not None
    return run_id


async def test_a_request_asks_for_the_keyword_as_entered_at_the_depth_and_queue_of_its_run(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    project = world.project
    keyword = await _tracked(
        migrated, project, "Best CRM+", device="mobile", location=OTHER_LOCATION
    )
    await execute(
        migrated,
        "INSERT INTO core.provider_location_map (provider_code, location_id, provider_value, "
        "supports) VALUES ('dataforseo', $1, '9002826', ARRAY['serp']) "
        "ON CONFLICT (provider_code, location_id) DO UPDATE SET provider_value = '9002826'",
        OTHER_LOCATION,
    )
    await execute(migrated, "UPDATE seo.tracked_keywords SET os = 'ios' WHERE id = $1", keyword)
    priority_run = await _run(worker_db, project, {"queue": "priority"})
    standard_run = await _run(worker_db, project, {})
    gone = await _tracked(migrated, project, "gone", deleted=True)
    tasks = [
        _ledger_task(project, priority_run, keyword, 50, OTHER_LOCATION, 7),
        _ledger_task(project, standard_run, keyword, 100, OTHER_LOCATION, 8),
        _ledger_task(project, standard_run, gone, 20, OTHER_LOCATION, 9),
    ]

    async with worker_db() as db:
        requests = await WORKLOAD.build_requests(db, tasks)

    assert set(requests) == {tasks[0].ref, tasks[1].ref}
    assert requests[tasks[0].ref].params == SerpOrganicParams(
        keyword="Best CRM+",
        location_code=9002826,
        language_code="en",
        device="mobile",
        os="ios",
        depth=50,
        queue="priority",
    )
    second = requests[tasks[1].ref].params
    assert isinstance(second, SerpOrganicParams)
    assert (second.depth, second.queue) == (100, "standard")
    assert WORKLOAD.batch_key(tasks[0]) == ""


async def test_a_task_of_a_live_run_is_asked_for_live(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    project = world.project
    keyword = await _tracked(migrated, project, "crm live")
    live_run = await _run(worker_db, project, {"queue": "live"})
    task = _ledger_task(project, live_run, keyword, 20, 2840, 11)

    async with worker_db() as db:
        requests = await WORKLOAD.build_requests(db, [task])

    params = requests[task.ref].params
    assert isinstance(params, SerpOrganicParams)
    assert (params.depth, params.queue) == (20, "live")


# The new-keyword tick.


async def _runs(pg: PostgresServer, project: Project) -> list[dict[str, Any]]:
    rows = await fetch(
        pg,
        "SELECT * FROM ops.collection_runs WHERE project_id = $1 AND workload = 'seo_rank' "
        "ORDER BY created_at",
        project.id,
    )
    return [dict(row) for row in rows]


async def test_a_project_with_unchecked_keywords_gets_one_planned_run(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    project = world.project
    await _tracked(migrated, project, "crm one")
    await _tracked(migrated, project, "crm two")
    quiet = await make_tenant(migrated)
    await track(migrated, quiet, "crm no entities", deleted=True)

    made = await queue_new_keywords(worker_db, now=NOW)
    again = await queue_new_keywords(worker_db, now=NOW)

    assert (made, again) == (1, 0)
    (run,) = await _runs(migrated, project)
    assert (run["trigger"], run["status"], run["schedule_id"]) == ("manual", "planned", None)
    assert run["config_snapshot"] == '{"selector": {"new": true}}'
    assert await _runs(migrated, quiet) == []


async def test_only_the_steps_own_empty_run_holds_back_the_next(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    """An empty window of a schedule, or a cancelled manual run, says nothing about whether new
    keywords can be checked; the step's own run that planned nothing does (it would be made
    again every minute)."""
    project = world.project
    await _tracked(migrated, project, "crm new")
    schedule = await make_schedule(migrated, project, selector={"all": True})
    for schedule_id, trigger, status, selector in (
        (schedule, "schedule", "completed", "{}"),
        (None, "manual", "cancelled", '{"selector": {"all": true}}'),
    ):
        await execute(
            migrated,
            "INSERT INTO ops.collection_runs (workspace_id, project_id, schedule_id, workload, "
            "window_start, window_end, trigger, status, config_snapshot, created_at) "
            "VALUES ($1, $2, $3, 'seo_rank', $4, $4, $5, $6, $7::jsonb, $4)",
            project.workspace_id,
            project.id,
            schedule_id,
            NOW - timedelta(hours=2),
            trigger,
            status,
            selector,
        )

    first = await queue_new_keywords(worker_db, now=NOW)
    await execute(
        migrated,
        "UPDATE ops.collection_runs SET status = 'completed' WHERE project_id = $1 "
        'AND config_snapshot = \'{"selector": {"new": true}}\'::jsonb',
        project.id,
    )
    again = await queue_new_keywords(worker_db, now=NOW + timedelta(hours=1))

    assert (first, again) == (1, 0)


async def test_a_run_blocked_by_a_budget_is_not_made_again_for_a_day(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    project = world.project
    await _tracked(migrated, project, "crm one")
    await queue_new_keywords(worker_db, now=NOW)
    await execute(
        migrated,
        "UPDATE ops.collection_runs SET status = 'budget_blocked' "
        "WHERE project_id = $1 AND workload = 'seo_rank'",
        project.id,
    )

    assert await queue_new_keywords(worker_db, now=NOW + timedelta(hours=2)) == 0
    # A day later the keyword is asked for again (the quiet time counts from the run).
    assert await queue_new_keywords(worker_db, now=NOW + timedelta(hours=25)) == 1


async def test_paused_and_archived_projects_get_no_run(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    project = world.project
    await _tracked(migrated, project, "crm one")
    await execute(migrated, "UPDATE core.projects SET status = 'paused' WHERE id = $1", project.id)

    assert await queue_new_keywords(worker_db, now=NOW) == 0


# Cases from the review of the workload.


async def test_a_weekly_keyword_gets_its_first_check_whatever_the_weekday(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    project = world.project
    weekly = await _tracked(migrated, project, "crm weekly", profile="weekly")
    light = await _tracked(migrated, project, "crm weekly light", profile="weekly_light")

    on_a_normal_day = _depths(await _plan(worker_db, _window(project, start=TUESDAY)))
    first = _depths(await _plan(worker_db, _window(project, {"new": True}, start=TUESDAY)))

    assert on_a_normal_day == {}
    assert first == {weekly: 100, light: 20}


async def test_nothing_is_planned_without_a_price_to_check_the_budget_against(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    project = world.project
    await _tracked(migrated, project, "crm one")
    before_the_prices = datetime(2026, 6, 1, 2, 0, tzinfo=UTC)

    plan = await _plan(worker_db, _window(project, start=before_the_prices))

    assert list(plan.tasks) == []
    assert plan.estimated_cost_usd == Decimal(0)


async def test_one_keyword_the_provider_would_refuse_does_not_take_the_others_down(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    project = world.project
    bad = await _tracked(migrated, project, "crm bad", device="desktop")
    good = await _tracked(migrated, project, "crm good", device="desktop")
    await execute(migrated, "UPDATE seo.tracked_keywords SET os = 'ios' WHERE id = $1", bad)
    run_id = await _run(worker_db, project, {})
    tasks = [
        _ledger_task(project, run_id, bad, 20, 2840, 1),
        _ledger_task(project, run_id, good, 20, 2840, 2),
    ]

    async with worker_db() as db:
        requests = await WORKLOAD.build_requests(db, tasks)

    assert set(requests) == {tasks[1].ref}


async def test_an_archived_keyword_is_not_sent_after_it_was_planned(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    project = world.project
    keyword = await _tracked(migrated, project, "crm archived later")
    run_id = await _run(worker_db, project, {})
    task = _ledger_task(project, run_id, keyword, 20, 2840, 1)
    await execute(
        migrated, "UPDATE seo.tracked_keywords SET is_active = false WHERE id = $1", keyword
    )

    async with worker_db() as db:
        assert await WORKLOAD.build_requests(db, [task]) == {}


async def test_a_task_that_was_sent_counts_as_checked_even_when_its_run_was_cancelled(
    worker_db: Ledger, migrated: PostgresServer, world: World
) -> None:
    project = world.project
    first = await make_schedule(migrated, project, selector={"all": True})
    second = await make_schedule(migrated, project, selector={"all": True})
    keyword = await _tracked(migrated, project, "crm paid already")
    window = _window(project, schedule_id=first)
    plan = await _plan(worker_db, window)
    async with worker_db() as db, db.begin():
        run_id = await ledger.create_run(
            db,
            NewRun(
                workspace_id=project.workspace_id,
                project_id=project.id,
                schedule_id=first,
                workload=TaskWorkload.SEO_RANK,
                window_start=window.window_start,
                window_end=window.window_end,
                trigger="schedule",
                config_snapshot={},
            ),
            now=NOW,
        )
        assert run_id is not None
        await ledger.insert_tasks(db, run_id, plan.tasks)
    other = _window(project, schedule_id=second, start=window.window_start + timedelta(hours=8))
    await execute(
        migrated, "UPDATE ops.collection_runs SET status = 'cancelled' WHERE id = $1", run_id
    )

    # Cancelled before it was sent: the keyword was not checked, and the other schedule may.
    await execute(
        migrated, "UPDATE ops.collection_tasks SET status = 'cancelled' WHERE run_id = $1", run_id
    )
    assert _depths(await _plan(worker_db, other)) == {keyword: 20}
    # Sent before the cancel: the provider has it, and it is paid for.
    await execute(
        migrated, "UPDATE ops.collection_tasks SET status = 'submitted' WHERE run_id = $1", run_id
    )
    assert _depths(await _plan(worker_db, other)) == {}


async def fetch_one(pg: PostgresServer, statement: str, *arguments: Any) -> Any:
    row = await fetchrow(pg, statement, *arguments)
    return row["id"]
