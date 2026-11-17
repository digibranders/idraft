"""A crawl of the synthetic site from the website-added trigger to the journey, through the
real On-Page adapter (over the real DataForSEO client and an httpx stand-in), the crawl tick,
the ingest and the read queries (spec section 11, "ingest from recorded DataForSEO payloads")."""

from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator
from decimal import Decimal

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.internal_links.page_filter import PageScope
from idraft.api.internal_links.reads import load_tiers, neighbor_page
from idraft.collectors.crawl_ingest import ingest_run
from idraft.collectors.crawl_runs import CrawlIngestTask, crawl_tick, queue_run
from idraft.crawl.scopes import LinkScope
from idraft.db.engine import workspace_transaction
from idraft.providers.dataforseo.client import DataForSeoClient
from idraft.providers.dataforseo.on_page import OnPage
from tests.api.auth.support import execute, fetch, fetchrow
from tests.api.internal_links.support import seed_tiers
from tests.collectors.crawl_support import (
    E2E_TASK,
    SITE,
    clear_crawls,
    serve,
    site_project,
    synthetic_site,
)
from tests.collectors.support import NOW
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer
from tests.providers.dataforseo.support import LOGIN, ORIGIN, PASSWORD, Api, FakeGate

Sessions = async_sessionmaker[AsyncSession]

# The only calls the adapter is documented to make to read a crawl (spec 6.1): nothing else may
# reach the provider, in particular no second post and no force stop.
TASK_POST = ("POST", "/v3/on_page/task_post")
ALLOWED = {
    TASK_POST,
    ("GET", f"/v3/on_page/summary/{E2E_TASK}"),
    ("POST", "/v3/on_page/pages"),
    ("POST", "/v3/on_page/non_indexable"),
    ("POST", "/v3/on_page/raw_html"),
    ("POST", "/v3/on_page/links"),
}


@pytest.fixture(autouse=True)
async def _no_other_crawls(migrated: PostgresServer) -> None:
    await clear_crawls(migrated)


@pytest.fixture
def events() -> list[str]:
    return []


@pytest.fixture
def provider(events: list[str]) -> Api:
    stand_in = Api(events)
    serve(synthetic_site(), stand_in)
    return stand_in


@pytest.fixture
async def on_page(provider: Api, events: list[str]) -> AsyncIterator[OnPage]:
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as http:
        client = DataForSeoClient(
            http, FakeGate(events), login=LOGIN, password=PASSWORD, origin=ORIGIN
        )
        yield OnPage(client)


def _asked(provider: Api, method: str, path: str) -> list[httpx.Request]:
    return [r for r in provider.requests if (r.method, r.url.path) == (method, path)]


async def test_a_new_site_is_crawled_ingested_and_walked(
    migrated: PostgresServer,
    worker_db: Sessions,
    on_page: OnPage,
    provider: Api,
    events: list[str],
) -> None:
    workspace, project = await site_project(migrated)
    t1, *_ = await seed_tiers(migrated, workspace)
    async with worker_db() as db, db.begin():
        run_id = await queue_run(
            db,
            workspace_id=workspace.id,
            project_id=project,
            trigger="website_added",
            requested_by=None,
            now=NOW,
        )
    sent: list[CrawlIngestTask] = []

    async def send(task: CrawlIngestTask) -> bool:
        sent.append(task)
        return True

    report = await crawl_tick(worker_db, on_page, send, now=NOW)

    # One tick posts the crawl, reads its finished summary and hands it to ingest.
    assert (report.posted, report.finished, report.ingest_sent, len(sent)) == (1, 1, 1, 1)
    assert len(_asked(provider, *TASK_POST)) == 1

    outcome = await ingest_run(
        worker_db, on_page, MemoryStore(), sent[0], deadline=time.monotonic() + 120
    )

    assert outcome.failed is False
    run = await fetchrow(
        migrated, "SELECT state, pages_crawled, cost_usd FROM seo.crawl_runs WHERE id = $1", run_id
    )
    assert (run["state"], run["pages_crawled"], run["cost_usd"]) == ("ready", 11, Decimal("0.3"))
    stored = await fetch(
        migrated, "SELECT count(*) AS n FROM seo.crawl_pages WHERE run_id = $1", run_id
    )
    assert stored[0]["n"] == 11

    # One post, paid once; ingest only reads.
    assert len(_asked(provider, *TASK_POST)) == 1
    costs = await fetch(
        migrated,
        "SELECT workload, endpoint, cost_usd FROM ops.provider_cost_events WHERE run_id = $1",
        run_id,
    )
    assert [(c["workload"], c["endpoint"], c["cost_usd"]) for c in costs] == [
        ("site_crawl", "on_page/task_post", Decimal("0.3"))
    ]

    # Every request was one the adapter is documented to make, each took a turn of the family
    # limit, and each kind was made: eleven pages two at a time, the one non-indexable page,
    # the HTML of the nine pages that answered 200 (the one missing from the stand-in, /orphan,
    # makes its links be read from the provider instead).
    assert {(r.method, r.url.path) for r in provider.requests} == ALLOWED
    assert events.count("turn on_page") == len(provider.requests)
    assert len(_asked(provider, "POST", "/v3/on_page/pages")) == 6
    assert len(_asked(provider, "GET", f"/v3/on_page/summary/{E2E_TASK}")) == 1
    assert len(_asked(provider, "POST", "/v3/on_page/non_indexable")) == 1
    html_asked = {
        json.loads(r.content)[0]["url"] for r in _asked(provider, "POST", "/v3/on_page/raw_html")
    }
    assert html_asked == {
        f"{SITE}{path}"
        for path in (
            "/",
            "/pricing",
            "/blog",
            "/blog/a",
            "/blog/b",
            "/blog/c",
            "/blog/d",
            "/privacy",
            "/orphan",
        )
    }
    links_asked = [
        json.loads(r.content)[0]["page_from"] for r in _asked(provider, "POST", "/v3/on_page/links")
    ]
    assert links_asked == ["/orphan"]

    pricing = await fetchrow(
        migrated,
        "SELECT p.url_id FROM seo.crawl_pages p JOIN core.urls u ON u.id = p.url_id "
        "WHERE p.run_id = $1 AND u.path = '/pricing'",
        run_id,
    )
    await execute(
        migrated,
        "INSERT INTO core.project_pages (project_id, url_id, workspace_id, tier_id, tier_source) "
        "VALUES ($1, $2, $3, $4, 'manual')",
        project,
        pricing["url_id"],
        workspace.id,
        t1,
    )
    scope = PageScope(workspace.id, project, run_id, None)
    async with workspace_transaction(worker_db, workspace.id) as db:
        tiers = await load_tiers(db, workspace.id)
        into = await neighbor_page(db, scope, tiers, pricing["url_id"], "in", LinkScope.ALL, 8, 0)
        editorial_in = await neighbor_page(
            db, scope, tiers, pricing["url_id"], "in", LinkScope.EDITORIAL, 8, 0
        )
        out = await neighbor_page(
            db, scope, tiers, pricing["url_id"], "out", LinkScope.EDITORIAL, 8, 0
        )

    # Seven pages link to /pricing: the home page, /blog, /blog/a to /blog/d and /privacy, each
    # through its menu. Not /orphan (no HTML, no links), nor /old and /gone (not read); /old's
    # redirect is no link. /blog/a links twice (menu and "See plans"), still one neighbor.
    assert into.meta.total == 7
    assert sorted(row.path for row in into.rows) == [
        "/",
        "/blog",
        "/blog/a",
        "/blog/b",
        "/blog/c",
        "/blog/d",
        "/privacy",
    ]
    assert [(row.path, row.anchor) for row in editorial_in.rows] == [("/blog/a", "See plans")]
    assert [(row.path, row.anchor, row.reciprocal, row.occurrences) for row in out.rows] == [
        ("/blog/c", "How it works", False, 1)
    ]
    # The menu and the footer: Home, Blog, Privacy (the menu's link to /pricing itself is dropped).
    assert [(count.scope, count.pages) for count in out.meta.other_scopes] == [("template", 3)]
