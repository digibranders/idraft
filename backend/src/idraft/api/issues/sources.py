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


async def read_sources(db: AsyncSession, scope: PageScope) -> Sources:
    ranks = (
        await db.execute(
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
    ).scalar_one()
    answered = (
        await db.execute(
            select(
                exists().where(
                    ai_observations.c.workspace_id == scope.workspace_id,
                    ai_observations.c.project_id == scope.project_id,
                    ai_observations.c.superseded_by.is_(None),
                )
            )
        )
    ).scalar_one()
    return Sources(gsc=await gsc_window(db, scope), ranks=ranks, ai=answered)
