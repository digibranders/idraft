"""Read model of the page drawer's AI tab (`GET .../internal-links/pages/{url_id}/ai`,
docs/superpowers/specs/2026-11-28-page-ai-tab-design.md sections 4, 5, 8)."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from datetime import date, datetime
from typing import Final, Literal
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.api.ai import citation_board_repository, source_repository
from idraft.api.ai.sources import local_instants, shown_engines
from idraft.api.ai.summary import previous_dates, summary_dates
from idraft.api.internal_links.page_ai_model import (
    PageAiInput,
    citing_in_current,
    count_page_ai,
)
from idraft.api.internal_links.page_filter import PageScope
from idraft.api.problems import NotFoundError
from idraft.api.ranks.repository import project_zone
from idraft.api.schemas.internal_links_ai import PageAi
from idraft.db.tables import crawl_pages
from idraft.domain.ai_engines import ENGINES, PROMPT_ENGINES, EngineCode

_ENGINE_ORDER: Final = tuple(str(code) for code in PROMPT_ENGINES)


async def _crawled_urls(
    db: AsyncSession, scope: PageScope, url_ids: Sequence[int]
) -> frozenset[int]:
    if not url_ids:
        return frozenset()
    rows = await db.execute(
        select(crawl_pages.c.url_id).where(
            crawl_pages.c.workspace_id == scope.workspace_id,
            crawl_pages.c.project_id == scope.project_id,
            crawl_pages.c.run_id == scope.run_id,
            crawl_pages.c.url_id.in_(list(url_ids)),
        )
    )
    return frozenset(rows.scalars())


async def load_page_ai(
    db: AsyncSession,
    scope: PageScope,
    *,
    url_id: int,
    start: date | None,
    end: date | None,
    compare: Literal["none", "previous_period"],
) -> PageAi:
    """Load the AI tab data for one page in one transaction (spec section 8)."""
    held = await db.execute(
        select(crawl_pages.c.url_id).where(
            crawl_pages.c.workspace_id == scope.workspace_id,
            crawl_pages.c.project_id == scope.project_id,
            crawl_pages.c.run_id == scope.run_id,
            crawl_pages.c.url_id == url_id,
        )
    )
    if held.first() is None:
        raise NotFoundError

    zone_row = await project_zone(db, scope.workspace_id, scope.project_id)
    if zone_row is None:
        raise NotFoundError
    zone = ZoneInfo(zone_row.timezone)
    today = datetime.now(zone).date()
    first, last = summary_dates(start, end, today)
    previous = previous_dates(first, last) if compare == "previous_period" else None
    earliest = previous[0] if previous is not None else first
    since, until = local_instants(earliest, last, zone)

    engines = sorted(shown_engines(None), key=_ENGINE_ORDER.index)
    labels = {code: ENGINES[EngineCode(code)].label for code in engines}
    prompt_ids = await source_repository.scope_prompts(
        db,
        scope.workspace_id,
        scope.project_id,
        include_branded=True,
        prompt_id=None,
        term_id=None,
        country_iso=None,
    )
    if not prompt_ids:
        return count_page_ai(
            PageAiInput(
                url_id=url_id,
                zone=zone,
                first=first,
                last=last,
                previous=previous,
                engines=engines,
                labels=labels,
                answers=(),
                citing=frozenset(),
                units={},
                prompts_in_scope=0,
            )
        ).build({}, frozenset())

    source_scope = source_repository.SourceScope(
        workspace_id=scope.workspace_id,
        project_id=scope.project_id,
        since=since,
        until=until,
        engine_codes=tuple(engines),
        prompt_ids=prompt_ids,
        excluded_flags=source_repository.EXCLUDED_FLAGS,
    )
    answers = await citation_board_repository.lookback_answers(db, source_scope)
    citing = await citation_board_repository.citing_observations(db, source_scope, url_id)
    partial = PageAiInput(
        url_id=url_id,
        zone=zone,
        first=first,
        last=last,
        previous=previous,
        engines=engines,
        labels=labels,
        answers=answers,
        citing=citing,
        units={},
        prompts_in_scope=len(prompt_ids),
    )
    current_citing = citing_in_current(partial)
    units = (
        await citation_board_repository.units_of(db, source_scope, current_citing)
        if current_citing
        else {}
    )
    counted = count_page_ai(replace(partial, units=units))
    texts = (
        await citation_board_repository.prompt_texts(db, scope.workspace_id, counted.prompt_ids)
        if counted.prompt_ids
        else {}
    )
    crawled = await _crawled_urls(db, scope, counted.own_urls)
    return counted.build(texts, crawled)
