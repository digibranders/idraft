"""Crawls of a project's site (spec 6.1, 6.2 and 9; plan decisions D3 to D6, D8 and D13).

A crawl moves `queued`, `crawling`, `processing`, then `ready` or `stopped_at_ceiling`; it can
end `failed` or `cancelled` on the way. One tick, under the worker's lock, takes each step once,
each run in its own transaction so one run never holds up another:

1. queue the scheduled crawls that are due (`idraft.crawl.schedule.crawl_due`);
2. post queued crawls: the budget first; a post that may have reached the provider is never
   sent again;
3. read the summary of the crawls under way, and stop the ones a person cancelled;
4. hand finished crawls to the ingest job, again on every tick while they process (the queue
   drops a message that is already waiting);
5. recompute the tier flows marked stale;
6. drop the link partitions of all but the last four finished crawls of each project.

Every statement names the workspace or the run: the worker bypasses row-level security.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Final, Literal
from uuid import UUID

import structlog
from pydantic import BaseModel
from sqlalchemy import ColumnElement, Row, and_, exists, func, insert, or_, select, text, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors import budget
from idraft.collectors.crawl_enrich import CrawlEnrichTask
from idraft.collectors.crawl_store import ACTIVE_STATES, DATA_STATES, recompute_tier_flow
from idraft.crawl.ceiling import crawl_ceiling, retry_ceiling
from idraft.crawl.hosts import is_site_host
from idraft.crawl.schedule import CrawlSchedule, crawl_due
from idraft.db.tables import (
    crawl_runs,
    domains,
    projects,
    provider_cost_events,
    provider_price_book,
    workspaces,
)
from idraft.domain.retries import ProviderErrorKind
from idraft.domain.workloads import CostWorkload, cost_channel
from idraft.providers.contract import ProviderCallError
from idraft.providers.dataforseo.on_page import TASK_POST, CrawlOrder, OnPageApi

TICK_LIMIT: Final = 50
KEEP_RUNS: Final = 4
# A crawl with JavaScript off that found this few pages suggests turning it on (spec 9).
FEW_PAGES: Final = 3
INGEST_JOB: Final = "crawl_ingest"
QUEUE_ATTEMPTS: Final = 3
# A post begun this recently may still be in flight in another tick (a tick that outlived its
# lock): it is left alone. A crawl marked sent for longer has an outcome that was never written.
POST_GRACE: Final = timedelta(minutes=10)
# A tick takes no new post after this many seconds. The check runs between posts, and one post
# can take about two minutes (the client's timeouts), so a tick can still outlive its lock: the
# grace above is what makes that safe.
POST_BUDGET: Final = 30.0
# A crawl that waited this long to be sent (the crawls were switched off, or the provider was
# out) is cancelled, not sent late: a pile of them must not all be paid for on the day crawls
# come back.
QUEUED_MAX_AGE: Final = timedelta(days=3)
_BLOCKED: Final = frozenset({"forbidden_robots", "forbidden_meta_tag", "forbidden_http_header"})
_UNREACHABLE: Final = frozenset(
    {"site_unreachable", "invalid_page_status_code", "too_many_redirects"}
)
# Kinds after which the post certainly did not reach the provider: try again next tick.
_NOT_SENT: Final = frozenset({ProviderErrorKind.NOT_SENT, ProviderErrorKind.RATE_LIMITED})
_MESSAGES: Final = {
    "budget_exceeded": "A budget for site crawls would be passed.",
    "submit_unknown": "The crawl may have been sent; it is not sent again.",
    "site_blocked": "The site refuses the crawler (robots.txt, a meta tag or a header).",
    "site_unreachable": "The site could not be reached.",
    "no_estimate": "The crawl has no cost estimate.",
    "site_gone": "The project or its website changed before the crawl was sent.",
    "too_old": "The crawl waited too long to be sent.",
}
Trigger = Literal["website_added", "schedule", "manual", "ceiling_retry"]
K = ProviderErrorKind
_log = structlog.get_logger(__name__)


class CrawlIngestTask(BaseModel):
    """The message of the `crawl_ingest` job: one finished crawl."""

    workspace_id: UUID
    run_id: UUID

    @property
    def dedupe_key(self) -> str:
        return f"{INGEST_JOB}:{self.run_id}"


type SendIngest = Callable[[CrawlIngestTask], Awaitable[bool]]
type SendEnrich = Callable[[CrawlEnrichTask], Awaitable[bool]]


def _failed(step: str, subject_id: UUID, failure: Exception) -> None:
    """One unexpected failure of one project's or crawl's step: the class only, as the message
    may hold data of the site or its owner."""
    _log.error(
        "crawl step failed", step=step, subject_id=str(subject_id), error=type(failure).__name__
    )


@contextmanager
def _isolated(step: str, subject_id: UUID) -> Iterator[None]:
    """An unexpected failure inside is logged and left behind, so one project or crawl never
    stops the rest of the tick. The work stays as it was and is tried again on the next tick."""
    try:
        yield
    except Exception as failure:
        _failed(step, subject_id, failure)


class CrawlBusyError(Exception):
    def __init__(self, run_id: UUID) -> None:
        super().__init__(f"crawl {run_id} is under way")
        self.run_id = run_id


class NoSiteError(Exception):
    """The project has no website, or is gone."""


class NoStoppedCrawlError(Exception):
    """A higher limit was asked for, and the latest crawl did not stop at its ceiling."""


class CrawlSlotError(Exception):
    """The project's crawl slot kept changing hands while a crawl was queued: the insert
    conflicted with a crawl that had ended by the time it was read, three times running."""


@dataclass(frozen=True, slots=True)
class LinkSettings:
    schedule: CrawlSchedule
    render_javascript: bool
    allowed_subdomains: tuple[str, ...]


def link_settings(stored: Mapping[str, Any] | None) -> LinkSettings:
    """The project's `internal_links` settings with their defaults (spec 7.8)."""
    part = (stored or {}).get("internal_links") or {}
    return LinkSettings(
        schedule=CrawlSchedule(part.get("schedule", CrawlSchedule.WEEKLY)),
        render_javascript=bool(part.get("render_javascript", False)),
        allowed_subdomains=tuple(part.get("allowed_subdomains", ())),
    )


@dataclass(frozen=True, slots=True)
class CrawlTickReport:
    queued: int = 0
    posted: int = 0
    failed: int = 0
    progressed: int = 0
    finished: int = 0
    cancelled: int = 0
    ingest_sent: int = 0
    flows: int = 0
    enrich_sent: int = 0
    dropped: int = 0

    @property
    def quiet(self) -> bool:
        return self == CrawlTickReport()


async def crawl_price(db: AsyncSession, *, javascript: bool, on: date) -> Decimal:
    book = provider_price_book
    price: Decimal | None = (
        await db.execute(
            select(book.c.unit_price_usd)
            .where(
                book.c.provider_code == "dataforseo",
                book.c.endpoint == TASK_POST,
                book.c.price_unit == "page",
                book.c.conditions["javascript"].as_boolean().is_(javascript),
                book.c.valid_from <= on,
                or_(book.c.valid_to.is_(None), book.c.valid_to > on),
            )
            .order_by(book.c.valid_from.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if price is None:
        raise LookupError("the price book has no On-Page price")
    return Decimal(price)


async def queue_run(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    project_id: UUID,
    trigger: Trigger,
    requested_by: UUID | None,
    now: datetime,
) -> UUID:
    """A queued crawl of the project's website with its settings, ceiling and estimate."""
    site = (
        await db.execute(
            select(projects.c.settings, domains.c.host)
            .join(domains, domains.c.id == projects.c.primary_domain_id)
            .where(
                projects.c.workspace_id == workspace_id,
                projects.c.id == project_id,
                projects.c.deleted_at.is_(None),
            )
        )
    ).one_or_none()
    if site is None:
        raise NoSiteError
    settings = link_settings(site.settings)
    previous = (
        await db.execute(
            select(crawl_runs.c.state, crawl_runs.c.ceiling, crawl_runs.c.sitemap_pages)
            .where(
                crawl_runs.c.workspace_id == workspace_id,
                crawl_runs.c.project_id == project_id,
                crawl_runs.c.state.in_(DATA_STATES),
            )
            .order_by(crawl_runs.c.created_at.desc(), crawl_runs.c.id.desc())
            .limit(1)
        )
    ).one_or_none()
    if trigger == "ceiling_retry":
        if previous is None or previous.state != "stopped_at_ceiling":
            raise NoStoppedCrawlError
        ceiling = retry_ceiling(previous.ceiling, previous.sitemap_pages)
    else:
        ceiling = crawl_ceiling(None if previous is None else previous.sitemap_pages)
    price = await crawl_price(db, javascript=settings.render_javascript, on=now.date())
    insert_run = (
        upsert(crawl_runs)
        .values(
            workspace_id=workspace_id,
            project_id=project_id,
            trigger=trigger,
            target_host=site.host,
            settings={
                "render_javascript": settings.render_javascript,
                # The primary domain may have changed since the subdomains were saved.
                "allowed_subdomains": [
                    name for name in settings.allowed_subdomains if is_site_host(site.host, name)
                ],
                "schedule": settings.schedule.value,
            },
            ceiling=ceiling,
            estimated_cost_usd=price * ceiling,
            requested_by=requested_by,
        )
        .on_conflict_do_nothing(
            index_elements=[crawl_runs.c.project_id],
            index_where=crawl_runs.c.state.in_(ACTIVE_STATES),
        )
        .returning(crawl_runs.c.id)
    )
    # Cancel and the worker end a crawl without the project lock, so the crawl that made the
    # insert conflict can be gone when it is read: the slot is free, and the insert is repeated.
    for _ in range(QUEUE_ATTEMPTS):
        run_id: UUID | None = (await db.execute(insert_run)).scalar_one_or_none()
        if run_id is not None:
            return run_id
        active: UUID | None = (
            await db.execute(
                select(crawl_runs.c.id).where(
                    crawl_runs.c.workspace_id == workspace_id,
                    crawl_runs.c.project_id == project_id,
                    crawl_runs.c.state.in_(ACTIVE_STATES),
                )
            )
        ).scalar_one_or_none()
        if active is not None:
            raise CrawlBusyError(active)
    raise CrawlSlotError(f"no crawl slot for project {project_id} after {QUEUE_ATTEMPTS} tries")


async def _finish(
    db: AsyncSession,
    run: Row[Any],
    state: str,
    *,
    now: datetime,
    error_code: str | None = None,
    message: str | None = None,
) -> bool:
    """End a crawl that is still under way. A crawl already in an end state (cancelled by a
    person, failed by another tick) is left as it is; False says so."""
    ended: UUID | None = (
        await db.execute(
            update(crawl_runs)
            .where(
                crawl_runs.c.workspace_id == run.workspace_id,
                crawl_runs.c.id == run.id,
                crawl_runs.c.state.in_(ACTIVE_STATES),
            )
            .values(
                state=state,
                error_code=error_code,
                error_message=None if message is None else message[:500],
                finished_at=now,
            )
            .returning(crawl_runs.c.id)
        )
    ).scalar_one_or_none()
    return ended is not None


async def _queue_scheduled(sessions: async_sessionmaker[AsyncSession], now: datetime) -> int:
    started = (
        select(crawl_runs.c.project_id, func.max(crawl_runs.c.created_at).label("last"))
        .group_by(crawl_runs.c.project_id)
        .subquery()
    )
    under_way = exists().where(
        crawl_runs.c.project_id == projects.c.id, crawl_runs.c.state.in_(ACTIVE_STATES)
    )
    # shortcut: reads every project with a website each minute; page it when there are
    # tens of thousands of projects.
    async with sessions() as db, db.begin():
        rows = (
            await db.execute(
                select(
                    projects.c.id,
                    projects.c.workspace_id,
                    projects.c.timezone,
                    projects.c.settings,
                    started.c.last,
                )
                .join(workspaces, workspaces.c.id == projects.c.workspace_id)
                .outerjoin(started, started.c.project_id == projects.c.id)
                .where(
                    projects.c.status == "active",
                    projects.c.deleted_at.is_(None),
                    workspaces.c.status == "active",
                    projects.c.primary_domain_id.is_not(None),
                    ~under_way,
                )
            )
        ).all()
    queued = 0
    for row in rows:
        if queued == TICK_LIMIT:
            break
        # A project with a time zone or settings that cannot be read, or no price for its
        # crawl, is left out of this tick and the others go on.
        with _isolated("queue", row.id):
            if not crawl_due(
                schedule=link_settings(row.settings).schedule,
                last_started=row.last,
                timezone=row.timezone,
                project_id=row.id,
                now=now,
            ):
                continue
            try:
                async with sessions() as db, db.begin():
                    await queue_run(
                        db,
                        workspace_id=row.workspace_id,
                        project_id=row.id,
                        trigger="schedule",
                        requested_by=None,
                        now=now,
                    )
            except (CrawlBusyError, NoSiteError):
                continue
            queued += 1
    return queued


# "lost": another tick or a person moved the crawl while its post was in flight.
# "inflight": a post begun a moment ago, in another tick, so it is skipped.
PostOutcome = Literal["posted", "failed", "cancelled", "waiting", "lost", "inflight", "none"]


async def _post_one(
    sessions: async_sessionmaker[AsyncSession],
    on_page: OnPageApi,
    now: datetime,
    seen: set[UUID],
) -> PostOutcome:
    """Post the oldest queued crawl not in `seen`, and add it to `seen` as soon as it is
    chosen, so a crawl that fails again and again is passed over within one tick."""
    async with sessions() as db, db.begin():
        run = (
            await db.execute(
                select(crawl_runs)
                .where(crawl_runs.c.state == "queued", crawl_runs.c.id.not_in(list(seen)))
                .order_by(crawl_runs.c.created_at, crawl_runs.c.id)
                .limit(1)
                .with_for_update(skip_locked=True)
            )
        ).one_or_none()
        if run is None:
            return "none"
        seen.add(run.id)
        if run.cancel_requested:
            await _finish(db, run, "cancelled", now=now)
            return "cancelled"
        if run.submitted_at is not None:
            if run.submitted_at >= now - POST_GRACE:
                # Begun a moment ago, so it is probably in flight in another tick; if it is
                # not, it is failed once it is older than the grace.
                return "inflight"
            # A post was begun and its outcome never written: it may have been charged.
            await _finish(
                db,
                run,
                "failed",
                now=now,
                error_code="submit_unknown",
                message=_MESSAGES["submit_unknown"],
            )
            return "failed"
        if not await _site_is_live(db, run):
            await _finish(db, run, "cancelled", now=now, message=_MESSAGES["site_gone"])
            return "cancelled"
        if run.estimated_cost_usd is None:
            # Without an estimate the budget cannot be judged: stop, never skip it.
            await _finish(
                db,
                run,
                "failed",
                now=now,
                error_code="provider_error",
                message=_MESSAGES["no_estimate"],
            )
            return "failed"
        verdict = await budget.check(
            db,
            workspace_id=run.workspace_id,
            project_id=run.project_id,
            workload=CostWorkload.SITE_CRAWL,
            now=now,
            estimate=run.estimated_cost_usd,
        )
        if not verdict.allowed:
            await _finish(
                db,
                run,
                "failed",
                now=now,
                error_code="budget_exceeded",
                message=_MESSAGES["budget_exceeded"],
            )
            return "failed"
        await db.execute(
            update(crawl_runs)
            .where(crawl_runs.c.workspace_id == run.workspace_id, crawl_runs.c.id == run.id)
            # The database's clock, as every tick reads `submitted_at` against it: a tick
            # running on a clock that is off must not make a begun post look old.
            .values(submitted_at=func.now())
        )
    recorded: dict[str, str] = {}
    try:
        return await _send(sessions, on_page, run, now, recorded)
    except Exception as failure:
        # A post paid for and not recorded is found again only by its task id: keep it.
        _log.error(
            "crawl post failed",
            run_id=str(run.id),
            task_id=recorded.get("task_id"),
            error=type(failure).__name__,
        )
        raise


async def _site_is_live(db: AsyncSession, run: Row[Any]) -> bool:
    """The crawl's project is active and not deleted, its workspace is active, and the project's
    website is still the host the crawl was queued for."""
    site = (
        await db.execute(
            select(
                projects.c.status,
                projects.c.deleted_at,
                workspaces.c.status.label("workspace_status"),
                domains.c.host,
            )
            .select_from(
                projects.join(workspaces, workspaces.c.id == projects.c.workspace_id).outerjoin(
                    domains, domains.c.id == projects.c.primary_domain_id
                )
            )
            .where(projects.c.workspace_id == run.workspace_id, projects.c.id == run.project_id)
        )
    ).one_or_none()
    return (
        site is not None
        and site.deleted_at is None
        and site.status == "active"
        and site.workspace_status == "active"
        and site.host == run.target_host
    )


async def _send(
    sessions: async_sessionmaker[AsyncSession],
    on_page: OnPageApi,
    run: Row[Any],
    now: datetime,
    recorded: dict[str, str],
) -> PostOutcome:
    """Send the crawl `_post_one` chose and record what came of it. `recorded` gets the task id
    as soon as the provider has given one."""
    order = CrawlOrder(
        host=run.target_host,
        max_crawl_pages=run.ceiling,
        enable_javascript=bool(run.settings.get("render_javascript")),
        allowed_subdomains=tuple(run.settings.get("allowed_subdomains", ())),
        tag=str(run.id),
    )
    try:
        posted = await on_page.post(order)
    except ProviderCallError as failure:
        async with sessions() as db, db.begin():
            if failure.error.kind in _NOT_SENT:
                await db.execute(
                    update(crawl_runs)
                    .where(
                        crawl_runs.c.workspace_id == run.workspace_id,
                        crawl_runs.c.id == run.id,
                        crawl_runs.c.state == "queued",
                    )
                    .values(submitted_at=None)
                )
                return "waiting"
            unknown = failure.error.kind is K.TIMEOUT
            ended = await _finish(
                db,
                run,
                "failed",
                now=now,
                error_code="submit_unknown" if unknown else "provider_error",
                message=_MESSAGES["submit_unknown"] if unknown else failure.error.message,
            )
        return "failed" if ended else "lost"
    recorded["task_id"] = posted.task_id
    cost = posted.cost_usd if posted.cost_usd is not None else run.estimated_cost_usd
    async with sessions() as db, db.begin():
        moved: UUID | None = (
            await db.execute(
                update(crawl_runs)
                .where(
                    crawl_runs.c.workspace_id == run.workspace_id,
                    crawl_runs.c.id == run.id,
                    crawl_runs.c.state == "queued",
                )
                .values(state="crawling", provider_task_id=posted.task_id, cost_usd=cost)
                .returning(crawl_runs.c.id)
            )
        ).scalar_one_or_none()
        if moved is None:
            # Cancelled or failed while the post was in flight: the crawl stays as it is and
            # keeps the task and its cost, which was charged all the same.
            await db.execute(
                update(crawl_runs)
                .where(crawl_runs.c.workspace_id == run.workspace_id, crawl_runs.c.id == run.id)
                .values(provider_task_id=posted.task_id, cost_usd=cost)
            )
        await db.execute(
            insert(provider_cost_events).values(
                occurred_at=now,
                workspace_id=run.workspace_id,
                project_id=run.project_id,
                provider_code="dataforseo",
                endpoint=TASK_POST,
                workload=CostWorkload.SITE_CRAWL.value,
                channel=cost_channel(CostWorkload.SITE_CRAWL).value,
                run_id=run.id,
                subject_type="site",
                subject_id=run.target_host,
                units=run.ceiling,
                price_unit="page",
                cost_usd=cost,
                cost_source=(
                    "provider_reported" if posted.cost_usd is not None else "price_book_estimate"
                ),
                billing_period=now.date().replace(day=1),
            )
        )
    if moved is None:
        try:
            await on_page.force_stop(posted.task_id)
        except ProviderCallError as failure:
            _log.warning(
                "crawl not stopped at the provider",
                run_id=str(run.id),
                kind=failure.error.kind.value,
            )
        return "lost"
    return "posted"


ProgressOutcome = Literal["progressed", "finished", "failed", "cancelled", "waiting"]


async def _progress_one(
    sessions: async_sessionmaker[AsyncSession],
    on_page: OnPageApi,
    run: Row[Any],
    now: datetime,
) -> ProgressOutcome:
    if run.cancel_requested:
        try:
            await on_page.force_stop(run.provider_task_id)
        except ProviderCallError as failure:
            _log.warning(
                "crawl not stopped at the provider",
                run_id=str(run.id),
                kind=failure.error.kind.value,
            )
        async with sessions() as db, db.begin():
            await _finish(db, run, "cancelled", now=now)
        return "cancelled"
    try:
        found = await on_page.summary(run.provider_task_id)
    except ProviderCallError as failure:
        if failure.error.kind is not K.NOT_FOUND_EXPIRED:
            _log.warning(
                "crawl summary not read", run_id=str(run.id), kind=failure.error.kind.value
            )
            return "waiting"
        async with sessions() as db, db.begin():
            ended = await _finish(
                db,
                run,
                "failed",
                now=now,
                error_code="provider_error",
                message=failure.error.message,
            )
        return "failed" if ended else "waiting"
    values: dict[str, object] = {
        "pages_crawled": found.pages_crawled,
        "pages_found": found.pages_crawled + found.pages_in_queue,
    }
    async with sessions() as db, db.begin():
        # Only a crawl still crawling and with no cancel asked is moved. If a person asked for
        # a cancel since this crawl was read, nothing matches and the next tick cancels it.
        where = and_(
            crawl_runs.c.workspace_id == run.workspace_id,
            crawl_runs.c.id == run.id,
            crawl_runs.c.state == "crawling",
            crawl_runs.c.cancel_requested.is_(False),
        )
        if not found.finished:
            return "progressed" if await _held(db, where, **values) else "waiting"
        code = (
            "site_blocked"
            if found.extended_status in _BLOCKED
            else "site_unreachable"
            if found.extended_status in _UNREACHABLE
            else None
        )
        if code is not None:
            if not await _held(db, where, **values):
                return "waiting"
            await _finish(db, run, "failed", now=now, error_code=code, message=_MESSAGES[code])
            return "failed"
        moved = await _held(
            db,
            where,
            **values,
            state="processing",
            stop_reason=found.stop_reason,
            crawled_at=now,
            ingest_phase="pages",
        )
    return "finished" if moved else "waiting"


async def _held(db: AsyncSession, where: ColumnElement[bool], **values: object) -> bool:
    """Update the crawl `where` names; False when it no longer matches."""
    updated: UUID | None = (
        await db.execute(
            update(crawl_runs).where(where).values(**values).returning(crawl_runs.c.id)
        )
    ).scalar_one_or_none()
    return updated is not None


async def _rows(sessions: async_sessionmaker[AsyncSession], *conditions: Any) -> list[Row[Any]]:
    async with sessions() as db:
        return list(
            (
                await db.execute(
                    select(crawl_runs)
                    .where(*conditions)
                    .order_by(crawl_runs.c.created_at)
                    .limit(TICK_LIMIT)
                )
            ).all()
        )


# Only finished crawls take a place: a failed or cancelled one must not push a finished crawl
# out of the last four.
_RETIRED = text(
    """
    SELECT id FROM seo.crawl_runs
    WHERE links_dropped_at IS NULL
      AND state IN ('failed', 'cancelled') AND ingest_phase IS NOT NULL
    UNION ALL
    SELECT id FROM (
        SELECT id, row_number() OVER (PARTITION BY project_id
                                      ORDER BY created_at DESC, id DESC) AS place
        FROM seo.crawl_runs
        WHERE links_dropped_at IS NULL AND state IN ('ready', 'stopped_at_ceiling')
    ) ranked
    WHERE place > :keep
    LIMIT :limit
    """
)


async def _retire(sessions: async_sessionmaker[AsyncSession], now: datetime) -> int:
    """Links of crawls past the last four finished ones, and of crawls that failed or were
    cancelled after ingest began, go; their pages stay (spec 6.5)."""
    async with sessions() as db:
        ids: list[UUID] = list(
            (await db.execute(_RETIRED, {"keep": KEEP_RUNS, "limit": TICK_LIMIT})).scalars()
        )
    dropped = 0
    for run_id in ids:
        with _isolated("retire", run_id):
            async with sessions() as db, db.begin():
                await db.execute(
                    text("SELECT seo.drop_crawl_links_partition(:run_id)"), {"run_id": run_id}
                )
                await db.execute(
                    update(crawl_runs).where(crawl_runs.c.id == run_id).values(links_dropped_at=now)
                )
            dropped += 1
    return dropped


async def _expire_queued(sessions: async_sessionmaker[AsyncSession], now: datetime) -> int:
    """Cancel crawls that have been queued longer than `QUEUED_MAX_AGE` and were never begun."""
    async with sessions() as db, db.begin():
        ended = (
            await db.execute(
                update(crawl_runs)
                .where(
                    crawl_runs.c.state == "queued",
                    crawl_runs.c.submitted_at.is_(None),
                    crawl_runs.c.created_at < now - QUEUED_MAX_AGE,
                )
                .values(state="cancelled", error_message=_MESSAGES["too_old"], finished_at=now)
                .returning(crawl_runs.c.id)
            )
        ).all()
    return len(ended)


async def crawl_tick(
    sessions: async_sessionmaker[AsyncSession],
    on_page: OnPageApi | None,
    send_ingest: SendIngest,
    *,
    now: datetime,
    send_enrich: SendEnrich | None = None,
) -> CrawlTickReport:
    """One pass over every crawl. With no provider (no DataForSEO credentials) crawls are
    queued and wait; nothing is posted. `send_enrich` sends the second job of a finished crawl
    (what changed, anchors, mentions); it needs no provider."""
    counts: dict[str, int] = dict.fromkeys(
        (
            "posted",
            "failed",
            "progressed",
            "finished",
            "cancelled",
            "ingest_sent",
            "flows",
            "enrich_sent",
        ),
        0,
    )
    started = time.monotonic()
    counts["cancelled"] += await _expire_queued(sessions, now)
    queued = await _queue_scheduled(sessions, now)
    if on_page is not None:
        seen: set[UUID] = set()
        for _ in range(TICK_LIMIT):
            if time.monotonic() - started >= POST_BUDGET:
                break
            before = set(seen)
            try:
                outcome = await _post_one(sessions, on_page, now, seen)
            except Exception as failure:
                # If its post began, the crawl is marked sent and is failed `submit_unknown` by
                # a tick that finds it older than the grace; if not, nothing was sent. Either
                # way it is passed over for the rest of this tick. A failure before any crawl
                # was chosen (the database is away) would repeat, so the posts stop.
                chosen = seen - before
                _log.error(
                    "crawl post failed",
                    error=type(failure).__name__,
                    run_id=None if not chosen else str(next(iter(chosen))),
                )
                if not chosen:
                    break
                continue
            if outcome in ("none", "waiting"):
                break
            if outcome not in ("lost", "inflight"):
                counts[outcome] += 1
        for run in await _rows(sessions, crawl_runs.c.state == "crawling"):
            with _isolated("progress", run.id):
                progress = await _progress_one(sessions, on_page, run, now)
                if progress != "waiting":
                    counts[progress] += 1
    for run in await _rows(sessions, crawl_runs.c.state == "processing"):
        with _isolated("ingest", run.id):
            if await send_ingest(CrawlIngestTask(workspace_id=run.workspace_id, run_id=run.id)):
                counts["ingest_sent"] += 1
    if send_enrich is not None:
        for run in await _rows(
            sessions,
            crawl_runs.c.state.in_(DATA_STATES),
            crawl_runs.c.enrich_state.in_(("pending", "running")),
        ):
            with _isolated("enrich", run.id):
                if await send_enrich(CrawlEnrichTask(workspace_id=run.workspace_id, run_id=run.id)):
                    counts["enrich_sent"] += 1
    for run in await _rows(
        sessions, crawl_runs.c.tier_flow_stale, crawl_runs.c.state.in_(DATA_STATES)
    ):
        with _isolated("tier_flow", run.id):
            async with sessions() as db, db.begin():
                await recompute_tier_flow(db, workspace_id=run.workspace_id, run_id=run.id)
            counts["flows"] += 1
    dropped = await _retire(sessions, now)
    return CrawlTickReport(queued=queued, dropped=dropped, **counts)
