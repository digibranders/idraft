"""Crawl runs in the worker (spec 6.1, 6.2 and 9; plan decisions D3 to D6, D8, D13)."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from structlog.testing import capture_logs

from idraft.collectors import budget
from idraft.collectors.crawl_runs import (
    CrawlBusyError,
    CrawlIngestTask,
    NoStoppedCrawlError,
    crawl_tick,
    queue_run,
)
from idraft.crawl.schedule import NIGHT_START, slot_offset
from idraft.domain.retries import ProviderErrorKind
from idraft.providers.contract import ProviderCallError, ProviderError
from idraft.providers.dataforseo.on_page import CrawlOrder, PostedCrawl
from tests.api.auth.support import execute, fetch, fetchrow
from tests.api.internal_links.support import seed_crawl
from tests.collectors.crawl_support import FakeOnPage, clear_crawls, site_project, summary
from tests.collectors.support import NOW, Project, make_budget
from tests.conftest import PostgresServer

Sessions = async_sessionmaker[AsyncSession]


@pytest.fixture(autouse=True)
async def _no_other_crawls(migrated: PostgresServer) -> None:
    await clear_crawls(migrated)


async def _queue(
    sessions: Sessions, workspace_id: uuid.UUID, project_id: uuid.UUID, trigger: str = "manual"
) -> uuid.UUID:
    async with sessions() as db, db.begin():
        return await queue_run(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            trigger=trigger,  # type: ignore[arg-type]
            requested_by=None,
            now=NOW,
        )


async def _run(pg: PostgresServer, run_id: uuid.UUID) -> dict[str, object]:
    return dict(await fetchrow(pg, "SELECT * FROM seo.crawl_runs WHERE id = $1", run_id))


async def _crawling(pg: PostgresServer, run_id: uuid.UUID, task: str) -> None:
    await execute(
        pg,
        "UPDATE seo.crawl_runs SET state = 'crawling', provider_task_id = $2, "
        "submitted_at = now() WHERE id = $1",
        run_id,
        task,
    )


class _Sent:
    def __init__(self) -> None:
        self.tasks: list[CrawlIngestTask] = []

    async def __call__(self, task: CrawlIngestTask) -> bool:
        self.tasks.append(task)
        return True


async def test_the_first_crawl_is_a_probe_and_the_next_follows_the_sitemap(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project = await site_project(migrated)

    first = await _queue(worker_db, workspace.id, project)
    row = await _run(migrated, first)
    assert (row["ceiling"], row["target_host"], row["state"]) == (2000, "example.com", "queued")
    assert row["estimated_cost_usd"] == Decimal("0.300000")
    with pytest.raises(CrawlBusyError) as busy:
        await _queue(worker_db, workspace.id, project)
    assert busy.value.run_id == first

    await execute(
        migrated,
        "UPDATE seo.crawl_runs SET state = 'stopped_at_ceiling', sitemap_pages = 1500 "
        "WHERE id = $1",
        first,
    )
    retry = await _queue(worker_db, workspace.id, project, "ceiling_retry")
    assert (await _run(migrated, retry))["ceiling"] == 4500
    await execute(migrated, "UPDATE seo.crawl_runs SET state = 'ready' WHERE id = $1", retry)
    with pytest.raises(NoStoppedCrawlError):
        await _queue(worker_db, workspace.id, project, "ceiling_retry")


async def test_a_crawl_that_ends_right_after_the_conflict_leaves_the_slot_free(
    migrated: PostgresServer, worker_db: Sessions, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Cancel and the worker take no project lock: the crawl that made the insert conflict can end
    before the busy path reads it. The slot is then free, and the insert is tried again."""
    workspace, project = await site_project(migrated)
    first = await _queue(worker_db, workspace.id, project)

    async with worker_db() as db, db.begin():
        real = db.execute
        ended = False

        async def execute_then_end_the_first(statement: Any, *args: Any, **kwargs: Any) -> Any:
            nonlocal ended
            result = await real(statement, *args, **kwargs)
            if not ended and getattr(statement, "is_insert", False):
                ended = True
                await execute(
                    migrated, "UPDATE seo.crawl_runs SET state = 'cancelled' WHERE id = $1", first
                )
            return result

        monkeypatch.setattr(db, "execute", execute_then_end_the_first)
        second = await queue_run(
            db,
            workspace_id=workspace.id,
            project_id=project,
            trigger="manual",
            requested_by=None,
            now=NOW,
        )

    assert second != first
    assert (await _run(migrated, second))["state"] == "queued"
    assert (await _run(migrated, first))["state"] == "cancelled"


async def test_a_crawl_started_for_a_site_keeps_only_subdomains_under_that_site(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    """The primary domain can change after the subdomains were saved."""
    workspace, project = await site_project(migrated)
    stored = {"internal_links": {"allowed_subdomains": ["blog.other.com", "blog.example.com"]}}
    await execute(
        migrated,
        "UPDATE core.projects SET settings = $2::jsonb WHERE id = $1",
        project,
        json.dumps(stored),
    )

    run_id = await _queue(worker_db, workspace.id, project)

    settings = json.loads((await _run(migrated, run_id))["settings"])  # type: ignore[arg-type]
    assert settings["allowed_subdomains"] == ["blog.example.com"]


async def test_a_due_project_is_queued_in_its_night_slot(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    _, project = await site_project(migrated)
    slot = datetime.combine(NOW.date(), NIGHT_START, tzinfo=UTC) + slot_offset(project)

    early = await crawl_tick(worker_db, None, _Sent(), now=slot - timedelta(minutes=1))
    due = await crawl_tick(worker_db, None, _Sent(), now=slot + timedelta(minutes=5))

    assert (early.queued, due.queued) == (0, 1)
    rows = await fetch(
        migrated, "SELECT trigger, state FROM seo.crawl_runs WHERE project_id = $1", project
    )
    assert [(row["trigger"], row["state"]) for row in rows] == [("schedule", "queued")]


async def test_a_queued_crawl_is_posted_and_its_cost_recorded(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project = await site_project(migrated)
    run_id = await _queue(worker_db, workspace.id, project)
    on_page = FakeOnPage(summaries=[summary(finished=False, crawled=10, queue=90)])

    report = await crawl_tick(worker_db, on_page, _Sent(), now=NOW)

    row = await _run(migrated, run_id)
    assert report.posted == 1
    assert (row["state"], row["provider_task_id"], row["pages_found"]) == (
        "crawling",
        "task-1",
        100,
    )
    (order,) = on_page.posted
    assert (order.host, order.max_crawl_pages, order.tag) == ("example.com", 2000, str(run_id))
    event = await fetchrow(
        migrated,
        "SELECT workload, channel, endpoint, cost_usd, cost_source, units FROM "
        "ops.provider_cost_events WHERE run_id = $1",
        run_id,
    )
    assert dict(event) == {
        "workload": "site_crawl",
        "channel": "seo",
        "endpoint": "on_page/task_post",
        "cost_usd": Decimal("0.300000"),
        "cost_source": "provider_reported",
        "units": Decimal("2000.0000"),
    }


async def test_a_budget_stops_a_crawl_before_it_is_posted(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project = await site_project(migrated)
    await make_budget(migrated, Project(workspace.id, project), "0", workload="site_crawl")
    run_id = await _queue(worker_db, workspace.id, project)
    on_page = FakeOnPage()

    await crawl_tick(worker_db, on_page, _Sent(), now=NOW)

    row = await _run(migrated, run_id)
    assert (row["state"], row["error_code"]) == ("failed", "budget_exceeded")
    assert on_page.posted == []


async def test_a_post_that_may_have_arrived_is_never_sent_again(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project = await site_project(migrated)
    run_id = await _queue(worker_db, workspace.id, project)
    on_page = FakeOnPage(post_error=ProviderError(kind=ProviderErrorKind.TIMEOUT, message="read"))

    await crawl_tick(worker_db, on_page, _Sent(), now=NOW)
    await crawl_tick(worker_db, on_page, _Sent(), now=NOW)

    row = await _run(migrated, run_id)
    assert (row["state"], row["error_code"]) == ("failed", "submit_unknown")
    assert len(on_page.posted) == 1


@pytest.mark.parametrize("kind", [ProviderErrorKind.NOT_SENT, ProviderErrorKind.RATE_LIMITED])
async def test_a_post_that_certainly_did_not_arrive_waits_for_the_next_tick(
    migrated: PostgresServer, worker_db: Sessions, kind: ProviderErrorKind
) -> None:
    workspace, project = await site_project(migrated)
    run_id = await _queue(worker_db, workspace.id, project)
    on_page = FakeOnPage(post_error=ProviderError(kind=kind, message="busy"))

    await crawl_tick(worker_db, on_page, _Sent(), now=NOW)

    row = await _run(migrated, run_id)
    assert (row["state"], row["submitted_at"]) == ("queued", None)


async def test_a_finished_crawl_goes_to_ingest_and_a_blocked_one_fails(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project = await site_project(migrated)
    other_workspace, blocked_project = await site_project(migrated)
    done = await _queue(worker_db, workspace.id, project)
    blocked = await _queue(worker_db, other_workspace.id, blocked_project)
    for run_id, task in ((done, "task-done"), (blocked, "task-blocked")):
        await execute(
            migrated,
            "UPDATE seo.crawl_runs SET state = 'crawling', provider_task_id = $2, "
            "submitted_at = now() WHERE id = $1",
            run_id,
            task,
        )
    finished = summary(finished=True, crawled=2000, stop="limit_exceeded")
    refused = summary(finished=True, crawled=1, status="forbidden_robots")
    on_page = FakeOnPage()
    sent = _Sent()

    async def answer(task_id: str) -> object:
        return finished if task_id == "task-done" else refused

    on_page.summary = answer  # type: ignore[method-assign,assignment]
    await crawl_tick(worker_db, on_page, sent, now=NOW)

    assert (await _run(migrated, done))["state"] == "processing"
    assert (await _run(migrated, done))["stop_reason"] == "limit_exceeded"
    assert [task.run_id for task in sent.tasks] == [done]
    row = await _run(migrated, blocked)
    assert (row["state"], row["error_code"]) == ("failed", "site_blocked")


async def test_cancelling_a_crawl_under_way_stops_it_at_the_provider(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project = await site_project(migrated)
    run_id = await _queue(worker_db, workspace.id, project)
    await execute(
        migrated,
        "UPDATE seo.crawl_runs SET state = 'crawling', provider_task_id = 'task-x', "
        "submitted_at = now(), cancel_requested = true WHERE id = $1",
        run_id,
    )
    on_page = FakeOnPage()

    report = await crawl_tick(worker_db, on_page, _Sent(), now=NOW)

    assert report.cancelled == 1
    assert on_page.stopped == ["task-x"]
    assert (await _run(migrated, run_id))["state"] == "cancelled"


async def test_only_the_last_four_finished_crawls_keep_their_links(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project = await site_project(migrated)
    runs = [(await seed_crawl(migrated, workspace, project, [("/", 200)]))[0] for _ in range(5)]

    report = await crawl_tick(worker_db, FakeOnPage(), _Sent(), now=NOW)

    assert report.dropped == 1
    kept = await fetch(
        migrated,
        "SELECT id FROM seo.crawl_runs WHERE project_id = $1 AND links_dropped_at IS NULL",
        project,
    )
    assert {row["id"] for row in kept} == set(runs[1:])
    part = await fetchrow(
        migrated, "SELECT to_regclass($1) AS found", f"seo.crawl_links_{runs[0].hex}"
    )
    assert part["found"] is None


async def test_a_crawl_cancelled_during_processing_does_not_cost_a_finished_one_its_links(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project = await site_project(migrated)
    ready = [(await seed_crawl(migrated, workspace, project, [("/", 200)]))[0] for _ in range(4)]
    cancelled = (await seed_crawl(migrated, workspace, project, [("/", 200)], state="cancelled"))[0]
    await execute(
        migrated, "UPDATE seo.crawl_runs SET ingest_phase = 'links' WHERE id = $1", cancelled
    )

    report = await crawl_tick(worker_db, FakeOnPage(), _Sent(), now=NOW)

    assert report.dropped == 1
    kept = await fetch(
        migrated,
        "SELECT id FROM seo.crawl_runs WHERE project_id = $1 AND links_dropped_at IS NULL",
        project,
    )
    assert {row["id"] for row in kept} == set(ready)
    part = await fetchrow(
        migrated, "SELECT to_regclass($1) AS found", f"seo.crawl_links_{cancelled.hex}"
    )
    assert part["found"] is None


async def _due_tick(worker_db: Sessions, project: uuid.UUID) -> int:
    slot = datetime.combine(NOW.date(), NIGHT_START, tzinfo=UTC) + slot_offset(project)
    report = await crawl_tick(worker_db, None, _Sent(), now=slot + timedelta(minutes=5))
    return report.queued


async def test_a_project_with_a_bad_time_zone_does_not_stop_the_others(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    _, bad = await site_project(migrated)
    _, good = await site_project(migrated)
    await execute(migrated, "UPDATE core.projects SET timezone = 'Mars/Olympus' WHERE id = $1", bad)

    queued = await _due_tick(worker_db, good)

    assert queued == 1
    rows = await fetch(migrated, "SELECT project_id FROM seo.crawl_runs")
    assert [row["project_id"] for row in rows] == [good]


async def test_a_project_that_cannot_be_queued_does_not_stop_the_others(
    migrated: PostgresServer, worker_db: Sessions, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, broken = await site_project(migrated)
    _, good = await site_project(migrated)
    real = queue_run

    async def queue(db: AsyncSession, *, project_id: uuid.UUID, **rest: object) -> uuid.UUID:
        if project_id == broken:
            raise LookupError("the price book has no On-Page price")
        return await real(db, project_id=project_id, **rest)  # type: ignore[arg-type]

    monkeypatch.setattr("idraft.collectors.crawl_runs.queue_run", queue)
    # Night slots are spread by project id, so both projects are made due at any time.
    monkeypatch.setattr("idraft.collectors.crawl_runs.crawl_due", lambda **_: True)

    report = await crawl_tick(worker_db, None, _Sent(), now=NOW)

    assert report.queued == 1
    rows = await fetch(migrated, "SELECT project_id FROM seo.crawl_runs")
    assert [row["project_id"] for row in rows] == [good]


async def test_one_crawl_that_fails_unexpectedly_does_not_stop_the_tick(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    ingesting_ws, ingesting_project = await site_project(migrated)
    stuck_ws, stuck_project = await site_project(migrated)
    moving_ws, moving_project = await site_project(migrated)
    ingesting = await _queue(worker_db, ingesting_ws.id, ingesting_project)
    stuck = await _queue(worker_db, stuck_ws.id, stuck_project)
    moving = await _queue(worker_db, moving_ws.id, moving_project)
    await execute(
        migrated,
        "UPDATE seo.crawl_runs SET state = 'processing', ingest_phase = 'pages' WHERE id = $1",
        ingesting,
    )
    for run_id, task in ((stuck, "task-stuck"), (moving, "task-moving")):
        await execute(
            migrated,
            "UPDATE seo.crawl_runs SET state = 'crawling', provider_task_id = $2, "
            "submitted_at = now() WHERE id = $1",
            run_id,
            task,
        )
    on_page = FakeOnPage()

    async def answer(task_id: str) -> object:
        if task_id == "task-stuck":
            raise RuntimeError("the answer cannot be read")
        return summary(finished=True, crawled=5)

    on_page.summary = answer  # type: ignore[method-assign,assignment]
    sent = _Sent()

    async def send(task: CrawlIngestTask) -> bool:
        if task.run_id == ingesting:
            raise ConnectionError("the queue is away")
        return await sent(task)

    report = await crawl_tick(worker_db, on_page, send, now=NOW)

    assert (report.finished, report.ingest_sent) == (1, 1)
    assert [task.run_id for task in sent.tasks] == [moving]
    assert (await _run(migrated, stuck))["state"] == "crawling"
    assert (await _run(migrated, ingesting))["state"] == "processing"


async def test_a_queued_crawl_that_cannot_be_posted_does_not_block_the_next(
    migrated: PostgresServer, worker_db: Sessions, monkeypatch: pytest.MonkeyPatch
) -> None:
    stuck_ws, stuck_project = await site_project(migrated)
    fine_ws, fine_project = await site_project(migrated)
    stuck = await _queue(worker_db, stuck_ws.id, stuck_project)
    fine = await _queue(worker_db, fine_ws.id, fine_project)
    real = budget.check

    async def check(
        db: AsyncSession, *, workspace_id: uuid.UUID, **rest: object
    ) -> budget.BudgetVerdict:
        if workspace_id == stuck_ws.id:
            raise RuntimeError("the budget cannot be read")
        return await real(db, workspace_id=workspace_id, **rest)  # type: ignore[arg-type]

    monkeypatch.setattr(budget, "check", check)
    on_page = FakeOnPage(summaries=[summary(finished=False, crawled=1, queue=9)])

    await crawl_tick(worker_db, on_page, _Sent(), now=NOW)

    assert (await _run(migrated, fine))["state"] == "crawling"
    row = await _run(migrated, stuck)
    assert (row["state"], row["submitted_at"]) == ("queued", None)
    assert len(on_page.posted) == 1


@pytest.mark.parametrize("stop_fails", [False, True])
async def test_a_crawl_cancelled_while_it_is_being_posted_stays_cancelled(
    migrated: PostgresServer, worker_db: Sessions, stop_fails: bool
) -> None:
    workspace, project = await site_project(migrated)
    run_id = await _queue(worker_db, workspace.id, project)
    on_page = FakeOnPage()
    real_post = on_page.post

    async def post(order: CrawlOrder) -> PostedCrawl:
        await execute(
            migrated,
            "UPDATE seo.crawl_runs SET state = 'cancelled', finished_at = now() WHERE id = $1",
            run_id,
        )
        return await real_post(order)

    async def stop(task_id: str) -> None:
        on_page.stopped.append(task_id)
        if stop_fails:
            raise ProviderCallError(ProviderError(kind=ProviderErrorKind.TIMEOUT, message="read"))

    on_page.post = post  # type: ignore[method-assign]
    on_page.force_stop = stop  # type: ignore[method-assign]

    await crawl_tick(worker_db, on_page, _Sent(), now=NOW)

    row = await _run(migrated, run_id)
    assert (row["state"], row["provider_task_id"], row["cost_usd"]) == (
        "cancelled",
        "task-1",
        Decimal("0.300000"),
    )
    assert on_page.stopped == ["task-1"]
    events = await fetch(
        migrated, "SELECT cost_usd FROM ops.provider_cost_events WHERE run_id = $1", run_id
    )
    assert [event["cost_usd"] for event in events] == [Decimal("0.300000")]


@pytest.mark.parametrize("fails", [False, True])
async def test_two_overlapping_ticks_post_a_crawl_once_and_it_stays_failed(
    migrated: PostgresServer, worker_db: Sessions, fails: bool
) -> None:
    workspace, project = await site_project(migrated)
    run_id = await _queue(worker_db, workspace.id, project)
    outer = FakeOnPage(
        post_error=ProviderError(kind=ProviderErrorKind.PROVIDER_ERROR, message="bad")
        if fails
        else None
    )
    inner = FakeOnPage()
    real_post = outer.post

    async def post(order: CrawlOrder) -> PostedCrawl:
        # Another tick runs while this post is in flight: it finds a post begun and no outcome.
        await crawl_tick(worker_db, inner, _Sent(), now=NOW)
        return await real_post(order)

    outer.post = post  # type: ignore[method-assign]

    await crawl_tick(worker_db, outer, _Sent(), now=NOW)

    row = await _run(migrated, run_id)
    assert (row["state"], row["error_code"]) == ("failed", "submit_unknown")
    assert len(outer.posted) + len(inner.posted) == 1


async def test_a_cancel_asked_while_the_summary_is_read_is_not_lost(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project = await site_project(migrated)
    run_id = await _queue(worker_db, workspace.id, project)
    await _crawling(migrated, run_id, "task-x")
    on_page = FakeOnPage()

    async def answer(task_id: str) -> object:
        await execute(
            migrated, "UPDATE seo.crawl_runs SET cancel_requested = true WHERE id = $1", run_id
        )
        return summary(finished=True, crawled=5)

    on_page.summary = answer  # type: ignore[method-assign,assignment]
    sent = _Sent()

    first = await crawl_tick(worker_db, on_page, sent, now=NOW)

    assert (await _run(migrated, run_id))["state"] == "crawling"
    assert (first.finished, sent.tasks) == (0, [])
    second = await crawl_tick(worker_db, on_page, sent, now=NOW)
    assert second.cancelled == 1
    assert on_page.stopped == ["task-x"]
    assert (await _run(migrated, run_id))["state"] == "cancelled"


async def test_a_crawl_that_is_no_longer_crawling_is_not_moved_on(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project = await site_project(migrated)
    run_id = await _queue(worker_db, workspace.id, project)
    await _crawling(migrated, run_id, "task-x")
    on_page = FakeOnPage()

    async def answer(task_id: str) -> object:
        await execute(
            migrated,
            "UPDATE seo.crawl_runs SET state = 'failed', error_code = 'provider_error', "
            "finished_at = now() WHERE id = $1",
            run_id,
        )
        return summary(finished=True, crawled=5)

    on_page.summary = answer  # type: ignore[method-assign,assignment]
    sent = _Sent()

    report = await crawl_tick(worker_db, on_page, sent, now=NOW)

    assert (await _run(migrated, run_id))["state"] == "failed"
    assert (report.finished, sent.tasks) == (0, [])


async def test_a_summary_the_provider_no_longer_holds_fails_the_crawl(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project = await site_project(migrated)
    run_id = await _queue(worker_db, workspace.id, project)
    await _crawling(migrated, run_id, "task-x")
    on_page = FakeOnPage()

    async def answer(task_id: str) -> object:
        raise ProviderCallError(
            ProviderError(kind=ProviderErrorKind.NOT_FOUND_EXPIRED, message="gone")
        )

    on_page.summary = answer  # type: ignore[method-assign,assignment]

    report = await crawl_tick(worker_db, on_page, _Sent(), now=NOW)

    row = await _run(migrated, run_id)
    assert (row["state"], row["error_code"], row["error_message"]) == (
        "failed",
        "provider_error",
        "gone",
    )
    assert report.failed == 1


async def test_a_summary_that_cannot_be_read_now_is_logged_and_tried_again(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project = await site_project(migrated)
    run_id = await _queue(worker_db, workspace.id, project)
    await _crawling(migrated, run_id, "task-x")
    on_page = FakeOnPage()

    async def answer(task_id: str) -> object:
        raise ProviderCallError(ProviderError(kind=ProviderErrorKind.TIMEOUT, message="read"))

    on_page.summary = answer  # type: ignore[method-assign,assignment]

    with capture_logs() as logs:
        await crawl_tick(worker_db, on_page, _Sent(), now=NOW)

    assert (await _run(migrated, run_id))["state"] == "crawling"
    (entry,) = [log for log in logs if log["event"] == "crawl summary not read"]
    assert (entry["run_id"], entry["kind"]) == (str(run_id), "timeout")


async def test_a_queued_crawl_a_person_cancelled_is_cancelled_without_a_post(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project = await site_project(migrated)
    run_id = await _queue(worker_db, workspace.id, project)
    await execute(
        migrated, "UPDATE seo.crawl_runs SET cancel_requested = true WHERE id = $1", run_id
    )
    on_page = FakeOnPage()

    report = await crawl_tick(worker_db, on_page, _Sent(), now=NOW)

    assert (await _run(migrated, run_id))["state"] == "cancelled"
    assert (report.cancelled, on_page.posted) == (1, [])


@pytest.mark.parametrize(
    ("reported", "cost", "source"),
    [
        (None, Decimal("0.300000"), "price_book_estimate"),
        (Decimal("0.25"), Decimal("0.250000"), "provider_reported"),
    ],
)
async def test_the_cost_event_holds_the_reported_cost_or_the_estimate(
    migrated: PostgresServer,
    worker_db: Sessions,
    reported: Decimal | None,
    cost: Decimal,
    source: str,
) -> None:
    workspace, project = await site_project(migrated)
    run_id = await _queue(worker_db, workspace.id, project)

    await crawl_tick(worker_db, FakeOnPage(cost=reported), _Sent(), now=NOW)

    assert (await _run(migrated, run_id))["cost_usd"] == cost
    event = await fetchrow(
        migrated,
        "SELECT cost_usd, cost_source FROM ops.provider_cost_events WHERE run_id = $1",
        run_id,
    )
    assert (event["cost_usd"], event["cost_source"]) == (cost, source)


async def test_a_crawl_with_no_cost_estimate_fails_instead_of_skipping_the_budget(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project = await site_project(migrated)
    run_id = await _queue(worker_db, workspace.id, project)
    await execute(
        migrated, "UPDATE seo.crawl_runs SET estimated_cost_usd = NULL WHERE id = $1", run_id
    )
    on_page = FakeOnPage()

    await crawl_tick(worker_db, on_page, _Sent(), now=NOW)

    row = await _run(migrated, run_id)
    assert (row["state"], row["error_code"], row["error_message"]) == (
        "failed",
        "provider_error",
        "The crawl has no cost estimate.",
    )
    assert on_page.posted == []


async def test_a_post_that_fails_unexpectedly_is_not_sent_again(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project = await site_project(migrated)
    run_id = await _queue(worker_db, workspace.id, project)
    on_page = FakeOnPage()

    async def post(order: object) -> object:
        raise RuntimeError("the connection broke")

    on_page.post = post  # type: ignore[method-assign,assignment]

    await crawl_tick(worker_db, on_page, _Sent(), now=NOW)
    row = await _run(migrated, run_id)
    assert (row["state"], row["submitted_at"] is not None) == ("queued", True)
    await crawl_tick(worker_db, on_page, _Sent(), now=NOW)

    row = await _run(migrated, run_id)
    assert (row["state"], row["error_code"]) == ("failed", "submit_unknown")
