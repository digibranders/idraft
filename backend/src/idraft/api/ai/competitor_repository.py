"""Reads of the competitors route beyond the prompts summary's (contract C5): the entity
references of the rows, the citation units by entity, the lost answers of each competitor and the
top domains of each entity. The summary holds every other count. Row-level security keeps every
read in the caller's workspace; each query names the workspace and the project as well."""

from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import and_, func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.api.ai import source_repository
from idraft.api.ai.source_repository import SourceScope
from idraft.api.schemas.ai_metrics import CompetitorSource
from idraft.api.schemas.entities import EntityRef
from idraft.db.tables import (
    ai_citations,
    ai_observation_facts,
    ai_prompts,
    domains,
    entities,
    project_entities,
)

_C, _F, _D = ai_citations.c, ai_observation_facts.c, domains.c


@dataclass(frozen=True, slots=True)
class LostAnswers:
    """The valid answers of one prompt on one engine that name one competitor and not the own
    brand, and the prompt's importance (1 to 5)."""

    answers: int
    importance: int


async def entity_refs(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, entity_ids: Collection[UUID]
) -> dict[UUID, EntityRef]:
    """The reference of each of `entity_ids` that the project holds now (a role not removed), with
    its live role and colour; an id the project does not hold has no entry."""
    e, pe = entities.c, project_entities.c
    rows = await db.execute(
        select(e.id, e.canonical_name, e.entity_type, pe.role, pe.color_index)
        .join(project_entities, and_(pe.entity_id == e.id, pe.workspace_id == e.workspace_id))
        .where(
            e.workspace_id == workspace_id,
            pe.workspace_id == workspace_id,
            pe.project_id == project_id,
            pe.removed_at.is_(None),
            e.id.in_(list(entity_ids)),
        )
    )
    return {
        row.id: EntityRef(
            entity_id=row.id,
            canonical_name=row.canonical_name,
            entity_type=row.entity_type,
            role=row.role,
            color_index=row.color_index,
        )
        for row in rows
    }


async def entity_units(db: AsyncSession, scope: SourceScope) -> dict[tuple[str, UUID | None], int]:
    """The citation units of each engine by the entity that is the role of the cited domain, over
    the answers and citations the sources lane counts for `scope`. The rows with no entity (third
    parties) are kept, so one statement gives both an entity's units and the engine's whole."""
    answers = source_repository.counted_answers(scope)
    source = answers.join(
        ai_citations,
        and_(
            _C.observation_id == answers.c.observation_id,
            _C.observed_at == answers.c.observed_at,
        ),
    )
    rows = await db.execute(
        select(
            answers.c.engine_code,
            _C.role_entity_id,
            func.count(source_repository.unit()).label("units"),
        )
        .select_from(source)
        .where(*source_repository.citation_bounds(scope))
        .group_by(answers.c.engine_code, _C.role_entity_id)
    )
    return {(row.engine_code, row.role_entity_id): row.units for row in rows}


async def lost_counts(
    db: AsyncSession, scope: SourceScope, entity_ids: Collection[UUID]
) -> dict[tuple[UUID, str, UUID], LostAnswers]:
    """For each prompt, engine and competitor of `entity_ids`: the valid answers that name the
    competitor and not the own brand (the rule of the summary's `lost_to` opportunity), in one
    statement over every competitor and engine. The answers are those the sources lane counts for
    `scope` (valid, current, not superseded, in the window, on the engines and prompts of the
    scope), the same the summary counts; a prompt with no such answer has no entry."""
    answers = source_repository.counted_answers(scope)
    # One row for each competitor an answer names: the array is unnested in the select list.
    named = (
        select(
            answers.c.observation_id,
            answers.c.observed_at,
            answers.c.prompt_id,
            answers.c.engine_code,
            func.unnest(_F.competitor_mentions).label("entity_id"),
        )
        .select_from(answers)
        .join(
            ai_observation_facts,
            and_(
                _F.observation_id == answers.c.observation_id,
                _F.observed_at == answers.c.observed_at,
                _F.derivation_id == answers.c.derivation_id,
            ),
        )
        .where(
            _F.workspace_id == scope.workspace_id,
            _F.project_id == scope.project_id,
            ~_F.own_mentioned,
        )
        .subquery("named")
    )
    n, p = named.c, ai_prompts.c
    rows = await db.execute(
        select(
            n.prompt_id,
            n.engine_code,
            n.entity_id,
            p.importance,
            func.count(tuple_(n.observation_id, n.observed_at).distinct()).label("answers"),
        )
        .select_from(named)
        .join(
            ai_prompts,
            and_(
                p.id == n.prompt_id,
                p.workspace_id == scope.workspace_id,
                p.project_id == scope.project_id,
            ),
        )
        .where(n.entity_id.in_(list(entity_ids)))
        .group_by(n.prompt_id, n.engine_code, n.entity_id, p.importance)
    )
    return {
        (row.prompt_id, row.engine_code, row.entity_id): LostAnswers(row.answers, row.importance)
        for row in rows
    }


async def top_sources(
    db: AsyncSession, scope: SourceScope, entity_ids: Collection[UUID], limit: int
) -> dict[UUID, list[CompetitorSource]]:
    """The top `limit` domains of each of `entity_ids`: those cited with the entity as the role of
    the domain, over all the engines of `scope`, by citation units, then domain; with the answers
    that cite it. The sources lane's counting (answers, flags) decides what counts. An entity with
    no cited domain has no entry."""
    answers = source_repository.counted_answers(scope)
    source = answers.join(
        ai_citations,
        and_(
            _C.observation_id == answers.c.observation_id,
            _C.observed_at == answers.c.observed_at,
        ),
    ).join(domains, _D.id == _C.domain_id)
    grouped = (
        select(
            _C.role_entity_id.label("entity_id"),
            _D.registrable_domain.label("domain"),
            func.count(source_repository.unit()).label("units"),
            func.count(_C.observation_id.distinct()).label("answers"),
        )
        .select_from(source)
        .where(*source_repository.citation_bounds(scope), _C.role_entity_id.in_(list(entity_ids)))
        .group_by(_C.role_entity_id, _D.registrable_domain)
        .subquery("grouped")
    )
    g = grouped.c
    ranked = select(
        g.entity_id,
        g.domain,
        g.units,
        g.answers,
        func.row_number()
        .over(partition_by=g.entity_id, order_by=(g.units.desc(), g.domain))
        .label("place"),
    ).subquery("ranked")
    r = ranked.c
    rows = await db.execute(
        select(r.entity_id, r.domain, r.units, r.answers)
        .where(r.place <= limit)
        .order_by(r.entity_id, r.place)
    )
    found: dict[UUID, list[CompetitorSource]] = {}
    for row in rows:
        found.setdefault(row.entity_id, []).append(
            CompetitorSource(
                registrable_domain=row.domain, citation_units=row.units, answers=row.answers
            )
        )
    return found
