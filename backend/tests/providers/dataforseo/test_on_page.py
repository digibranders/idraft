"""The On-Page adapter against a stand-in DataForSEO (plan 02 Task 7)."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from decimal import Decimal

import httpx
import pytest

from idraft.domain.retries import ProviderErrorKind
from idraft.providers.contract import ProviderCallError
from idraft.providers.dataforseo.client import FAMILY_LIMITS, DataForSeoClient
from idraft.providers.dataforseo.on_page import FAMILY, CrawlOrder, OnPage
from tests.providers.dataforseo.support import (
    LOGIN,
    ORIGIN,
    PASSWORD,
    Api,
    FakeGate,
    envelope,
    task_answer,
)

TASK = "11161234-1535-0216-0000-5b2e1e3c3b86"


@pytest.fixture
def events() -> list[str]:
    return []


@pytest.fixture
def api(events: list[str]) -> Api:
    return Api(events)


@pytest.fixture
async def on_page(api: Api, events: list[str]) -> AsyncIterator[OnPage]:
    async with httpx.AsyncClient(transport=httpx.MockTransport(api)) as http:
        client = DataForSeoClient(
            http, FakeGate(events), login=LOGIN, password=PASSWORD, origin=ORIGIN
        )
        yield OnPage(client)


def test_on_page_calls_have_their_own_limit() -> None:
    assert FAMILY in FAMILY_LIMITS


async def test_a_crawl_is_posted_with_the_settings_of_the_spec(api: Api, on_page: OnPage) -> None:
    # The cost is a float: the stand-in sends JSON, and the client reads it back as a decimal.
    api.answer(
        "POST",
        "/v3/on_page/task_post",
        envelope([task_answer(task_id=TASK, cost=0.3, status_code=20100)]),
    )

    posted = await on_page.post(
        CrawlOrder(
            host="www.example.com",
            max_crawl_pages=2000,
            enable_javascript=False,
            allowed_subdomains=("blog.example.com",),
            tag="run-1",
        )
    )

    assert (posted.task_id, posted.cost_usd) == (TASK, Decimal("0.300000"))
    assert api.posted() == [
        {
            "target": "example.com",
            "start_url": "https://www.example.com/",
            "max_crawl_pages": 2000,
            "respect_sitemap": True,
            "store_raw_html": True,
            "enable_javascript": False,
            "allow_subdomains": False,
            "allowed_subdomains": ["blog.example.com"],
            "tag": "run-1",
        }
    ]


async def test_a_post_that_may_have_arrived_is_a_timeout(api: Api, on_page: OnPage) -> None:
    def hang(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    api.on("POST", "/v3/on_page/task_post", hang)

    with pytest.raises(ProviderCallError) as raised:
        await on_page.post(
            CrawlOrder("example.com", 2000, enable_javascript=False, allowed_subdomains=(), tag="t")
        )
    assert raised.value.error.kind is ProviderErrorKind.TIMEOUT


async def test_the_summary_says_how_far_the_crawl_is(api: Api, on_page: OnPage) -> None:
    result = {
        "crawl_progress": "in_progress",
        "crawl_status": {"max_crawl_pages": 2000, "pages_in_queue": 40, "pages_crawled": 120},
        "crawl_stop_reason": None,
        "domain_info": {"extended_crawl_status": "no_errors", "checks": {"sitemap": True}},
    }
    api.answer(
        "GET", f"/v3/on_page/summary/{TASK}", envelope([task_answer(task_id=TASK, result=[result])])
    )

    summary = await on_page.summary(TASK)

    assert (summary.finished, summary.pages_crawled, summary.pages_in_queue) == (False, 120, 40)
    assert (summary.has_sitemap, summary.extended_status, summary.stop_reason) == (
        True,
        "no_errors",
        None,
    )


async def test_pages_come_in_batches_with_a_token(api: Api, on_page: OnPage) -> None:
    page = {
        "resource_type": "html",
        "status_code": 200,
        "location": None,
        "url": "https://example.com/pricing",
        "meta": {"title": "Pricing", "canonical": "https://example.com/pricing"},
        "checks": {"from_sitemap": True, "is_redirect": False},
    }
    redirect = {
        "resource_type": "redirect",
        "status_code": 301,
        "location": "https://example.com/new",
        "url": "https://example.com/old",
        "meta": None,
        "checks": {"from_sitemap": False},
    }
    result = {
        "crawl_progress": "finished",
        "total_items_count": 2,
        "items_count": 2,
        "items": [page, redirect],
        "search_after_token": "abc",
    }
    api.answer("POST", "/v3/on_page/pages", envelope([task_answer(task_id=TASK, result=[result])]))

    batch = await on_page.pages(TASK, token="prev")

    assert api.posted() == [{"id": TASK, "limit": 1000, "search_after_token": "prev"}]
    assert batch.token == "abc"
    assert [
        (item.url, item.status_code, item.location, item.from_sitemap) for item in batch.items
    ] == [
        ("https://example.com/pricing", 200, None, True),
        ("https://example.com/old", 301, "https://example.com/new", False),
    ]
    assert batch.items[0].title == "Pricing"


async def test_raw_html_and_its_absence(api: Api, on_page: OnPage) -> None:
    api.answer(
        "POST",
        "/v3/on_page/raw_html",
        envelope([task_answer(task_id=TASK, result=[{"items": {"html": "<html></html>"}}])]),
    )
    assert await on_page.raw_html(TASK, "https://example.com/") == "<html></html>"

    api.answer(
        "POST",
        "/v3/on_page/raw_html",
        envelope([task_answer(task_id=TASK, result=[{"items": None}])]),
    )
    assert await on_page.raw_html(TASK, "https://example.com/") is None


async def test_the_provider_links_of_one_page_keep_anchors_and_images(
    api: Api, on_page: OnPage
) -> None:
    items = [
        {"type": "anchor", "link_to": "https://example.com/a", "text": "A", "dofollow": True},
        {
            "type": "image",
            "link_to": "https://example.com/b",
            "text": "",
            "image_alt": "B",
            "dofollow": False,
        },
        {"type": "canonical", "link_to": "https://example.com/", "dofollow": True},
    ]
    api.answer(
        "POST",
        "/v3/on_page/links",
        envelope([task_answer(task_id=TASK, result=[{"items": items, "total_items_count": 3}])]),
    )

    links = await on_page.links_from(TASK, "https://example.com/blog/x?page=2")

    assert api.posted()[0]["page_from"] == "/blog/x?page=2"
    assert api.posted()[0]["filters"] == ["direction", "=", "internal"]
    assert [(link.link_to, link.anchor, link.kind, link.dofollow) for link in links] == [
        ("https://example.com/a", "A", "text", True),
        ("https://example.com/b", "B", "image", False),
    ]


async def test_non_indexable_pages_and_force_stop(api: Api, on_page: OnPage) -> None:
    api.answer(
        "POST",
        "/v3/on_page/non_indexable",
        envelope(
            [
                task_answer(
                    task_id=TASK,
                    result=[
                        {
                            "total_items_count": 1,
                            "items": [{"reason": "meta_tag", "url": "https://example.com/x"}],
                        }
                    ],
                )
            ]
        ),
    )
    api.answer("POST", "/v3/on_page/force_stop", envelope([task_answer(task_id=TASK)]))

    batch = await on_page.non_indexable(TASK, offset=0)
    await on_page.force_stop(TASK)

    assert [(item.url, item.reason) for item in batch.items] == [
        ("https://example.com/x", "meta_tag")
    ]
    assert batch.total == 1
    assert json.loads(api.requests[-1].content) == [{"id": TASK}]


async def test_an_answer_that_is_not_what_was_asked_is_a_schema_mismatch(
    api: Api, on_page: OnPage
) -> None:
    api.answer(
        "POST",
        "/v3/on_page/pages",
        envelope([task_answer(task_id=TASK, result=[{"items": [{"status_code": "x"}]}])]),
    )

    with pytest.raises(ProviderCallError) as raised:
        await on_page.pages(TASK, token=None)
    assert raised.value.error.kind is ProviderErrorKind.SCHEMA_MISMATCH
