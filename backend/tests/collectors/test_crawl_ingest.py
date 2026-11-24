"""Ingest of a finished crawl (spec 6.3 and 6.4; plan decisions D7 to D12)."""

from __future__ import annotations

import asyncio
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from typing import Any

import asyncpg
import pytest
from sqlalchemy import exc, func, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from structlog.testing import capture_logs

from idraft.collectors import crawl_ingest, crawl_store
from idraft.collectors.crawl_ingest import (
    EDGES_PER_PAGE_MAX,
    INGEST_FAILURES_MAX,
    capped_edges,
    html_key,
    ingest_run,
)
from idraft.collectors.crawl_runs import CrawlIngestTask, crawl_tick, queue_run
from idraft.collectors.crawl_store import latest_run
from idraft.crawl import graph
from idraft.crawl.placement import FoundLink, Placement
from idraft.domain.retries import ProviderErrorKind
from idraft.extraction.urls import canonicalize
from idraft.providers.contract import ProviderError
from idraft.providers.dataforseo.on_page import (
    LinkItem,
    NonIndexableBatch,
    NonIndexableItem,
    PageBatch,
)
from idraft.storage.raw import decompress
from tests.api.auth.support import Workspace, execute, fetch, fetchrow
from tests.api.internal_links.support import seed_crawl, seed_tiers
from tests.collectors.crawl_support import (
    SITE,
    FakeOnPage,
    clear_crawls,
    page_html,
    page_item,
    site_project,
    summary,
    synthetic_site,
)
from tests.collectors.support import NOW
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

Sessions = async_sessionmaker[AsyncSession]
Page = dict[str, Any]


@pytest.fixture(autouse=True)
async def _no_other_crawls(migrated: PostgresServer) -> None:
    await clear_crawls(migrated)


@dataclass
class GatedOnPage(FakeOnPage):
    """A stand-in whose raw HTML call can be held until a test lets it go."""

    hold: bool = False
    entered: asyncio.Event = field(default_factory=asyncio.Event)
    release: asyncio.Event = field(default_factory=asyncio.Event)

    async def raw_html(self, task_id: str, url: str) -> str | None:
        if self.hold:
            self.entered.set()
            await self.release.wait()
        return await super().raw_html(task_id, url)


@dataclass(frozen=True)
class Crawled:
    task: CrawlIngestTask
    workspace: Workspace
    project: uuid.UUID
    previous: uuid.UUID | None


async def _crawled(
    pg: PostgresServer, sessions: Sessions, on_page: FakeOnPage, *, previous: bool = False
) -> Crawled:
    """A project with a crawl the provider has finished, handed to ingest by the tick. With
    `previous`, the project already has a finished crawl."""
    workspace, project = await site_project(pg)
    before = None
    if previous:
        before, _ = await seed_crawl(pg, workspace, project, [("/", 200)])
    sent: list[CrawlIngestTask] = []

    async def send(task: CrawlIngestTask) -> bool:
        sent.append(task)
        return True

    async with sessions() as db, db.begin():
        run_id = await queue_run(
            db,
            workspace_id=workspace.id,
            project_id=project,
            trigger="manual",
            requested_by=None,
            now=NOW,
        )
    await crawl_tick(sessions, on_page, send, now=NOW)  # posts
    await crawl_tick(sessions, on_page, send, now=NOW)  # reads the finished summary
    task = next(task for task in sent if task.run_id == run_id)
    return Crawled(task=task, workspace=workspace, project=project, previous=before)


async def _ingest(
    sessions: Sessions,
    on_page: FakeOnPage,
    store: MemoryStore | None,
    task: CrawlIngestTask,
) -> crawl_ingest.IngestOutcome:
    return await ingest_run(sessions, on_page, store, task, deadline=time.monotonic() + 120)


async def _state(pg: PostgresServer, run_id: uuid.UUID) -> tuple[str, str | None]:
    row = await fetchrow(pg, "SELECT state, ingest_phase FROM seo.crawl_runs WHERE id = $1", run_id)
    return row["state"], row["ingest_phase"]


async def _step_until(
    pg: PostgresServer,
    sessions: Sessions,
    on_page: FakeOnPage,
    task: CrawlIngestTask,
    stop: Callable[[str, str | None], bool],
) -> None:
    """One step a pass (an expired deadline) until `stop(state, phase)` holds."""
    for _ in range(80):
        if stop(*await _state(pg, task.run_id)):
            return
        await ingest_run(sessions, on_page, None, task, deadline=0.0)
    raise AssertionError("the crawl did not get there")


async def _pages(pg: PostgresServer, run_id: uuid.UUID) -> dict[str, Page]:
    rows = await fetch(
        pg,
        "SELECT u.path, p.* FROM seo.crawl_pages p JOIN core.urls u ON u.id = p.url_id "
        "WHERE p.run_id = $1",
        run_id,
    )
    return {row["path"]: dict(row) for row in rows}


async def _snapshot(
    pg: PostgresServer, run_id: uuid.UUID
) -> tuple[list[Page], list[Page], list[Page]]:
    """Everything a crawl leaves behind, without the ids that differ between two crawls."""
    pages = [
        {
            key: value
            for key, value in page.items()
            if key not in ("run_id", "project_id", "workspace_id")
        }
        for page in (await _pages(pg, run_id)).values()
    ]
    links = await fetch(
        pg,
        "SELECT s.path AS source, t.path AS target, l.anchor, l.kind, l.placement, l.scope, "
        "l.rel, l.is_followed, l.occurrences, l.container_hash, l.template_candidate "
        "FROM seo.crawl_links l JOIN core.urls s ON s.id = l.source_url_id "
        "JOIN core.urls t ON t.id = l.target_url_id WHERE l.run_id = $1 "
        "ORDER BY s.path, t.path, l.anchor, l.placement, l.kind, l.container_hash, l.rel",
        run_id,
    )
    run = await fetchrow(
        pg,
        "SELECT state, ingest_phase, sitemap_pages, equity_p25, equity_lost_to_errors, "
        "links_stored, ingest_failures, stop_reason FROM seo.crawl_runs WHERE id = $1",
        run_id,
    )
    return (
        sorted(pages, key=lambda page: page["path"]),
        [dict(link) for link in links],
        [dict(run)],
    )


async def _cost_events(pg: PostgresServer, run_id: uuid.UUID) -> int:
    row = await fetchrow(
        pg, "SELECT count(*) AS n FROM ops.provider_cost_events WHERE run_id = $1", run_id
    )
    count: int = row["n"]
    return count


async def test_a_crawl_becomes_pages_links_and_metrics(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = synthetic_site()
    store = MemoryStore()
    crawled = await _crawled(migrated, worker_db, on_page)
    task = crawled.task
    spent = await _cost_events(migrated, task.run_id)

    outcome = await _ingest(worker_db, on_page, store, task)

    run = await fetchrow(migrated, "SELECT * FROM seo.crawl_runs WHERE id = $1", task.run_id)
    assert (run["state"], run["ingest_phase"], outcome.failed) == ("ready", "done", False)
    assert run["sitemap_pages"] == 3
    assert run["start_url_id"] is not None
    assert run["finished_at"] is not None
    pages = await _pages(migrated, task.run_id)
    assert len(pages) == 11
    depth = {path: page["click_depth"] for path, page in pages.items()}
    assert depth == {
        "/": 0,
        "/pricing": 1,
        "/blog": 1,
        "/blog/a": 1,
        "/privacy": 1,
        "/blog/b": 2,
        "/blog/c": 2,
        "/blog/d": 3,
        "/old": 3,
        "/gone": 3,
        "/orphan": None,
    }
    pricing = pages["/pricing"]
    # One editorial link (/blog/a); the menu link is on the other seven pages that have HTML.
    assert (
        pricing["linking_pages_editorial"],
        pricing["linking_pages_template"],
        pricing["linking_pages_all"],
        pricing["top_anchor"],
    ) == (1, 7, 7, "See plans")
    assert (pages["/blog/c"]["broken_outlinks"], pages["/blog/c"]["redirect_outlinks"]) == (1, 1)
    assert pages["/blog/d"]["deep_only_through_auto"]
    assert pages["/blog/d"]["is_editorial_orphan"]
    assert pages["/orphan"]["is_orphan"]
    assert pages["/orphan"]["links_state"] == "from_provider"
    assert pages["/privacy"]["is_indexable"] is False
    assert pages["/privacy"]["non_indexable_reason"] == "meta_tag"
    assert pages["/old"]["redirect_url_id"] == pricing["url_id"]
    shares = [page["equity_share"] for page in pages.values()]
    assert sum(shares) == pytest.approx(1.0)
    assert pricing["equity_share"] > pages["/blog/d"]["equity_share"]
    scopes = await fetch(
        migrated,
        "SELECT u.path, l.scope FROM seo.crawl_links l JOIN core.urls u ON u.id = l.target_url_id "
        "WHERE l.run_id = $1 AND l.source_url_id = $2",
        task.run_id,
        pages["/blog/c"]["url_id"],
    )
    assert {(row["path"], row["scope"]) for row in scopes} >= {
        ("/blog/d", "auto_generated"),
        ("/blog/b", "auto_generated"),
        ("/old", "editorial"),
        ("/pricing", "template"),
    }
    key = html_key(crawled.project, canonicalize(f"{SITE}/pricing").url_hash)
    assert b"How it works" in decompress(store.objects[key])
    # The eight pages with HTML, and none for the page whose HTML is missing.
    assert len(store.objects) == 8
    flow = await fetch(migrated, "SELECT 1 FROM seo.crawl_tier_flow WHERE run_id = $1", task.run_id)
    assert flow
    # Ingest reads and never buys: the one post and its one cost event are the tick's.
    assert len(on_page.posted) == 1
    assert await _cost_events(migrated, task.run_id) == spent == 1


async def test_ingest_carries_on_from_its_checkpoint(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = synthetic_site()
    task = (await _crawled(migrated, worker_db, on_page)).task

    passes = 0
    while passes < 50:
        passes += 1
        # An expired deadline: each pass takes one step and stops.
        await ingest_run(worker_db, on_page, None, task, deadline=0.0)
        run = await fetchrow(
            migrated, "SELECT state FROM seo.crawl_runs WHERE id = $1", task.run_id
        )
        if run["state"] != "processing":
            break

    pages = await _pages(migrated, task.run_id)
    assert run["state"] == "ready"
    assert passes > 5
    assert pages["/pricing"]["linking_pages_template"] == 7


def _site_with_head_canonicals() -> FakeOnPage:
    """The synthetic site, where the provider names no canonical (as on real crawls) and the
    pages say it in their HTML: `/blog/a` names `/blog/b` (relative), `/blog/b` itself with a
    trailing slash, `/privacy` (which the provider calls non-indexable by its meta tag) names
    `/pricing`, and `/pricing` names `/blog` while the provider says `/blog/c`."""
    site = synthetic_site()
    site.html[f"{SITE}/blog/a"] = page_html(
        '<p><a href="/pricing">See plans</a></p>',
        article=True,
        next_="/blog/b",
        canonical="/blog/b",
    )
    site.html[f"{SITE}/blog/b"] = page_html(
        "<p>No links here.</p>",
        article=True,
        prev="/blog/a",
        next_="/blog/c",
        canonical=f"{SITE}/blog/b/",
    )
    site.html[f"{SITE}/privacy"] = page_html("<p>Privacy.</p>", canonical="/pricing")
    site.html[f"{SITE}/pricing"] = page_html(
        '<div class="intro"><a href="/blog/c">How it works</a></div>', canonical="/blog"
    )
    site.page_items = [
        item.model_copy(update={"canonical": f"{SITE}/blog/c"})
        if item.url == f"{SITE}/pricing"
        else item
        for item in site.page_items
    ]
    return site


async def _canonicals(pg: PostgresServer, run_id: uuid.UUID) -> dict[str, tuple[Any, ...]]:
    rows = await fetch(
        pg,
        "SELECT p.url_id, u.path, c.path AS canonical, p.is_indexable, p.non_indexable_reason "
        "FROM seo.crawl_pages p JOIN core.urls u ON u.id = p.url_id "
        "LEFT JOIN core.urls c ON c.id = p.canonical_url_id WHERE p.run_id = $1",
        run_id,
    )
    return {
        row["path"]: (row["canonical"], row["is_indexable"], row["non_indexable_reason"])
        for row in rows
    }


async def test_a_canonical_only_the_html_names_is_stored_and_makes_the_page_non_indexable(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = _site_with_head_canonicals()
    crawled = await _crawled(migrated, worker_db, on_page)

    await _ingest(worker_db, on_page, None, crawled.task)

    stored = await _canonicals(migrated, crawled.task.run_id)
    # Another page's canonical: stored, and non-indexable for the reason ingest gives it.
    assert stored["/blog/a"] == ("/blog/b", False, "canonical")
    # Its own address, with or without a trailing slash: stored and still indexable.
    assert stored["/blog/b"] == ("/blog/b", True, None)
    # The provider's own reason is kept, and the canonical is stored beside it.
    assert stored["/privacy"] == ("/pricing", False, "meta_tag")
    # The provider's canonical outranks the page's HTML.
    assert stored["/pricing"] == ("/blog/c", False, "canonical")
    # No canonical anywhere: untouched.
    assert stored["/blog"] == (None, True, None)
    assert stored["/orphan"] == (None, True, None)
    assert stored["/gone"] == (None, True, None)


async def test_a_crash_in_the_links_step_resumes_to_the_same_canonicals(
    migrated: PostgresServer, worker_db: Sessions, monkeypatch: pytest.MonkeyPatch
) -> None:
    plain_site = _site_with_head_canonicals()
    plain = await _crawled(migrated, worker_db, plain_site)
    await _ingest(worker_db, plain_site, None, plain.task)
    expected = await _canonicals(migrated, plain.task.run_id)
    assert expected["/blog/a"] == ("/blog/b", False, "canonical")
    await execute(
        migrated, "UPDATE core.projects SET primary_domain_id = NULL WHERE id = $1", plain.project
    )
    on_page = _site_with_head_canonicals()
    task = (await _crawled(migrated, worker_db, on_page)).task
    armed = [True]
    real_checkpoint = crawl_ingest._checkpoint

    async def checkpoint(db: AsyncSession, run: Any, **values: object) -> None:
        # The links step's last write: its canonicals are in the transaction, its checkpoint is not.
        if run.phase == "links" and armed:
            armed.clear()
            raise RuntimeError("injected")
        await real_checkpoint(db, run, **values)

    monkeypatch.setattr(crawl_ingest, "_checkpoint", checkpoint)
    failed = 0
    for _ in range(60):
        failed += (await _ingest(worker_db, on_page, None, task)).failed
        if (await _state(migrated, task.run_id))[0] != "processing":
            break

    assert failed == 1
    assert await _canonicals(migrated, task.run_id) == expected
    assert await _snapshot(migrated, task.run_id) == await _snapshot(migrated, plain.task.run_id)


@pytest.mark.parametrize("status", [401, 403])
async def test_a_start_page_that_refuses_the_crawler_does_not_fail_a_crawl_that_found_pages(
    migrated: PostgresServer, worker_db: Sessions, status: int
) -> None:
    """Real data (eventussecurity.com): the start page and a fifth of the pages answered 403 and
    318 pages were served. The crawl is kept: the refused pages are stored as broken."""
    on_page = synthetic_site()
    on_page.page_items[0] = on_page.page_items[0].model_copy(
        update={"status_code": status, "resource_type": "broken"}
    )
    task = (await _crawled(migrated, worker_db, on_page)).task

    await _ingest(worker_db, on_page, None, task)

    run = await fetchrow(
        migrated, "SELECT state, error_code FROM seo.crawl_runs WHERE id = $1", task.run_id
    )
    assert (run["state"], run["error_code"]) == ("ready", None)
    start = (await _pages(migrated, task.run_id))["/"]
    assert (start["status_code"], start["resource_type"]) == (status, "broken")


async def test_a_refused_start_page_gets_the_sites_menu_links_for_the_depth_walk_only(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    """Real data (eventussecurity.com): the CDN answered the start page 403, so no page was
    reachable and 420 of 421 had no depth. The menu is on every served page, so it is on the
    start page too; those links are used for the walk and are never stored."""
    on_page = synthetic_site()
    on_page.page_items[0] = on_page.page_items[0].model_copy(
        update={"status_code": 403, "resource_type": "broken"}
    )
    del on_page.html[f"{SITE}/"]
    task = (await _crawled(migrated, worker_db, on_page)).task

    with capture_logs() as logs:
        await _ingest(worker_db, on_page, None, task)

    pages = await _pages(migrated, task.run_id)
    assert {path: page["click_depth"] for path, page in pages.items()} == {
        "/": 0,
        "/pricing": 1,
        "/blog": 1,
        "/privacy": 1,
        "/blog/a": 2,
        "/blog/b": 2,
        "/blog/c": 2,
        "/blog/d": 3,
        "/old": 3,
        "/gone": 3,
        "/orphan": None,
    }
    assert pages["/orphan"]["is_orphan"]
    assert pages["/"]["status_code"] == 403
    assert pages["/"]["resource_type"] == "broken"
    assert not pages["/"]["is_orphan"]
    # Nothing was stored for the start page, and no page counts it as linking out or in.
    stored = await fetchrow(
        migrated,
        "SELECT count(*) AS n FROM seo.crawl_links WHERE run_id = $1 AND source_url_id = $2",
        task.run_id,
        pages["/"]["url_id"],
    )
    assert stored["n"] == 0
    assert (pages["/"]["outlinks_all"], pages["/"]["outlinks_template"]) == (0, 0)
    # The six other pages with HTML carry the menu; the start page is not one of them.
    assert pages["/pricing"]["linking_pages_template"] == 6
    event = "crawl start page unreadable, depth from template links"
    entry = next(log for log in logs if log["event"] == event)
    assert (entry["run_id"], entry["roots"]) == (str(task.run_id), 4)


async def test_a_readable_start_page_is_walked_as_before_and_nothing_is_logged(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = synthetic_site()
    task = (await _crawled(migrated, worker_db, on_page)).task

    with capture_logs() as logs:
        await _ingest(worker_db, on_page, None, task)

    pages = await _pages(migrated, task.run_id)
    assert pages["/blog/b"]["click_depth"] == 2
    assert pages["/orphan"]["click_depth"] is None
    assert not any(log["event"].startswith("crawl start page") for log in logs)


@pytest.mark.parametrize("status", [401, 403])
async def test_a_start_page_that_refuses_the_crawler_fails_the_crawl_and_keeps_its_phase(
    migrated: PostgresServer, worker_db: Sessions, status: int
) -> None:
    on_page = synthetic_site()
    # A site that refuses the crawler refuses every page it is asked for.
    on_page.page_items = [
        item.model_copy(update={"status_code": status, "resource_type": "broken"})
        for item in on_page.page_items
        if item.status_code == 200
    ]
    task = (await _crawled(migrated, worker_db, on_page)).task

    await _ingest(worker_db, on_page, None, task)

    run = await fetchrow(
        migrated,
        "SELECT state, error_code, ingest_phase FROM seo.crawl_runs WHERE id = $1",
        task.run_id,
    )
    # The phase stays set: it is how the retention step knows the crawl has a partition.
    assert (run["state"], run["error_code"], run["ingest_phase"]) == (
        "failed",
        "site_blocked",
        "pages",
    )
    await crawl_tick(worker_db, on_page, _nothing, now=NOW)
    gone = await fetchrow(
        migrated,
        "SELECT links_dropped_at IS NOT NULL AS dropped, to_regclass($2)::text AS partition "
        "FROM seo.crawl_runs WHERE id = $1",
        task.run_id,
        "seo.crawl_links_" + str(task.run_id).replace("-", ""),
    )
    assert (gone["dropped"], gone["partition"]) == (True, None)


async def _nothing(task: CrawlIngestTask) -> bool:
    return True


def _break_the_template_pass(monkeypatch: pytest.MonkeyPatch, *, broken: list[bool]) -> None:
    """The template pass raises (a stored placement that is none) while `broken` holds one
    value: a failure that is the crawl's own, so it counts."""

    def refuse(*_: object) -> dict[int, str]:
        if broken:
            raise ValueError("not a placement")
        return {}

    monkeypatch.setattr(crawl_ingest, "template_placements", refuse)


async def test_a_pass_that_keeps_failing_ends_the_crawl_and_keeps_the_last_good_one(
    migrated: PostgresServer, worker_db: Sessions, monkeypatch: pytest.MonkeyPatch
) -> None:
    on_page = synthetic_site()
    _break_the_template_pass(monkeypatch, broken=[True])
    crawled = await _crawled(migrated, worker_db, on_page, previous=True)
    task = crawled.task

    for _ in range(INGEST_FAILURES_MAX):
        await _ingest(worker_db, on_page, None, task)

    run = await fetchrow(
        migrated,
        "SELECT state, error_code, ingest_failures, ingest_phase FROM seo.crawl_runs WHERE id = $1",
        task.run_id,
    )
    assert (run["state"], run["error_code"], run["ingest_failures"]) == (
        "failed",
        "ingest_failed",
        INGEST_FAILURES_MAX,
    )
    # Still at the phase that failed, so retention drops its link partition.
    assert run["ingest_phase"] == "template"
    async with worker_db() as db:
        assert await latest_run(db, crawled.workspace.id, crawled.project) == crawled.previous
    # A pass after the end changes nothing.
    again = await _ingest(worker_db, on_page, None, task)
    assert (again.failed, again.steps) == (False, 0)
    await crawl_tick(worker_db, on_page, _nothing, now=NOW)
    dropped = await fetchrow(
        migrated, "SELECT links_dropped_at FROM seo.crawl_runs WHERE id = $1", task.run_id
    )
    assert dropped["links_dropped_at"] is not None


async def test_a_pass_that_works_again_clears_the_count_of_failures(
    migrated: PostgresServer, worker_db: Sessions, monkeypatch: pytest.MonkeyPatch
) -> None:
    on_page = synthetic_site()
    broken = [True]
    _break_the_template_pass(monkeypatch, broken=broken)
    task = (await _crawled(migrated, worker_db, on_page)).task
    for _ in range(INGEST_FAILURES_MAX - 1):
        await _ingest(worker_db, on_page, None, task)

    broken.clear()
    await _ingest(worker_db, on_page, None, task)

    run = await fetchrow(
        migrated, "SELECT state, ingest_failures FROM seo.crawl_runs WHERE id = $1", task.run_id
    )
    assert (run["state"], run["ingest_failures"]) == ("ready", 0)


async def test_a_bad_stored_placement_fails_the_step_and_changes_nothing(
    migrated: PostgresServer, worker_db: Sessions, monkeypatch: pytest.MonkeyPatch
) -> None:
    on_page = synthetic_site()
    task = (await _crawled(migrated, worker_db, on_page)).task
    await _step_until(migrated, worker_db, on_page, task, lambda _, phase: phase == "template")

    def refuse(*_: object) -> dict[int, str]:
        raise ValueError("not a placement")

    monkeypatch.setattr(crawl_ingest, "template_placements", refuse)
    outcome = await _ingest(worker_db, on_page, None, task)

    run = await fetchrow(
        migrated,
        "SELECT state, ingest_phase, ingest_failures FROM seo.crawl_runs WHERE id = $1",
        task.run_id,
    )
    assert outcome.failed
    assert (run["state"], run["ingest_phase"], run["ingest_failures"]) == (
        "processing",
        "template",
        1,
    )


async def test_two_passes_over_one_crawl_end_in_one_coherent_result(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    plain = await _crawled(migrated, worker_db, synthetic_site())
    await _ingest(worker_db, synthetic_site(), None, plain.task)
    expected = await _snapshot(migrated, plain.task.run_id)
    await execute(
        migrated, "UPDATE core.projects SET primary_domain_id = NULL WHERE id = $1", plain.project
    )
    on_page = GatedOnPage(**vars(synthetic_site()))
    crawled = await _crawled(migrated, worker_db, on_page)
    on_page.hold = True

    first = asyncio.create_task(_ingest(worker_db, on_page, None, crawled.task))
    await asyncio.wait_for(on_page.entered.wait(), timeout=30)
    second = await _ingest(worker_db, on_page, None, crawled.task)
    on_page.hold = False
    on_page.release.set()
    done = await first

    assert (second.busy, second.steps) == (True, 0)
    assert (done.busy, done.failed) == (False, False)
    assert await _snapshot(migrated, crawled.task.run_id) == expected
    # The lock is gone with the pass: a later pass finds the crawl done and takes no step.
    later = await _ingest(worker_db, on_page, None, crawled.task)
    assert (later.busy, later.steps, later.phase) == (False, 0, "done")


@pytest.mark.parametrize("cancelled_again_while_unlocking", [False, True])
async def test_a_pass_that_is_cancelled_gives_up_its_lock(
    migrated: PostgresServer,
    worker_db: Sessions,
    monkeypatch: pytest.MonkeyPatch,
    cancelled_again_while_unlocking: bool,
) -> None:
    on_page = GatedOnPage(**vars(synthetic_site()))
    task = (await _crawled(migrated, worker_db, on_page)).task
    real_func = func

    class SlowUnlock:
        """`func` whose unlock waits, so that a second cancel lands in the middle of it."""

        def __getattr__(self, name: str) -> Any:
            if name == "pg_advisory_unlock":
                return lambda _key: real_func.pg_sleep(60)
            return getattr(real_func, name)

    if cancelled_again_while_unlocking:
        monkeypatch.setattr(crawl_ingest, "func", SlowUnlock())
    on_page.hold = True
    running = asyncio.ensure_future(_ingest(worker_db, on_page, None, task))
    await asyncio.wait_for(on_page.entered.wait(), timeout=30)

    # The handler's time limit, and then (a shutdown, say) another cancel mid-unlock.
    running.cancel()
    if cancelled_again_while_unlocking:
        await asyncio.sleep(1)
        running.cancel()
    with pytest.raises(asyncio.CancelledError):
        await running
    monkeypatch.setattr(crawl_ingest, "func", real_func)
    on_page.hold = False
    again = await _ingest(worker_db, on_page, None, task)

    assert (again.busy, again.failed) == (False, False)
    assert (await _state(migrated, task.run_id))[0] == "ready"


async def test_a_step_that_was_overtaken_writes_nothing(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = GatedOnPage(**vars(synthetic_site()))
    task = (await _crawled(migrated, worker_db, on_page)).task
    stale_first = await crawl_ingest._read_run(worker_db, task)
    assert stale_first is not None
    await _step_until(migrated, worker_db, on_page, task, lambda _, phase: phase == "links")
    at_links = await crawl_ingest._read_run(worker_db, task)
    assert at_links is not None
    step = crawl_ingest._STEPS["links"]

    # Two steps read the same checkpoint; the first is held while the second takes every page.
    on_page.hold = True
    held = asyncio.ensure_future(step(worker_db, on_page, None, at_links))
    await asyncio.wait_for(on_page.entered.wait(), timeout=30)
    on_page.hold = False
    assert await step(worker_db, on_page, None, at_links)
    stored = await fetchrow(
        migrated, "SELECT count(*) AS n FROM seo.crawl_links WHERE run_id = $1", task.run_id
    )
    on_page.release.set()
    await held

    after = await fetchrow(
        migrated, "SELECT count(*) AS n FROM seo.crawl_links WHERE run_id = $1", task.run_id
    )
    run = await fetchrow(
        migrated, "SELECT links_stored FROM seo.crawl_runs WHERE id = $1", task.run_id
    )
    assert stored["n"] > 0
    assert after["n"] == stored["n"] == run["links_stored"]
    # A step from the first checkpoint finds the crawl somewhere else and does nothing.
    before = await _snapshot(migrated, task.run_id)
    assert not await crawl_ingest._STEPS["pages"](worker_db, on_page, None, stale_first)
    assert await _snapshot(migrated, task.run_id) == before


@pytest.mark.parametrize(
    ("phase", "crash_in"),
    [
        ("pages", "_checkpoint"),
        ("non_indexable", "_checkpoint"),
        ("links", "_checkpoint"),
        ("template", "_checkpoint"),
        ("metrics", "pagerank"),
        ("metrics", "apply_rules"),
    ],
)
async def test_a_crash_inside_a_step_resumes_to_the_data_of_an_uninterrupted_run(
    migrated: PostgresServer,
    worker_db: Sessions,
    monkeypatch: pytest.MonkeyPatch,
    phase: str,
    crash_in: str,
) -> None:
    plain = await _crawled(migrated, worker_db, synthetic_site())
    await _ingest(worker_db, synthetic_site(), None, plain.task)
    expected = await _snapshot(migrated, plain.task.run_id)
    await execute(
        migrated, "UPDATE core.projects SET primary_domain_id = NULL WHERE id = $1", plain.project
    )
    on_page = synthetic_site()
    crawled = await _crawled(migrated, worker_db, on_page, previous=True)
    task = crawled.task
    armed = [True]
    real_checkpoint = crawl_ingest._checkpoint
    real_pagerank = graph.pagerank
    real_rules = crawl_store.apply_rules

    def explode_once() -> None:
        if armed:
            armed.clear()
            raise RuntimeError("injected")

    async def checkpoint(db: AsyncSession, run: Any, **values: object) -> None:
        # The step's last write: its rows are in the transaction and its checkpoint is not.
        if run.phase == phase:
            explode_once()
        await real_checkpoint(db, run, **values)

    def pagerank(*args: Any, **kwargs: Any) -> Any:
        explode_once()
        return real_pagerank(*args, **kwargs)

    async def apply_rules(*args: Any, **kwargs: Any) -> int:
        explode_once()
        return await real_rules(*args, **kwargs)

    patched: dict[str, Any] = {
        "_checkpoint": checkpoint,
        "pagerank": pagerank,
        "apply_rules": apply_rules,
    }
    monkeypatch.setattr(crawl_ingest, crash_in, patched[crash_in])

    failed = 0
    for _ in range(60):
        outcome = await _ingest(worker_db, on_page, None, task)
        failed += outcome.failed
        if (await _state(migrated, task.run_id))[0] != "processing":
            break
        if outcome.failed:
            # Nothing of the step stayed, and the crawl before it is still the latest.
            run = await fetchrow(
                migrated,
                "SELECT state, ingest_phase, ingest_failures, finished_at "
                "FROM seo.crawl_runs WHERE id = $1",
                task.run_id,
            )
            assert (run["state"], run["ingest_phase"], run["ingest_failures"]) == (
                "processing",
                phase,
                1,
            )
            assert run["finished_at"] is None
            async with worker_db() as db:
                assert (
                    await latest_run(db, crawled.workspace.id, crawled.project) == crawled.previous
                )

    assert failed == 1
    assert await _snapshot(migrated, task.run_id) == expected
    async with worker_db() as db:
        assert await latest_run(db, crawled.workspace.id, crawled.project) == task.run_id


async def test_the_previous_crawl_is_served_until_the_new_one_is_flipped_in(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = synthetic_site()
    crawled = await _crawled(migrated, worker_db, on_page, previous=True)
    task = crawled.task

    for _ in range(80):
        async with worker_db() as db:
            latest = await latest_run(db, crawled.workspace.id, crawled.project)
        state, _phase = await _state(migrated, task.run_id)
        if state != "processing":
            break
        assert latest == crawled.previous
        await ingest_run(worker_db, on_page, None, task, deadline=0.0)

    async with worker_db() as db:
        assert await latest_run(db, crawled.workspace.id, crawled.project) == task.run_id
    assert (await _state(migrated, task.run_id)) == ("ready", "done")


async def test_a_crawl_cancelled_before_the_flip_is_not_overwritten(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = synthetic_site()
    crawled = await _crawled(migrated, worker_db, on_page, previous=True)
    task = crawled.task
    await _step_until(migrated, worker_db, on_page, task, lambda _, phase: phase == "metrics")
    await execute(
        migrated,
        "UPDATE seo.crawl_runs SET state = 'cancelled', finished_at = now() WHERE id = $1",
        task.run_id,
    )

    outcome = await _ingest(worker_db, on_page, None, task)

    run = await fetchrow(
        migrated,
        "SELECT state, ingest_phase, error_code, equity_p25 FROM seo.crawl_runs WHERE id = $1",
        task.run_id,
    )
    assert (outcome.steps, outcome.failed) == (0, False)
    assert (run["state"], run["ingest_phase"], run["error_code"], run["equity_p25"]) == (
        "cancelled",
        "metrics",
        None,
        None,
    )
    async with worker_db() as db:
        assert await latest_run(db, crawled.workspace.id, crawled.project) == crawled.previous


async def test_a_step_that_overtook_a_cancel_in_flight_does_not_flip(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = synthetic_site()
    task = (await _crawled(migrated, worker_db, on_page)).task
    await _step_until(migrated, worker_db, on_page, task, lambda _, phase: phase == "metrics")
    run = await crawl_ingest._read_run(worker_db, task)
    assert run is not None
    await execute(
        migrated,
        "UPDATE seo.crawl_runs SET state = 'failed', error_code = 'provider_error', "
        "finished_at = now() WHERE id = $1",
        task.run_id,
    )

    applied = await crawl_ingest._STEPS["metrics"](worker_db, on_page, None, run)

    row = await fetchrow(
        migrated,
        "SELECT state, error_code, ingest_phase, equity_p25 FROM seo.crawl_runs WHERE id = $1",
        task.run_id,
    )
    assert not applied
    assert (row["state"], row["error_code"], row["ingest_phase"], row["equity_p25"]) == (
        "failed",
        "provider_error",
        "metrics",
        None,
    )


def _link(index: int, *, container: str = "main") -> FoundLink:
    return FoundLink(
        href=f"{SITE}/p/{index}",
        anchor=f"L{index}",
        kind="text",
        rel=frozenset(),
        placement=Placement.CONTENT,
        container=container,
        open=False,
    )


def test_a_page_keeps_its_first_distinct_edges_even_when_its_first_links_repeat() -> None:
    page = canonicalize(f"{SITE}/")
    hosts = frozenset({"example.com"})
    links = [_link(0), _link(1)] * 25_000 + [_link(index) for index in range(2, 30_002)]

    edges, capped = capped_edges(links, page=page, hosts=hosts)

    assert capped
    assert [edge.anchor for edge in edges] == [f"L{index}" for index in range(EDGES_PER_PAGE_MAX)]
    # A page at the limit is not cut.
    few, cut = capped_edges(links[: 2 * 25_000], page=page, hosts=hosts)
    assert (len(few), cut) == (2, False)
    exact, cut = capped_edges(
        [_link(index) for index in range(EDGES_PER_PAGE_MAX)], page=page, hosts=hosts
    )
    assert (len(exact), cut) == (EDGES_PER_PAGE_MAX, False)


async def test_a_page_of_thirty_thousand_links_keeps_twenty_thousand_and_says_so(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    body = "<p>" + "".join(f'<a href="/p/{index}">L{index}</a>' for index in range(30_000)) + "</p>"
    on_page = FakeOnPage(
        page_items=[page_item("/", sitemap=True)],
        html={f"{SITE}/": page_html(body)},
        summaries=[summary(finished=True, crawled=1)],
    )
    task = (await _crawled(migrated, worker_db, on_page)).task

    with capture_logs() as logs:
        await _ingest(worker_db, on_page, None, task)

    run = await fetchrow(
        migrated, "SELECT state, links_stored FROM seo.crawl_runs WHERE id = $1", task.run_id
    )
    targets = await fetch(
        migrated,
        "SELECT t.path FROM seo.crawl_links l JOIN core.urls t ON t.id = l.target_url_id "
        "WHERE l.run_id = $1",
        task.run_id,
    )
    paths = {row["path"] for row in targets}
    kept = sorted(int(path.removeprefix("/p/")) for path in paths if path.startswith("/p/"))
    assert (run["state"], run["links_stored"], len(targets)) == (
        "ready",
        EDGES_PER_PAGE_MAX,
        EDGES_PER_PAGE_MAX,
    )
    # The first ones in document order: the menu, then the body from its first link; the footer
    # link and the body's last thousands are cut.
    assert kept == list(range(len(kept)))
    assert {"/pricing", "/blog"} <= paths
    assert "/privacy" not in paths
    assert sum(1 for log in logs if log["event"] == "crawl page links cut") == 1


async def test_a_step_stops_taking_pages_once_it_holds_its_budget_of_edges(
    migrated: PostgresServer, worker_db: Sessions, monkeypatch: pytest.MonkeyPatch
) -> None:
    on_page = synthetic_site()
    task = (await _crawled(migrated, worker_db, on_page)).task
    await _step_until(migrated, worker_db, on_page, task, lambda _, phase: phase == "links")
    monkeypatch.setattr(crawl_ingest, "STEP_EDGES_MAX", 1)

    await ingest_run(worker_db, on_page, None, task, deadline=0.0)

    states = await fetch(
        migrated,
        "SELECT links_state, count(*) AS n FROM seo.crawl_pages WHERE run_id = $1 "
        "GROUP BY links_state",
        task.run_id,
    )
    assert {row["links_state"]: row["n"] for row in states}["from_html"] == 1


async def test_text_the_database_refuses_is_cleaned_or_skipped_and_never_fails_the_crawl(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = synthetic_site()
    on_page.page_items[1] = on_page.page_items[1].model_copy(update={"title": "a\x00b"})
    on_page.page_items[2] = on_page.page_items[2].model_copy(update={"title": "c\ud800d"})
    on_page.page_items += [
        page_item("/nul\x00page"),
        page_item("/lone\ud800surrogate"),
        # Not cut at the limit: a page whose address is that long is not stored at all.
        page_item("/" + "a" * 9_000),
    ]
    on_page.non_indexable_items.append(NonIndexableItem(url=f"{SITE}/x\x00y", reason="meta_tag"))
    task = (await _crawled(migrated, worker_db, on_page)).task

    with capture_logs() as logs:
        await _ingest(worker_db, on_page, None, task)

    assert (await _state(migrated, task.run_id)) == ("ready", "done")
    pages = await _pages(migrated, task.run_id)
    assert len(pages) == 11
    assert (pages["/pricing"]["title"], pages["/blog"]["title"]) == ("ab", "cd")
    skipped = [log for log in logs if log["event"] == "crawl pages skipped"]
    # A count a batch, and nothing of the addresses.
    assert {log["run_id"] for log in skipped} == {str(task.run_id)}
    assert sum(log["count"] for log in skipped) == 3


async def test_one_page_whose_links_cannot_be_read_does_not_fail_the_crawl(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = synthetic_site()
    # `/orphan` has no HTML, so its links come from the provider, which answers nonsense.
    on_page.links_errors[f"{SITE}/orphan"] = ProviderError(
        kind=ProviderErrorKind.SCHEMA_MISMATCH, message="a link that cannot be read"
    )
    task = (await _crawled(migrated, worker_db, on_page)).task

    outcome = await _ingest(worker_db, on_page, None, task)

    assert (outcome.failed, await _state(migrated, task.run_id)) == (False, ("ready", "done"))
    pages = await _pages(migrated, task.run_id)
    assert pages["/orphan"]["links_state"] == "none"
    assert pages["/pricing"]["links_state"] == "from_html"


async def test_a_page_whose_html_cannot_be_read_falls_back_to_the_providers_links(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = synthetic_site()
    on_page.html_errors[f"{SITE}/pricing"] = ProviderError(
        kind=ProviderErrorKind.PROVIDER_ERROR, message="no"
    )
    on_page.links[f"{SITE}/pricing"] = [
        LinkItem(link_to=f"{SITE}/blog/c", anchor="How", kind="text", dofollow=True)
    ]
    task = (await _crawled(migrated, worker_db, on_page)).task

    await _ingest(worker_db, on_page, None, task)

    assert (await _state(migrated, task.run_id)) == ("ready", "done")
    pages = await _pages(migrated, task.run_id)
    assert pages["/pricing"]["links_state"] == "from_provider"
    assert pages["/pricing"]["outlinks_all"] == 1


async def test_a_transient_failure_is_not_counted_and_is_logged_by_kind(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = synthetic_site()
    on_page.html_errors[f"{SITE}/pricing"] = ProviderError(
        kind=ProviderErrorKind.TIMEOUT, message="slow"
    )
    task = (await _crawled(migrated, worker_db, on_page)).task

    with capture_logs() as logs:
        for _ in range(INGEST_FAILURES_MAX + 2):
            assert (await _ingest(worker_db, on_page, None, task)).failed

    run = await fetchrow(
        migrated, "SELECT state, ingest_failures FROM seo.crawl_runs WHERE id = $1", task.run_id
    )
    assert (run["state"], run["ingest_failures"]) == ("processing", 0)
    entry = next(log for log in logs if log["event"] == "crawl ingest step failed")
    assert (entry["error"], entry["kind"], entry["phase"]) == (
        "ProviderCallError",
        "timeout",
        "links",
    )
    on_page.html_errors.clear()
    await _ingest(worker_db, on_page, None, task)
    assert (await _state(migrated, task.run_id)) == ("ready", "done")


async def test_a_transient_failure_that_goes_on_for_hours_is_counted(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = synthetic_site()
    on_page.html_errors[f"{SITE}/pricing"] = ProviderError(
        kind=ProviderErrorKind.TIMEOUT, message="slow"
    )
    task = (await _crawled(migrated, worker_db, on_page)).task
    await execute(
        migrated,
        "UPDATE seo.crawl_runs SET crawled_at = now() - interval '7 hours' WHERE id = $1",
        task.run_id,
    )

    await _ingest(worker_db, on_page, None, task)

    run = await fetchrow(
        migrated, "SELECT ingest_failures FROM seo.crawl_runs WHERE id = $1", task.run_id
    )
    assert run["ingest_failures"] == 1


async def test_a_lock_timeout_is_not_counted_and_is_logged_with_its_sqlstate(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = synthetic_site()
    task = (await _crawled(migrated, worker_db, on_page)).task
    holder = await asyncpg.connect(migrated.url())
    try:
        await holder.execute("BEGIN")
        await holder.execute("SELECT id FROM seo.crawl_runs WHERE id = $1 FOR UPDATE", task.run_id)
        with capture_logs() as logs:
            outcome = await _ingest(worker_db, on_page, None, task)
    finally:
        await holder.execute("ROLLBACK")
        await holder.close()

    run = await fetchrow(
        migrated, "SELECT state, ingest_failures FROM seo.crawl_runs WHERE id = $1", task.run_id
    )
    assert (outcome.failed, run["state"], run["ingest_failures"]) == (True, "processing", 0)
    entry = next(log for log in logs if log["event"] == "crawl ingest step failed")
    assert entry["sqlstate"] == "55P03"


async def test_a_pool_timeout_is_not_counted(
    migrated: PostgresServer, worker_db: Sessions, monkeypatch: pytest.MonkeyPatch
) -> None:
    on_page = synthetic_site()
    task = (await _crawled(migrated, worker_db, on_page)).task

    async def claim(db: AsyncSession, run: Any) -> bool:
        raise exc.TimeoutError("QueuePool limit reached")

    monkeypatch.setattr(crawl_ingest, "_claim", claim)
    for _ in range(INGEST_FAILURES_MAX + 1):
        assert (await _ingest(worker_db, on_page, None, task)).failed

    run = await fetchrow(
        migrated, "SELECT state, ingest_failures FROM seo.crawl_runs WHERE id = $1", task.run_id
    )
    assert (run["state"], run["ingest_failures"]) == ("processing", 0)


@dataclass
class RepeatingOnPage(FakeOnPage):
    """A provider that answers every page request with the token it was given."""

    async def pages(self, task_id: str, *, token: str | None) -> PageBatch:
        return PageBatch(items=[], token=token or "t", total=10)


@dataclass
class EndlessPages(FakeOnPage):
    """A provider that says it holds far more pages than the crawl's ceiling allows."""

    async def pages(self, task_id: str, *, token: str | None) -> PageBatch:
        return PageBatch(items=[], token=None, total=10_000_000)


@dataclass
class EndlessNonIndexable(FakeOnPage):
    """The same for the list of pages search engines may not index."""

    async def non_indexable(self, task_id: str, *, offset: int) -> NonIndexableBatch:
        item = NonIndexableItem(url=f"{SITE}/", reason="meta_tag")
        return NonIndexableBatch(items=[item], total=10_000_000)


@pytest.mark.parametrize("fake", [RepeatingOnPage, EndlessPages, EndlessNonIndexable])
async def test_a_provider_that_never_ends_a_listing_fails_the_crawl_instead_of_looping(
    migrated: PostgresServer, worker_db: Sessions, fake: type[FakeOnPage]
) -> None:
    on_page = fake(**vars(synthetic_site()))
    task = (await _crawled(migrated, worker_db, on_page)).task

    for _ in range(INGEST_FAILURES_MAX + 1):
        await _ingest(worker_db, on_page, None, task)

    run = await fetchrow(
        migrated,
        "SELECT state, error_code, ingest_failures FROM seo.crawl_runs WHERE id = $1",
        task.run_id,
    )
    assert (run["state"], run["error_code"], run["ingest_failures"]) == (
        "failed",
        "ingest_failed",
        INGEST_FAILURES_MAX,
    )


async def test_a_crawl_stops_adding_links_at_its_cap_and_goes_on_to_its_metrics(
    migrated: PostgresServer, worker_db: Sessions, monkeypatch: pytest.MonkeyPatch
) -> None:
    on_page = synthetic_site()
    task = (await _crawled(migrated, worker_db, on_page)).task
    monkeypatch.setattr(crawl_ingest, "LINKS_PER_CRAWL_MAX", 5)
    monkeypatch.setattr(crawl_ingest, "STEP_EDGES_MAX", 1)

    with capture_logs() as logs:
        await _ingest(worker_db, on_page, None, task)

    assert (await _state(migrated, task.run_id)) == ("ready", "done")
    states = await fetch(
        migrated,
        "SELECT links_state, count(*) AS n FROM seo.crawl_pages WHERE run_id = $1 "
        "GROUP BY links_state",
        task.run_id,
    )
    by_state = {row["links_state"]: row["n"] for row in states}
    # The redirect and the 404 never had links; the rest was left without once the cap was met.
    assert 1 <= by_state["from_html"] < 8
    assert by_state["none"] > 2
    stored = await fetchrow(
        migrated, "SELECT links_stored FROM seo.crawl_runs WHERE id = $1", task.run_id
    )
    assert 5 <= stored["links_stored"] < 40
    (entry,) = [log for log in logs if log["event"] == "crawl links cap reached"]
    assert entry["run_id"] == str(task.run_id)


async def test_the_long_transactions_run_with_a_long_statement_timeout_and_the_short_ones_do_not(
    migrated: PostgresServer, worker_db: Sessions, monkeypatch: pytest.MonkeyPatch
) -> None:
    on_page = synthetic_site()
    task = (await _crawled(migrated, worker_db, on_page)).task
    seen: dict[str, set[str]] = {}
    real_claim = crawl_ingest._claim

    async def claim(db: AsyncSession, run: Any) -> bool:
        setting = (await db.execute(text("SELECT current_setting('statement_timeout')"))).scalar()
        seen.setdefault(run.phase, set()).add(str(setting))
        return await real_claim(db, run)

    monkeypatch.setattr(crawl_ingest, "_claim", claim)
    await _ingest(worker_db, on_page, None, task)

    assert (await _state(migrated, task.run_id)) == ("ready", "done")
    assert seen["template"] == {"5min"}
    assert seen["metrics"] == {"5min"}
    for phase in ("pages", "non_indexable", "links"):
        assert seen[phase] == {"15s"}


async def test_a_crawl_that_stopped_at_its_ceiling_is_stopped_at_ceiling(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = synthetic_site()
    on_page.summaries = [summary(finished=True, crawled=11, stop="limit_exceeded")]
    crawled = await _crawled(migrated, worker_db, on_page)

    await _ingest(worker_db, on_page, None, crawled.task)

    assert (await _state(migrated, crawled.task.run_id)) == ("stopped_at_ceiling", "done")
    async with worker_db() as db:
        assert await latest_run(db, crawled.workspace.id, crawled.project) == crawled.task.run_id


async def test_the_flip_tiers_the_pages_by_the_projects_rules(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = synthetic_site()
    crawled = await _crawled(migrated, worker_db, on_page)
    _, t2, *_ = await seed_tiers(migrated, crawled.workspace)
    await execute(
        migrated,
        "INSERT INTO core.tier_rules (workspace_id, project_id, position, match_type, value, "
        "tier_id) VALUES ($1, $2, 1, 'prefix', '/blog', $3)",
        crawled.workspace.id,
        crawled.project,
        t2,
    )

    await _ingest(worker_db, on_page, None, crawled.task)

    rows = await fetch(
        migrated,
        "SELECT u.path, p.tier_id, p.tier_source FROM core.project_pages p "
        "JOIN core.urls u ON u.id = p.url_id WHERE p.project_id = $1",
        crawled.project,
    )
    tiered = {row["path"]: (row["tier_id"], row["tier_source"]) for row in rows}
    assert tiered == dict.fromkeys(
        ("/blog", "/blog/a", "/blog/b", "/blog/c", "/blog/d"), (t2, "rule")
    )
    stats = await fetch(
        migrated,
        "SELECT pages FROM seo.crawl_tier_stats WHERE run_id = $1 AND tier_id = $2",
        crawled.task.run_id,
        t2,
    )
    assert [row["pages"] for row in stats] == [5]


@pytest.mark.parametrize("clause", ["offset", "token", "phase", "state"])
async def test_a_step_that_read_another_checkpoint_writes_nothing(
    migrated: PostgresServer, worker_db: Sessions, clause: str
) -> None:
    on_page = synthetic_site()
    task = (await _crawled(migrated, worker_db, on_page)).task
    await _step_until(migrated, worker_db, on_page, task, lambda _, phase: phase == "non_indexable")
    run = await crawl_ingest._read_run(worker_db, task)
    assert run is not None
    stale = {
        "offset": replace(run, offset=run.offset + 1),
        "token": replace(run, token="elsewhere"),
        "phase": replace(run, phase="links"),
        "state": run,
    }[clause]
    if clause == "state":
        await execute(
            migrated,
            "UPDATE seo.crawl_runs SET state = 'cancelled', finished_at = now() WHERE id = $1",
            task.run_id,
        )
    before = await _snapshot(migrated, task.run_id)

    applied = await crawl_ingest._STEPS["non_indexable"](worker_db, on_page, None, stale)

    assert not applied
    assert await _snapshot(migrated, task.run_id) == before
    if clause != "state":
        # The same step from the checkpoint the crawl really holds does take its turn.
        assert await crawl_ingest._STEPS["non_indexable"](worker_db, on_page, None, run)


@pytest.mark.parametrize("guard", ["state", "phase"])
async def test_the_flip_checks_the_state_and_the_phase_itself(
    migrated: PostgresServer,
    worker_db: Sessions,
    monkeypatch: pytest.MonkeyPatch,
    guard: str,
) -> None:
    on_page = synthetic_site()
    task = (await _crawled(migrated, worker_db, on_page)).task
    await _step_until(migrated, worker_db, on_page, task, lambda _, phase: phase == "metrics")
    run = await crawl_ingest._read_run(worker_db, task)
    assert run is not None

    async def trusting(db: AsyncSession, run: Any) -> bool:
        return True

    monkeypatch.setattr(crawl_ingest, "_claim", trusting)
    change = (
        "state = 'failed', finished_at = now()" if guard == "state" else "ingest_phase = 'links'"
    )
    await execute(migrated, f"UPDATE seo.crawl_runs SET {change} WHERE id = $1", task.run_id)

    applied = await crawl_ingest._STEPS["metrics"](worker_db, on_page, None, run)

    assert not applied
    expected = ("failed", "metrics") if guard == "state" else ("processing", "links")
    assert (await _state(migrated, task.run_id)) == expected


async def test_a_page_that_refused_the_crawler_is_not_a_broken_link_nor_lost_strength(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    """Plan 08 task 2: 401, 403 and 429 targets are unknown, not broken; a 400 still is."""
    on_page = synthetic_site()
    for path, status in (("/bad", 400), ("/walled", 403), ("/limited", 429), ("/locked", 401)):
        on_page.page_items.append(page_item(path, status))
    on_page.html[f"{SITE}/privacy"] = page_html(
        '<div class="legal"><a href="/bad">Bad</a> <a href="/walled">W</a> '
        '<a href="/limited">L</a> <a href="/locked">K</a></div>'
    )
    task = (await _crawled(migrated, worker_db, on_page)).task

    await _ingest(worker_db, on_page, None, task)

    pages = await _pages(migrated, task.run_id)
    assert pages["/privacy"]["broken_outlinks"] == 1
    assert pages["/privacy"]["outlinks_all"] >= 4
    shares = {path: page["equity_share"] for path, page in pages.items()}
    run = await fetchrow(
        migrated, "SELECT equity_lost_to_errors FROM seo.crawl_runs WHERE id = $1", task.run_id
    )
    assert run["equity_lost_to_errors"] == pytest.approx(shares["/gone"] + shares["/bad"])


async def test_the_details_of_a_crawl_are_stored_as_the_spec_says(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = synthetic_site()
    on_page.page_items.append(page_item("/bad", 400))
    # `/blog/b` names `/blog/a` as its canonical page.
    on_page.page_items[4] = on_page.page_items[4].model_copy(update={"canonical": f"{SITE}/blog/a"})
    # Every page has its own container for its content links, so that none is a template block.
    on_page.html[f"{SITE}/"] = page_html(
        '<p><a href="/blog/a">Read our guide</a> <a href="/beyond">Past the ceiling</a></p>'
    )
    on_page.html[f"{SITE}/blog"] = page_html(
        '<ul><li><a href="/blog/a">A</a></li><li><a href="/blog/b">B</a></li>'
        '<li><a href="/pricing">Plans</a></li></ul>'
    )
    on_page.html[f"{SITE}/blog/a"] = page_html(
        '<p><a href="/pricing">See plans</a> <a href="/pricing">See plans</a></p>',
        article=True,
        next_="/blog/b",
    )
    on_page.html[f"{SITE}/privacy"] = page_html(
        '<div class="legal"><a href="/bad">Bad</a> <a rel="nofollow" href="/blog/a">Skip</a></div>'
    )
    on_page.links[f"{SITE}/orphan"] = [
        LinkItem(link_to=f"{SITE}/pricing", anchor="Pricing page", kind="text", dofollow=True),
        LinkItem(link_to=f"{SITE}/blog", anchor="Blog", kind="text", dofollow=False),
    ]
    task = (await _crawled(migrated, worker_db, on_page)).task

    await _ingest(worker_db, on_page, None, task)

    pages = await _pages(migrated, task.run_id)
    assert (await _state(migrated, task.run_id)) == ("ready", "done")
    # Pages that are not indexable by their canonical.
    assert (pages["/blog/b"]["is_indexable"], pages["/blog/b"]["non_indexable_reason"]) == (
        False,
        "canonical",
    )
    assert pages["/blog/b"]["canonical_url_id"] == pages["/blog/a"]["url_id"]
    # Orphans: in the sitemap with no link in; and linked, but never by an editor.
    assert {path for path, page in pages.items() if page["is_orphan"]} == {"/orphan"}
    assert {path for path, page in pages.items() if page["is_editorial_orphan"]} == {
        "/privacy",
        "/blog/d",
    }
    # A 400 counts as broken, as a 404 does.
    assert (pages["/privacy"]["broken_outlinks"], pages["/blog/c"]["broken_outlinks"]) == (1, 1)
    # The anchor used most (two links on one page are two uses) is the top anchor.
    assert pages["/pricing"]["top_anchor"] == "See plans"
    # Equity: the crawled pages' shares add up to one even with a link out of the crawl, and the
    # error pages hold what they hold.
    # `/blog/b` names `/blog/a` as its canonical: a variant, with no share of its own.
    assert pages["/blog/b"]["equity_share"] is None
    shares = {path: page["equity_share"] for path, page in pages.items() if path != "/blog/b"}
    assert sum(shares.values()) == pytest.approx(1.0)
    run = await fetchrow(
        migrated, "SELECT equity_lost_to_errors FROM seo.crawl_runs WHERE id = $1", task.run_id
    )
    assert shares["/gone"] > 0
    assert shares["/bad"] > 0
    assert run["equity_lost_to_errors"] == pytest.approx(shares["/gone"] + shares["/bad"])
    links = await fetch(
        migrated,
        "SELECT s.path AS source, t.path AS target, l.placement, l.scope, l.rel, l.is_followed "
        "FROM seo.crawl_links l JOIN core.urls s ON s.id = l.source_url_id "
        "JOIN core.urls t ON t.id = l.target_url_id WHERE l.run_id = $1",
        task.run_id,
    )
    stored = {(row["source"], row["target"]): row for row in links}
    # A nofollow link is stored as not followed, from the HTML and from the provider alike.
    assert stored[("/privacy", "/blog/a")]["is_followed"] is False
    assert list(stored[("/privacy", "/blog/a")]["rel"]) == ["nofollow"]
    assert stored[("/privacy", "/bad")]["is_followed"] is True
    assert stored[("/orphan", "/blog")]["is_followed"] is False
    # A page with no HTML has the provider's links, placement unknown and taken as content.
    assert pages["/orphan"]["links_state"] == "from_provider"
    assert (
        stored[("/orphan", "/pricing")]["placement"],
        stored[("/orphan", "/pricing")]["scope"],
    ) == (
        "content",
        "editorial",
    )
    # A link past the ceiling is kept, and the page it names is not a crawled page.
    assert ("/", "/beyond") in stored
    assert "/beyond" not in pages


async def test_a_page_that_names_another_crawled_page_as_canonical_is_a_variant_and_folds_into_it(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = _site_with_head_canonicals()
    crawled = await _crawled(migrated, worker_db, on_page)

    await _ingest(worker_db, on_page, None, crawled.task)

    run_id = crawled.task.run_id
    pages = await _pages(migrated, run_id)
    names = {page["url_id"]: path for path, page in pages.items()}
    variants = {
        path: names[page["variant_of_url_id"]]
        for path, page in pages.items()
        if page["variant_of_url_id"]
    }
    # `/pricing` names `/blog/c` and `/blog/a` names `/blog/b`: variants. `/privacy` names
    # `/pricing`, which is a variant itself: a chain leaves it a page. `/blog/b` names itself.
    assert variants == {"/pricing": "/blog/c", "/blog/a": "/blog/b"}
    run = await fetchrow(
        migrated, "SELECT pages_variant, sitemap_pages FROM seo.crawl_runs WHERE id = $1", run_id
    )
    assert run["pages_variant"] == 2
    for path in variants:
        assert pages[path]["click_depth"] is None
        assert pages[path]["equity_share"] is None
        assert (pages[path]["linking_pages_all"], pages[path]["outlinks_all"]) == (0, 0)
        assert not pages[path]["is_orphan"]
        assert not pages[path]["is_editorial_orphan"]
    # Oracle: distinct sources that are not variants, links to a variant counted for its page.
    links = await fetch(
        migrated,
        "SELECT source_url_id, target_url_id FROM seo.crawl_links WHERE run_id = $1",
        run_id,
    )
    fold = {
        page["url_id"]: page["variant_of_url_id"]
        for page in pages.values()
        if page["variant_of_url_id"]
    }
    expected_in: dict[int, set[int]] = {}
    for link in links:
        if link["source_url_id"] in fold:
            continue
        target = fold.get(link["target_url_id"], link["target_url_id"])
        if target != link["source_url_id"]:
            expected_in.setdefault(target, set()).add(link["source_url_id"])
    for path, page in pages.items():
        assert page["linking_pages_all"] == len(expected_in.get(page["url_id"], set())), path
    # The canonical pages hold what their variants were linked from.
    assert pages["/blog/c"]["linking_pages_all"] > 0


async def test_links_to_a_variant_are_re_pointed_and_links_from_one_are_ignored(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = _site_with_head_canonicals()
    crawled = await _crawled(migrated, worker_db, on_page)

    await _ingest(worker_db, on_page, None, crawled.task)

    run_id = crawled.task.run_id
    pages = await _pages(migrated, run_id)
    variant_of = {
        page["url_id"]: page["variant_of_url_id"]
        for page in pages.values()
        if page["variant_of_url_id"]
    }
    links = await fetch(migrated, "SELECT * FROM seo.crawl_links WHERE run_id = $1", run_id)
    assert variant_of
    for link in links:
        kept = not link["ignored"]
        if link["source_url_id"] in variant_of:
            assert not kept
        if kept:
            assert link["target_url_id"] not in variant_of
        if link["folded_from_url_id"] is not None:
            assert variant_of[link["folded_from_url_id"]] == link["target_url_id"]
            folded_onto_itself = link["target_url_id"] == link["source_url_id"]
            assert kept == (not folded_onto_itself and link["source_url_id"] not in variant_of)
    assert any(link["folded_from_url_id"] is not None for link in links)


def _counted(page: Page) -> dict[str, Any]:
    keys = ("variant_of_url_id", "click_depth", "depth_without_auto", "equity_share", "top_anchor")
    return {
        key: value
        for key, value in page.items()
        if key.startswith(("linking_pages_", "outlinks_", "is_")) or key in keys
    }


async def test_a_crawl_finished_before_variants_is_recounted_to_what_a_fresh_ingest_gives(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = _site_with_head_canonicals()
    crawled = await _crawled(migrated, worker_db, on_page)
    await _ingest(worker_db, on_page, None, crawled.task)
    run_id = crawled.task.run_id
    workspace_id = crawled.task.workspace_id
    await execute(migrated, "UPDATE seo.crawl_runs SET enrich_state = 'done' WHERE id = $1", run_id)
    fresh = {path: _counted(page) for path, page in (await _pages(migrated, run_id)).items()}
    fresh_run = await fetchrow(
        migrated, "SELECT pages_variant, sitemap_pages FROM seo.crawl_runs WHERE id = $1", run_id
    )
    # Back to a crawl as it was stored before: raw links, no variants, no count.
    await execute(
        migrated,
        "UPDATE seo.crawl_links SET target_url_id = coalesce(folded_from_url_id, target_url_id), "
        "folded_from_url_id = NULL, ignored = false WHERE run_id = $1",
        run_id,
    )
    await execute(
        migrated,
        "UPDATE seo.crawl_pages SET variant_of_url_id = NULL, linking_pages_all = 99, "
        "outlinks_all = 99 WHERE run_id = $1",
        run_id,
    )
    await execute(migrated, "UPDATE seo.crawl_runs SET pages_variant = NULL WHERE id = $1", run_id)

    outcome = await crawl_ingest.recount_variants(
        worker_db, workspace_id=workspace_id, run_id=run_id
    )
    again = await crawl_ingest.recount_variants(worker_db, workspace_id=workspace_id, run_id=run_id)

    assert outcome is not None
    assert (outcome.pages_variant, again) == (fresh_run["pages_variant"], outcome)
    recounted = {path: _counted(page) for path, page in (await _pages(migrated, run_id)).items()}
    # The anchor counts are the second job's: a recount makes them, a bare ingest has none.
    assert recounted == fresh
    run = await fetchrow(
        migrated, "SELECT pages_variant, sitemap_pages FROM seo.crawl_runs WHERE id = $1", run_id
    )
    assert dict(run) == dict(fresh_run)


async def test_a_crawl_whose_second_job_is_still_running_is_not_recounted(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = _site_with_head_canonicals()
    crawled = await _crawled(migrated, worker_db, on_page)
    await _ingest(worker_db, on_page, None, crawled.task)

    outcome = await crawl_ingest.recount_variants(
        worker_db, workspace_id=crawled.task.workspace_id, run_id=crawled.task.run_id
    )

    assert outcome is None


async def test_the_latest_crawl_of_a_project_is_recounted_by_its_ids(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    from idraft.worker.recount_variants import recount_latest

    on_page = _site_with_head_canonicals()
    crawled = await _crawled(migrated, worker_db, on_page)
    await _ingest(worker_db, on_page, None, crawled.task)
    await execute(
        migrated,
        "UPDATE seo.crawl_runs SET enrich_state = 'done', pages_variant = NULL WHERE id = $1",
        crawled.task.run_id,
    )

    run = await fetchrow(
        migrated, "SELECT project_id FROM seo.crawl_runs WHERE id = $1", crawled.task.run_id
    )

    outcome = await recount_latest(
        worker_db, workspace_id=crawled.task.workspace_id, project_id=run["project_id"]
    )
    other = await recount_latest(
        worker_db, workspace_id=crawled.task.workspace_id, project_id=uuid.uuid4()
    )

    assert outcome is not None
    assert (outcome.run_id, outcome.pages_variant) == (crawled.task.run_id, 2)
    assert other is None
