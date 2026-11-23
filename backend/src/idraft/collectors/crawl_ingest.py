"""Reading a finished crawl into pages, links and metrics (spec 6.3 and 6.4; plan decisions D7
to D12).

Ingest works in phases kept on the run row (`ingest_phase`, `ingest_token`, `ingest_offset`).
Each step commits its rows and the next checkpoint together, so a pass can stop after any step
and the next pass, on any worker, carries on:

- `pages`: the crawled pages, 1,000 a step, their URLs added to `core.urls`; the crawl's link
  partition is made first, and a start page that refuses the crawler ends the crawl;
- `non_indexable`: the pages search engines may not index;
- `links`: a few pages a step: each page's raw HTML (kept in R2, latest only), the classifier and
  the page's edges; the provider's links for a page with no HTML, all `content`;
- `template`: the second placement pass;
- `metrics`: counts, flags, depth and equity; then, in a second transaction, the crawl is
  `ready`, or `stopped_at_ceiling` when the provider stopped it there, and the rule tiers and
  the tier flow follow in the same transaction.

Who may write. The tick sends a `processing` crawl to the queue every minute and the queue only
drops a message that is still waiting, so two passes over one crawl are normal. A pass holds a
Postgres advisory lock named by the run for as long as it runs (`_pass_lock`); a pass that finds
the lock taken ends at once. The lock is a courtesy that saves duplicate reads. What makes the
data right is that every write transaction begins with `_claim`: it locks the run row and checks
that the crawl is still `processing` at the phase, token and offset the step read, so a step
that was overtaken (by a pass whose lock was lost, or by a cancel) writes nothing. Provider
calls and object storage puts happen outside a transaction: the server drops a connection that
is idle in a transaction for 60 seconds.

Resuming. A step is rows plus its checkpoint in one transaction, so a crash leaves the crawl at
the last checkpoint and the next pass repeats the step. Pages are `ON CONFLICT DO NOTHING`; a
page's links are written only for a page still `waiting`, in the same statement order as its
`links_state` change; the template and metrics steps are rewritten from the stored links.

The end. The crawl turns `ready` in one transaction that also takes the project row lock (as the
API does before it changes tiers, and in the same order, project then run), applies the rule
tiers and recomputes the tier flow. Until that commits the crawl is `processing`, so every read
of "the latest crawl" still gets the one before it; a failure in any of the three rolls all of
them back. The flip is guarded by `state = 'processing'`, so a crawl that was cancelled or failed
meanwhile is never overwritten.

A failed step is tried again by the next pass; five failed passes in a row end the crawl `failed`
with `ingest_failed` and the crawl before it stays the latest. A failure that goes away by
itself (the provider not reached or slow, a lock or pool timeout) does not count for six hours
after the crawl finished, and a provider listing that never ends is a failure that counts. A
crawl that ends `failed` keeps its `ingest_phase`, which tells the retention step it has a link
partition to drop.

Pages are hostile input. A page's edges are cut at `EDGES_PER_PAGE_MAX` (the first ones in
document order) and a step stops reading pages once it holds `STEP_EDGES_MAX` edges, so the
edges a step keeps are at most the budget plus one page: about 70,000, under 100 MB. That is not
the step's peak. The classifier (`idraft.crawl.placement.classify`) returns every link of a page
before any cut, and a 10 MiB page of minimal anchors (about 420,000 links) takes about 290 MB
while it is read (measured with tracemalloc), about 160 MB of it kept until the cut is made;
cutting adds about 20 MB. So one `links` step peaks near 400 MB for such a page, and each of the
worker's handlers can be in one at a time. The `template` and `metrics` steps read the crawl's
stored edges and hold memory in proportion to them (a quarter of a kilobyte an edge or more).
Their Python work runs between transactions, so that no transaction sits idle (the server ends
one idle for 60 seconds) holding the run row. Every statement names the run: the worker
bypasses row-level security.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Iterable, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Final
from uuid import UUID

import structlog
from sqlalchemy import bindparam, case, exc, func, insert, literal, select, text, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import aliased

from idraft.collectors.crawl_runs import INGEST_JOB, CrawlIngestTask
from idraft.collectors.crawl_store import apply_rules, recompute_tier_flow
from idraft.collectors.crawl_store import html_key as html_key  # kept here for its callers
from idraft.crawl.edges import PageEdge, clean_text, is_clean, page_edges
from idraft.crawl.graph import (
    Link,
    Node,
    click_depths,
    deep_only_through_auto,
    pagerank,
    template_roots,
)
from idraft.crawl.head import canonical_of
from idraft.crawl.hosts import site_hosts
from idraft.crawl.placement import FoundLink, Placement, classify
from idraft.crawl.scopes import LinkScope, scope_of
from idraft.crawl.status import BLOCKED_STATUSES, is_blocked
from idraft.crawl.template import TemplateRow, template_placements
from idraft.db import dictionaries
from idraft.db.tables import crawl_links, crawl_pages, crawl_runs, projects, urls
from idraft.domain.retries import ProviderErrorKind
from idraft.extraction.urls import CanonicalUrl, UrlRejectedError, canonicalize
from idraft.providers.contract import ProviderCallError
from idraft.providers.dataforseo.on_page import LinkItem, OnPageApi
from idraft.storage.raw import ObjectStore, compress

# A pass ends well inside the queue's handler limit (8 minutes, worker/queues.py).
PASS_TIME: Final = timedelta(minutes=6)
INGEST_FAILURES_MAX: Final = 5
HTML_PAGES_PER_STEP: Final = 25
# Distinct edges kept for one page, the first ones in document order. A 10 MiB page can hold
# hundreds of thousands of links; 20,000 is more than any page a person reads has.
EDGES_PER_PAGE_MAX: Final = 20_000
# A step stops taking pages once it holds this many edges: with one page of at most
# `EDGES_PER_PAGE_MAX` on top, a step holds 70,000 edges at the most (about 1 KB each).
STEP_EDGES_MAX: Final = 50_000
# Links stored for one crawl, at the most. A step that finds the crawl at this many leaves the
# pages still waiting without links and the crawl goes on to its metrics with what it has: the
# metrics step holds the crawl's links in memory (see `_page_metrics`).
LINKS_PER_CRAWL_MAX: Final = 1_000_000
# The statement timeout of the steps that work over a whole crawl (the process default, 15
# seconds, is for requests).
_LONG_STATEMENT_TIMEOUT: Final = text("SET LOCAL statement_timeout = '5min'")
# A failure of the provider or the database that goes away by itself is not the crawl's fault and
# is not counted, for this long after the crawl finished; after that it is counted like any other.
INGEST_TRANSIENT_WINDOW: Final = timedelta(hours=6)
_TRANSIENT_KINDS: Final = frozenset(
    {ProviderErrorKind.NOT_SENT, ProviderErrorKind.RATE_LIMITED, ProviderErrorKind.TIMEOUT}
)
# Lock not available (a lock timeout), serialization failure and deadlock.
_TRANSIENT_SQLSTATES: Final = frozenset({"55P03", "40001", "40P01"})
# The longest address a page is stored under; a longer one, or one with characters the database
# refuses, is skipped.
_URL_MAX: Final = 8192
_LINK_ROWS_PER_STATEMENT: Final = 2_000
# Bind parameters a call to `urls_for` may use: far under the driver's 32,767.
_URLS_PER_CALL: Final = 10_000
_RESOURCE_TYPES: Final = frozenset({"html", "redirect", "broken"})
_REASONS: Final = frozenset(
    {"robots_txt", "meta_tag", "http_header", "attribute", "too_many_redirects"}
)
# A refused start page ends the crawl as `site_blocked` only when fewer pages than this were served.
BLOCKED_SERVED_MIN: Final = 3
_BLOCKED_MESSAGE: Final = "The start page refuses the crawler."
_FAILED_MESSAGE: Final = "The crawl could not be read; the previous crawl is still shown."
_log = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class IngestOutcome:
    phase: str | None
    steps: int
    failed: bool = False
    # Another pass holds the crawl: this one did nothing.
    busy: bool = False


@dataclass(frozen=True, slots=True)
class _Run:
    """The columns of a crawl that ingest reads, as they were when a step began."""

    id: UUID
    workspace_id: UUID
    project_id: UUID
    state: str
    phase: str | None
    token: str | None
    offset: int
    provider_task_id: str
    target_host: str
    allowed_subdomains: tuple[str, ...]
    start_url_id: int | None
    stop_reason: str | None
    ceiling: int
    links_stored: int
    crawled_at: datetime | None


class IngestLoopError(Exception):
    """The provider's listing does not end (a token it repeats, or more pages than the crawl's
    ceiling allows): the step fails, and the failure counts."""


@dataclass(frozen=True, slots=True)
class _PageLinks:
    url_id: int
    state: str
    edges: list[PageEdge]
    capped: bool
    # The canonical address the page's own HTML names, when its HTML was read.
    canonical: CanonicalUrl | None = None


type Step = Callable[
    [async_sessionmaker[AsyncSession], OnPageApi, ObjectStore | None, _Run], Awaitable[bool]
]


def _canonical(raw: str | None) -> CanonicalUrl | None:
    """An address the provider reports, or None for one that is not stored: empty, longer than
    `_URL_MAX` (cut, it would name another page), holding what the database refuses (a NUL, a
    lone surrogate) or that the canonicalizer rejects."""
    if not raw or len(raw) > _URL_MAX or not is_clean(raw):
        return None
    try:
        return canonicalize(raw)
    except UrlRejectedError:
        return None


def _elsewhere(url_id: int, canonical_id: int | None) -> bool:
    """Whether a page names another page as its canonical: then it is not indexable itself."""
    return canonical_id is not None and canonical_id != url_id


def _listing_bound(run: _Run) -> int:
    """The most items a listing of the crawl's pages may hold: its ceiling and a fifth over (the
    provider counts a little past it), and a thousand more."""
    return int(run.ceiling * 1.2) + 1000


def _transient(failure: Exception, run: _Run) -> bool:
    """A failure that is no fault of the crawl and goes away by itself: the provider could not
    be reached or was slow, the database's lock or pool did not give a turn. Counted only after
    `INGEST_TRANSIENT_WINDOW`, so that a page that never answers still ends the crawl."""
    if run.crawled_at is not None and datetime.now(UTC) - run.crawled_at > INGEST_TRANSIENT_WINDOW:
        return False
    if isinstance(failure, ProviderCallError):
        return failure.error.kind in _TRANSIENT_KINDS
    if isinstance(failure, exc.TimeoutError):
        return True
    if isinstance(failure, exc.DBAPIError):
        return getattr(failure.orig, "sqlstate", None) in _TRANSIENT_SQLSTATES
    return False


def _failure_detail(failure: Exception) -> dict[str, str | None]:
    """What a step's failure may log besides its class: the provider's error kind or the
    database's SQLSTATE, never a message (those can hold an address or markup of the site)."""
    if isinstance(failure, ProviderCallError):
        return {"kind": failure.error.kind.value}
    if isinstance(failure, exc.DBAPIError):
        return {"sqlstate": getattr(failure.orig, "sqlstate", None)}
    return {}


async def _long_transaction(db: AsyncSession) -> None:
    """For the transaction in progress only: the long statement timeout of the steps that work
    over a whole crawl."""
    await db.execute(_LONG_STATEMENT_TIMEOUT)


def capped_edges(
    links: Sequence[FoundLink], *, page: CanonicalUrl, hosts: frozenset[str]
) -> tuple[list[PageEdge], bool]:
    """The page's edges, at most `EDGES_PER_PAGE_MAX` of them: the first distinct ones in
    document order. The second value says the page had more. Only a growing prefix of the links
    is turned into edges, so a page of hundreds of thousands of links never has them all in
    memory as edges; the occurrence counts of a cut page cover the prefix read."""
    window = EDGES_PER_PAGE_MAX + 1
    while True:
        edges = page_edges(links[:window], page=page, hosts=hosts)
        if len(edges) > EDGES_PER_PAGE_MAX:
            return edges[:EDGES_PER_PAGE_MAX], True
        if window >= len(links):
            return edges, False
        window *= 2


async def _read_run(
    sessions: async_sessionmaker[AsyncSession], task: CrawlIngestTask
) -> _Run | None:
    async with sessions() as db:
        row = (
            await db.execute(
                select(
                    crawl_runs.c.id,
                    crawl_runs.c.workspace_id,
                    crawl_runs.c.project_id,
                    crawl_runs.c.state,
                    crawl_runs.c.ingest_phase,
                    crawl_runs.c.ingest_token,
                    crawl_runs.c.ingest_offset,
                    crawl_runs.c.provider_task_id,
                    crawl_runs.c.target_host,
                    crawl_runs.c.settings,
                    crawl_runs.c.start_url_id,
                    crawl_runs.c.stop_reason,
                    crawl_runs.c.ceiling,
                    crawl_runs.c.links_stored,
                    crawl_runs.c.crawled_at,
                ).where(
                    crawl_runs.c.workspace_id == task.workspace_id, crawl_runs.c.id == task.run_id
                )
            )
        ).one_or_none()
    if row is None:
        return None
    return _Run(
        id=row.id,
        workspace_id=row.workspace_id,
        project_id=row.project_id,
        state=row.state,
        phase=row.ingest_phase,
        token=row.ingest_token,
        offset=row.ingest_offset,
        provider_task_id=row.provider_task_id or "",
        target_host=row.target_host,
        allowed_subdomains=tuple(str(name) for name in row.settings.get("allowed_subdomains", ())),
        start_url_id=row.start_url_id,
        stop_reason=row.stop_reason,
        ceiling=row.ceiling,
        links_stored=row.links_stored,
        crawled_at=row.crawled_at,
    )


async def _claim(db: AsyncSession, run: _Run) -> bool:
    """Lock the crawl's row and say whether it is still where the step read it. False: another
    pass, or a cancel, moved it, and the step must write nothing."""
    found: UUID | None = (
        await db.execute(
            select(crawl_runs.c.id)
            .where(
                crawl_runs.c.workspace_id == run.workspace_id,
                crawl_runs.c.id == run.id,
                crawl_runs.c.state == "processing",
                crawl_runs.c.ingest_phase == run.phase,
                crawl_runs.c.ingest_token.is_not_distinct_from(run.token),
                crawl_runs.c.ingest_offset == run.offset,
            )
            .with_for_update(key_share=True)
        )
    ).scalar_one_or_none()
    return found is not None


async def _checkpoint(db: AsyncSession, run: _Run, **values: object) -> None:
    """The step's last write: the next checkpoint. A step that got this far worked, so the
    count of failed passes starts again."""
    await db.execute(
        update(crawl_runs)
        .where(crawl_runs.c.workspace_id == run.workspace_id, crawl_runs.c.id == run.id)
        .values(ingest_failures=0, **values)
    )


async def _url_ids(db: AsyncSession, given: Iterable[CanonicalUrl]) -> dict[bytes, int]:
    """The `core.urls` id of each URL by its hash. The URLs go in one global order (host, then
    hash) however many calls that takes, so two crawls adding the same new URLs cannot wait on
    each other."""
    unique = sorted(
        {url.url_hash: url for url in given}.values(), key=lambda url: (url.host.name, url.url_hash)
    )
    ids: dict[bytes, int] = {}
    for start in range(0, len(unique), _URLS_PER_CALL):
        known = await dictionaries.urls_for(db, unique[start : start + _URLS_PER_CALL])
        ids.update({url_hash: row.id for url_hash, row in known.items()})
    return ids


async def _fail(db: AsyncSession, run: _Run, *, code: str, message: str) -> None:
    """End a crawl that is still processing. `ingest_phase` stays as it is: it is how the
    retention step knows the crawl has a link partition to drop."""
    await db.execute(
        update(crawl_runs)
        .where(
            crawl_runs.c.workspace_id == run.workspace_id,
            crawl_runs.c.id == run.id,
            crawl_runs.c.state == "processing",
        )
        .values(state="failed", error_code=code, error_message=message, finished_at=func.now())
    )


async def _pages(
    sessions: async_sessionmaker[AsyncSession],
    on_page: OnPageApi,
    store: ObjectStore | None,
    run: _Run,
) -> bool:
    batch = await on_page.pages(run.provider_task_id, token=run.token)
    if batch.total > _listing_bound(run) or (run.token is not None and batch.token == run.token):
        raise IngestLoopError("the provider's list of pages does not end")
    found = [
        (item, url, _canonical(item.location), _canonical(item.canonical))
        for item in batch.items
        if (url := _canonical(item.url)) is not None
    ]
    async with sessions() as db, db.begin():
        if not await _claim(db, run):
            return False
        if len(found) < len(batch.items):
            # Pages with an address that cannot be stored are left out; their number only.
            _log.warning(
                "crawl pages skipped", run_id=str(run.id), count=len(batch.items) - len(found)
            )
        if run.token is None:
            await db.execute(
                text("SELECT seo.add_crawl_links_partition(:run_id)"), {"run_id": run.id}
            )
        ids = await _url_ids(db, (url for row in found for url in row[1:] if url is not None))
        values = []
        for item, url, redirect, canonical in found:
            url_id = ids[url.url_hash]
            canonical_id = None if canonical is None else ids[canonical.url_hash]
            elsewhere = _elsewhere(url_id, canonical_id)
            values.append(
                {
                    "run_id": run.id,
                    "url_id": url_id,
                    "workspace_id": run.workspace_id,
                    "project_id": run.project_id,
                    "crawled_url": item.url,
                    "status_code": (
                        item.status_code
                        if item.status_code is not None and 100 <= item.status_code <= 599
                        else None
                    ),
                    "resource_type": item.resource_type
                    if item.resource_type in _RESOURCE_TYPES
                    else "other",
                    "redirect_url_id": None if redirect is None else ids[redirect.url_hash],
                    "is_indexable": not elsewhere,
                    "non_indexable_reason": "canonical" if elsewhere else None,
                    "canonical_url_id": canonical_id,
                    "title": None if item.title is None else clean_text(item.title, limit=1000),
                    "in_sitemap": item.from_sitemap,
                    "links_state": "waiting"
                    if item.resource_type == "html" and item.status_code == 200
                    else "none",
                }
            )
        if values:
            await db.execute(upsert(crawl_pages).values(values).on_conflict_do_nothing())
        if batch.token is not None:
            await _checkpoint(db, run, ingest_token=batch.token)
            return True
        start = canonicalize(f"https://{run.target_host}/")
        start_id = (await _url_ids(db, [start]))[start.url_hash]
        status: int | None = (
            await db.execute(
                select(crawl_pages.c.status_code).where(
                    crawl_pages.c.run_id == run.id, crawl_pages.c.url_id == start_id
                )
            )
        ).scalar_one_or_none()
        if is_blocked(status):
            served: int = (
                await db.execute(
                    select(func.count()).where(
                        crawl_pages.c.run_id == run.id, crawl_pages.c.status_code == 200
                    )
                )
            ).scalar_one()
            # A start page can answer 403 to the crawler's one spelling of it while the site
            # serves hundreds of pages (eventussecurity.com did): only a crawl that was served
            # next to nothing is a blocked one.
            if served < BLOCKED_SERVED_MIN:
                await _fail(db, run, code="site_blocked", message=_BLOCKED_MESSAGE)
                return True
        await _checkpoint(
            db,
            run,
            ingest_phase="non_indexable",
            ingest_token=None,
            ingest_offset=0,
            start_url_id=start_id,
        )
        return True


async def _non_indexable(
    sessions: async_sessionmaker[AsyncSession],
    on_page: OnPageApi,
    store: ObjectStore | None,
    run: _Run,
) -> bool:
    batch = await on_page.non_indexable(run.provider_task_id, offset=run.offset)
    if batch.total > _listing_bound(run) or run.offset + len(batch.items) > _listing_bound(run):
        raise IngestLoopError("the provider's list of non-indexable pages does not end")
    by_reason: dict[str, list[CanonicalUrl]] = {}
    for item in batch.items:
        url = _canonical(item.url)
        if url is not None and item.reason in _REASONS:
            by_reason.setdefault(item.reason, []).append(url)
    offset = run.offset + len(batch.items)
    async with sessions() as db, db.begin():
        if not await _claim(db, run):
            return False
        ids = await _url_ids(db, (url for found in by_reason.values() for url in found))
        for reason, found in by_reason.items():
            await db.execute(
                update(crawl_pages)
                .where(
                    crawl_pages.c.run_id == run.id,
                    crawl_pages.c.url_id.in_([ids[url.url_hash] for url in found]),
                )
                .values(is_indexable=False, non_indexable_reason=reason)
            )
        done = not batch.items or offset >= batch.total
        await _checkpoint(
            db, run, ingest_offset=offset, ingest_phase="links" if done else "non_indexable"
        )
        return True


def _as_found(link: LinkItem) -> FoundLink:
    """A link the provider found, for a page whose HTML is missing: its placement is unknown and
    taken as content (spec section 9)."""
    return FoundLink(
        href=link.link_to,
        anchor=link.anchor,
        kind=link.kind,
        rel=frozenset() if link.dofollow else frozenset({"nofollow"}),
        placement=Placement.CONTENT,
        container="",
        open=False,
    )


async def _read_page(
    on_page: OnPageApi,
    store: ObjectStore | None,
    run: _Run,
    hosts: frozenset[str],
    page_row: tuple[int, str, str, bytes],
) -> _PageLinks:
    """One page's edges: its raw HTML is kept and classified, or, with no HTML, the provider's
    links stand in. The parsing runs in a thread so that a page of megabytes does not hold up
    the worker's other jobs."""
    url_id, crawled_url, canonical_url, url_hash = page_row
    html: str | None = None
    html_canonical: CanonicalUrl | None = None
    try:
        html = await on_page.raw_html(run.provider_task_id, crawled_url)
    except ProviderCallError as failure:
        if failure.error.kind in _TRANSIENT_KINDS:
            raise
        # One page the provider cannot give is not the crawl's end: its links stand in.
        _log.warning(
            "crawl page html not read",
            run_id=str(run.id),
            url_id=url_id,
            kind=failure.error.kind.value,
        )
    if html is not None:
        if store is not None:
            packed = await asyncio.to_thread(compress, html.encode())
            await store.put(html_key(run.project_id, url_hash), packed)
        links = await asyncio.to_thread(classify, html, crawled_url)
        state = "from_html"
        # The provider's pages listing does not carry the canonical; the HTML does.
        html_canonical = _canonical(await asyncio.to_thread(canonical_of, html, crawled_url))
    else:
        try:
            provided = await on_page.links_from(run.provider_task_id, crawled_url)
        except ProviderCallError as failure:
            if failure.error.kind in _TRANSIENT_KINDS:
                raise
            _log.warning(
                "crawl page links not read",
                run_id=str(run.id),
                url_id=url_id,
                kind=failure.error.kind.value,
            )
            return _PageLinks(url_id=url_id, state="none", edges=[], capped=False)
        # The provider has no limit on a page's links; this is the most that can become edges.
        links = [_as_found(link) for link in provided[: 4 * EDGES_PER_PAGE_MAX]]
        state = "from_provider"
    edges, capped = await asyncio.to_thread(_edges_of, links, canonicalize(canonical_url), hosts)
    return _PageLinks(
        url_id=url_id, state=state, edges=edges, capped=capped, canonical=html_canonical
    )


def _edges_of(
    links: Sequence[FoundLink], page: CanonicalUrl, hosts: frozenset[str]
) -> tuple[list[PageEdge], bool]:
    """The page's capped edges, from the links whose address the database can hold."""
    return capped_edges([link for link in links if is_clean(link.href)], page=page, hosts=hosts)


async def _store_html_canonical(
    db: AsyncSession, run: _Run, url_id: int, canonical_id: int
) -> None:
    """The canonical a page's HTML names, for a page the provider gave none (the provider's
    stands). It makes the page non-indexable as the provider's does, and keeps a reason the
    non-indexable step already gave."""
    rule: dict[str, object] = {}
    if _elsewhere(url_id, canonical_id):
        rule = {
            "is_indexable": False,
            "non_indexable_reason": func.coalesce(crawl_pages.c.non_indexable_reason, "canonical"),
        }
    await db.execute(
        update(crawl_pages)
        .where(
            crawl_pages.c.run_id == run.id,
            crawl_pages.c.workspace_id == run.workspace_id,
            crawl_pages.c.url_id == url_id,
            crawl_pages.c.canonical_url_id.is_(None),
        )
        .values(canonical_url_id=canonical_id, **rule)
    )


async def _links(
    sessions: async_sessionmaker[AsyncSession],
    on_page: OnPageApi,
    store: ObjectStore | None,
    run: _Run,
) -> bool:
    if run.links_stored >= LINKS_PER_CRAWL_MAX:
        # The crawl holds as many links as it may: the pages still waiting get none, and the
        # crawl goes on to its metrics with what it has. There is no column to say so on the
        # crawl, so the log is the record.
        async with sessions() as db, db.begin():
            if not await _claim(db, run):
                return False
            left = await db.execute(
                update(crawl_pages)
                .where(
                    crawl_pages.c.run_id == run.id,
                    crawl_pages.c.workspace_id == run.workspace_id,
                    crawl_pages.c.links_state == "waiting",
                )
                .values(links_state="none")
                .returning(crawl_pages.c.url_id)
            )
            _log.warning(
                "crawl links cap reached",
                run_id=str(run.id),
                links_stored=run.links_stored,
                pages_without_links=len(left.all()),
            )
            await _checkpoint(db, run, ingest_phase="template")
        return True
    hosts = site_hosts(run.target_host, run.allowed_subdomains)
    async with sessions() as db:
        waiting = (
            await db.execute(
                select(
                    crawl_pages.c.url_id,
                    crawl_pages.c.crawled_url,
                    urls.c.canonical_url,
                    urls.c.url_hash,
                )
                .join(urls, urls.c.id == crawl_pages.c.url_id)
                .where(
                    crawl_pages.c.run_id == run.id,
                    crawl_pages.c.workspace_id == run.workspace_id,
                    crawl_pages.c.links_state == "waiting",
                )
                .order_by(crawl_pages.c.url_id)
                .limit(HTML_PAGES_PER_STEP)
            )
        ).all()
    if not waiting:
        async with sessions() as db, db.begin():
            if not await _claim(db, run):
                return False
            await _checkpoint(db, run, ingest_phase="template")
        return True
    found: list[_PageLinks] = []
    held = 0
    for page in waiting:
        read = await _read_page(
            on_page,
            store,
            run,
            hosts,
            (page.url_id, page.crawled_url, page.canonical_url, page.url_hash),
        )
        found.append(read)
        held += len(read.edges)
        if held >= STEP_EDGES_MAX:
            break
    async with sessions() as db, db.begin():
        if not await _claim(db, run):
            return False
        ids = await _url_ids(
            db,
            [edge.target for read in found for edge in read.edges]
            + [read.canonical for read in found if read.canonical is not None],
        )
        stored = 0
        for read in found:
            # A page is written once: only the step that moves it out of `waiting` stores it.
            moved = (
                await db.execute(
                    update(crawl_pages)
                    .where(
                        crawl_pages.c.run_id == run.id,
                        crawl_pages.c.workspace_id == run.workspace_id,
                        crawl_pages.c.url_id == read.url_id,
                        crawl_pages.c.links_state == "waiting",
                    )
                    .values(links_state=read.state)
                    .returning(crawl_pages.c.url_id)
                )
            ).scalar_one_or_none()
            if moved is None:
                continue
            if read.canonical is not None:
                await _store_html_canonical(db, run, read.url_id, ids[read.canonical.url_hash])
            if read.capped:
                _log.warning(
                    "crawl page links cut",
                    run_id=str(run.id),
                    url_id=read.url_id,
                    kept=EDGES_PER_PAGE_MAX,
                )
            rows = [
                {
                    "run_id": run.id,
                    "workspace_id": run.workspace_id,
                    "source_url_id": read.url_id,
                    "target_url_id": ids[edge.target.url_hash],
                    "anchor": edge.anchor,
                    "kind": edge.kind,
                    "placement": edge.placement,
                    "scope": edge.scope.value,
                    "rel": list(edge.rel),
                    "is_followed": edge.followed,
                    "occurrences": edge.occurrences,
                    "container_hash": edge.container_hash,
                    "template_candidate": edge.template_candidate,
                }
                for edge in read.edges
            ]
            for start in range(0, len(rows), _LINK_ROWS_PER_STATEMENT):
                await db.execute(
                    insert(crawl_links).values(rows[start : start + _LINK_ROWS_PER_STATEMENT])
                )
            stored += len(rows)
        await _checkpoint(db, run, links_stored=crawl_runs.c.links_stored + stored)
        return True


async def _template(
    sessions: async_sessionmaker[AsyncSession],
    on_page: OnPageApi,
    store: ObjectStore | None,
    run: _Run,
) -> bool:
    # Read, work out, write: the pass itself takes time in Python, and a transaction left
    # waiting on it would be idle (the server ends one that is idle for 60 seconds) and would
    # hold the run row the whole time.
    async with sessions() as db, db.begin():
        await _long_transaction(db)
        if not await _claim(db, run):
            return False
        source = aliased(urls)
        target = aliased(urls)
        rows = (
            await db.execute(
                select(
                    crawl_links.c.id,
                    source.c.canonical_url.label("source_url"),
                    target.c.canonical_url.label("target_url"),
                    crawl_links.c.container_hash,
                    crawl_links.c.placement,
                )
                .join(source, source.c.id == crawl_links.c.source_url_id)
                .join(target, target.c.id == crawl_links.c.target_url_id)
                .where(
                    crawl_links.c.run_id == run.id,
                    crawl_links.c.workspace_id == run.workspace_id,
                    crawl_links.c.template_candidate,
                    crawl_links.c.container_hash.is_not(None),
                )
                .order_by(crawl_links.c.source_url_id, crawl_links.c.id)
            )
        ).all()
        pages: list[str] = list(
            (
                await db.execute(
                    select(urls.c.canonical_url)
                    .join(crawl_pages, crawl_pages.c.url_id == urls.c.id)
                    .where(
                        crawl_pages.c.run_id == run.id,
                        crawl_pages.c.workspace_id == run.workspace_id,
                        crawl_pages.c.links_state == "from_html",
                    )
                )
            ).scalars()
        )
    template_rows = [
        TemplateRow(
            link_id=row.id,
            source_url=row.source_url,
            target_url=row.target_url,
            container=row.container_hash,
            placement=row.placement,
        )
        for row in rows
    ]
    del rows
    # A stored placement that is none raises `ValueError`: the step fails, and is not
    # swallowed here, so a corrupt row is never read as editorial.
    changes = await asyncio.to_thread(template_placements, template_rows, pages)
    async with sessions() as db, db.begin():
        await _long_transaction(db)
        if not await _claim(db, run):
            return False
        if changes:
            await db.execute(
                update(crawl_links)
                .where(
                    crawl_links.c.run_id == run.id,
                    crawl_links.c.workspace_id == run.workspace_id,
                    crawl_links.c.id == bindparam("b_id"),
                )
                .values(placement=bindparam("b_placement"), scope=bindparam("b_scope")),
                [
                    {
                        "b_id": link_id,
                        "b_placement": placement,
                        "b_scope": scope_of(placement).value,
                    }
                    for link_id, placement in changes.items()
                ],
            )
        await _checkpoint(db, run, ingest_phase="metrics")
        return True


_INCOMING = text(
    """
    UPDATE seo.crawl_pages p SET
        linking_pages_editorial = c.editorial, linking_pages_auto = c.auto,
        linking_pages_template = c.template, linking_pages_all = c.every
    FROM (SELECT target_url_id AS url_id,
                 count(DISTINCT source_url_id) FILTER (WHERE scope = 'editorial') AS editorial,
                 count(DISTINCT source_url_id) FILTER (WHERE scope = 'auto_generated') AS auto,
                 count(DISTINCT source_url_id) FILTER (WHERE scope = 'template') AS template,
                 count(DISTINCT source_url_id) AS every
          FROM seo.crawl_links WHERE run_id = :run_id GROUP BY target_url_id) c
    WHERE p.run_id = :run_id AND p.url_id = c.url_id
    """
)
_OUTGOING = text(
    """
    UPDATE seo.crawl_pages p SET
        outlinks_editorial = c.editorial, outlinks_auto = c.auto, outlinks_template = c.template,
        outlinks_all = c.every, broken_outlinks = c.broken, redirect_outlinks = c.redirect,
        non_indexable_outlinks = c.non_indexable
    FROM (SELECT l.source_url_id AS url_id,
                 count(DISTINCT l.target_url_id) FILTER (WHERE l.scope = 'editorial') AS editorial,
                 count(DISTINCT l.target_url_id) FILTER (WHERE l.scope = 'auto_generated') AS auto,
                 count(DISTINCT l.target_url_id) FILTER (WHERE l.scope = 'template') AS template,
                 count(DISTINCT l.target_url_id) AS every,
                 count(DISTINCT l.target_url_id)
                     FILTER (WHERE t.status_code >= 400
                             AND t.status_code <> ALL(CAST(:blocked AS integer[]))) AS broken,
                 count(DISTINCT l.target_url_id)
                     FILTER (WHERE t.status_code BETWEEN 300 AND 399) AS redirect,
                 count(DISTINCT l.target_url_id) FILTER (WHERE NOT t.is_indexable) AS non_indexable
          FROM seo.crawl_links l
          LEFT JOIN seo.crawl_pages t ON t.run_id = l.run_id AND t.url_id = l.target_url_id
          WHERE l.run_id = :run_id GROUP BY l.source_url_id) c
    WHERE p.run_id = :run_id AND p.url_id = c.url_id
    """
)
_TOP_ANCHOR = text(
    """
    UPDATE seo.crawl_pages p SET top_anchor = a.anchor
    FROM (SELECT DISTINCT ON (target_url_id) target_url_id, anchor
          FROM (SELECT target_url_id, anchor, sum(occurrences) AS uses
                FROM seo.crawl_links
                WHERE run_id = :run_id AND scope = 'editorial' AND anchor <> ''
                GROUP BY target_url_id, anchor) counted
          ORDER BY target_url_id, uses DESC, anchor) a
    WHERE p.run_id = :run_id AND p.url_id = a.target_url_id
    """
)
_FLAGS = text(
    """
    UPDATE seo.crawl_pages SET
        is_orphan = in_sitemap AND linking_pages_all = 0 AND url_id IS DISTINCT FROM :start,
        is_editorial_orphan = coalesce(status_code = 200, false) AND linking_pages_all > 0
            AND linking_pages_editorial = 0 AND url_id IS DISTINCT FROM :start
    WHERE run_id = :run_id
    """
)
_SUMMARY = text(
    """
    SELECT count(*) FILTER (WHERE in_sitemap) AS sitemap_pages,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY equity_share)
               FILTER (WHERE status_code = 200) AS equity_p25
    FROM seo.crawl_pages WHERE run_id = :run_id
    """
)


def _walked_links(run: _Run, nodes: dict[int, Node], links: list[Link]) -> list[Link]:
    """The links the depth walk follows: the stored ones, and, when the start page was not
    served, the site's template links as its own. Those are for the walk only: they are never
    stored, counted or ranked."""
    if run.start_url_id is None:
        return links
    roots = template_roots(run.start_url_id, nodes, links)
    if not roots:
        return links
    _log.info(
        "crawl start page unreadable, depth from template links",
        run_id=str(run.id),
        roots=len(roots),
    )
    return [*links, *(Link(run.start_url_id, root, LinkScope.TEMPLATE, True) for root in roots)]


def _page_values(
    nodes: dict[int, Node], links: list[Link], run: _Run
) -> tuple[list[dict[str, object]], float]:
    """Depth and equity of every page, and the share of equity the error pages hold. Pure
    work, run in a thread."""
    start = run.start_url_id
    walked = _walked_links(run, nodes, links)
    depths = {} if start is None else click_depths(start, nodes, walked)
    without = {} if start is None else click_depths(start, nodes, walked, without_auto=True)
    equity = pagerank(nodes, links)
    # Shares of the crawled pages only (spec 6.4): links to pages past the ceiling hold some
    # value, which is not shown.
    total = sum(equity.shares.get(url_id, 0.0) for url_id in nodes) or 1.0
    values: list[dict[str, object]] = [
        {
            "b_url": url_id,
            "b_depth": depths.get(url_id),
            "b_without": without.get(url_id),
            "b_share": equity.shares.get(url_id, 0.0) / total,
            "b_deep": deep_only_through_auto(depths.get(url_id), without.get(url_id)),
        }
        for url_id in nodes
    ]
    lost = sum(equity.shares.get(url_id, 0.0) for url_id, node in nodes.items() if node.is_error)
    return values, lost / total


async def _page_metrics(sessions: async_sessionmaker[AsyncSession], run: _Run) -> bool:
    """Counts, flags, depth and equity of every page, written to the pages. The crawl is still
    `processing`, so nothing here is shown yet, and the statements can be run again. The SQL
    counts and the reading of the graph are one transaction, the depth and PageRank work is
    done between transactions (see `_template`), and the results are written in a second.

    Memory. Depth and PageRank need the whole graph, so every node and link of the crawl is held
    at once; `LINKS_PER_CRAWL_MAX` is the bound. Measured with tracemalloc on 100,000 pages and
    300,000 links: the rows read take 51 MB (as tuples; SQLAlchemy rows are larger) and are
    freed once the node and link objects exist (33 MB), and the peak while the work runs is
    176 MB, about 600 bytes a link. At the cap of 1,000,000 links that is about 600 MB, so the
    cap bounds the step and does not make it small: one ingest runs at a time in a worker."""
    async with sessions() as db, db.begin():
        await _long_transaction(db)
        if not await _claim(db, run):
            return False
        for statement in (_INCOMING, _TOP_ANCHOR):
            await db.execute(statement, {"run_id": run.id})
        await db.execute(_OUTGOING, {"run_id": run.id, "blocked": sorted(BLOCKED_STATUSES)})
        await db.execute(_FLAGS, {"run_id": run.id, "start": run.start_url_id})
        node_rows = (
            await db.execute(
                select(
                    crawl_pages.c.url_id, crawl_pages.c.status_code, crawl_pages.c.redirect_url_id
                ).where(crawl_pages.c.run_id == run.id)
            )
        ).all()
        link_rows = (
            await db.execute(
                select(
                    crawl_links.c.source_url_id,
                    crawl_links.c.target_url_id,
                    crawl_links.c.scope,
                    crawl_links.c.is_followed,
                ).where(crawl_links.c.run_id == run.id)
            )
        ).all()
    nodes = {
        row.url_id: Node(row.url_id, row.status_code, row.redirect_url_id) for row in node_rows
    }
    links = [
        Link(row.source_url_id, row.target_url_id, LinkScope(row.scope), row.is_followed)
        for row in link_rows
    ]
    del node_rows, link_rows
    values, lost = await asyncio.to_thread(_page_values, nodes, links, run)
    async with sessions() as db, db.begin():
        await _long_transaction(db)
        if not await _claim(db, run):
            return False
        if values:
            await db.execute(
                update(crawl_pages)
                .where(crawl_pages.c.run_id == run.id, crawl_pages.c.url_id == bindparam("b_url"))
                .values(
                    click_depth=bindparam("b_depth"),
                    depth_without_auto=bindparam("b_without"),
                    equity_share=bindparam("b_share"),
                    deep_only_through_auto=bindparam("b_deep"),
                ),
                values,
            )
        await db.execute(
            update(crawl_runs)
            .where(crawl_runs.c.workspace_id == run.workspace_id, crawl_runs.c.id == run.id)
            .values(equity_lost_to_errors=lost)
        )
    return True


async def _metrics(
    sessions: async_sessionmaker[AsyncSession],
    on_page: OnPageApi,
    store: ObjectStore | None,
    run: _Run,
) -> bool:
    if not await _page_metrics(sessions, run):
        return False
    # The metrics took their time; the project lock is held only for the end, which is short.
    async with sessions() as db, db.begin():
        await _long_transaction(db)
        # The API takes the project row first and then a crawl; the same order here, so the
        # two cannot wait on each other.
        await db.execute(
            select(projects.c.id)
            .where(projects.c.workspace_id == run.workspace_id, projects.c.id == run.project_id)
            .with_for_update(of=projects, key_share=True)
        )
        if not await _claim(db, run):
            return False
        summary = (await db.execute(_SUMMARY, {"run_id": run.id})).one()
        flipped: UUID | None = (
            await db.execute(
                update(crawl_runs)
                .where(
                    crawl_runs.c.workspace_id == run.workspace_id,
                    crawl_runs.c.id == run.id,
                    crawl_runs.c.state == "processing",
                    crawl_runs.c.ingest_phase == "metrics",
                )
                .values(
                    state="stopped_at_ceiling" if run.stop_reason == "limit_exceeded" else "ready",
                    ingest_phase="done",
                    ingest_failures=0,
                    finished_at=func.now(),
                    sitemap_pages=summary.sitemap_pages,
                    equity_p25=summary.equity_p25,
                )
                .returning(crawl_runs.c.id)
            )
        ).scalar_one_or_none()
        if flipped is None:
            return False
        # The crawl is the latest from here on, in this transaction: rules and flow follow it,
        # and all three commit together or not at all.
        await apply_rules(db, workspace_id=run.workspace_id, project_id=run.project_id)
        await recompute_tier_flow(db, workspace_id=run.workspace_id, run_id=run.id)
        return True


_STEPS: Final[dict[str, Step]] = {
    "pages": _pages,
    "non_indexable": _non_indexable,
    "links": _links,
    "template": _template,
    "metrics": _metrics,
}


async def _failed_pass(sessions: async_sessionmaker[AsyncSession], run: _Run) -> None:
    """Count a failed pass, and end the crawl at the fifth in a row. Only a crawl still at the
    phase that failed is touched."""
    failures = crawl_runs.c.ingest_failures + 1
    over = failures >= INGEST_FAILURES_MAX
    async with sessions() as db, db.begin():
        await db.execute(
            update(crawl_runs)
            .where(
                crawl_runs.c.workspace_id == run.workspace_id,
                crawl_runs.c.id == run.id,
                crawl_runs.c.state == "processing",
                crawl_runs.c.ingest_phase == run.phase,
            )
            .values(
                ingest_failures=failures,
                state=case((over, "failed"), else_=crawl_runs.c.state),
                error_code=case((over, "ingest_failed"), else_=crawl_runs.c.error_code),
                error_message=case(
                    (over, literal(_FAILED_MESSAGE)), else_=crawl_runs.c.error_message
                ),
                finished_at=case((over, func.now()), else_=crawl_runs.c.finished_at),
            )
        )


@asynccontextmanager
async def _pass_lock(
    sessions: async_sessionmaker[AsyncSession], run_id: UUID
) -> AsyncIterator[bool]:
    """Whether this pass holds the crawl's advisory lock, kept for as long as the block runs on
    a connection of its own (the lock belongs to the connection, so that one is not used for
    anything else and runs without a transaction)."""
    key = func.hashtextextended(literal(f"{INGEST_JOB}:{run_id}"), 0)
    async with sessions() as db:
        connection = await db.connection(execution_options={"isolation_level": "AUTOCOMMIT"})
        held = bool((await connection.execute(select(func.pg_try_advisory_lock(key)))).scalar_one())
        try:
            yield held
        finally:
            if held:
                released = False
                try:
                    await connection.execute(select(func.pg_advisory_unlock(key)))
                    released = True
                except Exception as failure:
                    _log.error("crawl lock not released", error=type(failure).__name__)
                finally:
                    # A connection that is dropped frees its locks; one that goes back to the
                    # pool still holding this one would block the crawl for good, so whenever
                    # the unlock did not verifiably happen (an error, or this task cancelled
                    # while unlocking) the connection is dropped, and the drop is shielded.
                    if not released:
                        await asyncio.shield(connection.invalidate())


async def ingest_run(
    sessions: async_sessionmaker[AsyncSession],
    on_page: OnPageApi,
    store: ObjectStore | None,
    task: CrawlIngestTask,
    *,
    deadline: float,
) -> IngestOutcome:
    """One pass: steps until the crawl is done or `deadline` (`time.monotonic()`) has passed;
    at least one step is taken. It only reads from the provider: nothing here posts a crawl or
    spends."""
    async with _pass_lock(sessions, task.run_id) as held:
        if not held:
            return IngestOutcome(phase=None, steps=0, busy=True)
        steps = 0
        while True:
            run = await _read_run(sessions, task)
            if run is None or run.state != "processing" or run.phase not in _STEPS:
                return IngestOutcome(phase=None if run is None else run.phase, steps=steps)
            try:
                applied = await _STEPS[run.phase](sessions, on_page, store, run)
            except Exception as failure:
                # Retried by the next pass; a bug fails the crawl after five, it never loops.
                # The class, and the provider's error kind or the database's SQLSTATE: the
                # message may hold an address or markup of the site.
                _log.error(
                    "crawl ingest step failed",
                    run_id=str(run.id),
                    phase=run.phase,
                    error=type(failure).__name__,
                    **_failure_detail(failure),
                )
                if not _transient(failure, run):
                    await _failed_pass(sessions, run)
                return IngestOutcome(phase=run.phase, steps=steps, failed=True)
            if not applied:
                # Overtaken: the crawl moved or ended while the step read. The next pass looks.
                return IngestOutcome(phase=run.phase, steps=steps)
            steps += 1
            if time.monotonic() >= deadline:
                return IngestOutcome(phase=run.phase, steps=steps)
