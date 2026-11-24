"""Google AI Overview on the prompts summary (`include=ai_overview`; BE-AIO-03, doc 19 B13).

An AI Overview is not an answer the project asks for: it is what Google showed for a keyword at
its latest rank check. A prompt gets it through the keyword it is linked to, read from
`seo.tracked_keyword_state` (the latest check of each tracked keyword), so nothing here reads the
snapshots and nothing is collected for it: a keyword nobody tracks has no state and the prompt
says `not_tracked`.

Which keyword speaks for a prompt: of its active links, those with an active Google tracked
keyword of this project whose latest check could read the page (`aio_state` `absent`,
`present_cited` or `present_not_cited`; `not_loaded` and `unknown` say nothing). A keyword
tracked at the prompt's place wins over one tracked elsewhere, then the primary link, then the
first by text. The keyword's tracked variants (desktop, mobile) are read together: the overview
is shown when any of them showed it, and cited when any of them cites the own site.
shortcut: a tracked keyword at another place than the prompt's is used when none is tracked at
the prompt's own place; upgrade to a strict market match once prompts and tracked keywords share
one location model.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final, Literal
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.db.tables import (
    ai_prompts,
    keyword_prompt_links,
    keywords,
    projects,
    tracked_keyword_state,
    tracked_keywords,
)
from idraft.keywords.prompt_links import prompt_location_id

SourceState = Literal["no_linked_keyword", "not_tracked", "no_surface", "ok"]

# The verdicts of a check that read the results page (`idraft.ranks.resolve.AioState`).
_READ: Final = frozenset({"absent", "present_cited", "present_not_cited"})


@dataclass(frozen=True, slots=True)
class CheckRow:
    """One active link of a prompt with one tracked variant of its keyword, if it has any."""

    prompt_id: UUID
    keyword_id: UUID
    keyword: str
    is_primary: bool
    prompt_location_id: int | None
    location_id: int | None
    aio_state: str | None
    cited_position: int | None
    observed_at: datetime | None


@dataclass(frozen=True, slots=True)
class AioCell:
    state: SourceState
    keyword: str | None = None
    keyword_id: UUID | None = None
    shown: bool | None = None
    cited_own: bool | None = None
    cited_position: int | None = None
    observed_at: datetime | None = None
    checks: int = 0


async def check_rows(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, prompt_ids: Collection[UUID]
) -> list[CheckRow]:
    """The active links of the prompts with their tracked variants and the state of each: one
    statement for every prompt. A link whose keyword is tracked nowhere comes back with null
    state columns."""
    if not prompt_ids:
        return []
    link, k, tk, st = (
        keyword_prompt_links.c,
        keywords.c,
        tracked_keywords.c,
        tracked_keyword_state.c,
    )
    statement = (
        select(
            link.prompt_id,
            link.keyword_id,
            k.text.label("keyword"),
            link.is_primary,
            prompt_location_id().label("prompt_location_id"),
            tk.location_id,
            st.aio_state,
            st.aio_citation_position.label("cited_position"),
            st.last_observed_at.label("observed_at"),
        )
        .select_from(
            keyword_prompt_links.join(
                keywords, and_(k.id == link.keyword_id, k.workspace_id == link.workspace_id)
            )
            .join(
                ai_prompts,
                and_(
                    ai_prompts.c.id == link.prompt_id,
                    ai_prompts.c.workspace_id == link.workspace_id,
                ),
            )
            .join(
                projects,
                and_(
                    projects.c.id == ai_prompts.c.project_id,
                    projects.c.workspace_id == ai_prompts.c.workspace_id,
                ),
            )
            .outerjoin(
                tracked_keywords,
                and_(
                    tk.keyword_id == link.keyword_id,
                    tk.workspace_id == link.workspace_id,
                    tk.project_id == link.project_id,
                    tk.search_engine == "google",
                    tk.is_active.is_(True),
                    tk.deleted_at.is_(None),
                ),
            )
            .outerjoin(
                tracked_keyword_state,
                and_(
                    st.tracked_keyword_id == tk.id,
                    st.workspace_id == tk.workspace_id,
                    st.project_id == tk.project_id,
                ),
            )
        )
        .where(
            link.workspace_id == workspace_id,
            link.project_id == project_id,
            link.prompt_id.in_(list(prompt_ids)),
            link.status == "active",
        )
    )
    return [
        CheckRow(
            prompt_id=row.prompt_id,
            keyword_id=row.keyword_id,
            keyword=row.keyword,
            is_primary=row.is_primary,
            prompt_location_id=row.prompt_location_id,
            location_id=row.location_id,
            aio_state=row.aio_state,
            cited_position=row.cited_position,
            observed_at=row.observed_at,
        )
        for row in await db.execute(statement)
    ]


def _usable(row: CheckRow) -> bool:
    return row.aio_state in _READ and row.observed_at is not None


def _rank(rows: Sequence[CheckRow]) -> tuple[bool, bool, str]:
    """Lower wins: tracked at the prompt's place, the primary link, then the keyword's text."""
    first = rows[0]
    at_place = any(row.location_id == row.prompt_location_id for row in rows)
    return (not at_place, not first.is_primary, first.keyword)


def prompt_cell(rows: Sequence[CheckRow]) -> AioCell:
    """What one prompt shows, from all its link rows."""
    if not rows:
        return AioCell("no_linked_keyword")
    by_keyword: dict[UUID, list[CheckRow]] = defaultdict(list)
    for row in rows:
        if _usable(row):
            by_keyword[row.keyword_id].append(row)
    if not by_keyword:
        return AioCell("not_tracked")
    chosen = min(by_keyword.values(), key=_rank)
    at_place = [row for row in chosen if row.location_id == row.prompt_location_id]
    variants = at_place or chosen
    shown = any(row.aio_state != "absent" for row in variants)
    positions = [
        row.cited_position
        for row in variants
        if row.aio_state == "present_cited" and row.cited_position is not None
    ]
    observed = [row.observed_at for row in variants if row.observed_at is not None]
    return AioCell(
        state="ok" if shown else "no_surface",
        keyword=variants[0].keyword,
        keyword_id=variants[0].keyword_id,
        shown=shown,
        cited_own=any(row.aio_state == "present_cited" for row in variants),
        cited_position=min(positions) if positions else None,
        observed_at=max(observed),
        checks=len(variants),
    )


def prompt_cells(prompt_ids: Collection[UUID], rows: Sequence[CheckRow]) -> dict[UUID, AioCell]:
    """The cell of every prompt in scope, a prompt without a link included."""
    held: dict[UUID, list[CheckRow]] = defaultdict(list)
    for row in rows:
        held[row.prompt_id].append(row)
    return {prompt: prompt_cell(held[prompt]) for prompt in prompt_ids}


@dataclass(frozen=True, slots=True)
class AioTotals:
    prompts: int
    linked: int
    tracked: int
    shown: int
    cited_own: int
    keywords_shown: int
    keywords_cited: int
    observed_at: datetime | None


def totals(cells: dict[UUID, AioCell]) -> AioTotals:
    """The counts the platform figure rests on, over the prompts in scope."""
    values = list(cells.values())
    tracked = [cell for cell in values if cell.state in ("ok", "no_surface")]
    shown = [cell for cell in tracked if cell.shown]
    cited = [cell for cell in shown if cell.cited_own]
    observed = [cell.observed_at for cell in tracked if cell.observed_at is not None]
    return AioTotals(
        prompts=len(values),
        linked=sum(1 for cell in values if cell.state != "no_linked_keyword"),
        tracked=len(tracked),
        shown=len(shown),
        cited_own=len(cited),
        keywords_shown=len({cell.keyword_id for cell in shown}),
        keywords_cited=len({cell.keyword_id for cell in cited}),
        observed_at=max(observed, default=None),
    )
