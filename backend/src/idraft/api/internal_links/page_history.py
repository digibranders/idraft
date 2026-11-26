"""Read model of a page's history tab (spec 5 of the page history design): SQL reads at the top,
then pure assembly of the answer from the rows."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.api.internal_links.page_filter import PageScope
from idraft.api.problems import NotFoundError
from idraft.api.schemas.internal_links_history import (
    VERSIONS_MAX,
    DeclaredSource,
    PageDeclared,
    PageGoogleCrawl,
    PageHistory,
    PageHistoryChange,
    PageHistoryVersion,
)
from idraft.crawl.page_history import Change, Snapshot, classify_change, diff_snapshots
from idraft.crawl.page_text import Heading
from idraft.db.tables import (
    crawl_pages,
    crawl_runs,
    page_checks,
    page_google_crawl,
    page_history_runs,
    page_snapshots,
)

_RUN_DATE = func.coalesce(crawl_runs.c.crawled_at, crawl_runs.c.created_at)


@dataclass(frozen=True, slots=True)
class CheckRow:
    """One crawl's check of the page, with the crawl's date and run flags."""

    run_id: UUID
    date: datetime
    main_hash: bytes
    full_hash: bytes
    snapshot_id: int | None
    declared_at: datetime | None
    declared_source: DeclaredSource | None
    site_wide: bool
    declared_unreliable: bool


@dataclass(frozen=True, slots=True)
class GoogleRow:
    last_crawl_time: datetime | None
    coverage_state: str | None


@dataclass(frozen=True, slots=True)
class HistoryRows:
    status: int | None
    first_seen: datetime
    checks: Sequence[CheckRow]  # oldest first
    snapshots: dict[int, Snapshot]
    google: GoogleRow | None


async def read_history_rows(db: AsyncSession, scope: PageScope, url_id: int) -> HistoryRows:
    """404 when the page is not in the crawl in scope."""
    ws, project = scope.workspace_id, scope.project_id
    status_row = (
        await db.execute(
            select(crawl_pages.c.status_code).where(
                crawl_pages.c.workspace_id == ws,
                crawl_pages.c.project_id == project,
                crawl_pages.c.run_id == scope.run_id,
                crawl_pages.c.url_id == url_id,
            )
        )
    ).one_or_none()
    if status_row is None:
        raise NotFoundError
    first_seen: datetime = (
        await db.execute(
            select(func.min(_RUN_DATE))
            .select_from(crawl_pages)
            .join(
                crawl_runs,
                (crawl_runs.c.id == crawl_pages.c.run_id)
                & (crawl_runs.c.workspace_id == crawl_pages.c.workspace_id),
            )
            .where(
                crawl_pages.c.workspace_id == ws,
                crawl_pages.c.project_id == project,
                crawl_pages.c.url_id == url_id,
            )
        )
    ).scalar_one()
    checks = [
        CheckRow(
            run_id=row.run_id,
            date=row.date,
            main_hash=bytes(row.main_hash),
            full_hash=bytes(row.full_hash),
            snapshot_id=row.snapshot_id,
            declared_at=row.declared_at,
            declared_source=row.declared_source,
            site_wide=bool(row.site_wide),
            declared_unreliable=bool(row.declared_unreliable),
        )
        for row in await db.execute(
            select(
                page_checks.c.run_id,
                _RUN_DATE.label("date"),
                page_checks.c.main_hash,
                page_checks.c.full_hash,
                page_checks.c.snapshot_id,
                page_checks.c.declared_at,
                page_checks.c.declared_source,
                page_history_runs.c.site_wide,
                page_history_runs.c.declared_unreliable,
            )
            .select_from(page_checks)
            .join(
                crawl_runs,
                (crawl_runs.c.id == page_checks.c.run_id)
                & (crawl_runs.c.workspace_id == page_checks.c.workspace_id),
            )
            .outerjoin(
                page_history_runs,
                (page_history_runs.c.run_id == page_checks.c.run_id)
                & (page_history_runs.c.workspace_id == page_checks.c.workspace_id),
            )
            .where(
                page_checks.c.workspace_id == ws,
                page_checks.c.project_id == project,
                page_checks.c.url_id == url_id,
            )
            .order_by(_RUN_DATE, page_checks.c.run_id)
        )
    ]
    snapshots = {
        row.id: Snapshot(
            title=row.title,
            description=row.description,
            headings=tuple(Heading(int(level), str(text)) for level, text in row.headings),
            words=row.words,
            links_all=row.links_all,
            links_editorial=row.links_editorial,
            canonical=row.canonical,
            main_hash=bytes(row.main_hash),
            full_hash=bytes(row.full_hash),
        )
        for row in await db.execute(
            select(page_snapshots).where(
                page_snapshots.c.workspace_id == ws,
                page_snapshots.c.project_id == project,
                page_snapshots.c.url_id == url_id,
            )
        )
    }
    google = (
        await db.execute(
            select(page_google_crawl.c.last_crawl_time, page_google_crawl.c.coverage_state).where(
                page_google_crawl.c.workspace_id == ws,
                page_google_crawl.c.project_id == project,
                page_google_crawl.c.url_id == url_id,
            )
        )
    ).one_or_none()
    return HistoryRows(
        status=status_row.status_code,
        first_seen=first_seen,
        checks=checks,
        snapshots=snapshots,
        google=None if google is None else GoogleRow(google.last_crawl_time, google.coverage_state),
    )


def _change(change: Change) -> PageHistoryChange:
    return PageHistoryChange(
        type=change.type,
        level=change.level,
        before=change.before,
        after=change.after,
        delta=change.delta,
    )


def _versions(
    checks: Sequence[CheckRow], snapshots: dict[int, Snapshot]
) -> list[PageHistoryVersion]:
    """Oldest first, kinds from the hashes of consecutive checks (the check of an unchanged page
    points at the snapshot of its last change, so `snapshot_id` alone says nothing)."""
    versions: list[PageHistoryVersion] = []
    kept: Snapshot | None = None
    previous: CheckRow | None = None
    for check in checks:
        kind = classify_change(
            None if previous is None else (previous.main_hash, previous.full_hash),
            (check.main_hash, check.full_hash),
        )
        previous = check
        snapshot = None if check.snapshot_id is None else snapshots.get(check.snapshot_id)
        changes: list[Change] = []
        if kind == "first":
            version_kind: Literal["content", "site_wide", "first"] = "first"
        elif kind == "content" and snapshot is not None:
            version_kind = "content"
            changes = [] if kept is None else diff_snapshots(kept, snapshot)
        elif kind == "template_candidate" and check.site_wide:
            version_kind = "site_wide"
        else:
            continue
        if snapshot is not None:
            kept = snapshot
        versions.append(
            PageHistoryVersion(
                run_id=check.run_id,
                date=check.date,
                kind=version_kind,
                changes=[_change(change) for change in changes],
            )
        )
    return versions


def _unreadable(status: int | None) -> tuple[bool, Literal["redirect", "error"] | None]:
    if status == 200:
        return True, None
    return False, "redirect" if status is not None and 300 <= status < 400 else "error"


def assemble_history(rows: HistoryRows) -> PageHistory:
    ascending = _versions(rows.checks, rows.snapshots)
    content = [version for version in ascending if version.kind == "content"]
    last_change = content[-1].date if content else None
    newest = rows.checks[-1] if rows.checks else None
    unreliable = newest is not None and newest.declared_unreliable
    declared = (
        PageDeclared(date=newest.declared_at, source=newest.declared_source)
        if newest is not None
        and not unreliable
        and newest.declared_at is not None
        and newest.declared_source is not None
        else None
    )
    readable, why = _unreadable(rows.status)
    google: PageGoogleCrawl | None = None
    if rows.google is not None:
        crawled = rows.google.last_crawl_time
        google = PageGoogleCrawl(
            crawled_at=crawled,
            behind=crawled is not None and last_change is not None and crawled < last_change,
            coverage_state=rows.google.coverage_state,
        )
    newest_first = ascending[::-1]
    return PageHistory(
        readable=readable,
        why=why,
        status=rows.status,
        first_seen=rows.first_seen,
        history_starts=rows.checks[0].date if rows.checks else None,
        last_change=last_change,
        changes=len(content),
        declared=declared,
        declared_unreliable=unreliable,
        versions=newest_first[:VERSIONS_MAX],
        versions_capped=len(newest_first) > VERSIONS_MAX,
        google=google,
        tracked=rows.google is not None,
    )


async def page_history(db: AsyncSession, scope: PageScope, url_id: int) -> PageHistory:
    return assemble_history(await read_history_rows(db, scope, url_id))


__all__ = ["CheckRow", "GoogleRow", "HistoryRows", "assemble_history", "page_history"]
