"""Two crawls of the synthetic site, the second after a link was removed, through the real
On-Page adapter, the crawl tick, the ingest and the enrichment, read back through the HTTP API
(plan 04 Task 16, step 1)."""

from __future__ import annotations

import time
import uuid
from collections.abc import AsyncIterator

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.resources import Resources
from idraft.collectors.crawl_enrich import CrawlEnrichTask, enrich_run
from idraft.collectors.crawl_ingest import ingest_run
from idraft.collectors.crawl_runs import CrawlIngestTask, Trigger, crawl_tick, queue_run
from idraft.providers.dataforseo.client import DataForSeoClient
from idraft.providers.dataforseo.on_page import OnPage
from tests.api.auth.support import fetchrow
from tests.api.conftest import api, auth_app, import_store, mailbox, resources
from tests.api.entities.support import member
from tests.api.keywords.support import project_url
from tests.collectors.crawl_support import (
    SITE,
    clear_crawls,
    page_html,
    serve,
    site_project,
    synthetic_site,
)
from tests.collectors.support import NOW
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer
from tests.providers.dataforseo.support import LOGIN, ORIGIN, PASSWORD, Api, FakeGate

# Fixtures of the API tests, which a test of this folder reads its results through.
__all__ = ["api", "auth_app", "import_store", "mailbox", "resources"]

Sessions = async_sessionmaker[AsyncSession]


@pytest.fixture(autouse=True)
async def _no_other_crawls(migrated: PostgresServer) -> None:
    await clear_crawls(migrated)


@pytest.fixture
def provider() -> Api:
    stand_in = Api([])
    serve(synthetic_site(), stand_in)
    return stand_in


@pytest.fixture
async def on_page(provider: Api) -> AsyncIterator[OnPage]:
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as http:
        client = DataForSeoClient(
            http, FakeGate(provider.events), login=LOGIN, password=PASSWORD, origin=ORIGIN
        )
        yield OnPage(client)


async def _crawl(
    sessions: Sessions,
    on_page: OnPage,
    store: MemoryStore,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    trigger: Trigger,
) -> uuid.UUID:
    """One crawl, queued, posted and read by the tick, ingested into `store`."""
    async with sessions() as db, db.begin():
        run_id = await queue_run(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            trigger=trigger,
            requested_by=None,
            now=NOW,
        )
    sent: list[CrawlIngestTask] = []

    async def send(task: CrawlIngestTask) -> bool:
        sent.append(task)
        return True

    await crawl_tick(sessions, on_page, send, now=NOW)
    assert [task.run_id for task in sent] == [run_id]
    outcome = await ingest_run(sessions, on_page, store, sent[0], deadline=time.monotonic() + 120)
    assert outcome.failed is False
    return run_id


async def test_a_removed_link_shows_in_the_changes_the_pages_extras_and_the_paths(
    migrated: PostgresServer,
    worker_db: Sessions,
    on_page: OnPage,
    provider: Api,
    api: httpx.AsyncClient,
    resources: Resources,
) -> None:
    workspace, project = await site_project(migrated)
    store = MemoryStore()

    first = await _crawl(worker_db, on_page, store, workspace.id, project, "website_added")
    # The second crawl finds /blog/a without its link in the text to /pricing ("See plans").
    changed = synthetic_site()
    changed.html[f"{SITE}/blog/a"] = page_html(
        "<p>Nothing to see.</p>", article=True, next_="/blog/b"
    )
    serve(changed, provider)
    second = await _crawl(worker_db, on_page, store, workspace.id, project, "manual")
    run = await fetchrow(
        migrated, "SELECT state, previous_run_id FROM seo.crawl_runs WHERE id = $1", second
    )
    assert run["state"] == "ready"
    assert any(store.objects), "the crawl read HTML that ingest kept for the enrichment"

    outcome = await enrich_run(
        worker_db,
        store,
        CrawlEnrichTask(workspace_id=workspace.id, run_id=second),
        deadline=time.monotonic() + 120,
    )
    assert outcome.failed is False

    viewer = await member(resources, migrated, workspace, "viewer")
    base = project_url(workspace, project, "internal-links")

    summary = await api.get(f"{base}/changes/summary", headers=viewer.headers)
    data = summary.json()["data"]
    assert data["state"] == "ready"
    assert data["previous_run_id"] == str(first)
    assert data["editorial_lost"] >= 1

    lost = await api.get(f"{base}/changes/links", params={"change": "lost"}, headers=viewer.headers)
    pairs = {(row["source"]["path"], row["target"]["path"]) for row in lost.json()["data"]}
    assert ("/blog/a", "/pricing") in pairs

    pages = await api.get(
        f"{base}/pages",
        params={"include": "changes,anchors,keywords,citations,gsc"},
        headers=viewer.headers,
    )
    assert pages.status_code == 200
    rows = pages.json()["data"]
    assert rows
    assert all(row["extras"] is not None for row in rows)

    deep = await fetchrow(
        migrated,
        "SELECT p.url_id FROM seo.crawl_pages p JOIN core.urls u ON u.id = p.url_id "
        "WHERE p.run_id = $1 AND u.path = '/blog/d'",
        second,
    )
    route = await api.get(
        f"{base}/paths", params={"url_id": deep["url_id"]}, headers=viewer.headers
    )
    assert route.status_code == 200
    steps = route.json()["data"]["any"]["steps"]
    assert [steps[0]["page"]["path"], steps[-1]["page"]["path"]] == ["/", "/blog/d"]
