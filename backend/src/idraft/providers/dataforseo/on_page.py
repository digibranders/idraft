"""DataForSEO On-Page for the internal link tracker (spec 6.1 and 6.3; plan decisions D5 to
D7).

One crawl is one posted task, paid when posted. The summary says how far it is; when it has
finished, its pages, its non-indexable pages and each page's raw HTML are read (results stay 30
days at DataForSEO, raw HTML 7). The links of a page are read from the provider only when its
HTML is missing. Every call takes a turn under the `on_page` family limit.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import ROUND_UP, Decimal
from typing import Final, Literal, Protocol
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, ValidationError

from idraft.domain.retries import ProviderErrorKind
from idraft.providers.contract import ProviderCallError, ProviderError
from idraft.providers.dataforseo.client import DataForSeoClient, TaskAnswer
from idraft.providers.dataforseo.errors import read_status

FAMILY: Final = "on_page"
# The endpoint of the crawl's cost event and its price (migration 0025).
TASK_POST: Final = "on_page/task_post"
PAGE_LIMIT: Final = 1000
# The pause between two hits on a customer's site. The provider's default of 2 seconds halved the
# crawl speed (60 pages took 139 s against 79 s at 200 ms, measured 2026-11-23); 250 ms is about
# 4 hits a second at most, and the provider fetches one page at a time anyway.
CRAWL_DELAY_MS: Final = 250
_TASK_ID: Final = re.compile(r"[0-9A-Za-z-]{1,64}")
_COST_STEP: Final = Decimal("0.000001")
# 200,000 pages (the largest ceiling) at the JavaScript price of $0.0015.
COST_MAX: Final = Decimal("300")
# Raw HTML above this is treated as missing: the page's links come from the provider instead.
HTML_MAX: Final = 10 * 1024 * 1024
_PROGRESS: Final = frozenset({"in_progress", "finished"})
_LINK_TYPES: Final = {"anchor": "text", "image": "image"}
K = ProviderErrorKind


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="ignore")


@dataclass(frozen=True, slots=True)
class CrawlOrder:
    host: str
    max_crawl_pages: int
    enable_javascript: bool
    allowed_subdomains: tuple[str, ...]
    tag: str
    # The provider waits this long between two hits on the site (its own default is 2000).
    crawl_delay_ms: int = CRAWL_DELAY_MS

    def body(self) -> dict[str, object]:
        body: dict[str, object] = {
            # The documentation: the domain without the protocol or `www`.
            "target": self.host.removeprefix("www."),
            "start_url": f"https://{self.host}/",
            "max_crawl_pages": self.max_crawl_pages,
            "respect_sitemap": True,
            "store_raw_html": True,
            "enable_javascript": self.enable_javascript,
            "allow_subdomains": False,
            "crawl_delay": self.crawl_delay_ms,
            "tag": self.tag,
        }
        if self.allowed_subdomains:
            body["allowed_subdomains"] = list(self.allowed_subdomains)
        return body


class PostedCrawl(_Model):
    task_id: str
    cost_usd: Decimal | None


class CrawlSummary(_Model):
    finished: bool
    pages_crawled: int
    pages_in_queue: int
    stop_reason: str | None
    extended_status: str | None
    has_sitemap: bool | None


class PageItem(_Model):
    url: str
    status_code: int | None
    resource_type: str
    location: str | None
    title: str | None
    canonical: str | None
    from_sitemap: bool


class PageBatch(_Model):
    items: list[PageItem]
    token: str | None
    total: int


class NonIndexableItem(_Model):
    url: str
    reason: str


class NonIndexableBatch(_Model):
    items: list[NonIndexableItem]
    total: int


class LinkItem(_Model):
    link_to: str
    anchor: str
    kind: Literal["text", "image"]
    dofollow: bool


class OnPageApi(Protocol):
    """What the crawl workload calls; `OnPage` is the real one, tests use a stand-in."""

    async def post(self, order: CrawlOrder) -> PostedCrawl: ...
    async def summary(self, task_id: str) -> CrawlSummary: ...
    async def pages(self, task_id: str, *, token: str | None) -> PageBatch: ...
    async def non_indexable(self, task_id: str, *, offset: int) -> NonIndexableBatch: ...
    async def links_from(self, task_id: str, page_url: str) -> list[LinkItem]: ...
    async def raw_html(self, task_id: str, url: str) -> str | None: ...
    async def force_stop(self, task_id: str) -> None: ...


def _mismatch(message: str) -> ProviderCallError:
    return ProviderCallError(ProviderError(kind=K.SCHEMA_MISMATCH, message=message))


def _mapping(value: object) -> Mapping[str, object]:
    return value if isinstance(value, Mapping) else {}


def _cost(value: object) -> Decimal | None:
    """The cost the answer reports, or None (the price book estimate is used then): absent,
    zero, negative or above what the largest crawl could cost."""
    if isinstance(value, bool) or not isinstance(value, int | Decimal):
        return None
    number = Decimal(value)
    if not number.is_finite() or not 0 < number <= COST_MAX:
        return None
    return number.quantize(_COST_STEP, rounding=ROUND_UP)


def _total(found: Mapping[str, object], count: int) -> int:
    """`total_items_count` of a list answer. A list with items and no usable total is a
    mismatch: guessing it from the items would end a paged read after the first batch."""
    total = found.get("total_items_count")
    if isinstance(total, int) and not isinstance(total, bool) and total >= 0:
        return total
    if count == 0:
        return 0
    raise _mismatch("a list with no total")


def _task(task_id: str) -> str:
    if not _TASK_ID.fullmatch(task_id):
        raise _mismatch("a task id that is not one")
    return task_id


def _summary(result: Mapping[str, object]) -> CrawlSummary:
    status = _mapping(result.get("crawl_status"))
    domain = _mapping(result.get("domain_info"))
    sitemap = _mapping(domain.get("checks")).get("sitemap")
    progress = result.get("crawl_progress")
    if progress not in _PROGRESS:
        # An empty or renamed summary must not read as "still running" for ever.
        raise _mismatch("a summary with no crawl progress")
    return CrawlSummary.model_validate(
        {
            "finished": progress == "finished",
            "pages_crawled": status.get("pages_crawled") or 0,
            "pages_in_queue": status.get("pages_in_queue") or 0,
            "stop_reason": result.get("crawl_stop_reason"),
            "extended_status": domain.get("extended_crawl_status"),
            "has_sitemap": sitemap if isinstance(sitemap, bool) else None,
        }
    )


def _page(raw: object) -> PageItem:
    item = _mapping(raw)
    meta = _mapping(item.get("meta"))
    checks = _mapping(item.get("checks"))
    return PageItem.model_validate(
        {
            "url": item.get("url"),
            "status_code": item.get("status_code"),
            "resource_type": item.get("resource_type") or "other",
            "location": item.get("location"),
            "title": meta.get("title"),
            "canonical": meta.get("canonical"),
            "from_sitemap": checks.get("from_sitemap") is True,
        }
    )


def _link(raw: object) -> LinkItem | None:
    item = _mapping(raw)
    kind = _LINK_TYPES.get(str(item.get("type")))
    if kind is None:
        return None
    anchor = item.get("text") or (item.get("image_alt") if kind == "image" else "") or ""
    return LinkItem.model_validate(
        {
            "link_to": item.get("link_to"),
            "anchor": anchor,
            "kind": kind,
            "dofollow": item.get("dofollow") is not False,
        }
    )


def _items(found: Mapping[str, object]) -> Sequence[object]:
    items = found.get("items") or []
    if not isinstance(items, Sequence) or isinstance(items, str):
        raise _mismatch("items that are not a list")
    return items


def _relative(url: str) -> str:
    parts = urlsplit(url)
    return (parts.path or "/") + (f"?{parts.query}" if parts.query else "")


class OnPage:
    def __init__(self, client: DataForSeoClient) -> None:
        self._client = client

    async def _call(
        self,
        method: Literal["GET", "POST"],
        path: str,
        body: list[dict[str, object]] | None = None,
        *,
        sending: bool = False,
    ) -> tuple[TaskAnswer, Mapping[str, object] | None]:
        answered = await self._client.call(method, path, family=FAMILY, sending=sending, body=body)
        task = answered.tasks[0] if answered.tasks else None
        if task is None:
            raise ProviderCallError(
                ProviderError(
                    kind=K.TIMEOUT if sending else K.PROVIDER_ERROR,
                    message="the answer names no task",
                )
            )
        outcome = read_status(task.status_code, task.status_message, sending=sending)
        if isinstance(outcome, ProviderError):
            raise ProviderCallError(outcome)
        first = task.result[0] if task.result else None
        if first is not None and not isinstance(first, Mapping):
            if sending:
                # The task exists and is charged: keep its id, the caller does not read a result.
                return task, None
            raise _mismatch("a result that is not an object")
        return task, first

    async def post(self, order: CrawlOrder) -> PostedCrawl:
        task, _ = await self._call("POST", "/v3/on_page/task_post", [order.body()], sending=True)
        if task.id is None or not _TASK_ID.fullmatch(task.id):
            # Created and charged, with an id we cannot keep: the outcome is unknown to us.
            raise ProviderCallError(ProviderError(kind=K.TIMEOUT, message="no usable task id"))
        return PostedCrawl(task_id=task.id, cost_usd=_cost(task.cost))

    async def summary(self, task_id: str) -> CrawlSummary:
        _, result = await self._call("GET", f"/v3/on_page/summary/{_task(task_id)}")
        try:
            return _summary(result or {})
        except ValidationError:
            raise _mismatch("a summary that cannot be read") from None

    async def pages(self, task_id: str, *, token: str | None) -> PageBatch:
        body: dict[str, object] = {"id": _task(task_id), "limit": PAGE_LIMIT}
        if token is not None:
            body["search_after_token"] = token
        _, result = await self._call("POST", "/v3/on_page/pages", [body])
        found = result or {}
        try:
            pages = [_page(item) for item in _items(found)]
        except ValidationError:
            raise _mismatch("a page that cannot be read") from None
        next_token = found.get("search_after_token")
        return PageBatch(
            items=pages,
            token=next_token if isinstance(next_token, str) and next_token and pages else None,
            total=_total(found, len(pages)),
        )

    async def non_indexable(self, task_id: str, *, offset: int) -> NonIndexableBatch:
        body: dict[str, object] = {"id": _task(task_id), "limit": PAGE_LIMIT, "offset": offset}
        _, result = await self._call("POST", "/v3/on_page/non_indexable", [body])
        found = result or {}
        try:
            items = [NonIndexableItem.model_validate(_mapping(item)) for item in _items(found)]
        except ValidationError:
            raise _mismatch("a non-indexable page that cannot be read") from None
        return NonIndexableBatch(items=items, total=_total(found, len(items)))

    async def links_from(self, task_id: str, page_url: str) -> list[LinkItem]:
        """Every internal link of one page, read in batches of PAGE_LIMIT until the total."""
        links: list[LinkItem] = []
        offset = 0
        while True:
            body: dict[str, object] = {
                "id": _task(task_id),
                "page_from": _relative(page_url),
                "limit": PAGE_LIMIT,
                "offset": offset,
                "filters": ["direction", "=", "internal"],
            }
            _, result = await self._call("POST", "/v3/on_page/links", [body])
            found = result or {}
            try:
                items = _items(found)
                links.extend(link for link in map(_link, items) if link is not None)
            except ValidationError:
                raise _mismatch("a link that cannot be read") from None
            offset += len(items)
            if not items or offset >= _total(found, len(items)):
                return links

    async def raw_html(self, task_id: str, url: str) -> str | None:
        try:
            _, result = await self._call(
                "POST", "/v3/on_page/raw_html", [{"id": _task(task_id), "url": url}]
            )
        except ProviderCallError as failure:
            if failure.error.kind is K.NOT_FOUND_EXPIRED:
                return None
            raise
        html = _mapping(_mapping(result).get("items")).get("html")
        return html if isinstance(html, str) and 0 < len(html) <= HTML_MAX else None

    async def force_stop(self, task_id: str) -> None:
        await self._call("POST", "/v3/on_page/force_stop", [{"id": _task(task_id)}])
