"""Keyword metrics (plan decisions D6 to D9): the workload's plans and requests, the
ingester, the new-keyword tick and manual runs. As `app_worker`."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors import keyword_metrics, ledger
from sightline.collectors.fetching import RETENTION_CLASS
from sightline.collectors.keyword_metrics import (
    KeywordMetricsWorkload,
    ingest,
    queue_new_keywords,
    subject_id,
)
from sightline.collectors.ledger import LedgerTask, TaskRef
from sightline.collectors.planner import ManualReport, plan_manual_runs
from sightline.collectors.raw_payloads import RawPayload, store_raw_payload
from sightline.collectors.registry import Registry, ScheduleWindow
from sightline.domain.workloads import TaskWorkload
from sightline.providers.dataforseo import labs
from sightline.providers.dataforseo.labs import KeywordOverviewParams
from sightline.storage.raw import RawStorageError
from tests.api.auth.support import execute, fetch, fetchrow
from tests.api.keywords.support import LOCATION, OTHER_LOCATION, ensure_locations
from tests.collectors.support import (
    NOW,
    Project,
    another_project,
    make_budget,
    make_tenant,
    run_row,
    spend,
    task_rows,
)
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer
from tests.providers.dataforseo.support import fixture_bytes

Ledger = async_sessionmaker[AsyncSession]
DAY = timedelta(days=1)
WORKLOAD = KeywordMetricsWorkload()


async def _track(
    pg: PostgresServer,
    project: Project,
    text: str,
    *,
    location: int = LOCATION,
    language: str = "en",
    device: str = "desktop",
    active: bool = True,
    deleted: bool = False,
) -> uuid.UUID:
    """The keyword's id, tracked by the project."""
    await ensure_locations(pg)
    keyword = await fetchrow(
        pg,
        "INSERT INTO seo.keywords (workspace_id, text, normalized_text, language_code) "
        "VALUES ($1, $2, $3, $4) ON CONFLICT (workspace_id, normalized_text, language_code) "
        "DO UPDATE SET text = seo.keywords.text RETURNING id",
        project.workspace_id,
        text,
        " ".join(text.lower().split()),
        language,
    )
    await execute(
        pg,
        "INSERT INTO seo.tracked_keywords (workspace_id, project_id, keyword_id, location_id, "
        "language_code, device, is_active, deleted_at) "
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        project.workspace_id,
        project.id,
        keyword["id"],
        location,
        language,
        device,
        active,
        NOW if deleted else None,
    )
    keyword_id: uuid.UUID = keyword["id"]
    return keyword_id


async def _metrics(
    pg: PostgresServer,
    project: Project,
    keyword_id: uuid.UUID,
    fetched_at: datetime,
    *,
    volume: int | None = 100,
    difficulty: int = 40,
    location: int = LOCATION,
    current: bool = True,
) -> None:
    """A Labs snapshot as of `fetched_at`, and the keyword's current metrics from it when
    `current`."""
    snapshot = await fetchrow(
        pg,
        "INSERT INTO seo.keyword_metric_snapshots (workspace_id, keyword_id, location_id, "
        "language_code, source, fetched_at, search_volume, keyword_difficulty, intent_main, "
        "is_material_change) VALUES ($1, $2, $3, 'en', 'dataforseo_labs', $4, $5, $6, "
        "'commercial', true) RETURNING id",
        project.workspace_id,
        keyword_id,
        location,
        fetched_at,
        volume,
        difficulty,
    )
    if not current:
        return
    await execute(
        pg,
        "INSERT INTO seo.keyword_metrics_current (keyword_id, location_id, language_code, "
        "source, workspace_id, snapshot_id, search_volume, keyword_difficulty, intent_main, "
        "fetched_at) VALUES ($1, $2, 'en', 'dataforseo_labs', $3, $4, $5, $6, 'commercial', $7)",
        keyword_id,
        location,
        project.workspace_id,
        snapshot["id"],
        volume,
        difficulty,
        fetched_at,
    )


def _window(project: Project, selector: dict[str, Any] | None = None) -> ScheduleWindow:
    return ScheduleWindow(
        schedule_id=None,
        workspace_id=project.workspace_id,
        project_id=project.id,
        workload=TaskWorkload.KEYWORD_METRICS,
        provider_mode="live",
        selector=selector or {},
        window_start=NOW,
        window_end=NOW + timedelta(hours=2),
        window_hours=2,
    )


async def _plan(sessions: Ledger, project: Project, selector: dict[str, Any] | None = None) -> Any:
    async with sessions() as db:
        return await WORKLOAD.plan(db, _window(project, selector))


# Planning.


async def test_a_schedule_plans_the_projects_stale_and_new_keywords_once_each(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    other = await another_project(migrated, project)
    stale = await _track(migrated, project, "stale crm")
    # Tracked on both devices: asked about once.
    await _track(migrated, project, "stale crm", device="mobile")
    fresh = await _track(migrated, project, "fresh crm")
    new = await _track(migrated, project, "new crm")
    await _track(migrated, project, "archived crm", active=False)
    await _track(migrated, project, "deleted crm", deleted=True)
    await _track(migrated, project, "x" * (labs.KEYWORD_MAX + 1))
    await _track(migrated, other, "other project crm")
    await _metrics(migrated, project, stale, NOW - 40 * DAY)
    await _metrics(migrated, project, fresh, NOW - 3 * DAY)

    plan = await _plan(worker_db, project)

    assert sorted(task.subject_id for task in plan.tasks) == sorted(
        [subject_id(stale, "en"), subject_id(new, "en")]
    )
    assert {
        (task.subject_type, task.location_id, task.provider_code, task.provider_endpoint)
        for task in plan.tasks
    } == {("keyword", LOCATION, "dataforseo", labs.KEYWORD_OVERVIEW)}
    # All due at once, so they go in one Labs call.
    assert {task.scheduled_for for task in plan.tasks} == {NOW}
    # One call ($0.012) and two keywords ($0.00012 each), by the price book.
    assert plan.estimated_cost_usd == Decimal("0.01224")
    assert plan.config_snapshot["provider_mode"] == "live"


async def test_given_keywords_are_planned_however_fresh_unless_stale_days_say_otherwise(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    fresh = await _track(migrated, project, "fresh crm")
    await _track(migrated, project, "fresh crm", location=OTHER_LOCATION)
    untracked = uuid.uuid4()
    await _metrics(migrated, project, fresh, NOW - 3 * DAY)

    given = await _plan(worker_db, project, {"keyword_ids": [str(fresh), str(untracked)]})
    stale_only = await _plan(worker_db, project, {"keyword_ids": [str(fresh)], "stale_days": 30})
    everything = await _plan(worker_db, project, {"all": True})

    # At each location it is tracked at; a keyword the project does not track is not asked.
    assert sorted(task.location_id for task in given.tasks) == sorted([LOCATION, OTHER_LOCATION])
    # Fresh at the first location; never fetched at the second.
    assert [task.location_id for task in stale_only.tasks] == [OTHER_LOCATION]
    assert len(everything.tasks) == 2


async def _tracked_row(pg: PostgresServer, project: Project, keyword_id: uuid.UUID) -> uuid.UUID:
    row = await fetchrow(
        pg,
        "SELECT id FROM seo.tracked_keywords WHERE project_id = $1 AND keyword_id = $2",
        project.id,
        keyword_id,
    )
    tracked: uuid.UUID = row["id"]
    return tracked


async def _in_group(
    pg: PostgresServer, project: Project, keyword_id: uuid.UUID, name: str, parent: str | None
) -> str:
    """A group of the project (under `parent`) holding the keyword."""
    made = await fetchrow(
        pg,
        "INSERT INTO seo.keyword_groups (workspace_id, project_id, parent_id, name, path) "
        "VALUES ($1, $2, $3, $4, $4) RETURNING id",
        project.workspace_id,
        project.id,
        None if parent is None else uuid.UUID(parent),
        name,
    )
    await execute(
        pg,
        "INSERT INTO seo.keyword_group_members (workspace_id, project_id, group_id, "
        "tracked_keyword_id) VALUES ($1, $2, $3, $4)",
        project.workspace_id,
        project.id,
        made["id"],
        await _tracked_row(pg, project, keyword_id),
    )
    return str(made["id"])


async def _with_term(pg: PostgresServer, project: Project, keyword_id: uuid.UUID) -> str:
    """A term of a new vocabulary, given to the keyword."""
    vocabulary = await fetchrow(
        pg,
        "INSERT INTO core.taxonomy_vocabularies (workspace_id, kind, name, is_hierarchical) "
        "VALUES ($1, 'topic', $2, true) RETURNING id",
        project.workspace_id,
        f"Topics {uuid.uuid4().hex[:6]}",
    )
    made = await fetchrow(
        pg,
        "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, name, slug, path) "
        "VALUES ($1, $2, 'crm', 'crm', 'crm') RETURNING id",
        project.workspace_id,
        vocabulary["id"],
    )
    await execute(
        pg,
        "INSERT INTO seo.tracked_keyword_terms (workspace_id, tracked_keyword_id, term_id) "
        "VALUES ($1, $2, $3)",
        project.workspace_id,
        await _tracked_row(pg, project, keyword_id),
        made["id"],
    )
    return str(made["id"])


async def test_groups_and_terms_narrow_a_schedules_keywords(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    nested = await _track(migrated, project, "nested crm")
    tagged = await _track(migrated, project, "tagged crm")
    both = await _track(migrated, project, "both crm")
    await _track(migrated, project, "loose crm")
    services = await _in_group(migrated, project, both, "Services", None)
    await _in_group(migrated, project, nested, "Audits", services)
    topic = await _with_term(migrated, project, tagged)
    await execute(
        migrated,
        "INSERT INTO seo.tracked_keyword_terms (workspace_id, tracked_keyword_id, term_id) "
        "VALUES ($1, $2, $3)",
        project.workspace_id,
        await _tracked_row(migrated, project, both),
        uuid.UUID(topic),
    )

    def keywords_of(plan: Any) -> list[str]:
        return sorted(task.subject_id for task in plan.tasks)

    in_groups = await _plan(worker_db, project, {"groups": [services]})
    with_term = await _plan(worker_db, project, {"all": True, "terms": [topic]})
    both_ways = await _plan(worker_db, project, {"groups": [services], "terms": [topic]})

    # A group takes the groups under it too.
    assert keywords_of(in_groups) == sorted([subject_id(nested, "en"), subject_id(both, "en")])
    assert keywords_of(with_term) == sorted([subject_id(tagged, "en"), subject_id(both, "en")])
    assert keywords_of(both_ways) == [subject_id(both, "en")]


def _ledger_task(
    project: Project, keyword_id: uuid.UUID, location: int, *, task_id: int
) -> LedgerTask:
    return LedgerTask(
        ref=TaskRef(id=task_id, created_at=NOW),
        run_id=uuid.uuid4(),
        workspace_id=project.workspace_id,
        project_id=project.id,
        workload=TaskWorkload.KEYWORD_METRICS,
        subject_type="keyword",
        subject_id=subject_id(keyword_id, "en"),
        engine_code=None,
        location_id=location,
        replicate_index=1,
        provider_code="dataforseo",
        provider_endpoint=labs.KEYWORD_OVERVIEW,
        provider_task_id=None,
        status="submit_unknown",
        attempts=1,
        scheduled_for=NOW,
        priority="high",
        window_end=NOW + timedelta(hours=1),
    )


async def test_a_request_asks_about_the_keyword_as_entered_at_its_location_code(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    keyword_id = await _track(migrated, project, "CRM Software", location=OTHER_LOCATION)
    await execute(
        migrated,
        "INSERT INTO core.provider_location_map (provider_code, location_id, provider_value, "
        "supports) VALUES ('dataforseo', $1, '9002826', ARRAY['serp']) "
        "ON CONFLICT (provider_code, location_id) DO UPDATE SET provider_value = '9002826'",
        OTHER_LOCATION,
    )
    task = _ledger_task(project, keyword_id, OTHER_LOCATION, task_id=7)
    gone = _ledger_task(project, uuid.uuid4(), LOCATION, task_id=8)

    async with worker_db() as db:
        requests = await WORKLOAD.build_requests(db, [task, gone])

    (request,) = requests.values()
    assert request.params == KeywordOverviewParams(
        keyword="CRM Software", location_code=9002826, language_code="en"
    )
    assert (request.task_id, request.priority) == ("7", "high")
    # One Labs call asks about one location and language.
    assert WORKLOAD.batch_key(task) == f"{OTHER_LOCATION}:en"


# Ingesting.


async def _fetched_run(
    sessions: Ledger, pg: PostgresServer, project: Project, body: bytes, store: MemoryStore
) -> uuid.UUID:
    """A running run whose tasks are fetched, with `body` as their stored answer."""
    async with sessions() as db:
        plan = await WORKLOAD.plan(db, _window(project, {"all": True}))
    async with sessions() as db, db.begin():
        run = ledger.NewRun(
            workspace_id=project.workspace_id,
            project_id=project.id,
            schedule_id=None,
            workload=TaskWorkload.KEYWORD_METRICS,
            window_start=NOW,
            window_end=NOW + timedelta(hours=1),
            trigger="manual",
            config_snapshot={},
        )
        run_id = await ledger.create_run(db, run, now=NOW)
        assert run_id is not None
        await ledger.insert_tasks(db, run_id, plan.tasks)
        await ledger.start_run(
            db, run_id, tasks_total=len(plan.tasks), estimated_cost_usd=Decimal(0)
        )
    payload_id = await store_raw_payload(
        sessions,
        store,
        RawPayload(
            body=body,
            content_type="application/json",
            provider_code="dataforseo",
            provider_endpoint=labs.KEYWORD_OVERVIEW,
            endpoint_slug=labs.PAYLOAD_SLUG,
            retention_class=RETENTION_CLASS[TaskWorkload.KEYWORD_METRICS],
        ),
    )
    await execute(
        pg,
        "UPDATE ops.collection_tasks SET status = 'fetched', raw_payload_id = $2, "
        "ready_source = 'live', ready_at = $3 WHERE run_id = $1",
        run_id,
        payload_id,
        NOW,
    )
    return run_id


async def _snapshots(pg: PostgresServer, keyword_id: uuid.UUID) -> list[dict[str, Any]]:
    rows = await fetch(
        pg,
        "SELECT * FROM seo.keyword_metric_snapshots WHERE keyword_id = $1 ORDER BY id",
        keyword_id,
    )
    return [dict(row) for row in rows]


async def test_each_task_gets_one_snapshot_and_the_keyword_its_current_metrics(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    best = await _track(migrated, project, "Best CRM")
    software = await _track(migrated, project, "CRM Software")
    unknown = await _track(migrated, project, "no such keyword anywhere")
    store = MemoryStore()
    run_id = await _fetched_run(
        worker_db, migrated, project, fixture_bytes("keyword_overview_live"), store
    )

    report = await ingest(worker_db, store)
    again = await ingest(worker_db, store)

    assert report == keyword_metrics.IngestReport(ingested=3)
    assert again.quiet
    (row,) = await _snapshots(migrated, best)
    assert (row["search_volume"], row["cpc_usd"], row["competition"], row["competition_level"]) == (
        1900,
        Decimal("14.2300"),
        Decimal("0.6700"),
        "HIGH",
    )
    assert (row["keyword_difficulty"], row["intent_main"], row["data_month"].isoformat()) == (
        58,
        "commercial",
        "2026-08-01",
    )
    assert json.loads(row["intent_detail"]) == {"main": "commercial", "foreign": ["informational"]}
    months = json.loads(row["monthly_searches"])
    assert len(months) == 12
    assert months[0] == {"year": 2025, "month": 9, "search_volume": 2400}
    assert row["is_material_change"] is True
    # Known to Labs with no values, and not known at all: a snapshot of nulls each.
    for keyword_id in (software, unknown):
        (empty,) = await _snapshots(migrated, keyword_id)
        assert (empty["search_volume"], empty["data_month"]) == (None, None)
        assert json.loads(empty["monthly_searches"]) == []
    current = await fetchrow(
        migrated,
        "SELECT search_volume, keyword_difficulty, snapshot_id FROM seo.keyword_metrics_current "
        "WHERE keyword_id = $1",
        best,
    )
    assert (current["search_volume"], current["keyword_difficulty"]) == (1900, 58)
    assert {r["status"] for r in await task_rows(migrated, run_id)} == {"ingested"}


async def test_a_later_answer_is_a_material_change_only_when_it_moves_enough(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    best = await _track(migrated, project, "best crm")
    store = MemoryStore()
    await _metrics(migrated, project, best, NOW - 40 * DAY, volume=1850, difficulty=56)
    await _fetched_run(worker_db, migrated, project, fixture_bytes("keyword_overview_live"), store)

    await ingest(worker_db, store)

    rows = await _snapshots(migrated, best)
    # 1850 to 1900 is under 20%, 56 to 58 is under 5 points, and the intent is the same.
    assert rows[-1]["is_material_change"] is False


async def _current(pg: PostgresServer, keyword_id: uuid.UUID) -> tuple[Any, ...]:
    row = await fetchrow(
        pg,
        "SELECT search_volume, keyword_difficulty FROM seo.keyword_metrics_current "
        "WHERE keyword_id = $1",
        keyword_id,
    )
    return (row["search_volume"], row["keyword_difficulty"])


async def test_an_older_answer_ingested_late_is_judged_against_the_reading_before_it(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    best = await _track(migrated, project, "best crm")
    store = MemoryStore()
    # Before the answer: close to it. After it (already ingested): far from it.
    await _metrics(
        migrated, project, best, NOW - 40 * DAY, volume=1850, difficulty=56, current=False
    )
    await _metrics(migrated, project, best, NOW + DAY, volume=200, difficulty=10)
    await _fetched_run(worker_db, migrated, project, fixture_bytes("keyword_overview_live"), store)

    await ingest(worker_db, store)

    (late,) = [row for row in await _snapshots(migrated, best) if row["task_id"] is not None]
    assert late["is_material_change"] is False
    # The newer reading stays current.
    assert await _current(migrated, best) == (200, 10)


async def test_an_empty_reading_keeps_the_current_metrics_and_is_no_change(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    software = await _track(migrated, project, "crm software")
    store = MemoryStore()
    await _metrics(migrated, project, software, NOW - 40 * DAY, volume=500, difficulty=30)
    await _fetched_run(worker_db, migrated, project, fixture_bytes("keyword_overview_live"), store)

    await ingest(worker_db, store)

    rows = await _snapshots(migrated, software)
    assert (rows[-1]["search_volume"], rows[-1]["is_material_change"]) == (None, False)
    assert await _current(migrated, software) == (500, 30)


class LosingStore(MemoryStore):
    """Storage that cannot read the objects under `lost`."""

    def __init__(self) -> None:
        super().__init__()
        self.lost: set[str] = set()

    async def get(self, key: str) -> bytes:
        if key in self.lost:
            raise RawStorageError("reading a payload failed: NoSuchKey")
        return await super().get(key)


async def test_an_answer_that_is_not_labs_fails_its_tasks_and_a_missing_one_waits(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    await _track(migrated, project, "crm")
    store = LosingStore()
    run_id = await _fetched_run(worker_db, migrated, project, b"<html>gateway</html>", store)
    other = await make_tenant(migrated)
    await _track(migrated, other, "erp")
    kept = set(store.objects)
    lost = await _fetched_run(worker_db, migrated, other, b'{"tasks": []}', store)
    store.lost = set(store.objects) - kept

    report = await ingest(worker_db, store)

    assert (report.failed, report.waiting) == (1, 1)
    (failed,) = await task_rows(migrated, run_id)
    assert (failed["status"], failed["last_error_code"]) == ("failed", keyword_metrics.UNREADABLE)
    (waiting,) = await task_rows(migrated, lost)
    assert (waiting["status"], waiting["last_error_code"]) == ("fetched", keyword_metrics.NOT_READ)
    # It waits out the retry, so it does not take the head of every pass.
    assert waiting["next_attempt_at"] > NOW
    assert (await ingest(worker_db, store)).quiet


async def test_an_answer_not_read_for_a_day_fails_its_tasks_so_the_run_can_finish(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    await _track(migrated, project, "crm")
    store = LosingStore()
    run_id = await _fetched_run(worker_db, migrated, project, b'{"tasks": []}', store)
    store.lost = set(store.objects)
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET ready_at = now() - interval '25 hours' WHERE run_id = $1",
        run_id,
    )

    report = await ingest(worker_db, store)

    assert report == keyword_metrics.IngestReport(failed=1)
    (task,) = await task_rows(migrated, run_id)
    assert (task["status"], task["last_error_code"]) == ("failed", keyword_metrics.NOT_READ)


async def test_an_answer_that_cannot_be_written_waits_and_the_others_are_ingested(
    worker_db: Ledger, migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    project = await make_tenant(migrated)
    await _track(migrated, project, "best crm")
    other = await make_tenant(migrated)
    await _track(migrated, other, "best crm")
    store = MemoryStore()
    body = fixture_bytes("keyword_overview_live")
    broken = await _fetched_run(worker_db, migrated, project, body + b" ", store)
    fine = await _fetched_run(worker_db, migrated, other, body, store)
    keep = keyword_metrics._keep

    async def fails_for_one(db: AsyncSession, task: Any, overviews: Any) -> None:
        if task.workspace_id == project.workspace_id:
            raise ValueError("a value the snapshot cannot hold")
        await keep(db, task, overviews)

    monkeypatch.setattr(keyword_metrics, "_keep", fails_for_one)

    report = await ingest(worker_db, store)

    assert (report.ingested, report.waiting) == (1, 1)
    (waiting,) = await task_rows(migrated, broken)
    assert (waiting["status"], waiting["last_error_code"]) == (
        "fetched",
        keyword_metrics.NOT_WRITTEN,
    )
    assert [task["status"] for task in await task_rows(migrated, fine)] == ["ingested"]


# New keywords and manual runs.


def _registry() -> Registry:
    registry = Registry()
    registry.add_workload(KeywordMetricsWorkload())
    return registry


async def _runs(pg: PostgresServer, project: Project) -> list[dict[str, Any]]:
    rows = await fetch(
        pg,
        "SELECT * FROM ops.collection_runs WHERE project_id = $1 ORDER BY created_at",
        project.id,
    )
    return [dict(row) for row in rows]


async def test_new_keywords_get_one_run_which_the_planner_plans_at_once(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    new = await _track(migrated, project, "new crm")
    known = await _track(migrated, project, "known crm")
    await _metrics(migrated, project, known, NOW - 40 * DAY)

    queued = await queue_new_keywords(worker_db, now=NOW)
    waiting = await queue_new_keywords(worker_db, now=NOW)
    later = NOW + timedelta(minutes=5)
    planned = await plan_manual_runs(worker_db, _registry(), now=later)
    asked_already = await queue_new_keywords(worker_db, now=NOW + timedelta(minutes=6))

    assert (queued, waiting, asked_already) == (1, 0, 0)
    assert planned == ManualReport(planned=1)
    (run,) = await _runs(migrated, project)
    assert (run["trigger"], run["created_by_type"], run["status"]) == (
        "manual",
        "system",
        "running",
    )
    # Its window opens when it is planned, and it keeps the configuration its plan used.
    assert (run["window_start"], run["window_end"]) == (later, later + timedelta(hours=1))
    snapshot = json.loads(run["config_snapshot"])
    assert (snapshot["selector"], snapshot["provider_mode"]) == ({"new": True}, "live")
    assert snapshot["adapter"] == keyword_metrics.ADAPTER
    # Only the keyword with no metrics; the stale one waits for the monthly run.
    assert [task["subject_id"] for task in await task_rows(migrated, run["id"])] == [
        subject_id(new, "en")
    ]
    # A day later, a keyword whose task failed is asked about again.
    assert await queue_new_keywords(worker_db, now=NOW + 2 * DAY) == 1


async def test_a_manual_run_over_a_used_up_budget_is_blocked(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    await _track(migrated, project, "crm")
    # Keyword metrics count against the keyword research budget.
    await make_budget(migrated, project, "1.00", workload="keyword_research")
    await spend(migrated, project, "1.00", workload="keyword_metrics")
    await queue_new_keywords(worker_db, now=NOW)

    report = await plan_manual_runs(worker_db, _registry(), now=NOW)

    assert report == ManualReport(blocked=1)
    (run,) = await _runs(migrated, project)
    assert (await run_row(migrated, run["id"]))["status"] == "budget_blocked"
    # The blocked run made no task; the next ticks of the day make no other run.
    assert await queue_new_keywords(worker_db, now=NOW + timedelta(minutes=1)) == 0
    assert await queue_new_keywords(worker_db, now=NOW + 2 * DAY) == 1


async def test_a_manual_run_no_worker_can_plan_is_cancelled_after_a_while(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    await _track(migrated, project, "crm")
    await queue_new_keywords(worker_db, now=NOW)
    # The run's age is by the database clock, which made it.
    (queued,) = await _runs(migrated, project)
    made: datetime = queued["created_at"]
    # A worker without DataForSEO credentials registers no keyword metrics.
    nothing = Registry()

    soon = await plan_manual_runs(worker_db, nothing, now=made + timedelta(minutes=1))
    later = await plan_manual_runs(worker_db, nothing, now=made + timedelta(minutes=11))

    assert (soon, later) == (ManualReport(), ManualReport(cancelled=1))
    (run,) = await _runs(migrated, project)
    assert (run["status"], run["status_reason"]) == ("cancelled", "workload_unavailable")


async def test_a_manual_run_of_a_project_that_stopped_collecting_is_cancelled(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    await _track(migrated, project, "crm")
    await queue_new_keywords(worker_db, now=NOW)
    await execute(migrated, "UPDATE core.projects SET status = 'paused' WHERE id = $1", project.id)

    report = await plan_manual_runs(worker_db, _registry(), now=NOW)

    assert report == ManualReport(cancelled=1)
    (run,) = await _runs(migrated, project)
    assert (run["status"], run["status_reason"]) == ("cancelled", "project_not_collecting")


@pytest.mark.parametrize("subject", ["not-a-uuid:en", "abc"])
def test_a_subject_this_workload_did_not_make_is_not_read(subject: str) -> None:
    assert keyword_metrics.parse_subject(subject) is None
