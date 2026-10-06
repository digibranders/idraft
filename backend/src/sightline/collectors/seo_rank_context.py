"""What the rank rules need to know about a project and one of its tracked keywords: the domain
rules of its entities, whose ranks are kept, which entity events belong to (plan decisions R15
and R20 of docs/superpowers/plans/2026-10-05-rank-ingest.md)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Final, cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from sightline.db.tables import (
    domains,
    project_domain_roles,
    project_entities,
    tracked_keyword_competitors,
)
from sightline.extraction.domains import DomainResolver, DomainRule, MatchScope, ProjectRole
from sightline.extraction.urls import Host
from sightline.ranks.resolve import RankedEntity

_ROLES: Final = frozenset({"own", "competitor", "watch"})
_SCOPES: Final = frozenset({"path_prefix", "host", "registrable"})


@dataclass(frozen=True, slots=True)
class RankContext:
    resolver: DomainResolver
    entities: tuple[RankedEntity, ...]  # own entities and the keyword's competitors
    primary_own: uuid.UUID | None  # the entity events are attributed to; None writes no events


async def load_context(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    tracked_keyword_id: uuid.UUID,
) -> RankContext:
    """The context of one tracked keyword.

    The ranked entities are the project's own entities that track SEO, and its competitors that
    do, plus the entities the keyword includes, minus the ones it excludes. Every attached
    entity's domains are rules, kept or not: a result of a watched or an excluded entity must not
    fall through to a broader rule of another."""
    attached = (
        await db.execute(
            select(
                project_entities.c.entity_id,
                project_entities.c.role,
                project_entities.c.is_primary,
                project_entities.c.track_seo,
            ).where(
                project_entities.c.workspace_id == workspace_id,
                project_entities.c.project_id == project_id,
                project_entities.c.removed_at.is_(None),
            )
        )
    ).all()
    overrides = {
        row.entity_id: row.mode
        for row in await db.execute(
            select(
                tracked_keyword_competitors.c.entity_id, tracked_keyword_competitors.c.mode
            ).where(
                tracked_keyword_competitors.c.workspace_id == workspace_id,
                tracked_keyword_competitors.c.tracked_keyword_id == tracked_keyword_id,
            )
        )
    }

    entities: list[RankedEntity] = []
    primary_own: uuid.UUID | None = None
    for row in attached:
        if row.role == "own":
            if row.track_seo:
                entities.append(RankedEntity(row.entity_id, "own"))
            if row.is_primary:
                primary_own = row.entity_id
            continue
        mode = overrides.get(row.entity_id)
        is_competitor = (row.role == "competitor" and row.track_seo) or mode == "include"
        if is_competitor and mode != "exclude":
            entities.append(RankedEntity(row.entity_id, "competitor"))

    return RankContext(
        resolver=DomainResolver(await _rules(db, workspace_id, project_id)),
        entities=tuple(entities),
        primary_own=primary_own,
    )


async def _rules(
    db: AsyncSession, workspace_id: uuid.UUID, project_id: uuid.UUID
) -> list[DomainRule]:
    rows = await db.execute(
        select(
            project_domain_roles.c.entity_id,
            project_domain_roles.c.role,
            project_domain_roles.c.match_scope,
            project_domain_roles.c.path_prefix,
            domains.c.host,
            domains.c.registrable_domain,
            domains.c.public_suffix,
            domains.c.is_ip,
        )
        .join(domains, domains.c.id == project_domain_roles.c.domain_id)
        .where(
            project_domain_roles.c.workspace_id == workspace_id,
            project_domain_roles.c.project_id == project_id,
        )
    )
    rules: list[DomainRule] = []
    for row in rows:
        if row.role not in _ROLES or row.match_scope not in _SCOPES:
            continue
        role = cast(ProjectRole, row.role)
        scope = cast(MatchScope, row.match_scope)
        rules.append(
            DomainRule(
                entity_id=row.entity_id,
                role=role,
                match_scope=scope,
                host=Host(
                    name=row.host,
                    registrable_domain=row.registrable_domain,
                    public_suffix=row.public_suffix,
                    is_ip=row.is_ip,
                ),
                path_prefix=row.path_prefix,
            )
        )
    return rules
