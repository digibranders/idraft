"""The list of checks of a crawl: for each check its state, the pages it found and one example,
and the totals of the strip (spec sections 5 and 6.1)."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any
from uuid import UUID

from sqlalchemy import ColumnElement, Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.internal_links.page_filter import PageScope
from idraft.api.internal_links.page_sort import extra_sort
from idraft.api.internal_links.reads import read_scope
from idraft.api.issues.catalogue import BY_ID, CHECKS, Check
from idraft.api.issues.rules import condition
from idraft.api.issues.sources import Sources, read_sources
from idraft.api.schemas.issues import (
    IssueCheck,
    IssueGsc,
    IssueListResponse,
    IssueMeta,
    IssueSummary,
    NotRunReason,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.db.tables import crawl_pages, crawl_runs, urls


def _not_run_reason(
    check: Check, *, has_sitemap: bool, links_dropped: bool, sources: Sources
) -> NotRunReason | None:
    """Why a check cannot be evaluated on this crawl; None when it can."""
    if check.need == "sitemap" and not has_sitemap:
        return "no_sitemap"
    if check.need == "links" and links_dropped:
        return "links_dropped"
    if check.need == "gsc" and sources.gsc.state == "not_connected":
        return "source_not_connected"
    if check.need == "gsc" and sources.gsc.state == "pending":
        return "not_collected"
    if (check.need == "ranks" and not sources.ranks) or (check.need == "ai" and not sources.ai):
        return "not_collected"
    return None


def _pages_with(severity: str, columns: dict[str, ColumnElement[bool]]) -> ColumnElement[int]:
    """Pages found by at least one running check of that severity."""
    found = [column for check_id, column in columns.items() if BY_ID[check_id].severity == severity]
    return func.count().filter(or_(*found))


def checks_statement(
    crawl: PageScope, running: Sequence[Check], sources: Sources
) -> Select[*tuple[Any, ...]]:
    """One row of totals for the crawl: `crawled`, `issue`, `error`, `warning`, `notice`, then
    `n<i>` (pages found), `e<i>` (first path in byte order) and, when Search Console is `ok`,
    `k<i>` (clicks of those pages) for the i-th running check. Each severity has a running
    check that needs nothing, so no list of columns is empty."""
    window = sources.gsc.window if sources.gsc.state == "ok" else None
    clicks = (
        None
        if sources.gsc.integration_id is None or window is None
        else extra_sort(crawl, "clicks", gsc=(sources.gsc.integration_id, window))
    )
    rows = crawl_pages.join(urls, urls.c.id == crawl_pages.c.url_id)
    # MATERIALIZED makes PostgreSQL evaluate every condition once per page. A plain subquery is
    # pulled up into the aggregate and each condition is then evaluated once per use.
    flags = (
        select(
            urls.c.path.label("path"),
            *(
                condition(check.id, crawl, sources).label(f"c{index}")
                for index, check in enumerate(running)
            ),
            *(() if clicks is None else (clicks.column.label("clicks"),)),
        )
        .select_from(rows if clicks is None else clicks.join(rows))
        .where(
            crawl_pages.c.workspace_id == crawl.workspace_id,
            crawl_pages.c.run_id == crawl.run_id,
        )
        .cte("flags")
        .prefix_with("MATERIALIZED")
    )
    columns: dict[str, ColumnElement[bool]] = {
        check.id: flags.c[f"c{index}"] for index, check in enumerate(running)
    }
    # shortcut: every read runs this aggregate over the crawl's pages; store the counts
    # per crawl when a read takes over a second on a real crawl.
    return select(
        func.count().label("crawled"),
        func.count().filter(or_(*columns.values())).label("issue"),
        _pages_with("error", columns).label("error"),
        _pages_with("warning", columns).label("warning"),
        _pages_with("notice", columns).label("notice"),
        *(
            func.count().filter(column).label(f"n{index}")
            for index, column in enumerate(columns.values())
        ),
        *(
            func.min(flags.c.path.collate("C")).filter(column).label(f"e{index}")
            for index, column in enumerate(columns.values())
        ),
        *(
            func.coalesce(func.sum(flags.c.clicks).filter(column), 0).label(f"k{index}")
            for index, column in enumerate(columns.values())
            if clicks is not None
        ),
    )


class IssueService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    async def checks(
        self, access: WorkspaceAccess, project_id: UUID, *, run: UUID | None
    ) -> IssueListResponse:
        # One snapshot for every number of the answer.
        async with workspace_transaction(
            self._sessions,
            access.workspace_id,
            user_id=access.user_id,
            isolation_level="REPEATABLE READ",
        ) as db:
            scope = await read_scope(db, access, project_id, run)
            crawl = (
                await db.execute(
                    select(crawl_runs.c.sitemap_pages, crawl_runs.c.finished_at).where(
                        crawl_runs.c.workspace_id == scope.workspace_id,
                        crawl_runs.c.id == scope.run_id,
                    )
                )
            ).one()
            sources = await read_sources(db, scope)
            reasons = {
                check.id: _not_run_reason(
                    check,
                    has_sitemap=(crawl.sitemap_pages or 0) > 0,
                    links_dropped=scope.links_dropped,
                    sources=sources,
                )
                for check in CHECKS
            }
            running = [check for check in CHECKS if reasons[check.id] is None]
            counts = (await db.execute(checks_statement(scope, running, sources))).one()
        found_by_index = counts._mapping
        pages = {check.id: found_by_index[f"n{index}"] for index, check in enumerate(running)}
        examples = {check.id: found_by_index[f"e{index}"] for index, check in enumerate(running)}
        # Clicks are known only when Search Console has stored days; a check that did not run
        # has none.
        clicks = (
            {check.id: int(found_by_index[f"k{index}"]) for index, check in enumerate(running)}
            if sources.gsc.state == "ok"
            else {}
        )
        window = sources.gsc.window if sources.gsc.state == "ok" else None
        data = [
            IssueCheck(
                id=check.id,
                tab=check.tab,
                category=check.category,
                severity=check.severity,
                found_by=check.found_by,
                state="not_run" if reasons[check.id] else "ran",
                reason=reasons[check.id],
                pages=pages.get(check.id),
                clicks=clicks.get(check.id),
                example_path=examples.get(check.id),
            )
            for check in CHECKS
        ]
        return IssueListResponse(
            data=data,
            summary=IssueSummary(
                pages_crawled=counts.crawled,
                pages_with_issue=counts.issue,
                pages_with_error=counts.error,
                pages_with_warning=counts.warning,
                pages_with_notice=counts.notice,
                checks_ran=len(running),
                checks_passed=sum(1 for count in pages.values() if count == 0),
            ),
            meta=IssueMeta(
                run_id=scope.run_id,
                crawled_at=crawl.finished_at,
                links_available=not scope.links_dropped,
                gsc=IssueGsc(
                    state=sources.gsc.state,
                    window_start=None if window is None else window[0],
                    window_end=None if window is None else window[1],
                ),
            ),
        )
