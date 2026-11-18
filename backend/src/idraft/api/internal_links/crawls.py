"""Crawl now, the crawl list and cancel (spec 6.2 and 9; decisions D5, D13 to D15).

A crawl is queued here and moved on by the worker (`idraft.collectors.crawl_runs`). Crawl now is
judged against the budget in the request, so a crawl a budget would stop is refused and never
queued. Cancel ends a queued crawl at once and asks the worker to stop a running one.

Two crawls started at once make one run: the project row is locked for the start, and the
partial unique index on `seo.crawl_runs` decides if the lock were ever missed. Every state change
here is guarded by the state it was decided from, under the run's row lock, so it cannot undo a
step the worker took.
"""

from __future__ import annotations

from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from sqlalchemy import Row, Select, select, tuple_, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api import audit
from idraft.api.ai.engine_service import live_project
from idraft.api.internal_links.problems import (
    BudgetExceededError,
    CrawlInProgressError,
    CrawlsDisabledError,
    NoWebsiteError,
)
from idraft.api.pagination import (
    CursorParams,
    cursor_instant,
    decode_cursor,
    encode_cursor,
    invalid_cursor,
)
from idraft.api.problems import InvalidStateTransitionError, NotFoundError, invalid_field
from idraft.api.request_info import RequestInfo
from idraft.api.schemas.internal_links import CrawlState, CrawlTrigger
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.collectors import budget
from idraft.collectors.crawl_runs import (
    FEW_PAGES,
    CrawlBusyError,
    NoSiteError,
    NoStoppedCrawlError,
    Trigger,
    queue_run,
)
from idraft.collectors.crawl_store import latest_run
from idraft.db.engine import workspace_transaction
from idraft.db.tables import crawl_runs, users
from idraft.domain.workloads import CostWorkload


@dataclass(frozen=True, slots=True)
class CrawlRecord:
    run_id: UUID
    trigger: CrawlTrigger
    state: CrawlState
    ceiling: int
    pages_found: int
    pages_crawled: int
    sitemap_pages: int | None
    render_javascript: bool
    estimated_cost_usd: Decimal | None
    cost_usd: Decimal | None
    stop_reason: str | None
    error_code: str | None
    error_message: str | None
    created_at: datetime
    submitted_at: datetime | None
    finished_at: datetime | None
    requested_by: UUID | None
    requester_name: str | None
    requester_email: str | None
    links_available: bool
    previous_run_id: UUID | None
    enrich_state: Literal["pending", "running", "done", "failed"]

    @property
    def hints(self) -> list[Literal["render_javascript"]]:
        """A crawl without JavaScript that found next to nothing: the site may need it (spec 9)."""
        few = self.state == "ready" and self.pages_crawled <= FEW_PAGES
        return ["render_javascript"] if few and not self.render_javascript else []


@dataclass(frozen=True, slots=True)
class CrawlView:
    """A crawl and the id of the latest finished crawl of its project (the `is_latest` flag)."""

    record: CrawlRecord
    latest: UUID | None


@dataclass(frozen=True, slots=True)
class CrawlListing:
    records: list[CrawlRecord]
    latest: UUID | None
    next_cursor: str | None


def _record(row: Row[tuple[object, ...]]) -> CrawlRecord:
    return CrawlRecord(
        run_id=row.id,
        trigger=row.trigger,
        state=row.state,
        ceiling=row.ceiling,
        pages_found=row.pages_found,
        pages_crawled=row.pages_crawled,
        sitemap_pages=row.sitemap_pages,
        render_javascript=bool(row.settings.get("render_javascript")),
        estimated_cost_usd=row.estimated_cost_usd,
        cost_usd=row.cost_usd,
        stop_reason=row.stop_reason,
        error_code=row.error_code,
        error_message=row.error_message,
        created_at=row.created_at,
        submitted_at=row.submitted_at,
        finished_at=row.finished_at,
        requested_by=row.requested_by,
        requester_name=row.requester_name,
        requester_email=row.requester_email,
        links_available=row.links_dropped_at is None,
        previous_run_id=row.previous_run_id,
        enrich_state=row.enrich_state,
    )


def _runs_query(workspace_id: UUID, project_id: UUID) -> Select[tuple[object, ...]]:
    return (
        select(
            crawl_runs,
            users.c.name.label("requester_name"),
            users.c.email.label("requester_email"),
        )
        .outerjoin(users, users.c.id == crawl_runs.c.requested_by)
        .where(crawl_runs.c.workspace_id == workspace_id, crawl_runs.c.project_id == project_id)
    )


def _after(cursor: str, scope: dict[str, object]) -> tuple[datetime, UUID]:
    key = decode_cursor(cursor, scope=scope)
    if len(key) != 2 or not isinstance(key[1], str):
        raise invalid_cursor()
    try:
        return cursor_instant(key[0]), UUID(key[1])
    except ValueError:
        raise invalid_cursor() from None


class CrawlService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession], enabled: bool) -> None:
        """`enabled` is the `crawls_enabled` setting. Without it the worker never posts or expires
        a queued crawl, so Crawl now is refused rather than leave one holding the project's slot."""
        self._sessions = sessions
        self._enabled = enabled

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    @staticmethod
    async def _one(
        db: AsyncSession, access: WorkspaceAccess, project_id: UUID, run_id: UUID
    ) -> CrawlRecord:
        row = (
            await db.execute(
                _runs_query(access.workspace_id, project_id).where(crawl_runs.c.id == run_id)
            )
        ).one_or_none()
        if row is None:
            raise NotFoundError
        return _record(row)

    async def list(
        self, access: WorkspaceAccess, project_id: UUID, page: CursorParams
    ) -> CrawlListing:
        """Newest first."""
        scope: dict[str, object] = {"list": "link-crawls", "project_id": str(project_id)}
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            statement = _runs_query(access.workspace_id, project_id)
            if page.cursor is not None:
                created, run_id = _after(page.cursor, scope)
                statement = statement.where(
                    tuple_(crawl_runs.c.created_at, crawl_runs.c.id) < tuple_(created, run_id)
                )
            rows = list(
                (
                    await db.execute(
                        statement.order_by(
                            crawl_runs.c.created_at.desc(), crawl_runs.c.id.desc()
                        ).limit(page.limit + 1)
                    )
                ).all()
            )
            latest = await latest_run(db, access.workspace_id, project_id)
        shown = rows[: page.limit]
        cursor = (
            encode_cursor([shown[-1].created_at.isoformat(), str(shown[-1].id)], scope=scope)
            if len(rows) > page.limit
            else None
        )
        return CrawlListing([_record(row) for row in shown], latest, cursor)

    async def get(self, access: WorkspaceAccess, project_id: UUID, run_id: UUID) -> CrawlView:
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            record = await self._one(db, access, project_id, run_id)
            return CrawlView(record, await latest_run(db, access.workspace_id, project_id))

    async def start(
        self, access: WorkspaceAccess, project_id: UUID, higher_limit: bool, info: RequestInfo
    ) -> CrawlView:
        now = datetime.now(UTC)
        trigger: Trigger = "ceiling_retry" if higher_limit else "manual"
        async with self._transaction(access) as db:
            await live_project(db, access, project_id, lock=True)
            if not self._enabled:
                raise CrawlsDisabledError("Site crawls are not switched on yet.")
            try:
                run_id = await queue_run(
                    db,
                    workspace_id=access.workspace_id,
                    project_id=project_id,
                    trigger=trigger,
                    requested_by=access.user_id,
                    now=now,
                )
            except NoSiteError:
                raise NoWebsiteError from None
            except CrawlBusyError as busy:
                raise CrawlInProgressError(run_id=str(busy.run_id)) from None
            except NoStoppedCrawlError:
                raise invalid_field(
                    "higher_limit",
                    code="no_stopped_crawl",
                    message="The latest crawl did not stop at its ceiling.",
                ) from None
            record = await self._one(db, access, project_id, run_id)
            verdict = await budget.check(
                db,
                workspace_id=access.workspace_id,
                project_id=project_id,
                workload=CostWorkload.SITE_CRAWL,
                now=now,
                estimate=record.estimated_cost_usd,
            )
            if verdict.blocked_by is not None:
                # Raised inside the transaction: the queued row goes with it.
                raise BudgetExceededError(budget_id=str(verdict.blocked_by))
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="link_crawl.requested",
                target_type="link_crawl",
                target_id=run_id,
                info=info,
                after={"trigger": record.trigger, "ceiling": record.ceiling},
            )
            return CrawlView(record, await latest_run(db, access.workspace_id, project_id))

    async def cancel(
        self, access: WorkspaceAccess, project_id: UUID, run_id: UUID, info: RequestInfo
    ) -> CrawlView:
        """A queued crawl ends at once; the worker guards its own updates with the `queued`
        state and stops a crawl cancelled while it was being sent. A crawling one is asked to
        stop (`cancel_requested`) and stays as it is until the worker has stopped it."""
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            found = (
                await db.execute(
                    select(crawl_runs.c.state, crawl_runs.c.cancel_requested)
                    .where(
                        crawl_runs.c.workspace_id == access.workspace_id,
                        crawl_runs.c.project_id == project_id,
                        crawl_runs.c.id == run_id,
                    )
                    # FOR NO KEY UPDATE, not FOR UPDATE: the ingest inserts take KEY SHARE on
                    # this row through their foreign key and must not wait for a cancel.
                    .with_for_update(key_share=True)
                )
            ).one_or_none()
            if found is None:
                raise NotFoundError
            guard = (
                crawl_runs.c.workspace_id == access.workspace_id,
                crawl_runs.c.id == run_id,
                crawl_runs.c.state == found.state,
            )
            if found.state == "queued":
                await db.execute(
                    update(crawl_runs)
                    .where(*guard)
                    .values(state="cancelled", finished_at=datetime.now(UTC))
                )
            elif found.state == "crawling":
                await db.execute(update(crawl_runs).where(*guard).values(cancel_requested=True))
            else:
                raise InvalidStateTransitionError(
                    "Only a queued or running crawl can be cancelled."
                )
            record = await self._one(db, access, project_id, run_id)
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="link_crawl.cancelled",
                target_type="link_crawl",
                target_id=run_id,
                info=info,
                before={"state": found.state, "cancel_requested": found.cancel_requested},
                after={
                    "state": record.state,
                    "cancel_requested": found.cancel_requested or found.state == "crawling",
                },
            )
            return CrawlView(record, await latest_run(db, access.workspace_id, project_id))
