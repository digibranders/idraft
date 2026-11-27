"""Cannibalization and Switching reads (docs/33). Every read loads the stored checks of one
device once (two periods' worth, for the comparison) and applies the rules; nothing is stored
and nothing is bought from a provider."""

from __future__ import annotations

from collections.abc import Mapping
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import UTC, date, datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.ai.engine_service import live_project
from idraft.api.cannibalization import model
from idraft.api.cannibalization.repository import KeywordSeries, UrlInfo, load_series
from idraft.api.problems import NotFoundError
from idraft.api.schemas.cannibalization import (
    CannKeywordDetail,
    CannMeta,
    CannUrl,
    ConflictList,
    DeviceName,
    PairList,
    SwitchList,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction

ROWS_MAX = 2000


@dataclass(frozen=True, slots=True)
class OffTarget:
    """A tracked keyword whose ranking page is not the page set as its target (Issues check
    `off-target`)."""

    tracked_keyword_id: UUID
    keyword: str
    target_url_id: int
    current_url_id: int
    current_rank: int


class CannibalizationService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(
            self._sessions,
            access.workspace_id,
            user_id=access.user_id,
            isolation_level="REPEATABLE READ",
        )

    async def _load(
        self,
        db: AsyncSession,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        device: DeviceName,
        days: int,
        today: date | None,
        group_id: UUID | None = None,
        tracked_keyword_id: UUID | None = None,
    ) -> tuple[model.Window, list[model.Result], Mapping[int, UrlInfo]]:
        await live_project(db, access, project_id)
        utc_today = (today or datetime.now(UTC).date()).toordinal()
        # `observed_date` is the keyword's own local date, which may be a day ahead of UTC: the
        # period ends on the newest check, and the load starts a day early to cover it.
        series, urls = await load_series(
            db,
            workspace_id=access.workspace_id,
            project_id=project_id,
            device=device,
            since=date.fromordinal(utc_today - 2 * days - 1),
            group_id=group_id,
            tracked_keyword_id=tracked_keyword_id,
        )
        newest = max((c.day for s in series for c in s.checks), default=utc_today)
        window = model.Window(today=max(utc_today, newest), days=days)
        return window, model.analyse_all(series, window), urls

    @staticmethod
    def _meta(
        window: model.Window, device: DeviceName, results: list[model.Result], total: int
    ) -> CannMeta:
        return CannMeta(
            days=window.days,
            device=device,
            date_from=date.fromordinal(window.start + 1),
            date_to=date.fromordinal(window.today),
            has_previous=any(r.before is not None for r in results),
            total=total,
        )

    async def conflicts(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        device: DeviceName,
        days: int,
        verdict: str,
        group_id: UUID | None,
        limit: int,
        today: date | None = None,
    ) -> ConflictList:
        async with self._transaction(access) as db:
            window, results, urls = await self._load(
                db, access, project_id, device=device, days=days, today=today, group_id=group_id
            )
        shown = [r for r in model.sort_results(results) if model.matches(r, verdict)]
        return ConflictList(
            meta=self._meta(window, device, results, len(shown)),
            headline=model.conflict_headline(results),
            counts=model.verdict_counts(results),
            items=[model.keyword_row(r, urls, device) for r in shown[:limit]],
        )

    async def pairs(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        device: DeviceName,
        days: int,
        group_id: UUID | None,
        today: date | None = None,
    ) -> PairList:
        async with self._transaction(access) as db:
            window, results, urls = await self._load(
                db, access, project_id, device=device, days=days, today=today, group_id=group_id
            )
        items = model.pair_rows(results, urls)
        return PairList(meta=self._meta(window, device, results, len(items)), items=items)

    async def switches(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        device: DeviceName,
        days: int,
        kind: str,
        group_id: UUID | None,
        limit: int,
        today: date | None = None,
    ) -> SwitchList:
        async with self._transaction(access) as db:
            window, results, urls = await self._load(
                db, access, project_id, device=device, days=days, today=today, group_id=group_id
            )
        rows = model.switch_rows(results, urls)
        shown = [r for r in rows if model.switch_matches(r, kind)]
        return SwitchList(
            meta=self._meta(window, device, results, len(shown)),
            headline=model.switch_headline(results, rows),
            weeks=model.weekly_switches(rows, window),
            items=shown[:limit],
        )

    async def keyword(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        tracked_keyword_id: UUID,
        *,
        device: DeviceName,
        days: int,
        today: date | None = None,
    ) -> CannKeywordDetail:
        async with self._transaction(access) as db:
            window, results, urls = await self._load(
                db,
                access,
                project_id,
                device=device,
                days=days,
                today=today,
                tracked_keyword_id=tracked_keyword_id,
            )
        if not results:
            raise NotFoundError
        (result,) = results
        series: KeywordSeries = result.series
        checks = model.keyword_checks(series, window)
        row = model.keyword_row(result, urls, device)
        named = {int(rank.url_id) for check in checks for rank in check.ranks}
        named |= {int(page.url_id) for page in row.pages}
        return CannKeywordDetail(
            meta=self._meta(window, device, results, 1),
            keyword=row,
            urls=[
                CannUrl(
                    url_id=str(page),
                    url=urls[page].url,
                    path=urls[page].path,
                    title=urls[page].title,
                )
                for page in sorted(named)
                if page in urls
            ],
            checks=checks,
        )

    async def page_conflicts(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        device: DeviceName = "desktop",
        days: int = 30,
        today: date | None = None,
    ) -> dict[int, model.PageConflicts]:
        """Per own page (core.urls id), the keywords where it competes with another own page.
        For Monitoring's `cannibalization` column and the Issues check of the same name."""
        async with self._transaction(access) as db:
            _, results, _ = await self._load(
                db, access, project_id, device=device, days=days, today=today
            )
        return model.conflicts_by_page(results)

    async def off_target(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        device: DeviceName = "desktop",
        days: int = 30,
        today: date | None = None,
    ) -> list[OffTarget]:
        """Keywords with a target page whose ranking page now is another page (Issues check
        `off-target`)."""
        async with self._transaction(access) as db:
            _, results, _ = await self._load(
                db, access, project_id, device=device, days=days, today=today
            )
        return [
            OffTarget(
                r.series.tracked_keyword_id,
                r.series.keyword,
                r.series.target_url_id,
                r.now.current,
                r.now.current_rank,
            )
            for r in results
            if r.series.target_url_id is not None
            and r.now.current is not None
            and r.now.current_rank is not None
            and r.now.strip[-1].kind == "page"
            and r.now.current != r.series.target_url_id
        ]
