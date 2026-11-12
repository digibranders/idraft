"""What extraction needs to know about a project, read by the worker (spec section 4.4): its
tracked entities with their aliases, sites and hints as an alias matcher, its domain rules as a
resolver, the role of each entity, and the entity configuration version all of it is.

The API builds the same matcher for the alias test (`api/entities/project_service.py`); this is
the worker's copy of those reads, which names the workspace in every query because the worker
bypasses row-level security. Only entities the project tracks in AI answers (`track_ai`) are
matched. The domains of every entity with a live role in the project are rules, as for rank
checks, so the site of an entity that is not tracked does not fall through to a broader rule of
another.
"""

from __future__ import annotations

import uuid
from collections.abc import Collection, Mapping
from dataclasses import dataclass
from typing import Final, cast

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.collectors.seo_rank_context import domain_rules
from idraft.db.tables import (
    domains,
    entities,
    entity_aliases,
    entity_domains,
    project_entities,
    projects,
)
from idraft.extraction.aliases import AliasMatcher, AliasRule, EntityRule, MatchMode
from idraft.extraction.domains import DomainResolver, ProjectRole

_ROLES: Final = frozenset({"own", "competitor", "watch"})
_MODES: Final = frozenset({"word_boundary", "exact_case", "substring", "regex"})


@dataclass(frozen=True, slots=True)
class AiContext:
    entity_config_version: int
    matcher: AliasMatcher
    resolver: DomainResolver
    # The entities the project tracks in AI answers, by role.
    roles: Mapping[uuid.UUID, ProjectRole]


async def load_ai_context(
    db: AsyncSession, *, workspace_id: uuid.UUID, project_id: uuid.UUID
) -> AiContext | None:
    """The project's context; None for a project that is not there."""
    version: int | None = (
        await db.execute(
            select(projects.c.entity_config_version).where(
                projects.c.workspace_id == workspace_id, projects.c.id == project_id
            )
        )
    ).scalar_one_or_none()
    if version is None:
        return None
    e, pe = entities.c, project_entities.c
    rows = (
        await db.execute(
            select(
                e.id,
                e.canonical_name,
                e.parent_entity_id,
                e.is_ambiguous,
                e.disambiguation_hints,
                pe.role,
            )
            .join(
                project_entities,
                and_(pe.entity_id == e.id, pe.workspace_id == e.workspace_id),
            )
            .where(
                pe.workspace_id == workspace_id,
                pe.project_id == project_id,
                pe.removed_at.is_(None),
                pe.track_ai,
            )
        )
    ).all()
    tracked = [row for row in rows if row.role in _ROLES]
    ids = [row.id for row in tracked]
    hosts = await _hosts(db, workspace_id, ids)
    matcher = AliasMatcher(
        [
            EntityRule(
                id=row.id,
                canonical_name=row.canonical_name,
                parent_entity_id=row.parent_entity_id,
                is_ambiguous=row.is_ambiguous,
                hints=tuple(row.disambiguation_hints),
                domains=tuple(hosts.get(row.id, ())),
            )
            for row in tracked
        ],
        await _aliases(db, workspace_id, ids),
    )
    return AiContext(
        entity_config_version=version,
        matcher=matcher,
        resolver=DomainResolver(await domain_rules(db, workspace_id, project_id)),
        roles={row.id: cast(ProjectRole, row.role) for row in tracked},
    )


async def _hosts(
    db: AsyncSession, workspace_id: uuid.UUID, entity_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, list[str]]:
    """The hosts of each entity's host and registrable rules: its domain-shaped aliases. A path
    prefix names part of a site, not a name people write."""
    if not entity_ids:
        return {}
    rows = await db.execute(
        select(entity_domains.c.entity_id, domains.c.host)
        .join(domains, domains.c.id == entity_domains.c.domain_id)
        .where(
            entity_domains.c.workspace_id == workspace_id,
            entity_domains.c.entity_id.in_(list(entity_ids)),
            entity_domains.c.match_scope != "path_prefix",
        )
    )
    found: dict[uuid.UUID, list[str]] = {}
    for row in rows:
        found.setdefault(row.entity_id, []).append(row.host)
    return found


async def _aliases(
    db: AsyncSession, workspace_id: uuid.UUID, entity_ids: Collection[uuid.UUID]
) -> list[AliasRule]:
    if not entity_ids:
        return []
    a = entity_aliases.c
    rows = await db.execute(
        select(
            a.id,
            a.entity_id,
            a.alias,
            a.match_mode,
            a.case_sensitive,
            a.is_negative,
            a.requires_context,
        )
        .where(a.workspace_id == workspace_id, a.entity_id.in_(list(entity_ids)))
        .order_by(a.created_at, a.id)
    )
    return [
        AliasRule(
            id=row.id,
            entity_id=row.entity_id,
            alias=row.alias,
            match_mode=cast(MatchMode, row.match_mode),
            case_sensitive=row.case_sensitive,
            is_negative=row.is_negative,
            requires_context=row.requires_context,
        )
        for row in rows
        if row.match_mode in _MODES
    ]


class AiContextCache:
    """The contexts of one ingest pass, by project. A pass is short; an alias changed during it
    applies from the next pass, and the derivation records the version that was used."""

    def __init__(self) -> None:
        self._found: dict[tuple[uuid.UUID, uuid.UUID], AiContext | None] = {}

    async def get(
        self, db: AsyncSession, workspace_id: uuid.UUID, project_id: uuid.UUID
    ) -> AiContext | None:
        key = (workspace_id, project_id)
        if key not in self._found:
            self._found[key] = await load_ai_context(
                db, workspace_id=workspace_id, project_id=project_id
            )
        return self._found[key]
