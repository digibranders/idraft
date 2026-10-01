"""Statements for the roles projects give entities, and what a project's roles add up to: its
domains and its matcher's input. Every function runs inside `workspace_transaction`, and every
statement names the workspace as well."""

from __future__ import annotations

from collections.abc import Collection, Mapping
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import Row, Select, and_, case, func, insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from sightline.db.errors import violated_unique_constraint
from sightline.db.tables import (
    domains,
    entities,
    entity_aliases,
    entity_domains,
    project_entities,
)

_PRIMARY_TAKEN = "project_one_primary_own"
_ROLE_TAKEN = "project_entities_pkey"
_ROLE_ORDER = case({"own": 0, "competitor": 1}, value=project_entities.c.role, else_=2)


class PrimaryOwnTakenError(Exception):
    """Another live own entity of the project is primary. The transaction is spent."""


class RoleTakenError(Exception):
    """The project has a row for this entity already. The transaction is spent."""


@dataclass(frozen=True, slots=True)
class RoleRow:
    project_id: UUID
    entity_id: UUID
    entity_type: str
    canonical_name: str
    role: str
    is_primary: bool
    track_seo: bool
    track_ai: bool
    color_index: int | None
    added_at: datetime
    removed_at: datetime | None
    alias_count: int


def _roles(workspace_id: UUID, project_id: UUID) -> Select[tuple[object, ...]]:
    alias_count = (
        select(func.count())
        .where(
            entity_aliases.c.entity_id == project_entities.c.entity_id,
            entity_aliases.c.workspace_id == workspace_id,
        )
        .scalar_subquery()
    )
    return (
        select(
            project_entities.c.project_id,
            project_entities.c.entity_id,
            entities.c.entity_type,
            entities.c.canonical_name,
            project_entities.c.role,
            project_entities.c.is_primary,
            project_entities.c.track_seo,
            project_entities.c.track_ai,
            project_entities.c.color_index,
            project_entities.c.added_at,
            project_entities.c.removed_at,
            alias_count.label("alias_count"),
        )
        .join(
            entities,
            and_(
                entities.c.id == project_entities.c.entity_id,
                entities.c.workspace_id == project_entities.c.workspace_id,
            ),
        )
        .where(
            project_entities.c.workspace_id == workspace_id,
            project_entities.c.project_id == project_id,
        )
    )


def _role(row: Row[tuple[object, ...]]) -> RoleRow:
    fields = row._mapping
    return RoleRow(
        project_id=fields["project_id"],
        entity_id=fields["entity_id"],
        entity_type=fields["entity_type"],
        canonical_name=fields["canonical_name"],
        role=fields["role"],
        is_primary=fields["is_primary"],
        track_seo=fields["track_seo"],
        track_ai=fields["track_ai"],
        color_index=fields["color_index"],
        added_at=fields["added_at"],
        removed_at=fields["removed_at"],
        alias_count=fields["alias_count"],
    )


async def list_roles(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    *,
    role: str | None,
    include_removed: bool,
) -> list[RoleRow]:
    """Own first, then competitors, then watched entities, each by name."""
    statement = _roles(workspace_id, project_id)
    if role is not None:
        statement = statement.where(project_entities.c.role == role)
    if not include_removed:
        statement = statement.where(project_entities.c.removed_at.is_(None))
    statement = statement.order_by(
        _ROLE_ORDER, func.lower(entities.c.canonical_name), project_entities.c.entity_id
    )
    return [_role(row) for row in await db.execute(statement)]


async def get_role(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, entity_id: UUID
) -> RoleRow | None:
    """The project's row for the entity, live or removed."""
    statement = _roles(workspace_id, project_id).where(project_entities.c.entity_id == entity_id)
    row = (await db.execute(statement)).one_or_none()
    return None if row is None else _role(row)


def _raise_if_taken(error: IntegrityError) -> None:
    name = violated_unique_constraint(error)
    if name == _PRIMARY_TAKEN:
        raise PrimaryOwnTakenError from None
    if name == _ROLE_TAKEN:
        raise RoleTakenError from None


async def insert_role(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    project_id: UUID,
    entity_id: UUID,
    values: Mapping[str, object],
) -> None:
    statement = insert(project_entities).values(
        workspace_id=workspace_id, project_id=project_id, entity_id=entity_id, **values
    )
    try:
        await db.execute(statement)
    except IntegrityError as error:
        _raise_if_taken(error)
        raise


async def update_role(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    project_id: UUID,
    entity_id: UUID,
    values: Mapping[str, object],
) -> None:
    statement = (
        update(project_entities)
        .where(
            project_entities.c.workspace_id == workspace_id,
            project_entities.c.project_id == project_id,
            project_entities.c.entity_id == entity_id,
        )
        .values(**values)
    )
    try:
        await db.execute(statement)
    except IntegrityError as error:
        _raise_if_taken(error)
        raise


async def count_seo_competitors(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, *, besides: UUID
) -> int:
    """Live competitors tracked in SEO, the entity `besides` left out."""
    count: int = (
        await db.execute(
            select(func.count())
            .select_from(project_entities)
            .where(
                project_entities.c.workspace_id == workspace_id,
                project_entities.c.project_id == project_id,
                project_entities.c.entity_id != besides,
                project_entities.c.role == "competitor",
                project_entities.c.track_seo,
                project_entities.c.removed_at.is_(None),
            )
        )
    ).scalar_one()
    return count


@dataclass(frozen=True, slots=True)
class ProjectDomainRow:
    entity_id: UUID
    entity_type: str
    canonical_name: str
    role: str
    color_index: int | None
    domain_id: int
    host: str
    registrable_domain: str
    category: str | None
    category_source: str | None
    match_scope: str
    path_prefix: str | None


async def project_domains(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, *, role: str | None
) -> list[ProjectDomainRow]:
    """The domain rules of the project's live roles."""
    statement = (
        select(
            project_entities.c.entity_id,
            entities.c.entity_type,
            entities.c.canonical_name,
            project_entities.c.role,
            project_entities.c.color_index,
            domains.c.id.label("domain_id"),
            domains.c.host,
            domains.c.registrable_domain,
            domains.c.default_category,
            domains.c.category_source,
            entity_domains.c.match_scope,
            entity_domains.c.path_prefix,
        )
        .join(
            entities,
            and_(
                entities.c.id == project_entities.c.entity_id,
                entities.c.workspace_id == project_entities.c.workspace_id,
            ),
        )
        .join(
            entity_domains,
            and_(
                entity_domains.c.entity_id == project_entities.c.entity_id,
                entity_domains.c.workspace_id == project_entities.c.workspace_id,
            ),
        )
        .join(domains, domains.c.id == entity_domains.c.domain_id)
        .where(
            project_entities.c.workspace_id == workspace_id,
            project_entities.c.project_id == project_id,
            project_entities.c.removed_at.is_(None),
        )
        .order_by(_ROLE_ORDER, func.lower(entities.c.canonical_name), domains.c.host)
    )
    if role is not None:
        statement = statement.where(project_entities.c.role == role)
    return [
        ProjectDomainRow(
            entity_id=row.entity_id,
            entity_type=row.entity_type,
            canonical_name=row.canonical_name,
            role=row.role,
            color_index=row.color_index,
            domain_id=row.domain_id,
            host=row.host,
            registrable_domain=row.registrable_domain,
            category=row.default_category,
            category_source=row.category_source,
            match_scope=row.match_scope,
            path_prefix=row.path_prefix,
        )
        for row in await db.execute(statement)
    ]


@dataclass(frozen=True, slots=True)
class MatcherEntity:
    id: UUID
    canonical_name: str
    entity_type: str
    parent_entity_id: UUID | None
    is_ambiguous: bool
    hints: tuple[str, ...]
    role: str
    color_index: int | None


async def matcher_entities(
    db: AsyncSession, workspace_id: UUID, project_id: UUID
) -> list[MatcherEntity]:
    """The entities of the project's live roles, as the alias matcher reads them."""
    rows = await db.execute(
        select(
            entities.c.id,
            entities.c.canonical_name,
            entities.c.entity_type,
            entities.c.parent_entity_id,
            entities.c.is_ambiguous,
            entities.c.disambiguation_hints,
            project_entities.c.role,
            project_entities.c.color_index,
        )
        .join(
            project_entities,
            and_(
                project_entities.c.entity_id == entities.c.id,
                project_entities.c.workspace_id == entities.c.workspace_id,
            ),
        )
        .where(
            project_entities.c.workspace_id == workspace_id,
            project_entities.c.project_id == project_id,
            project_entities.c.removed_at.is_(None),
        )
    )
    return [
        MatcherEntity(
            id=row.id,
            canonical_name=row.canonical_name,
            entity_type=row.entity_type,
            parent_entity_id=row.parent_entity_id,
            is_ambiguous=row.is_ambiguous,
            hints=tuple(row.disambiguation_hints),
            role=row.role,
            color_index=row.color_index,
        )
        for row in rows
    ]


async def matcher_hosts(
    db: AsyncSession, workspace_id: UUID, entity_ids: Collection[UUID]
) -> dict[UUID, list[str]]:
    """The hosts of each entity's host and registrable rules: its domain-shaped aliases. A path
    prefix rule names part of a site, not a name people write."""
    found: dict[UUID, list[str]] = {entity_id: [] for entity_id in entity_ids}
    if not entity_ids:
        return found
    rows = await db.execute(
        select(entity_domains.c.entity_id, domains.c.host)
        .join(domains, domains.c.id == entity_domains.c.domain_id)
        .where(
            entity_domains.c.workspace_id == workspace_id,
            entity_domains.c.entity_id.in_(entity_ids),
            entity_domains.c.match_scope != "path_prefix",
        )
    )
    for row in rows:
        found[row.entity_id].append(row.host)
    return found
