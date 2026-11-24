"""Reads of what a crawl changed against the one before it (plan 04 D2 to D4, D17). The change
rows are stored by `crawl_enrich`; tiers are joined when read, so a tier change moves the
Priority and the "lost to important tiers" counts, as in the mock."""

from __future__ import annotations

from contextlib import AbstractAsyncContextManager
from typing import Any, Final, Literal, cast
from uuid import UUID

from sqlalchemy import Row, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.internal_links.csv_export import EXPORT_ROWS_MAX, csv_text
from idraft.api.internal_links.reads import Tiers, load_tiers, read_scope
from idraft.api.schemas.internal_links_extra import (
    AlertChannel,
    ChangeAlert,
    ChangeLink,
    ChangeLinkMeta,
    ChangeLinkPage,
    ChangePage,
    ChangesSummary,
    MovedPage,
    MovedPageList,
    MovedPageMeta,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.crawl.changes import (
    CHANGES_MAX,
    AlertSettings,
    alert_due,
    alert_settings,
    priority_of,
)
from idraft.db.engine import workspace_transaction
from idraft.db.tables import crawl_runs, projects

type SummaryState = Literal["first_crawl", "pending", "ready", "unavailable"]

PLACEMENT_LABEL: Final = {
    "content": "Content",
    "auto_generated": "Auto-generated",
    "navigation": "Navigation",
    "footer": "Footer",
    "breadcrumb": "Breadcrumb",
    "header": "Header",
    "sidebar": "Sidebar",
}
_COUNTS = text(
    """
    SELECT count(*) FILTER (WHERE change = 'lost' AND scope = 'editorial') AS editorial_lost,
           count(*) FILTER (WHERE change = 'added' AND scope = 'editorial') AS editorial_added,
           count(*) FILTER (WHERE change = 'lost' AND scope = 'all') AS all_lost,
           count(*) FILTER (WHERE change = 'added' AND scope = 'all') AS all_added
    FROM seo.crawl_link_changes
    WHERE run_id = CAST(:run_id AS uuid) AND workspace_id = CAST(:workspace_id AS uuid)
    """
)
_LOST_TO_TOP = text(
    """
    SELECT count(*) FROM seo.crawl_link_changes lc
    JOIN core.project_pages pp ON pp.workspace_id = lc.workspace_id
         AND pp.project_id = CAST(:project_id AS uuid) AND pp.url_id = lc.target_url_id
    JOIN core.page_tier_levels t ON t.id = pp.tier_id AND t.workspace_id = pp.workspace_id
    WHERE lc.run_id = CAST(:run_id AS uuid) AND lc.workspace_id = CAST(:workspace_id AS uuid)
      AND lc.change = 'lost' AND lc.scope = 'editorial' AND t.position <= :max_position
    """
)
_PAGES_ADDED = text(
    """
    SELECT count(*) FROM seo.crawl_page_changes pc
    JOIN seo.crawl_pages cp ON cp.run_id = pc.run_id AND cp.url_id = pc.url_id
         AND cp.workspace_id = pc.workspace_id
    WHERE pc.run_id = CAST(:run_id AS uuid) AND pc.workspace_id = CAST(:workspace_id AS uuid)
      AND pc.is_new AND cp.variant_of_url_id IS NULL
    """
)
_PAGES_LOST = text(
    """
    SELECT count(*) FROM seo.crawl_pages p
    WHERE p.run_id = CAST(:previous_id AS uuid) AND p.workspace_id = CAST(:workspace_id AS uuid)
      AND p.variant_of_url_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM seo.crawl_pages c
                      WHERE c.run_id = CAST(:run_id AS uuid) AND c.workspace_id = p.workspace_id
                        AND c.url_id = p.url_id)
    """
)
# `stored` is every row of the change and scope (what the cap cuts); `top` the rows whose target
# is an important page.
_LINK_TOTALS = text(
    """
    SELECT count(*) AS stored, count(*) FILTER (WHERE tl.position <= :max_position) AS top
    FROM seo.crawl_link_changes lc
    LEFT JOIN core.project_pages tp ON tp.workspace_id = lc.workspace_id
         AND tp.project_id = CAST(:project_id AS uuid) AND tp.url_id = lc.target_url_id
    LEFT JOIN core.page_tier_levels tl ON tl.id = tp.tier_id AND tl.workspace_id = tp.workspace_id
    WHERE lc.run_id = CAST(:run_id AS uuid) AND lc.workspace_id = CAST(:workspace_id AS uuid)
      AND lc.change = :change AND lc.scope = :scope
    """
)
_LINKS: Final = """
    SELECT lc.source_url_id, lc.target_url_id, lc.placement, lc.anchor, lc.still_linked_by,
           su.canonical_url AS source_url, su.path AS source_path,
           tu.canonical_url AS target_url, tu.path AS target_path,
           sp.tier_id AS source_tier, tp.tier_id AS target_tier, tl.position AS target_position
    FROM seo.crawl_link_changes lc
    JOIN core.urls su ON su.id = lc.source_url_id
    JOIN core.urls tu ON tu.id = lc.target_url_id
    LEFT JOIN core.project_pages sp ON sp.workspace_id = lc.workspace_id
         AND sp.project_id = CAST(:project_id AS uuid) AND sp.url_id = lc.source_url_id
    LEFT JOIN core.project_pages tp ON tp.workspace_id = lc.workspace_id
         AND tp.project_id = CAST(:project_id AS uuid) AND tp.url_id = lc.target_url_id
    LEFT JOIN core.page_tier_levels tl ON tl.id = tp.tier_id AND tl.workspace_id = tp.workspace_id
    WHERE lc.run_id = CAST(:run_id AS uuid) AND lc.workspace_id = CAST(:workspace_id AS uuid)
      AND lc.change = :change AND lc.scope = :scope {top}
    ORDER BY coalesce(tl.position, 99), su.path, tu.path, lc.source_url_id, lc.target_url_id
    LIMIT :limit OFFSET :offset
"""
_TOP: Final = "AND tl.position <= :max_position"
_MOVED = text(
    """
    SELECT pc.url_id, pc.editorial_in_delta, pc.equity_points, pc.depth_state, pc.depth_delta,
           cp.linking_pages_editorial AS editorial_in, cp.click_depth, u.canonical_url, u.path,
           pp.tier_id
    FROM seo.crawl_page_changes pc
    JOIN seo.crawl_pages cp ON cp.run_id = pc.run_id AND cp.url_id = pc.url_id
         AND cp.workspace_id = pc.workspace_id
    JOIN core.urls u ON u.id = pc.url_id
    LEFT JOIN core.project_pages pp ON pp.workspace_id = pc.workspace_id
         AND pp.project_id = CAST(:project_id AS uuid) AND pp.url_id = pc.url_id
    WHERE pc.run_id = CAST(:run_id AS uuid) AND pc.workspace_id = CAST(:workspace_id AS uuid)
      AND NOT pc.is_new AND cp.status_code = 200 AND cp.variant_of_url_id IS NULL
      AND (coalesce(pc.editorial_in_delta, 0) <> 0 OR coalesce(pc.depth_delta, 0) <> 0
           OR pc.depth_state IS NOT NULL)
    ORDER BY abs(coalesce(pc.editorial_in_delta, 0)) DESC, abs(coalesce(pc.depth_delta, 0)) DESC,
             u.path, pc.url_id
    LIMIT :limit
    """
)


def _page(url_id: int, url: str, path: str, tier_id: UUID | None, tiers: Tiers) -> ChangePage:
    return ChangePage(url_id=str(url_id), url=url, path=path, tier=tiers.ref(tier_id))


def _state(row: Row[Any]) -> SummaryState:
    """Change rows exist once enrichment reached the `anchors` phase (the changes phase ends
    by moving there); before that the crawl is waiting, or its enrichment failed."""
    if row.enrich_phase in ("anchors", "mentions", "done") or row.enrich_state == "done":
        return "first_crawl" if row.previous_run_id is None else "ready"
    return "unavailable" if row.enrich_state == "failed" else "pending"


class ChangeService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(
            self._sessions,
            access.workspace_id,
            user_id=access.user_id,
            isolation_level="REPEATABLE READ",
        )

    @staticmethod
    async def _run_row(db: AsyncSession, access: WorkspaceAccess, run_id: UUID) -> Row[Any]:
        return (
            await db.execute(
                select(
                    crawl_runs.c.previous_run_id,
                    crawl_runs.c.enrich_state,
                    crawl_runs.c.enrich_phase,
                    crawl_runs.c.links_compared,
                ).where(crawl_runs.c.workspace_id == access.workspace_id, crawl_runs.c.id == run_id)
            )
        ).one()

    @staticmethod
    async def _alert_settings(
        db: AsyncSession, access: WorkspaceAccess, project_id: UUID
    ) -> AlertSettings:
        stored: dict[str, Any] | None = (
            await db.execute(
                select(projects.c.settings).where(
                    projects.c.workspace_id == access.workspace_id, projects.c.id == project_id
                )
            )
        ).scalar_one()
        return alert_settings((stored or {}).get("internal_links"))

    async def summary(
        self, access: WorkspaceAccess, project_id: UUID, *, run: UUID | None
    ) -> ChangesSummary:
        async with self._transaction(access) as db:
            scope = await read_scope(db, access, project_id, run)
            row = await self._run_row(db, access, scope.run_id)
            keys = {"run_id": str(scope.run_id), "workspace_id": str(access.workspace_id)}
            counts = (await db.execute(_COUNTS, keys)).one()
            settings = await self._alert_settings(db, access, project_id)
            lost_to_top: int = (
                await db.execute(
                    _LOST_TO_TOP,
                    {**keys, "project_id": str(project_id), "max_position": settings.max_position},
                )
            ).scalar_one()
            added: int = (await db.execute(_PAGES_ADDED, keys)).scalar_one()
            lost_pages = 0
            finished = None
            if row.previous_run_id is not None:
                lost_pages = (
                    await db.execute(_PAGES_LOST, {**keys, "previous_id": str(row.previous_run_id)})
                ).scalar_one()
                finished = (
                    await db.execute(
                        select(crawl_runs.c.finished_at).where(
                            crawl_runs.c.workspace_id == access.workspace_id,
                            crawl_runs.c.id == row.previous_run_id,
                        )
                    )
                ).scalar_one_or_none()
            alert = None
            if alert_due(lost_to_top, settings):
                alert = ChangeAlert(
                    lost_links=lost_to_top,
                    max_position=settings.max_position,
                    threshold=settings.threshold,
                    channel=cast("AlertChannel", settings.channel),  # `alert_settings` checks it
                    delivery_state="shown_in_app"
                    if settings.channel == "app"
                    else "channel_unavailable",
                )
            return ChangesSummary(
                run_id=scope.run_id,
                previous_run_id=row.previous_run_id,
                previous_finished_at=finished,
                state=_state(row),
                links_compared=row.links_compared,
                editorial_lost=counts.editorial_lost,
                editorial_added=counts.editorial_added,
                all_lost=counts.all_lost,
                all_added=counts.all_added,
                lost_to_top=lost_to_top,
                important_max_position=settings.max_position,
                pages_added=added,
                pages_lost=lost_pages,
                alert=alert,
            )

    async def links(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        run: UUID | None,
        change: Literal["lost", "added"],
        link_scope: Literal["editorial", "all"],
        only: Literal["top", "all"],
        offset: int,
        limit: int,
    ) -> ChangeLinkPage:
        async with self._transaction(access) as db:
            scope = await read_scope(db, access, project_id, run)
            scope.require_links()
            row = await self._run_row(db, access, scope.run_id)
            tiers = await load_tiers(db, access.workspace_id)
            settings = await self._alert_settings(db, access, project_id)
            keys: dict[str, Any] = {
                "run_id": str(scope.run_id),
                "workspace_id": str(access.workspace_id),
                "project_id": str(project_id),
                "change": change,
                "scope": link_scope,
                "limit": limit,
                "offset": offset,
                "max_position": settings.max_position,
            }
            totals = (await db.execute(_LINK_TOTALS, keys)).one()
            found = (
                await db.execute(text(_LINKS.format(top=_TOP if only == "top" else "")), keys)
            ).all()
            return ChangeLinkPage(
                data=[
                    ChangeLink(
                        source=_page(
                            item.source_url_id,
                            item.source_url,
                            item.source_path,
                            item.source_tier,
                            tiers,
                        ),
                        target=_page(
                            item.target_url_id,
                            item.target_url,
                            item.target_path,
                            item.target_tier,
                            tiers,
                        ),
                        anchor=item.anchor,
                        placement=item.placement,
                        priority=priority_of(item.target_position) if change == "lost" else "none",
                        still_linked_by=item.still_linked_by,
                    )
                    for item in found
                ],
                meta=ChangeLinkMeta(
                    run_id=scope.run_id,
                    previous_run_id=row.previous_run_id,
                    change=change,
                    link_scope=link_scope,
                    only=only,
                    total=totals.top if only == "top" else totals.stored,
                    truncated=totals.stored >= CHANGES_MAX,
                ),
            )

    async def links_csv(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        run: UUID | None,
        change: Literal["lost", "added"],
        link_scope: Literal["editorial", "all"],
        only: Literal["top", "all"],
    ) -> str:
        listed = await self.links(
            access,
            project_id,
            run=run,
            change=change,
            link_scope=link_scope,
            only=only,
            offset=0,
            limit=EXPORT_ROWS_MAX,
        )
        return csv_text(
            (
                "Change",
                "Source",
                "Target",
                "Anchor",
                "Link type",
                "Target tier",
                "Still linked from",
            ),
            (
                (
                    change.capitalize(),
                    item.source.path,
                    item.target.path,
                    item.anchor,
                    PLACEMENT_LABEL.get(item.placement, item.placement),
                    "Untiered" if item.target.tier is None else item.target.tier.code,
                    ""
                    if item.still_linked_by is None
                    else PLACEMENT_LABEL.get(item.still_linked_by, item.still_linked_by),
                )
                for item in listed.data
            ),
        )

    async def moved(
        self, access: WorkspaceAccess, project_id: UUID, *, run: UUID | None, limit: int
    ) -> MovedPageList:
        async with self._transaction(access) as db:
            scope = await read_scope(db, access, project_id, run)
            row = await self._run_row(db, access, scope.run_id)
            tiers = await load_tiers(db, access.workspace_id)
            found = (
                await db.execute(
                    _MOVED,
                    {
                        "run_id": str(scope.run_id),
                        "workspace_id": str(access.workspace_id),
                        "project_id": str(project_id),
                        "limit": limit,
                    },
                )
            ).all()
            return MovedPageList(
                data=[
                    MovedPage(
                        page=_page(item.url_id, item.canonical_url, item.path, item.tier_id, tiers),
                        editorial_in=item.editorial_in,
                        editorial_in_delta=item.editorial_in_delta,
                        equity_points=item.equity_points,
                        depth=item.click_depth,
                        depth_state=item.depth_state,
                        depth_delta=item.depth_delta,
                    )
                    for item in found
                ],
                meta=MovedPageMeta(run_id=scope.run_id, previous_run_id=row.previous_run_id),
            )
