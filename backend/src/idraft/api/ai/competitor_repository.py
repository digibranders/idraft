"""Reads of the competitors route beyond the prompts summary's (contract C5): the entity
references of the rows and the citation units by entity. The summary holds every other count.
Row-level security keeps every read in the caller's workspace; each query names the workspace and
the project as well."""

from __future__ import annotations

from collections.abc import Collection
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.api.ai import source_repository
from idraft.api.ai.source_repository import SourceScope
from idraft.api.schemas.entities import EntityRef
from idraft.db.tables import ai_citations, entities, project_entities

_C = ai_citations.c


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
