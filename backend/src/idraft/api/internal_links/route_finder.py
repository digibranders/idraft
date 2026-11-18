"""The shortest route from the start page to a page (spec 7.10, plan 04 D14), by a search that
asks the database for one level of links at a time, so a site of 50,000 pages and 600,000 links
is never held in memory."""

from __future__ import annotations

from collections.abc import Sequence
from contextlib import AbstractAsyncContextManager
from typing import Final
from uuid import UUID

from sqlalchemy import ARRAY, BigInteger, and_, bindparam, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.internal_links.page_filter import PageScope
from idraft.api.internal_links.reads import Tiers, load_tiers, read_scope
from idraft.api.problems import NotFoundError
from idraft.api.schemas.internal_links_extra import ChangePage, Route, Routes, RouteStep
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.crawl.paths import MAX_LEVELS, Hop, Step, rebuild_route
from idraft.db.engine import workspace_transaction
from idraft.db.tables import crawl_pages, crawl_runs, project_pages, urls

REDIRECT_ANCHOR: Final = "301 redirect"
# A level can hold thousands of pages (a menu, a footer or an index leads to many at once), and
# the pages of a level go into the next query as an array: they are sent this many at a time,
# so no page of a level is left unsearched and the route stays the shortest.
FRONTIER_CHUNK: Final = 20_000
# One row per page reached: among the links that reach a page in this level the first by scope
# (editorial, auto-generated, template), then by source page and link id, is the step. That also
# keeps one level's answer to at most one row per page of the crawl.
_LEVEL_SQL: Final = """
    SELECT DISTINCT ON (target_url_id)
           source_url_id, target_url_id, anchor, placement, scope
    FROM seo.crawl_links
    WHERE run_id = CAST(:run_id AS uuid) AND workspace_id = CAST(:workspace_id AS uuid)
      AND source_url_id = ANY(:frontier) AND is_followed AND source_url_id <> target_url_id
      {scope}
    ORDER BY target_url_id,
             CASE scope WHEN 'editorial' THEN 0 WHEN 'auto_generated' THEN 1 ELSE 2 END,
             source_url_id, id
"""


class RouteFinder:
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
    async def _search(
        db: AsyncSession,
        keys: dict[str, str],
        redirects: dict[int, int],
        start: int,
        target: int,
        *,
        editorial: bool,
    ) -> dict[int, Hop] | None:
        """Level by level from `start`: the hop that reached each page, or None when `target`
        was not reached within `MAX_LEVELS` clicks. A redirect page has one way on, its target."""
        statement = text(
            _LEVEL_SQL.format(scope="AND scope = 'editorial'" if editorial else "")
        ).bindparams(bindparam("frontier", type_=ARRAY(BigInteger)))
        parents: dict[int, Hop] = {}
        seen = {start}
        frontier = [start]
        for _ in range(MAX_LEVELS):
            if not frontier or target in seen:
                break
            following: list[int] = []
            plain: list[int] = []
            for page in frontier:
                goal = redirects.get(page)
                if goal is None:
                    plain.append(page)
                elif goal not in seen:
                    seen.add(goal)
                    parents[goal] = Hop(
                        page, goal, REDIRECT_ANCHOR, "content", "editorial", redirect=True
                    )
                    following.append(goal)
            for offset in range(0, len(plain), FRONTIER_CHUNK):
                chunk = plain[offset : offset + FRONTIER_CHUNK]
                for row in await db.execute(statement, {**keys, "frontier": chunk}):
                    if row.target_url_id in seen:
                        continue
                    seen.add(row.target_url_id)
                    parents[row.target_url_id] = Hop(
                        row.source_url_id, row.target_url_id, row.anchor, row.placement, row.scope
                    )
                    following.append(row.target_url_id)
            frontier = following
        return parents if target in seen else None

    @staticmethod
    async def _pages(
        db: AsyncSession, scope: PageScope, tiers: Tiers, ids: Sequence[int]
    ) -> dict[int, ChangePage]:
        """The page cards of the given URL ids. The ids come from the crawl's own pages and
        links, so no id of another workspace can be among them."""
        rows = await db.execute(
            select(urls.c.id, urls.c.canonical_url, urls.c.path, project_pages.c.tier_id)
            .select_from(
                urls.outerjoin(
                    project_pages,
                    and_(
                        project_pages.c.workspace_id == scope.workspace_id,
                        project_pages.c.project_id == scope.project_id,
                        project_pages.c.url_id == urls.c.id,
                    ),
                )
            )
            .where(urls.c.id.in_(list(ids)))
        )
        return {
            row.id: ChangePage(
                url_id=str(row.id),
                url=row.canonical_url,
                path=row.path,
                tier=tiers.ref(row.tier_id),
            )
            for row in rows
        }

    async def _route(
        self, db: AsyncSession, scope: PageScope, tiers: Tiers, steps: list[Step]
    ) -> Route:
        ids = [step.url_id for step in steps]
        cards = await self._pages(db, scope, tiers, ids)
        status = {
            row.url_id: row.status_code
            for row in await db.execute(
                select(crawl_pages.c.url_id, crawl_pages.c.status_code).where(
                    crawl_pages.c.workspace_id == scope.workspace_id,
                    crawl_pages.c.run_id == scope.run_id,
                    crawl_pages.c.url_id.in_(ids),
                )
            )
        }
        # The hop's placement and scope are the database's own values, checked by the model.
        return Route(
            clicks=len(steps) - 1,
            steps=[
                RouteStep.model_validate(
                    {
                        "page": cards[step.url_id],
                        "status_code": status.get(step.url_id),
                        "anchor": None if step.hop is None else step.hop.anchor,
                        "placement": None if step.hop is None else step.hop.placement,
                        "scope": None if step.hop is None else step.hop.scope,
                        "via_redirect": step.hop is not None and step.hop.redirect,
                    }
                )
                for step in steps
            ],
        )

    async def routes(
        self, access: WorkspaceAccess, project_id: UUID, *, run: UUID | None, url_id: int
    ) -> Routes:
        async with self._transaction(access) as db:
            scope = await read_scope(db, access, project_id, run)
            scope.require_links()
            held = (
                await db.execute(
                    select(crawl_pages.c.url_id).where(
                        crawl_pages.c.workspace_id == scope.workspace_id,
                        crawl_pages.c.run_id == scope.run_id,
                        crawl_pages.c.url_id == url_id,
                    )
                )
            ).first()
            if held is None:
                raise NotFoundError
            start: int | None = (
                await db.execute(
                    select(crawl_runs.c.start_url_id).where(
                        crawl_runs.c.workspace_id == scope.workspace_id,
                        crawl_runs.c.id == scope.run_id,
                    )
                )
            ).scalar_one()
            tiers = await load_tiers(db, access.workspace_id)
            target = (await self._pages(db, scope, tiers, [url_id]))[url_id]
            if start is None:
                # A crawl that recorded no start page has no route from it to anywhere.
                return Routes(target=target, any=None, editorial=None)
            redirects = {
                row.url_id: row.redirect_url_id
                for row in await db.execute(
                    select(crawl_pages.c.url_id, crawl_pages.c.redirect_url_id).where(
                        crawl_pages.c.workspace_id == scope.workspace_id,
                        crawl_pages.c.run_id == scope.run_id,
                        crawl_pages.c.redirect_url_id.is_not(None),
                    )
                )
            }
            keys = {"run_id": str(scope.run_id), "workspace_id": str(scope.workspace_id)}
            found: list[Route | None] = []
            for editorial in (False, True):
                parents = await self._search(
                    db, keys, redirects, start, url_id, editorial=editorial
                )
                steps = None if parents is None else rebuild_route(parents, start, url_id)
                found.append(None if steps is None else await self._route(db, scope, tiers, steps))
            return Routes(target=target, any=found[0], editorial=found[1])
