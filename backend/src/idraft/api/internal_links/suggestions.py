"""Tier suggestions (spec 7.10, plan 04 D13). The list is computed when read from live data: the
latest crawl's live indexable pages with their tiers, Google's clicks per page over 28 days (only
when the property has page days stored, otherwise ranks decide alone) and the ranks of tracked
keywords. Accepting is a manual tier change through the usual service, so it writes
`page_tiers.changed` and recomputes the tier flow; dismissing is stored per project."""

from __future__ import annotations

from contextlib import AbstractAsyncContextManager
from typing import Any, cast
from uuid import UUID

from sqlalchemy import CursorResult, select, text
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api import audit
from idraft.api.ai.engine_service import live_project
from idraft.api.internal_links.extras import gsc_window, keywords_of
from idraft.api.internal_links.page_tiers import PageTierService
from idraft.api.internal_links.reads import load_tiers, read_scope
from idraft.api.request_info import RequestInfo
from idraft.api.schemas.internal_links import BULK_IDS_MAX, PageTierSet
from idraft.api.schemas.internal_links_extra import (
    SuggestionReason,
    SuggestionSelection,
    TierSuggestionList,
    TierSuggestionMeta,
    TierSuggestionRow,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.collectors.gsc_pages import page_clicks
from idraft.crawl.suggest import KeywordHit, SuggestPage, suggest_tiers
from idraft.db.engine import workspace_transaction
from idraft.db.tables import tier_suggestion_dismissals

# The pages a suggestion may be about: live and indexable in the crawl in scope.
_PAGES = text(
    """
    SELECT cp.url_id, u.canonical_url, u.path, cp.title, pp.tier_id, pp.tier_source
    FROM seo.crawl_pages cp
    JOIN core.urls u ON u.id = cp.url_id
    LEFT JOIN core.project_pages pp ON pp.workspace_id = cp.workspace_id
         AND pp.project_id = cp.project_id AND pp.url_id = cp.url_id
    WHERE cp.run_id = CAST(:run_id AS uuid) AND cp.workspace_id = CAST(:workspace_id AS uuid)
      AND cp.status_code = 200 AND cp.is_indexable
    ORDER BY u.path, cp.url_id
    """
)


class SuggestionService:
    def __init__(
        self, *, sessions: async_sessionmaker[AsyncSession], page_tiers: PageTierService
    ) -> None:
        self._sessions = sessions
        self._page_tiers = page_tiers

    def _read(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(
            self._sessions,
            access.workspace_id,
            user_id=access.user_id,
            isolation_level="REPEATABLE READ",
        )

    async def _compute(
        self, db: AsyncSession, access: WorkspaceAccess, project_id: UUID
    ) -> TierSuggestionList:
        scope = await read_scope(db, access, project_id, None)
        tiers = await load_tiers(db, access.workspace_id)
        by_position = {position: tier_id for tier_id, position in tiers.positions.items()}
        pages = (
            await db.execute(
                _PAGES, {"run_id": str(scope.run_id), "workspace_id": str(access.workspace_id)}
            )
        ).all()
        gsc = await gsc_window(db, scope)
        clicks: dict[int, int] = {}
        if gsc.integration_id is not None and gsc.window is not None:
            found = await page_clicks(
                db, access.workspace_id, project_id, gsc.integration_id, gsc.window, None
            )
            clicks = {url: value.clicks for url, value in found.items()}
        keywords = await keywords_of(db, scope, [page.url_id for page in pages])
        dismissed: set[int] = set(
            (
                await db.execute(
                    select(tier_suggestion_dismissals.c.url_id).where(
                        tier_suggestion_dismissals.c.workspace_id == access.workspace_id,
                        tier_suggestion_dismissals.c.project_id == project_id,
                    )
                )
            ).scalars()
        )
        positions = tiers.positions
        inputs = [
            SuggestPage(
                url_id=page.url_id,
                tier_position=positions.get(page.tier_id) if page.tier_id is not None else None,
                manual=page.tier_source == "manual",
                clicks=clicks.get(page.url_id, 0),
                hits=[
                    KeywordHit(fact.keyword, fact.rank, fact.volume)
                    for fact in keywords.get(page.url_id, [])
                ],
            )
            for page in pages
        ]
        by_url = {page.url_id: page for page in pages}
        rows = [
            TierSuggestionRow(
                url_id=str(item.url_id),
                url=by_url[item.url_id].canonical_url,
                path=by_url[item.url_id].path,
                title=by_url[item.url_id].title,
                from_tier=tiers.ref(by_url[item.url_id].tier_id),
                to_tier=tiers.refs[by_position[item.to_position]],
                reasons=[
                    SuggestionReason(
                        kind=reason.kind,
                        clicks=reason.clicks,
                        rank=reason.rank,
                        keyword=reason.keyword,
                        volume=reason.volume,
                    )
                    for reason in item.reasons
                ],
            )
            for item in suggest_tiers(inputs, tiers=len(by_position), dismissed=dismissed)
            if item.to_position in by_position
        ]
        return TierSuggestionList(
            data=rows, meta=TierSuggestionMeta(run_id=scope.run_id, gsc_state=gsc.state)
        )

    async def suggestions(self, access: WorkspaceAccess, project_id: UUID) -> TierSuggestionList:
        async with self._read(access) as db:
            return await self._compute(db, access, project_id)

    @staticmethod
    def _chosen(listed: TierSuggestionList, body: SuggestionSelection) -> list[TierSuggestionRow]:
        """The suggestions the body names; an id that is not a suggestion is left out."""
        if body.all:
            return listed.data
        wanted = {str(url_id) for url_id in body.url_ids or ()}
        return [row for row in listed.data if row.url_id in wanted]

    async def accept(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        body: SuggestionSelection,
        info: RequestInfo,
    ) -> tuple[int, int]:
        """Each chosen page gets its suggested tier as a manual tier, through the usual change
        (one call per target tier and 5,000 pages). Returns (matched, changed)."""
        async with self._read(access) as db:
            chosen = self._chosen(await self._compute(db, access, project_id), body)
        by_tier: dict[UUID, list[int]] = {}
        for row in chosen:
            by_tier.setdefault(row.to_tier.tier_id, []).append(int(row.url_id))
        matched = changed = 0
        for tier_id, url_ids in by_tier.items():
            for start in range(0, len(url_ids), BULK_IDS_MAX):
                found, moved = await self._page_tiers.set_tiers(
                    access,
                    project_id,
                    PageTierSet(url_ids=url_ids[start : start + BULK_IDS_MAX], tier_id=tier_id),
                    info,
                )
                matched += found
                changed += moved
        return matched, changed

    async def dismiss(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        body: SuggestionSelection,
        info: RequestInfo,
    ) -> tuple[int, int]:
        """Hide the chosen suggestions for the project. Returns (matched, changed)."""
        async with workspace_transaction(
            self._sessions, access.workspace_id, user_id=access.user_id
        ) as db:
            await live_project(db, access, project_id, lock=True)
            chosen = self._chosen(await self._compute(db, access, project_id), body)
            changed = 0
            for start in range(0, len(chosen), BULK_IDS_MAX):
                result = await db.execute(
                    upsert(tier_suggestion_dismissals)
                    .values(
                        [
                            {
                                "project_id": project_id,
                                "workspace_id": access.workspace_id,
                                "url_id": int(row.url_id),
                                "dismissed_by": access.user_id,
                            }
                            for row in chosen[start : start + BULK_IDS_MAX]
                        ]
                    )
                    .on_conflict_do_nothing()
                )
                changed += cast("CursorResult[Any]", result).rowcount
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="tier_suggestion.dismissed",
                target_type="project",
                target_id=project_id,
                info=info,
                after={"pages": len(chosen), "changed": changed},
            )
            return len(chosen), changed
