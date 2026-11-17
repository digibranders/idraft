"""A stand-in for DataForSEO On-Page that answers from memory, and the project a crawl test
needs (a website on example.com)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from decimal import Decimal

from idraft.providers.contract import ProviderCallError, ProviderError
from idraft.providers.dataforseo.on_page import (
    CrawlOrder,
    CrawlSummary,
    LinkItem,
    NonIndexableBatch,
    NonIndexableItem,
    PageBatch,
    PageItem,
    PostedCrawl,
)
from tests.api.auth.support import Workspace, execute, make_workspace
from tests.api.internal_links.support import set_website
from tests.api.keywords.support import keyword_project
from tests.conftest import PostgresServer


def summary(
    *,
    finished: bool,
    crawled: int = 0,
    queue: int = 0,
    stop: str | None = None,
    status: str | None = "no_errors",
    sitemap: bool | None = True,
) -> CrawlSummary:
    return CrawlSummary(
        finished=finished,
        pages_crawled=crawled,
        pages_in_queue=queue,
        stop_reason=stop,
        extended_status=status,
        has_sitemap=sitemap,
    )


@dataclass
class FakeOnPage:
    # Not `pages`: that is the name of the method which serves them.
    page_items: list[PageItem] = field(default_factory=list)
    html: dict[str, str] = field(default_factory=dict)
    links: dict[str, list[LinkItem]] = field(default_factory=dict)
    non_indexable_items: list[NonIndexableItem] = field(default_factory=list)
    # One per call; the last one repeats.
    summaries: list[CrawlSummary] = field(
        default_factory=lambda: [summary(finished=True, crawled=3)]
    )
    post_error: ProviderError | None = None
    html_error: ProviderError | None = None
    cost: Decimal | None = Decimal("0.3")
    batch: int = 2
    posted: list[CrawlOrder] = field(default_factory=list)
    stopped: list[str] = field(default_factory=list)
    calls: list[str] = field(default_factory=list)

    async def post(self, order: CrawlOrder) -> PostedCrawl:
        self.posted.append(order)
        if self.post_error is not None:
            raise ProviderCallError(self.post_error)
        return PostedCrawl(task_id=f"task-{len(self.posted)}", cost_usd=self.cost)

    async def summary(self, task_id: str) -> CrawlSummary:
        self.calls.append(f"summary {task_id}")
        return self.summaries.pop(0) if len(self.summaries) > 1 else self.summaries[0]

    async def pages(self, task_id: str, *, token: str | None) -> PageBatch:
        start = int(token or 0)
        end = start + self.batch
        return PageBatch(
            items=self.page_items[start:end],
            token=str(end) if end < len(self.page_items) else None,
            total=len(self.page_items),
        )

    async def non_indexable(self, task_id: str, *, offset: int) -> NonIndexableBatch:
        return NonIndexableBatch(
            items=self.non_indexable_items[offset : offset + self.batch],
            total=len(self.non_indexable_items),
        )

    async def links_from(self, task_id: str, page_url: str) -> list[LinkItem]:
        self.calls.append(f"links {page_url}")
        return self.links.get(page_url, [])

    async def raw_html(self, task_id: str, url: str) -> str | None:
        self.calls.append(f"html {url}")
        if self.html_error is not None:
            raise ProviderCallError(self.html_error)
        return self.html.get(url)

    async def force_stop(self, task_id: str) -> None:
        self.stopped.append(task_id)


async def clear_crawls(pg: PostgresServer) -> None:
    """A crawl tick looks at every crawl and every project with a website in the database, so
    a crawl test starts with none left by earlier tests."""
    await execute(pg, "DELETE FROM seo.crawl_runs")
    await execute(
        pg, "UPDATE core.projects SET primary_domain_id = NULL WHERE primary_domain_id IS NOT NULL"
    )


async def site_project(pg: PostgresServer) -> tuple[Workspace, uuid.UUID]:
    workspace = await make_workspace(pg)
    project = await keyword_project(pg, workspace)
    await set_website(pg, project)
    return workspace, project
