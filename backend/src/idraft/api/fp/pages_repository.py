"""Reads and writes of the tracked pages routes: the project's Search Console state, its tracked
pages, their stored numbers, and the query counts the worker and the drawer stored. Row-level
security keeps every statement in the caller's workspace; each one names the workspace and the
project as well. Nothing here calls Google."""

from __future__ import annotations

from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import ColumnElement, Text, and_, delete, exists, func, insert, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.api.projects import repository as project_repository
from idraft.api.schemas.fp_pages import SearchState
from idraft.collectors.crawl_store import latest_run
from idraft.crawl.hosts import site_hosts
from idraft.db.tables import (
    connections,
    crawl_pages,
    gsc_page_breakdown,
    gsc_page_daily,
    gsc_page_fetches,
    integrations,
    project_pages,
    projects,
    tracked_pages,
    urls,
)
from idraft.domain.gsc_pull import PullState
from idraft.domain.page_search import Totals

_D, _F, _I, _C = gsc_page_daily.c, gsc_page_fetches.c, integrations.c, connections.c
_B = gsc_page_breakdown.c
_T, _P, _U = tracked_pages.c, project_pages.c, urls.c


@dataclass(frozen=True, slots=True)
class SearchScope:
    """What a project's numbers are read from: the state, and the property and the last final day
    where there is a property. `final_through` is set in every state that has one (the caller
    hides it for `pending`)."""

    state: SearchState
    integration_id: UUID | None = None
    site_url: str | None = None
    final_through: date | None = None


@dataclass(frozen=True, slots=True)
class PageRow:
    url_id: int
    url: str
    path: str
    tier_id: UUID | None
    title: str | None
    added_at: datetime


@dataclass(frozen=True, slots=True)
class PageInfo:
    """One page of the project, tracked or not."""

    url_id: int
    url: str
    path: str
    tier_id: UUID | None
    title: str | None
    tracked: bool


@dataclass(frozen=True, slots=True)
class Marker:
    """What a fetch of one breakdown left: whether Google had more rows than were kept, and when."""

    truncated: bool
    fetched_at: datetime


@dataclass(frozen=True, slots=True)
class PageRef:
    """A page of the project, as the add route names it."""

    url_id: int
    path: str


@dataclass(frozen=True, slots=True)
class Suggestion:
    url_id: int
    url: str
    path: str
    title: str | None
    clicks: int
    impressions: int


@dataclass(frozen=True, slots=True)
class SiteHosts:
    primary: str | None
    hosts: frozenset[str]


async def search_scope(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> SearchScope:
    row = (
        await db.execute(
            select(
                _I.id, _I.status, _I.external_property, _I.backfill_state, _C.status.label("auth")
            )
            .join(connections, and_(_C.id == _I.connection_id, _C.workspace_id == _I.workspace_id))
            .where(
                _I.workspace_id == workspace_id,
                _I.project_id == project_id,
                _I.kind == "gsc",
                _I.status != "disabled",
            )
        )
    ).one_or_none()
    if row is None:
        return SearchScope("not_connected")
    pulled = PullState.read(row.backfill_state)
    found = {
        "integration_id": row.id,
        "site_url": row.external_property,
        "final_through": pulled.window_end,
    }
    if "reauth_required" in (row.status, row.auth):
        return SearchScope("reauth_required", **found)
    # Google refused the property, or the account was revoked or failed: stored rows are served.
    if row.status == "error" or row.auth in ("revoked", "error"):
        return SearchScope("no_access", **found)
    state: SearchState = "ok" if pulled.recent_done and pulled.window_end else "pending"
    return SearchScope(state, **found)


def _title(workspace_id: UUID, run_id: UUID | None) -> ColumnElement[Any]:
    """The page's title in the crawl `run_id`; null with no crawl or no title."""
    if run_id is None:
        return literal(None, Text)
    return (
        select(crawl_pages.c.title)
        .where(
            crawl_pages.c.workspace_id == workspace_id,
            crawl_pages.c.run_id == run_id,
            crawl_pages.c.url_id == _U.id,
        )
        .scalar_subquery()
    )


async def tracked_rows(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> list[PageRow]:
    run_id = await latest_run(db, workspace_id, project_id)
    rows = await db.execute(
        select(
            _U.id,
            _U.canonical_url,
            _U.path,
            _P.tier_id,
            _title(workspace_id, run_id).label("title"),
            _T.added_at,
        )
        .select_from(
            tracked_pages.join(urls, urls.c.id == _T.url_id).outerjoin(
                project_pages,
                and_(
                    _P.project_id == _T.project_id,
                    _P.url_id == _T.url_id,
                    _P.workspace_id == _T.workspace_id,
                ),
            )
        )
        .where(_T.workspace_id == workspace_id, _T.project_id == project_id)
        .order_by(_U.path, _U.id)
    )
    return [PageRow(*row) for row in rows]


async def page_row(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, url_id: int
) -> PageInfo | None:
    """One page of the project (a row of `core.project_pages`); None for any other url id."""
    run_id = await latest_run(db, workspace_id, project_id)
    row = (
        await db.execute(
            select(
                _U.id,
                _U.canonical_url,
                _U.path,
                _P.tier_id,
                _title(workspace_id, run_id),
                exists()
                .where(
                    _T.workspace_id == workspace_id,
                    _T.project_id == project_id,
                    _T.url_id == _P.url_id,
                )
                .label("tracked"),
            )
            .select_from(project_pages.join(urls, urls.c.id == _P.url_id))
            .where(
                _P.workspace_id == workspace_id,
                _P.project_id == project_id,
                _P.url_id == url_id,
            )
        )
    ).one_or_none()
    return None if row is None else PageInfo(*row)


async def tracked_ids(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> list[int]:
    found = await db.execute(
        select(_T.url_id)
        .where(_T.workspace_id == workspace_id, _T.project_id == project_id)
        .order_by(_T.url_id)
    )
    return list(found.scalars())


async def totals(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    integration_id: UUID,
    url_ids: Collection[int],
    window: tuple[date, date],
) -> dict[int, Totals]:
    """The stored sums of each page over `window`; a page with no row in it is absent."""
    if not url_ids:
        return {}
    rows = await db.execute(
        select(
            _D.url_id,
            func.sum(_D.clicks),
            func.sum(_D.impressions),
            func.sum(_D.position_sum),
            func.sum(_D.impressions).filter(_D.position_sum.is_not(None)),
        )
        .where(
            _D.workspace_id == workspace_id,
            _D.project_id == project_id,
            _D.integration_id == integration_id,
            _D.url_id.in_(url_ids),
            _D.metric_date.between(*window),
        )
        .group_by(_D.url_id)
    )
    return {
        url_id: Totals(
            int(clicks),
            int(impressions),
            position_sum or Decimal(0),
            int(position_impressions or 0),
        )
        for url_id, clicks, impressions, position_sum, position_impressions in rows
    }


async def clicks_by_day(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    integration_id: UUID,
    url_ids: Collection[int],
    window: tuple[date, date],
) -> dict[int, dict[date, int]]:
    found: dict[int, dict[date, int]] = {}
    if not url_ids:
        return found
    rows = await db.execute(
        select(_D.url_id, _D.metric_date, _D.clicks).where(
            _D.workspace_id == workspace_id,
            _D.project_id == project_id,
            _D.integration_id == integration_id,
            _D.url_id.in_(url_ids),
            _D.metric_date.between(*window),
        )
    )
    for url_id, day, clicks in rows:
        found.setdefault(url_id, {})[day] = clicks
    return found


async def series(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    integration_id: UUID,
    url_id: int,
    window: tuple[date, date],
) -> dict[date, Totals]:
    """The stored numbers of one page for each day of `window`; a day without a row is absent."""
    rows = await db.execute(
        select(_D.metric_date, _D.clicks, _D.impressions, _D.position_sum).where(
            _D.workspace_id == workspace_id,
            _D.project_id == project_id,
            _D.integration_id == integration_id,
            _D.url_id == url_id,
            _D.metric_date.between(*window),
        )
    )
    return {
        day: Totals(
            clicks,
            impressions,
            position_sum or Decimal(0),
            0 if position_sum is None else impressions,
        )
        for day, clicks, impressions, position_sum in rows
    }


async def breakdown_rows(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    integration_id: UUID,
    url_id: int,
    window: tuple[date, date],
    dimension: str,
) -> dict[str, Totals]:
    """The stored rows of one page, period and dimension, by key."""
    rows = await db.execute(
        select(_B.key, _B.clicks, _B.impressions, _B.position_sum).where(
            _B.workspace_id == workspace_id,
            _B.project_id == project_id,
            _B.integration_id == integration_id,
            _B.url_id == url_id,
            _B.dimension == dimension,
            _B.date_from == window[0],
            _B.date_to == window[1],
        )
    )
    return {
        key: Totals(clicks, impressions, position_sum, impressions)
        for key, clicks, impressions, position_sum in rows
    }


async def fetch_marker(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    integration_id: UUID,
    url_id: int,
    kind: str,
    window: tuple[date, date],
) -> Marker | None:
    """The marker of a fetch for exactly this page, kind and period; None before one."""
    row = (
        await db.execute(
            select(_F.truncated, _F.fetched_at).where(
                _F.workspace_id == workspace_id,
                _F.project_id == project_id,
                _F.integration_id == integration_id,
                _F.url_id == url_id,
                _F.kind == kind,
                _F.date_from == window[0],
                _F.date_to == window[1],
            )
        )
    ).one_or_none()
    return None if row is None else Marker(*row)


async def history_starts(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    integration_id: UUID,
    url_ids: Collection[int],
) -> dict[int, date]:
    """The first day each page's history covers; a page whose history was not fetched is absent."""
    if not url_ids:
        return {}
    rows = await db.execute(
        select(_F.url_id, func.min(_F.date_from))
        .where(
            _F.workspace_id == workspace_id,
            _F.project_id == project_id,
            _F.integration_id == integration_id,
            _F.kind == "history",
            _F.url_id.in_(url_ids),
        )
        .group_by(_F.url_id)
    )
    return dict(rows.all())


async def query_counts(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    integration_id: UUID,
    url_ids: Collection[int],
    window: tuple[date, date],
) -> dict[int, tuple[int, bool]]:
    """The stored query count and whether it was capped, for each page whose `query` marker is for
    exactly `window`. A page without one is absent: nothing is summed or estimated."""
    if not url_ids:
        return {}
    rows = await db.execute(
        select(_F.url_id, _F.query_count, _F.query_count_capped).where(
            _F.workspace_id == workspace_id,
            _F.project_id == project_id,
            _F.integration_id == integration_id,
            _F.kind == "query",
            _F.date_from == window[0],
            _F.date_to == window[1],
            _F.url_id.in_(url_ids),
            _F.query_count.is_not(None),
        )
    )
    return {url_id: (count, capped) for url_id, count, capped in rows}


async def suggestions(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    integration_id: UUID,
    window: tuple[date, date],
    limit: int,
) -> list[Suggestion]:
    """The project's untracked pages with the most clicks over `window`."""
    run_id = await latest_run(db, workspace_id, project_id)
    clicks, impressions = func.sum(_D.clicks), func.sum(_D.impressions)
    rows = await db.execute(
        select(_U.id, _U.canonical_url, _U.path, _title(workspace_id, run_id), clicks, impressions)
        .select_from(
            gsc_page_daily.join(urls, urls.c.id == _D.url_id).join(
                project_pages,
                and_(
                    _P.project_id == _D.project_id,
                    _P.url_id == _D.url_id,
                    _P.workspace_id == _D.workspace_id,
                ),
            )
        )
        .where(
            _D.workspace_id == workspace_id,
            _D.project_id == project_id,
            _D.integration_id == integration_id,
            _D.metric_date.between(*window),
            ~exists().where(
                _T.workspace_id == workspace_id, _T.project_id == project_id, _T.url_id == _D.url_id
            ),
        )
        .group_by(_U.id, _U.canonical_url, _U.path)
        .order_by(clicks.desc(), impressions.desc(), _U.path, _U.id)
        .limit(limit)
    )
    return [
        Suggestion(url_id, url, path, title, int(c), int(i))
        for url_id, url, path, title, c, i in rows
    ]


async def site_hosts_of(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> SiteHosts:
    """The project's website host and the hosts that count as the site (the website with and
    without `www.`, plus the allowed subdomains of the project settings)."""
    project = await project_repository.get_project(db, workspace_id, project_id)
    if project is None or project.primary_host is None:
        return SiteHosts(None, frozenset())
    settings: dict[str, Any] | None = (
        await db.execute(
            select(projects.c.settings).where(
                projects.c.workspace_id == workspace_id, projects.c.id == project_id
            )
        )
    ).scalar_one()
    allowed = (settings or {}).get("internal_links", {}).get("allowed_subdomains", [])
    return SiteHosts(project.primary_host, site_hosts(project.primary_host, allowed))


async def pages_by_hash(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, hashes: Collection[bytes]
) -> dict[bytes, PageRef]:
    """The pages of the project among the addresses with these hashes. Read only: an address
    the dictionary does not hold is no page, and none is added."""
    if not hashes:
        return {}
    rows = await db.execute(
        select(_U.url_hash, _U.id, _U.path)
        .join(project_pages, _P.url_id == _U.id)
        .where(
            _P.workspace_id == workspace_id, _P.project_id == project_id, _U.url_hash.in_(hashes)
        )
    )
    return {url_hash: PageRef(url_id, path) for url_hash, url_id, path in rows}


async def pages_by_id(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, url_ids: Collection[int]
) -> dict[int, PageRef]:
    if not url_ids:
        return {}
    rows = await db.execute(
        select(_U.id, _U.path)
        .join(project_pages, _P.url_id == _U.id)
        .where(_P.workspace_id == workspace_id, _P.project_id == project_id, _U.id.in_(url_ids))
    )
    return {url_id: PageRef(url_id, path) for url_id, path in rows}


async def add_tracked(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, user_id: UUID, url_ids: Sequence[int]
) -> None:
    await db.execute(
        insert(tracked_pages),
        [
            {
                "project_id": project_id,
                "url_id": url_id,
                "workspace_id": workspace_id,
                "added_by": user_id,
            }
            for url_id in url_ids
        ],
    )


async def remove_tracked(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, url_ids: Collection[int]
) -> list[int]:
    """Stop tracking; the ids that were tracked, in order. Stored numbers are kept."""
    removed = await db.execute(
        delete(tracked_pages)
        .where(
            _T.workspace_id == workspace_id,
            _T.project_id == project_id,
            _T.url_id.in_(url_ids),
        )
        .returning(_T.url_id)
    )
    return sorted(removed.scalars())
