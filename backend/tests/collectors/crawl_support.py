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
    # By page URL: one page's raw HTML or links that fail while the others are fine.
    html_errors: dict[str, ProviderError] = field(default_factory=dict)
    links_errors: dict[str, ProviderError] = field(default_factory=dict)
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
        if page_url in self.links_errors:
            raise ProviderCallError(self.links_errors[page_url])
        return self.links.get(page_url, [])

    async def raw_html(self, task_id: str, url: str) -> str | None:
        self.calls.append(f"html {url}")
        if self.html_error is not None:
            raise ProviderCallError(self.html_error)
        if url in self.html_errors:
            raise ProviderCallError(self.html_errors[url])
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


SITE = "https://example.com"
_NAV = (
    '<header><nav><a href="/">Home</a><a href="/pricing">Pricing</a>'
    '<a href="/blog">Blog</a></nav></header>'
)
_FOOTER = '<footer><a href="/privacy">Privacy</a></footer>'


def page_html(
    main: str, *, article: bool = False, prev: str | None = None, next_: str | None = None
) -> str:
    """A page of the synthetic site: menu, main content, previous and next as on
    cleanstart.com (a section labelled "Article navigation" outside the article), footer."""
    body = f"<article>{main}</article>" if article else main
    steps = [
        f'<a rel="{rel}" href="{href}">{label}: {href}</a>'
        for rel, label, href in (("prev", "Previous", prev), ("next", "Next", next_))
        if href is not None
    ]
    joined = "".join(steps)
    section = f'<section aria-label="Article navigation">{joined}</section>' if steps else ""
    return f"<html><body>{_NAV}<main>{body}{section}</main>{_FOOTER}</body></html>"


def page_item(
    path: str, status: int = 200, *, location: str | None = None, sitemap: bool = False
) -> PageItem:
    return PageItem(
        url=f"{SITE}{path}",
        status_code=status,
        resource_type="redirect" if location else ("broken" if status >= 400 else "html"),
        location=location,
        title=path,
        canonical=None,
        from_sitemap=sitemap,
    )


def synthetic_site() -> FakeOnPage:
    """Eleven pages. `/blog/d` is reached only through "Next" (deep only through previous and
    next, and an editorial orphan); `/orphan` is in the sitemap and linked from nowhere, and
    its HTML is missing (placement unknown); `/old` redirects to `/pricing`; `/gone` is 404."""
    html = {
        f"{SITE}/": page_html('<p><a href="/blog/a">Read our guide</a></p>'),
        # Another container than the home page's paragraph: two pages of four sharing one
        # block of one changing link would be a template block to plan 01's pass.
        f"{SITE}/pricing": page_html('<div class="intro"><a href="/blog/c">How it works</a></div>'),
        f"{SITE}/blog": page_html(
            '<ul><li><a href="/blog/a">A</a></li><li><a href="/blog/b">B</a></li></ul>'
        ),
        f"{SITE}/blog/a": page_html(
            '<p><a href="/pricing">See plans</a></p>', article=True, next_="/blog/b"
        ),
        f"{SITE}/blog/b": page_html(
            "<p>No links here.</p>", article=True, prev="/blog/a", next_="/blog/c"
        ),
        f"{SITE}/blog/c": page_html(
            '<p><a href="/old">Old page</a> and <a href="/gone">a gone page</a></p>',
            article=True,
            prev="/blog/b",
            next_="/blog/d",
        ),
        f"{SITE}/blog/d": page_html("<p>The end.</p>", article=True, prev="/blog/c"),
        f"{SITE}/privacy": page_html("<p>Privacy.</p>"),
    }
    pages = [
        page_item("/", sitemap=True),
        page_item("/pricing", sitemap=True),
        page_item("/blog"),
        page_item("/blog/a"),
        page_item("/blog/b"),
        page_item("/blog/c"),
        page_item("/blog/d"),
        page_item("/privacy"),
        page_item("/orphan", sitemap=True),
        page_item("/old", 301, location=f"{SITE}/pricing"),
        page_item("/gone", 404),
    ]
    return FakeOnPage(
        page_items=pages,
        html=html,
        summaries=[summary(finished=True, crawled=len(pages))],
        non_indexable_items=[NonIndexableItem(url=f"{SITE}/privacy", reason="meta_tag")],
    )
