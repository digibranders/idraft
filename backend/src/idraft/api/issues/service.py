"""The list of checks of a crawl: for each check its state, the pages it found and one example,
and the totals of the strip (spec sections 5 and 6.1)."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import ColumnElement, func, literal, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.internal_links.reads import read_scope
from idraft.api.issues.catalogue import BY_ID, CHECKS, Check
from idraft.api.issues.rules import condition
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


def _not_run_reason(check: Check, *, has_sitemap: bool, links_dropped: bool) -> NotRunReason | None:
    """Why a check cannot be evaluated on this crawl; None when it can."""
    if check.need == "sitemap" and not has_sitemap:
        return "no_sitemap"
    if check.need == "links" and links_dropped:
        return "links_dropped"
    # The other sources are read by a later task; until then they hold nothing.
    if check.need in ("gsc", "ranks", "ai"):
        return "not_collected"
    return None


def _pages_with(severity: str, columns: dict[str, ColumnElement[bool]]) -> ColumnElement[int]:
    """Pages found by at least one running check of that severity."""
    found = [column for check_id, column in columns.items() if BY_ID[check_id].severity == severity]
    return func.count().filter(or_(*found)) if found else literal(0)


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
            reasons = {
                check.id: _not_run_reason(
                    check,
                    has_sitemap=(crawl.sitemap_pages or 0) > 0,
                    links_dropped=scope.links_dropped,
                )
                for check in CHECKS
            }
            running = [check for check in CHECKS if reasons[check.id] is None]
            # Every condition is evaluated once per page, here; the aggregate below counts them.
            flags = (
                select(
                    urls.c.path.label("path"),
                    *(
                        condition(check.id, scope).label(f"c{index}")
                        for index, check in enumerate(running)
                    ),
                )
                .select_from(crawl_pages.join(urls, urls.c.id == crawl_pages.c.url_id))
                .where(
                    crawl_pages.c.workspace_id == scope.workspace_id,
                    crawl_pages.c.run_id == scope.run_id,
                )
                .subquery("flags")
            )
            columns: dict[str, ColumnElement[bool]] = {
                check.id: flags.c[f"c{index}"] for index, check in enumerate(running)
            }
            # shortcut: every read runs this aggregate over the crawl's pages; store the counts
            # per crawl when a read takes over a second on a real crawl.
            counts = (
                await db.execute(
                    select(
                        func.count().label("crawled"),
                        func.count().filter(or_(*columns.values())).label("issue")
                        if columns
                        else literal(0).label("issue"),
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
                    )
                )
            ).one()
        found_by_index = counts._mapping
        pages = {check.id: found_by_index[f"n{index}"] for index, check in enumerate(running)}
        examples = {check.id: found_by_index[f"e{index}"] for index, check in enumerate(running)}
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
                clicks=None,
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
                gsc=IssueGsc(state="not_connected", window_start=None, window_end=None),
            ),
        )
