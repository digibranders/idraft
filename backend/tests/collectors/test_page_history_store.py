"""Page history kept by crawl ingest (spec 3, 4 and 8 of the page history design)."""

from __future__ import annotations

import time
import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from structlog.testing import capture_logs

from idraft.collectors import crawl_ingest, page_history_store
from idraft.collectors.page_history_store import (
    PageHistory,
    history_of,
    record_checks,
    summarize_history,
)
from idraft.crawl.declared_dates import Declared
from idraft.crawl.page_history import Snapshot
from idraft.crawl.page_text import content_hash
from tests.api.auth.support import Workspace, fetch, fetchrow
from tests.api.internal_links.support import seed_crawl
from tests.collectors.crawl_support import FakeOnPage, clear_crawls, site_project, synthetic_site
from tests.collectors.test_crawl_ingest import _crawled, _ingest
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

Sessions = async_sessionmaker[AsyncSession]
DAY = datetime(2026, 11, 1, 9, tzinfo=UTC)


@pytest.fixture(autouse=True)
async def _no_other_crawls(migrated: PostgresServer) -> None:
    await clear_crawls(migrated)


def _history(main: str, full: str | None = None, declared: datetime | None = None) -> PageHistory:
    return PageHistory(
        declared=None if declared is None else Declared(declared, "json_ld"),
        snapshot=Snapshot(
            title="T",
            description=None,
            headings=(),
            words=3,
            links_all=2,
            links_editorial=1,
            canonical=None,
            main_hash=content_hash(main),
            full_hash=content_hash(full or main),
        ),
    )


class Site:
    """A project whose pages are crawled one run after another, as `seed_crawl` seeds them."""

    def __init__(
        self, pg: PostgresServer, sessions: Sessions, workspace: Workspace, project: uuid.UUID
    ) -> None:
        self.pg, self.sessions, self.workspace, self.project = pg, sessions, workspace, project

    async def crawl(self, paths: list[str]) -> tuple[uuid.UUID, dict[str, int]]:
        return await seed_crawl(self.pg, self.workspace, self.project, [(p, 200) for p in paths])

    async def record(
        self, run_id: uuid.UUID, pages: dict[int, PageHistory], *, summarize: bool = True
    ) -> None:
        async with self.sessions() as db, db.begin():
            await record_checks(
                db,
                run_id=run_id,
                workspace_id=self.workspace.id,
                project_id=self.project,
                taken_at=datetime.now(UTC),
                pages=list(pages.items()),
            )
            if summarize:
                await summarize_history(db, run_id=run_id, workspace_id=self.workspace.id)

    async def counts(self) -> tuple[int, int]:
        checks = await fetchrow(
            self.pg,
            "SELECT count(*) AS n FROM seo.page_checks WHERE project_id = $1",
            self.project,
        )
        snapshots = await fetchrow(
            self.pg,
            "SELECT count(*) AS n FROM seo.page_snapshots WHERE project_id = $1",
            self.project,
        )
        return checks["n"], snapshots["n"]

    async def summary(self, run_id: uuid.UUID) -> dict[str, object]:
        return dict(
            await fetchrow(self.pg, "SELECT * FROM seo.page_history_runs WHERE run_id = $1", run_id)
        )


@pytest.fixture
async def site(migrated: PostgresServer, worker_db: Sessions) -> Site:
    workspace, project = await site_project(migrated)
    return Site(migrated, worker_db, workspace, project)


async def test_unchanged_page_keeps_one_snapshot_and_an_edited_page_adds_one(site: Site) -> None:
    paths = ["/same", "/edited"]
    first, ids = await site.crawl(paths)
    await site.record(first, {ids["/same"]: _history("a"), ids["/edited"]: _history("b")})
    second, ids2 = await site.crawl(paths)
    await site.record(second, {ids2["/same"]: _history("a"), ids2["/edited"]: _history("b2")})

    assert await site.counts() == (4, 3)
    rows = await fetch(
        site.pg,
        "SELECT u.path, c.run_id, c.snapshot_id, s.run_id AS seen FROM seo.page_checks c "
        "JOIN core.urls u ON u.id = c.url_id JOIN seo.page_snapshots s ON s.id = c.snapshot_id "
        "WHERE c.project_id = $1",
        site.project,
    )
    snapshots = {(r["path"], r["run_id"]): r["snapshot_id"] for r in rows}
    # The unchanged page's second check points at the content it saw in the first crawl.
    assert snapshots[("/same", second)] == snapshots[("/same", first)]
    assert snapshots[("/edited", second)] != snapshots[("/edited", first)]
    assert {r["seen"] for r in rows if r["path"] == "/same"} == {first}
    summary = await site.summary(second)
    assert (summary["pages_checked"], summary["pages_main_changed"]) == (2, 1)
    assert summary["site_wide"] is False


async def test_a_footer_only_change_on_many_pages_is_site_wide_and_adds_no_snapshot(
    site: Site,
) -> None:
    paths = [f"/p{n}" for n in range(25)]
    first, ids = await site.crawl(paths)
    await site.record(first, {i: _history(f"text {p}", "foot 1") for p, i in ids.items()})
    second, ids2 = await site.crawl(paths)
    await site.record(second, {i: _history(f"text {p}", "foot 2") for p, i in ids2.items()})

    assert await site.counts() == (50, 25)
    summary = await site.summary(second)
    assert (summary["site_wide"], summary["pages_site_wide"], summary["pages_main_changed"]) == (
        True,
        25,
        0,
    )
    assert (await site.summary(first))["site_wide"] is False  # nothing to compare with


async def test_fewer_than_twenty_compared_pages_are_never_site_wide(site: Site) -> None:
    paths = [f"/p{n}" for n in range(19)]
    first, ids = await site.crawl(paths)
    await site.record(first, {i: _history(p, "foot 1") for p, i in ids.items()})
    second, ids2 = await site.crawl(paths)
    await site.record(second, {i: _history(p, "foot 2") for p, i in ids2.items()})

    summary = await site.summary(second)
    assert (summary["site_wide"], summary["pages_site_wide"]) == (False, 0)


async def test_a_page_with_no_history_writes_no_check(site: Site) -> None:
    run_id, ids = await site.crawl(["/html", "/none"])
    await site.record(run_id, {ids["/html"]: _history("a")})

    assert await site.counts() == (1, 1)
    assert (await site.summary(run_id))["pages_checked"] == 1


async def test_the_same_batch_twice_is_idempotent(site: Site) -> None:
    first, ids = await site.crawl(["/a", "/b"])
    await site.record(first, {ids["/a"]: _history("a"), ids["/b"]: _history("b")})
    second, ids2 = await site.crawl(["/a", "/b"])
    batch = {ids2["/a"]: _history("a", "f2"), ids2["/b"]: _history("b2")}
    await site.record(second, batch)
    before = await site.summary(second)
    await site.record(second, batch)

    assert await site.counts() == (4, 3)
    assert await site.summary(second) == before
    assert (before["pages_checked"], before["pages_main_changed"]) == (2, 1)


async def test_twenty_pages_declaring_one_day_make_declared_dates_unreliable(site: Site) -> None:
    paths = [f"/p{n}" for n in range(20)]
    run_id, ids = await site.crawl(paths)
    await site.record(run_id, {i: _history(p, declared=DAY) for p, i in ids.items()})

    assert (await site.summary(run_id))["declared_unreliable"] is True
    other, ids2 = await site.crawl(paths)
    days = [datetime(2026, 1, 1 + n, tzinfo=UTC) for n in range(20)]
    await site.record(
        other, {i: _history(p, declared=d) for (p, i), d in zip(ids2.items(), days, strict=True)}
    )
    assert (await site.summary(other))["declared_unreliable"] is False


def test_history_of_reads_hashes_counts_and_declared_date() -> None:
    html = (
        '<html><head><title>Hi</title><meta property="article:modified_time" '
        'content="2025-05-06T07:08:09Z"></head><body><nav><a href="/x">X</a></nav>'
        "<main><h1>Head</h1><p>One two three</p></main><footer>Foot</footer></body></html>"
    )
    first = history_of(html, "https://example.com/a", "https://example.com/a", None, [], [])
    footer_changed = history_of(
        html.replace("Foot", "Other"), "https://example.com/a", None, None, [], []
    )

    assert first.declared == Declared(datetime(2025, 5, 6, 7, 8, 9, tzinfo=UTC), "meta_modified")
    assert (first.snapshot.title, first.snapshot.words) == ("Hi", 4)
    assert first.snapshot.main_hash == footer_changed.snapshot.main_hash
    assert first.snapshot.full_hash != footer_changed.snapshot.full_hash


async def test_ingest_records_checks_for_pages_with_html_only(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    on_page = synthetic_site()
    crawled = await _crawled(migrated, worker_db, on_page)

    outcome = await _ingest(worker_db, on_page, MemoryStore(), crawled.task)

    assert outcome.failed is False
    paths = await fetch(
        migrated,
        "SELECT u.path FROM seo.page_checks c JOIN core.urls u ON u.id = c.url_id "
        "WHERE c.run_id = $1 ORDER BY 1",
        crawled.task.run_id,
    )
    assert [r["path"] for r in paths] == [
        "/",
        "/blog",
        "/blog/a",
        "/blog/b",
        "/blog/c",
        "/blog/d",
        "/pricing",
        "/privacy",
    ]
    summary = await fetchrow(
        migrated, "SELECT * FROM seo.page_history_runs WHERE run_id = $1", crawled.task.run_id
    )
    assert (summary["pages_checked"], summary["site_wide"]) == (8, False)


async def test_a_page_that_cannot_be_read_keeps_no_history_and_the_crawl_goes_on(
    migrated: PostgresServer, worker_db: Sessions, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(*_: object, **__: object) -> object:
        raise RuntimeError("secret page text")

    monkeypatch.setattr(page_history_store, "read_page_text", broken)
    on_page: FakeOnPage = synthetic_site()
    crawled = await _crawled(migrated, worker_db, on_page)

    with capture_logs() as logs:
        outcome = await crawl_ingest.ingest_run(
            worker_db, on_page, None, crawled.task, deadline=time.monotonic() + 120
        )

    assert outcome.failed is False
    run = await fetchrow(
        migrated, "SELECT state FROM seo.crawl_runs WHERE id = $1", crawled.task.run_id
    )
    assert run["state"] == "ready"
    count = await fetchrow(
        migrated, "SELECT count(*) AS n FROM seo.page_checks WHERE run_id = $1", crawled.task.run_id
    )
    assert count["n"] == 0
    warned = [log for log in logs if log["event"] == "crawl page history not read"]
    assert warned
    assert all(log["error"] == "RuntimeError" for log in warned)
    assert "secret" not in repr(logs)
    links = await fetchrow(
        migrated, "SELECT count(*) AS n FROM seo.crawl_links WHERE run_id = $1", crawled.task.run_id
    )
    assert links["n"] > 0


async def test_a_changed_canonical_tag_reaches_the_snapshot() -> None:
    def page(canonical: str | None) -> str:
        head = (
            "" if canonical is None else f'<head><link rel="canonical" href="{canonical}"></head>'
        )
        return f"<html>{head}<body><main>same</main></body></html>"

    url = "https://example.com/a"
    hosts = frozenset({"example.com"})
    old = await crawl_ingest._from_html(
        page("https://example.com/a"), 1, url, url, hosts, history_run=uuid.uuid4()
    )
    new = await crawl_ingest._from_html(page("/b"), 1, url, url, hosts, history_run=uuid.uuid4())
    bare = await crawl_ingest._from_html(page(None), 1, url, url, hosts, history_run=uuid.uuid4())

    assert old.history is not None
    assert new.history is not None
    assert bare.history is not None
    assert old.history.snapshot.canonical == "https://example.com/a"
    assert new.history.snapshot.canonical == "https://example.com/b"
    assert bare.history.snapshot.canonical is None
    assert old.history.snapshot.main_hash == new.history.snapshot.main_hash


async def test_a_crawl_that_hits_the_links_cap_still_gets_its_summary(
    migrated: PostgresServer, worker_db: Sessions, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(crawl_ingest, "LINKS_PER_CRAWL_MAX", 1)
    on_page = synthetic_site()
    crawled = await _crawled(migrated, worker_db, on_page)

    outcome = await _ingest(worker_db, on_page, MemoryStore(), crawled.task)

    assert outcome.failed is False
    summary = await fetchrow(
        migrated, "SELECT * FROM seo.page_history_runs WHERE run_id = $1", crawled.task.run_id
    )
    assert summary is not None
    assert summary["pages_checked"] > 0
