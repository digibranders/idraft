"""The Citations page (WP-76): one load per request (answers over the lookback, slots, units,
lookups) and the model's counting. One REPEATABLE READ snapshot per request, as the sources
lane, so a table and its `meta` agree while an answer is being ingested."""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import ClassVar
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.ai import citation_board_model as model
from idraft.api.ai import citation_board_repository as repository
from idraft.api.ai import source_repository
from idraft.api.ai.prompt_repository import terms_of
from idraft.api.ai.sources import shown_engines
from idraft.api.pagination import OffsetPageInfo, OffsetParams
from idraft.api.problems import NotFoundError, ProblemError
from idraft.api.ranks.repository import project_zone
from idraft.api.schemas.ai_citation_board import (
    CitationGapDetail,
    CitationGapList,
    CitationGapsMeta,
    CitationOverview,
    CitedPageDetail,
    CitedPagePage,
    CitedPageRow,
    CitedPagesMeta,
    CitedPageSort,
    GapCompetitor,
    OwnerCounts,
    RunWindow,
)
from idraft.api.schemas.ai_sources import DomainRole
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.domain.ai_engines import EngineCode


class CompetitorNotTrackedError(ProblemError):
    """A selected competitor that the project does not track."""

    status, code, title = 422, "competitor_not_tracked", "Competitor is not tracked"


@dataclass(frozen=True, slots=True)
class BoardQuery:
    runs: int
    engine_codes: Sequence[EngineCode] | None
    term_id: UUID | None
    include_branded: bool
    excluded_flags: tuple[str, ...]
    competitor_ids: tuple[UUID, ...] = ()


@dataclass(frozen=True, slots=True)
class Loaded:
    board: model.Board
    engines: list[str]
    texts: dict[UUID, str]
    window: RunWindow


class CitationBoardService:
    # Keys of every `CitedPageSort` value once its leading `-` is removed.
    SORT_KEYS: ClassVar[dict[str, Callable[[CitedPageRow], int | str | datetime]]] = {
        "citations": lambda r: r.citations,
        "change": lambda r: r.citations - r.previous_citations,
        "prompts": lambda r: r.prompts,
        "last_cited": lambda r: r.last_cited_at,
        "page": lambda r: r.url,
    }

    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    @asynccontextmanager
    async def _transaction(self, access: WorkspaceAccess) -> AsyncIterator[AsyncSession]:
        async with workspace_transaction(
            self._sessions,
            access.workspace_id,
            user_id=access.user_id,
            isolation_level="REPEATABLE READ",
        ) as db:
            # As the sources lane: without statistics on a new partition the planner can pick a
            # nested loop over answers and citations (see `SourceService._transaction`).
            await db.execute(text("SET LOCAL enable_nestloop = off"))
            yield db

    async def _load(
        self, db: AsyncSession, access: WorkspaceAccess, project_id: UUID, query: BoardQuery
    ) -> Loaded:
        zone = await project_zone(db, access.workspace_id, project_id)
        if zone is None:
            raise NotFoundError
        engines = shown_engines(query.engine_codes)
        prompt_ids = await source_repository.scope_prompts(
            db,
            access.workspace_id,
            project_id,
            include_branded=query.include_branded,
            prompt_id=None,
            term_id=query.term_id,
            country_iso=None,
        )
        now = datetime.now(UTC)
        scope = source_repository.SourceScope(
            workspace_id=access.workspace_id,
            project_id=project_id,
            since=now - timedelta(days=repository.LOOKBACK_DAYS),
            until=now + timedelta(seconds=1),
            engine_codes=tuple(engines),
            prompt_ids=prompt_ids,
            excluded_flags=query.excluded_flags,
        )
        # No prompt in scope: nothing to read, and `= ANY(empty)` reads would only cost a trip.
        answers = (
            model.assign_slots(await repository.lookback_answers(db, scope)) if prompt_ids else []
        )
        units = await repository.units_of(db, scope, [s.answer for s in answers])
        board = model.Board(runs=query.runs, answers=answers, units=units)
        texts = (
            await repository.prompt_texts(
                db, access.workspace_id, {s.answer.prompt_id for s in answers}
            )
            if answers
            else {}
        )
        number = await repository.run_number(
            db, access.workspace_id, project_id, model.latest_run_id(board)
        )
        window = model.run_window(board, timezone=zone.timezone, run_number=number)
        return Loaded(board, engines, texts, window)

    async def overview(
        self, access: WorkspaceAccess, project_id: UUID, query: BoardQuery
    ) -> CitationOverview:
        async with self._transaction(access) as db:
            loaded = await self._load(db, access, project_id, query)
        return model.overview(
            loaded.board,
            loaded.engines,
            timezone=loaded.window.timezone,
            run_number=loaded.window.latest_run_number,
        )

    async def pages(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        query: BoardQuery,
        *,
        role: DomainRole | None,
        q: str | None,
        sort: CitedPageSort,
        page: OffsetParams,
    ) -> CitedPagePage:
        async with self._transaction(access) as db:
            loaded = await self._load(db, access, project_id, query)
            names = await self._names(db, access, project_id, loaded)
        rows = model.page_rows(loaded.board, loaded.engines, loaded.texts, names)
        # Counted before the role filter and `q`, so the role tabs keep their numbers.
        owners = OwnerCounts(
            own=sum(r.domain_role == "own" for r in rows),
            competitor=sum(r.domain_role == "competitor" for r in rows),
            third_party=sum(r.domain_role == "third_party" for r in rows),
            all=len(rows),
        )
        needle = (q or "").strip().casefold()
        kept = [
            r
            for r in rows
            if (role is None or r.domain_role == role)
            and (needle == "" or needle in r.url.casefold() or needle in (r.title or "").casefold())
        ]
        # Stable passes from the weakest tie-break to the requested key: the address, then
        # most citations first, then the key. A page boundary never moves between requests.
        kept.sort(key=lambda r: r.url_id)
        kept.sort(key=lambda r: r.url)
        kept.sort(key=lambda r: r.citations, reverse=True)
        kept.sort(key=self.SORT_KEYS[sort.lstrip("-")], reverse=sort.startswith("-"))
        return CitedPagePage(
            data=kept[page.offset : page.offset + page.limit],
            page=OffsetPageInfo(offset=page.offset, limit=page.limit, total=len(kept)),
            meta=CitedPagesMeta(
                window=loaded.window, owners=owners, citations=sum(r.citations for r in kept)
            ),
        )

    async def page_detail(
        self, access: WorkspaceAccess, project_id: UUID, query: BoardQuery, url_id: int
    ) -> CitedPageDetail:
        async with self._transaction(access) as db:
            loaded = await self._load(db, access, project_id, query)
            names = await self._names(db, access, project_id, loaded)
        detail = model.page_detail(loaded.board, url_id, loaded.engines, loaded.texts, names)
        if detail is None:
            raise NotFoundError
        return detail.model_copy(update={"window": loaded.window})

    async def gaps(
        self, access: WorkspaceAccess, project_id: UUID, query: BoardQuery
    ) -> CitationGapList:
        async with self._transaction(access) as db:
            loaded = await self._load(db, access, project_id, query)
            competitors = await self._selected(db, access, project_id, query.competitor_ids)
            topics = await self._topics(db, access, loaded)
        rows = model.gap_rows(
            loaded.board,
            loaded.engines,
            query.competitor_ids,
            loaded.texts,
            {prompt: terms[0] for prompt, terms in topics.items()},
        )
        return CitationGapList(
            data=rows,
            meta=CitationGapsMeta(
                window=loaded.window,
                competitors=competitors,
                prompts=len(rows),
                gaps=sum(r.gap > 0 for r in rows),
            ),
        )

    async def gap_detail(
        self, access: WorkspaceAccess, project_id: UUID, query: BoardQuery, prompt_id: UUID
    ) -> CitationGapDetail:
        async with self._transaction(access) as db:
            loaded = await self._load(db, access, project_id, query)
            await self._selected(db, access, project_id, query.competitor_ids)
            topics = await self._topics(db, access, loaded)
        detail = model.gap_detail(
            loaded.board,
            prompt_id,
            loaded.engines,
            query.competitor_ids,
            loaded.texts,
            {prompt: terms[0] for prompt, terms in topics.items()},
            {prompt: [term_id for term_id, _ in terms] for prompt, terms in topics.items()},
        )
        if detail is None:
            raise NotFoundError
        return detail.model_copy(update={"window": loaded.window})

    async def _names(
        self, db: AsyncSession, access: WorkspaceAccess, project_id: UUID, loaded: Loaded
    ) -> dict[UUID, tuple[str, int | None]]:
        ids = {
            u.entity_id
            for units in loaded.board.units.values()
            for u in units
            if u.entity_id is not None
        }
        return await repository.entity_names(db, access.workspace_id, project_id, ids)

    async def _selected(
        self, db: AsyncSession, access: WorkspaceAccess, project_id: UUID, ids: Sequence[UUID]
    ) -> list[GapCompetitor]:
        """The selected competitors, in request order; each must be tracked by the project."""
        tracked = {
            c.entity_id: c
            for c in await repository.tracked_competitors(db, access.workspace_id, project_id)
        }
        unknown = [str(i) for i in ids if i not in tracked]
        if unknown:
            raise CompetitorNotTrackedError(
                f"Not a tracked competitor of the project: {', '.join(unknown)}.",
                entity_ids=unknown,
            )
        return [tracked[i] for i in ids]

    async def _topics(
        self, db: AsyncSession, access: WorkspaceAccess, loaded: Loaded
    ) -> dict[UUID, list[tuple[UUID, str]]]:
        """Each prompt's topic terms in path order (D-1), only for prompts that have one: a market
        or product term is never the Group and never makes two prompts neighbours, and a prompt
        with no topic term has no entry, which the model reads as "no group"."""
        records = await terms_of(db, access.workspace_id, loaded.texts.keys())
        topics = {
            prompt: [(r.term_id, r.name) for r in rs if r.vocabulary_kind == "topic"]
            for prompt, rs in records.items()
        }
        return {prompt: terms for prompt, terms in topics.items() if terms}
