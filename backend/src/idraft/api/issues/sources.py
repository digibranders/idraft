"""What a project has stored besides its crawl, read once per request: Search Console, rank
checks and AI answers. A check that joins one of them runs only when it is there (spec 5)."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.api.internal_links.extras import gsc_window
from idraft.api.internal_links.page_filter import PageScope
from idraft.api.issues.rules import KEYWORD_ROWS, active_keywords
from idraft.api.keywords.gsc_repository import GscScope
from idraft.db.tables import ai_observations, tracked_keyword_state


@dataclass(frozen=True, slots=True)
class Sources:
    gsc: GscScope
    """`ok` (with the property and the window), `pending` or `not_connected`."""
    ranks: bool
    """A tracked keyword of the project, active and not deleted, has a rank check."""
    ai: bool
    """The project has an answer that was not superseded."""


async def _has_rank_checks(db: AsyncSession, scope: PageScope) -> bool:
    found = await db.execute(
        select(
            exists(
                select(1)
                .select_from(KEYWORD_ROWS)
                .where(
                    *active_keywords(scope),
                    tracked_keyword_state.c.last_observed_at.is_not(None),
                )
            )
        )
    )
    return bool(found.scalar_one())


async def _has_answers(db: AsyncSession, scope: PageScope) -> bool:
    found = await db.execute(
        select(
            exists().where(
                ai_observations.c.workspace_id == scope.workspace_id,
                ai_observations.c.project_id == scope.project_id,
                ai_observations.c.superseded_by.is_(None),
            )
        )
    )
    return bool(found.scalar_one())


async def read_sources(db: AsyncSession, scope: PageScope, need: str | None = None) -> Sources:
    """All three sources, or with `need` (`gsc`, `ranks` or `ai`, as a check names it) only that
    one: a source that was not read is reported as not there, so use the result for that check
    only."""
    return Sources(
        gsc=await gsc_window(db, scope) if need in (None, "gsc") else GscScope("not_connected"),
        ranks=need in (None, "ranks") and await _has_rank_checks(db, scope),
        ai=need in (None, "ai") and await _has_answers(db, scope),
    )
