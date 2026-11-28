"""SQL reads of the Citations page (WP-76). The counted answers are those of the sources lane
(`source_repository.counted_answers`: same prompts, validity, currency and supersession rules),
read over `LOOKBACK_DAYS` so every prompt and engine has its last eight runs; the citation units
are read once, for the answers the slots keep. See the module note of `source_repository` on
planning without statistics: these reads bound every `ai.*` table by the window's instants too."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Collection, Sequence
from dataclasses import replace
from datetime import timedelta
from typing import Final
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.api.ai.citation_board_model import Answer, Unit
from idraft.api.ai.source_repository import SourceScope, citation_bounds, counted_answers
from idraft.api.schemas.ai_citation_board import GapCompetitor
from idraft.db.tables import (
    ai_citations,
    ai_observation_facts,
    ai_observations,
    ai_prompt_versions,
    ai_prompts,
    collection_runs,
    domains,
    entities,
    entity_domains,
    project_entities,
    urls,
)

# Eight weekly runs take 56 days; twice the slots of a monthly schedule still fit.
LOOKBACK_DAYS: Final = 183
# asyncpg takes at most 32,767 parameters; one per answer. The ids alone pick the rows (one
# sequence, `observed_at` is already bounded by `citation_bounds`): a tuple IN of (id, observed_at)
# pairs became a BitmapOr of thousands of index scans once the table had statistics, with a plan
# that took seconds to build and to JIT compile.
_KEYS_PER_QUERY: Final = 4000

_O, _C, _D, _U = ai_observations.c, ai_citations.c, domains.c, urls.c


async def lookback_answers(db: AsyncSession, scope: SourceScope) -> list[Answer]:
    """The counted answers of the scope with their run, own mention and competitor mentions,
    newest first (the model reads a URL's first-seen role and entity from the freshest answer).

    An answer with no collection run is its own run per UTC day: `observed_date` of an answer is
    its UTC date (`ai_prompt_ingest` writes it as `observed_at.astimezone(UTC).date()`)."""
    counted = counted_answers(scope)
    facts = ai_observation_facts.alias("mentions")
    f = facts.c
    rows = await db.execute(
        select(
            counted.c.observation_id,
            counted.c.observed_at,
            counted.c.prompt_id,
            counted.c.engine_code,
            _O.collection_run_id,
            _O.observed_date,
            f.own_mentioned,
            f.competitor_mentions,
        )
        .select_from(
            counted.join(
                ai_observations,
                and_(
                    _O.id == counted.c.observation_id,
                    _O.observed_at == counted.c.observed_at,
                    _O.workspace_id == scope.workspace_id,
                    _O.observed_at >= scope.since,
                    _O.observed_at < scope.until,
                ),
            ).join(
                facts,
                and_(
                    f.observation_id == counted.c.observation_id,
                    f.observed_at == counted.c.observed_at,
                    f.derivation_id == counted.c.derivation_id,
                    f.workspace_id == scope.workspace_id,
                    f.observed_at >= scope.since,
                    f.observed_at < scope.until,
                ),
            )
        )
        .order_by(counted.c.observed_at.desc(), counted.c.observation_id.desc())
    )
    return [
        Answer(
            observation_id=row.observation_id,
            observed_at=row.observed_at,
            prompt_id=row.prompt_id,
            engine_code=row.engine_code,
            run_id=row.collection_run_id,
            run_key=str(row.collection_run_id)
            if row.collection_run_id
            else f"day:{row.observed_date}",
            own_mentioned=bool(row.own_mentioned),
            competitors_mentioned=frozenset(row.competitor_mentions or ()),
        )
        for row in rows
    ]


async def units_of(
    db: AsyncSession, scope: SourceScope, answers: Sequence[Answer]
) -> dict[int, list[Unit]]:
    """The citation units of these answers, by observation id, flagged citations left out."""
    found: defaultdict[int, list[Unit]] = defaultdict(list)
    for start in range(0, len(answers), _KEYS_PER_QUERY):
        chunk = answers[start : start + _KEYS_PER_QUERY]
        bounded = replace(
            scope,
            since=min(a.observed_at for a in chunk),
            until=max(a.observed_at for a in chunk) + timedelta(microseconds=1),
        )
        rows = await db.execute(
            select(
                _C.observation_id,
                _C.url_id,
                _U.canonical_url,
                _D.host,
                _D.registrable_domain,
                _U.path,
                func.max(_C.title).label("title"),
                _C.domain_role,
                _C.role_entity_id,
            )
            .select_from(
                ai_citations.join(urls, _U.id == _C.url_id).join(domains, _D.id == _C.domain_id)
            )
            .where(
                *citation_bounds(bounded), _C.observation_id.in_([a.observation_id for a in chunk])
            )
            .group_by(
                _C.observation_id,
                _C.url_id,
                _U.canonical_url,
                _D.host,
                _D.registrable_domain,
                _U.path,
                _C.domain_role,
                _C.role_entity_id,
            )
            .order_by(_C.observation_id, func.min(_C.citation_index))
        )
        for row in rows:
            found[row.observation_id].append(
                Unit(
                    row.observation_id,
                    row.url_id,
                    row.canonical_url,
                    row.host,
                    row.registrable_domain,
                    row.path,
                    row.title,
                    row.domain_role,
                    row.role_entity_id,
                )
            )
    return dict(found)


async def citing_observations(db: AsyncSession, scope: SourceScope, url_id: int) -> frozenset[int]:
    """The ids of the answers in `scope` that cite this address, flagged citations left out.

    The ids alone are enough, as for `units_of`: one sequence, and `citation_bounds` already
    bounds `observed_at`. The caller keeps the counted answers (`lookback_answers`) that match."""
    rows = await db.execute(
        select(_C.observation_id).where(*citation_bounds(scope), _C.url_id == url_id).distinct()
    )
    return frozenset(rows.scalars())


async def prompt_texts(
    db: AsyncSession, workspace_id: UUID, prompt_ids: Collection[UUID]
) -> dict[UUID, str]:
    p, v = ai_prompts.c, ai_prompt_versions.c
    rows = await db.execute(
        select(p.id, v.text)
        .select_from(ai_prompts.join(ai_prompt_versions, v.id == p.current_version_id))
        .where(p.workspace_id == workspace_id, p.id.in_(list(prompt_ids)))
    )
    return {row.id: row.text for row in rows}


async def tracked_competitors(
    db: AsyncSession, workspace_id: UUID, project_id: UUID
) -> list[GapCompetitor]:
    """The project's competitors in the order Settings lists them (added first), with a domain."""
    pe, e, ed, d = project_entities.c, entities.c, entity_domains.c, domains.c
    domain = (
        select(func.min(d.registrable_domain))
        .select_from(entity_domains.join(domains, d.id == ed.domain_id))
        .where(ed.entity_id == pe.entity_id, ed.workspace_id == workspace_id)
        .scalar_subquery()
    )
    rows = await db.execute(
        select(pe.entity_id, e.canonical_name, pe.color_index, domain.label("domain"))
        .select_from(
            project_entities.join(
                entities, and_(e.id == pe.entity_id, e.workspace_id == pe.workspace_id)
            )
        )
        .where(
            pe.workspace_id == workspace_id,
            pe.project_id == project_id,
            pe.role == "competitor",
            pe.removed_at.is_(None),
        )
        .order_by(pe.added_at, pe.entity_id)
    )
    return [
        GapCompetitor(
            entity_id=r.entity_id, name=r.canonical_name, color_index=r.color_index, domain=r.domain
        )
        for r in rows
    ]


async def entity_names(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, ids: Collection[UUID]
) -> dict[UUID, tuple[str, int | None]]:
    if not ids:
        return {}
    pe, e = project_entities.c, entities.c
    rows = await db.execute(
        select(e.id, e.canonical_name, pe.color_index)
        .select_from(
            entities.outerjoin(
                project_entities,
                and_(
                    pe.entity_id == e.id,
                    pe.project_id == project_id,
                    pe.workspace_id == workspace_id,
                ),
            )
        )
        .where(e.workspace_id == workspace_id, e.id.in_(list(ids)))
    )
    return {r.id: (r.canonical_name, r.color_index) for r in rows}


async def run_number(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, run_id: UUID | None
) -> int | None:
    """How many AI prompt runs the project has had up to this run (the footer's "run 48")."""
    if run_id is None:
        return None
    r = collection_runs.c
    start = (
        select(r.window_start)
        .where(r.id == run_id, r.workspace_id == workspace_id)
        .scalar_subquery()
    )
    count = await db.scalar(
        select(func.count()).where(
            r.workspace_id == workspace_id,
            r.project_id == project_id,
            r.workload == "ai_prompt",
            r.status.in_(("completed", "completed_with_errors")),
            r.window_start <= start,
        )
    )
    return int(count or 0) or None
