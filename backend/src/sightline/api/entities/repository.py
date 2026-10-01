"""Statements for entities, aliases and entity domains. Every function runs inside
`workspace_transaction`, and every statement names the workspace as well: row-level security is
the second line, not the first.

`visible` is a member's project scope: None for every project, else the projects the member
may see. A member limited to some projects sees only the entities those projects have named.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    ColumnElement,
    Row,
    Select,
    and_,
    delete,
    exists,
    func,
    insert,
    literal,
    or_,
    select,
    tuple_,
    update,
)
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from sightline.db.errors import violated_foreign_key, violated_unique_constraint
from sightline.db.tables import (
    domains,
    entities,
    entity_aliases,
    entity_domains,
    project_entities,
    projects,
    users,
)
from sightline.extraction.urls import Host

_NAME_TAKEN = "entities_workspace_name_type"
_ALIAS_TAKEN = frozenset(
    {"entity_aliases_entity_id_alias_match_mode_is_negative_key", "entity_aliases_folded"}
)
_DOMAIN_TAKEN = "entity_domains_entity_id_domain_id_match_scope_path_prefix_key"


class EntityNameTakenError(Exception):
    """Another entity of the workspace has this name and type. The transaction is spent."""


class EntityInUseError(Exception):
    """A project role, or a product, still names the entity. The transaction is spent."""


class AliasTakenError(Exception):
    """The entity has this alias already. The transaction is spent."""


class EntityDomainTakenError(Exception):
    """The entity claims this domain at this scope already. The transaction is spent."""


@dataclass(frozen=True, slots=True)
class EntityRecord:
    id: UUID
    entity_type: str
    canonical_name: str
    parent_entity_id: UUID | None
    description: str | None
    is_ambiguous: bool
    disambiguation_hints: list[str]
    alias_count: int
    created_at: datetime
    updated_at: datetime
    # The list's sort key as PostgreSQL computes it: Python's lower() differs for some letters
    # (U+0130), and a cursor made from it would skip rows.
    sort_key: str


@dataclass(frozen=True, slots=True)
class AliasRecord:
    id: UUID
    entity_id: UUID
    alias: str
    match_mode: str
    case_sensitive: bool
    language_code: str | None
    is_negative: bool
    requires_context: bool
    created_by_id: UUID | None
    created_by_name: str | None
    created_by_email: str | None
    created_at: datetime


@dataclass(frozen=True, slots=True)
class EntityDomainRecord:
    id: UUID
    entity_id: UUID
    domain_id: int
    host: str
    registrable_domain: str
    category: str | None
    category_source: str | None
    match_scope: str
    path_prefix: str | None


@dataclass(frozen=True, slots=True)
class RoleRecord:
    project_id: UUID
    role: str
    is_primary: bool
    removed_at: datetime | None


def visible_to(visible: Collection[UUID] | None) -> ColumnElement[bool]:
    """Whether the entity of the row is one a member with this project scope may see."""
    if visible is None:
        return literal(True)
    return exists().where(
        project_entities.c.entity_id == entities.c.id,
        project_entities.c.workspace_id == entities.c.workspace_id,
        project_entities.c.project_id.in_(visible),
    )


def _entities(workspace_id: UUID, visible: Collection[UUID] | None) -> Select[tuple[object, ...]]:
    alias_count = (
        select(func.count())
        .where(
            entity_aliases.c.entity_id == entities.c.id,
            entity_aliases.c.workspace_id == entities.c.workspace_id,
        )
        .scalar_subquery()
    )
    return select(
        entities.c.id,
        entities.c.entity_type,
        entities.c.canonical_name,
        entities.c.parent_entity_id,
        entities.c.description,
        entities.c.is_ambiguous,
        entities.c.disambiguation_hints,
        alias_count.label("alias_count"),
        entities.c.created_at,
        entities.c.updated_at,
        func.lower(entities.c.canonical_name).label("sort_key"),
    ).where(entities.c.workspace_id == workspace_id, visible_to(visible))


def _entity(row: Row[tuple[object, ...]]) -> EntityRecord:
    fields = row._mapping
    return EntityRecord(
        id=fields["id"],
        entity_type=fields["entity_type"],
        canonical_name=fields["canonical_name"],
        parent_entity_id=fields["parent_entity_id"],
        description=fields["description"],
        is_ambiguous=fields["is_ambiguous"],
        disambiguation_hints=list(fields["disambiguation_hints"]),
        alias_count=fields["alias_count"],
        created_at=fields["created_at"],
        updated_at=fields["updated_at"],
        sort_key=fields["sort_key"],
    )


def _contains(column: ColumnElement[str], text: str) -> ColumnElement[bool]:
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return column.ilike(f"%{escaped}%", escape="\\")


async def list_entities(
    db: AsyncSession,
    workspace_id: UUID,
    *,
    visible: Collection[UUID] | None,
    entity_type: str | None,
    q: str | None,
    project_id: UUID | None,
    role: str | None,
    after: tuple[str, UUID] | None,
    limit: int,
) -> list[EntityRecord]:
    """Up to `limit` entities by name, after the `(lower name, id)` key of the previous page.
    `project_id` and `role` keep the entities a live role names; `q` matches names and
    aliases."""
    statement = _entities(workspace_id, visible)
    if entity_type is not None:
        statement = statement.where(entities.c.entity_type == entity_type)
    if q is not None:
        statement = statement.where(
            or_(
                _contains(entities.c.canonical_name, q),
                exists().where(
                    entity_aliases.c.entity_id == entities.c.id,
                    entity_aliases.c.workspace_id == workspace_id,
                    _contains(entity_aliases.c.alias, q),
                ),
            )
        )
    if project_id is not None or role is not None:
        named = [
            project_entities.c.entity_id == entities.c.id,
            project_entities.c.workspace_id == workspace_id,
            project_entities.c.removed_at.is_(None),
        ]
        if project_id is not None:
            named.append(project_entities.c.project_id == project_id)
        if role is not None:
            named.append(project_entities.c.role == role)
        if visible is not None:
            named.append(project_entities.c.project_id.in_(visible))
        statement = statement.where(exists().where(and_(*named)))
    key = tuple_(func.lower(entities.c.canonical_name), entities.c.id)
    if after is not None:
        statement = statement.where(key > tuple_(literal(after[0]), literal(after[1])))
    page = statement.order_by(func.lower(entities.c.canonical_name), entities.c.id).limit(limit)
    return [_entity(row) for row in await db.execute(page)]


async def get_entity(
    db: AsyncSession,
    workspace_id: UUID,
    entity_id: UUID,
    *,
    visible: Collection[UUID] | None,
    for_update: bool = False,
) -> EntityRecord | None:
    statement = _entities(workspace_id, visible).where(entities.c.id == entity_id)
    if for_update:
        statement = statement.with_for_update(of=entities, key_share=True)
    row = (await db.execute(statement)).one_or_none()
    return None if row is None else _entity(row)


async def lock_parent_changes(db: AsyncSession, workspace_id: UUID) -> None:
    """Parent changes in a workspace run one at a time until the transaction ends, so two
    cannot each pass the cycle check and together write a cycle."""
    await db.execute(
        select(
            func.pg_advisory_xact_lock(
                func.hashtextextended(literal(f"entity_parent:{workspace_id}"), 0)
            )
        )
    )


async def hold_parent(db: AsyncSession, workspace_id: UUID, entity_id: UUID) -> bool:
    """Whether the entity exists, kept from being deleted until the transaction ends (FOR KEY
    SHARE), so a parent read here is still there when the child is written."""
    statement = (
        select(entities.c.id)
        .where(entities.c.workspace_id == workspace_id, entities.c.id == entity_id)
        .with_for_update(read=True, key_share=True)
    )
    return (await db.execute(statement)).first() is not None


async def ancestors(db: AsyncSession, workspace_id: UUID, entity_id: UUID) -> list[UUID]:
    """The entity and its parents up to the top, nearest first (products sit one or two levels
    under a brand). Stops at a repeat, so no stored chain can loop."""
    chain: list[UUID] = []
    current: UUID | None = entity_id
    while current is not None and current not in chain:
        chain.append(current)
        current = (
            await db.execute(
                select(entities.c.parent_entity_id).where(
                    entities.c.workspace_id == workspace_id, entities.c.id == current
                )
            )
        ).scalar_one_or_none()
    return chain


async def insert_entity(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    entity_type: str,
    canonical_name: str,
    parent_entity_id: UUID | None,
    description: str | None,
    is_ambiguous: bool,
    disambiguation_hints: Sequence[str],
) -> UUID:
    statement = (
        insert(entities)
        .values(
            workspace_id=workspace_id,
            entity_type=entity_type,
            canonical_name=canonical_name,
            parent_entity_id=parent_entity_id,
            description=description,
            is_ambiguous=is_ambiguous,
            disambiguation_hints=list(disambiguation_hints),
        )
        .returning(entities.c.id)
    )
    try:
        entity_id: UUID = (await db.execute(statement)).scalar_one()
    except IntegrityError as error:
        if violated_unique_constraint(error) == _NAME_TAKEN:
            raise EntityNameTakenError from None
        raise
    return entity_id


async def update_entity(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    entity_id: UUID,
    changes: Mapping[str, object],
    now: datetime,
) -> None:
    statement = (
        update(entities)
        .where(entities.c.workspace_id == workspace_id, entities.c.id == entity_id)
        .values(**changes, updated_at=now)
    )
    try:
        await db.execute(statement)
    except IntegrityError as error:
        if violated_unique_constraint(error) == _NAME_TAKEN:
            raise EntityNameTakenError from None
        raise


async def delete_entity(db: AsyncSession, workspace_id: UUID, entity_id: UUID) -> None:
    """Its aliases and domains go with it. A role or a product naming it stops the delete,
    even one written by a request racing this one: the key decides, not a check before."""
    statement = delete(entities).where(
        entities.c.workspace_id == workspace_id, entities.c.id == entity_id
    )
    try:
        await db.execute(statement)
    except IntegrityError as error:
        if violated_foreign_key(error) is not None:
            raise EntityInUseError from None
        raise


async def projects_naming(db: AsyncSession, workspace_id: UUID, entity_id: UUID) -> list[UUID]:
    """Every project that has given the entity a role, removed roles included."""
    rows = await db.execute(
        select(project_entities.c.project_id)
        .where(
            project_entities.c.workspace_id == workspace_id,
            project_entities.c.entity_id == entity_id,
        )
        .order_by(project_entities.c.project_id)
    )
    return [row.project_id for row in rows]


async def bump_entity_config(
    db: AsyncSession, workspace_id: UUID, project_ids: Collection[UUID]
) -> None:
    """A changed entity changes what extraction counts for every project that names it
    (plan decision D7)."""
    if not project_ids:
        return
    await db.execute(
        update(projects)
        .where(projects.c.workspace_id == workspace_id, projects.c.id.in_(project_ids))
        .values(entity_config_version=projects.c.entity_config_version + 1)
    )


async def roles_of(
    db: AsyncSession, workspace_id: UUID, entity_id: UUID, *, visible: Collection[UUID] | None
) -> list[RoleRecord]:
    statement = select(
        project_entities.c.project_id,
        project_entities.c.role,
        project_entities.c.is_primary,
        project_entities.c.removed_at,
    ).where(
        project_entities.c.workspace_id == workspace_id,
        project_entities.c.entity_id == entity_id,
    )
    if visible is not None:
        statement = statement.where(project_entities.c.project_id.in_(visible))
    rows = await db.execute(statement.order_by(project_entities.c.added_at))
    return [RoleRecord(row.project_id, row.role, row.is_primary, row.removed_at) for row in rows]


# Aliases.


def _aliases(workspace_id: UUID) -> Select[tuple[object, ...]]:
    return (
        select(
            entity_aliases.c.id,
            entity_aliases.c.entity_id,
            entity_aliases.c.alias,
            entity_aliases.c.match_mode,
            entity_aliases.c.case_sensitive,
            entity_aliases.c.language_code,
            entity_aliases.c.is_negative,
            entity_aliases.c.requires_context,
            entity_aliases.c.created_at,
            users.c.id.label("created_by_id"),
            users.c.name.label("created_by_name"),
            users.c.email.label("created_by_email"),
        )
        .outerjoin(users, users.c.id == entity_aliases.c.created_by)
        .where(entity_aliases.c.workspace_id == workspace_id)
    )


def _alias(row: Row[tuple[object, ...]]) -> AliasRecord:
    fields = row._mapping
    email = fields["created_by_email"]
    return AliasRecord(
        id=fields["id"],
        entity_id=fields["entity_id"],
        alias=fields["alias"],
        match_mode=fields["match_mode"],
        case_sensitive=fields["case_sensitive"],
        language_code=fields["language_code"],
        is_negative=fields["is_negative"],
        requires_context=fields["requires_context"],
        created_by_id=fields["created_by_id"],
        created_by_name=fields["created_by_name"],
        created_by_email=None if email is None else str(email),
        created_at=fields["created_at"],
    )


async def aliases_of(
    db: AsyncSession, workspace_id: UUID, entity_ids: Collection[UUID]
) -> list[AliasRecord]:
    statement = (
        _aliases(workspace_id)
        .where(entity_aliases.c.entity_id.in_(entity_ids))
        .order_by(entity_aliases.c.created_at, entity_aliases.c.id)
    )
    return [_alias(row) for row in await db.execute(statement)]


async def get_alias(
    db: AsyncSession, workspace_id: UUID, entity_id: UUID, alias_id: UUID
) -> AliasRecord | None:
    statement = _aliases(workspace_id).where(
        entity_aliases.c.entity_id == entity_id, entity_aliases.c.id == alias_id
    )
    row = (await db.execute(statement)).one_or_none()
    return None if row is None else _alias(row)


@dataclass(frozen=True, slots=True)
class NewAlias:
    alias: str
    match_mode: str
    case_sensitive: bool
    language_code: str | None
    is_negative: bool
    requires_context: bool


async def insert_aliases(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    entity_id: UUID,
    aliases: Sequence[NewAlias],
    created_by: UUID,
) -> list[UUID]:
    if not aliases:
        return []
    statement = (
        insert(entity_aliases)
        .values(
            [
                {
                    "workspace_id": workspace_id,
                    "entity_id": entity_id,
                    "alias": alias.alias,
                    "match_mode": alias.match_mode,
                    "case_sensitive": alias.case_sensitive,
                    "language_code": alias.language_code,
                    "is_negative": alias.is_negative,
                    "requires_context": alias.requires_context,
                    "created_by": created_by,
                }
                for alias in aliases
            ]
        )
        .returning(entity_aliases.c.id)
    )
    try:
        return list((await db.execute(statement)).scalars())
    except IntegrityError as error:
        if violated_unique_constraint(error) in _ALIAS_TAKEN:
            raise AliasTakenError from None
        raise


async def update_alias(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    alias_id: UUID,
    changes: Mapping[str, object],
) -> None:
    statement = (
        update(entity_aliases)
        .where(entity_aliases.c.workspace_id == workspace_id, entity_aliases.c.id == alias_id)
        .values(**changes)
    )
    try:
        await db.execute(statement)
    except IntegrityError as error:
        if violated_unique_constraint(error) in _ALIAS_TAKEN:
            raise AliasTakenError from None
        raise


async def delete_alias(
    db: AsyncSession, workspace_id: UUID, entity_id: UUID, alias_id: UUID
) -> bool:
    result = await db.execute(
        delete(entity_aliases)
        .where(
            entity_aliases.c.workspace_id == workspace_id,
            entity_aliases.c.entity_id == entity_id,
            entity_aliases.c.id == alias_id,
        )
        .returning(entity_aliases.c.id)
    )
    return result.first() is not None


# Domains.


async def domain_id_for(db: AsyncSession, host: Host) -> int:
    """The `core.domains` row of a host, added when no workspace has named it before. The API
    may insert a host but not change one, so an existing row is read, never updated."""
    await db.execute(
        upsert(domains)
        .values(
            host=host.name,
            registrable_domain=host.registrable_domain,
            public_suffix=host.public_suffix,
            is_ip=host.is_ip,
        )
        .on_conflict_do_nothing(index_elements=[domains.c.host])
    )
    domain_id: int = (
        await db.execute(select(domains.c.id).where(domains.c.host == host.name))
    ).scalar_one()
    return domain_id


def _entity_domains(workspace_id: UUID) -> Select[tuple[object, ...]]:
    return (
        select(
            entity_domains.c.id,
            entity_domains.c.entity_id,
            entity_domains.c.domain_id,
            domains.c.host,
            domains.c.registrable_domain,
            domains.c.default_category,
            domains.c.category_source,
            entity_domains.c.match_scope,
            entity_domains.c.path_prefix,
        )
        .join(domains, domains.c.id == entity_domains.c.domain_id)
        .where(entity_domains.c.workspace_id == workspace_id)
    )


def _entity_domain(row: Row[tuple[object, ...]]) -> EntityDomainRecord:
    fields = row._mapping
    return EntityDomainRecord(
        id=fields["id"],
        entity_id=fields["entity_id"],
        domain_id=fields["domain_id"],
        host=fields["host"],
        registrable_domain=fields["registrable_domain"],
        category=fields["default_category"],
        category_source=fields["category_source"],
        match_scope=fields["match_scope"],
        path_prefix=fields["path_prefix"],
    )


async def domains_of(
    db: AsyncSession, workspace_id: UUID, entity_ids: Collection[UUID]
) -> list[EntityDomainRecord]:
    if not entity_ids:
        return []
    statement = (
        _entity_domains(workspace_id)
        .where(entity_domains.c.entity_id.in_(entity_ids))
        .order_by(domains.c.host, entity_domains.c.match_scope, entity_domains.c.path_prefix)
    )
    return [_entity_domain(row) for row in await db.execute(statement)]


async def get_entity_domain(
    db: AsyncSession, workspace_id: UUID, entity_id: UUID, entity_domain_id: UUID
) -> EntityDomainRecord | None:
    statement = _entity_domains(workspace_id).where(
        entity_domains.c.entity_id == entity_id, entity_domains.c.id == entity_domain_id
    )
    row = (await db.execute(statement)).one_or_none()
    return None if row is None else _entity_domain(row)


async def insert_entity_domain(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    entity_id: UUID,
    domain_id: int,
    match_scope: str,
    path_prefix: str | None,
) -> UUID:
    statement = (
        insert(entity_domains)
        .values(
            workspace_id=workspace_id,
            entity_id=entity_id,
            domain_id=domain_id,
            match_scope=match_scope,
            path_prefix=path_prefix,
        )
        .returning(entity_domains.c.id)
    )
    try:
        entity_domain_id: UUID = (await db.execute(statement)).scalar_one()
    except IntegrityError as error:
        if violated_unique_constraint(error) == _DOMAIN_TAKEN:
            raise EntityDomainTakenError from None
        raise
    return entity_domain_id


async def delete_entity_domain(
    db: AsyncSession, workspace_id: UUID, entity_id: UUID, entity_domain_id: UUID
) -> bool:
    result = await db.execute(
        delete(entity_domains)
        .where(
            entity_domains.c.workspace_id == workspace_id,
            entity_domains.c.entity_id == entity_id,
            entity_domains.c.id == entity_domain_id,
        )
        .returning(entity_domains.c.id)
    )
    return result.first() is not None


@dataclass(frozen=True, slots=True)
class ProjectRule:
    """One domain rule of one live role in a project."""

    project_id: UUID
    entity_id: UUID
    role: str
    host: str
    registrable_domain: str
    public_suffix: str
    is_ip: bool
    match_scope: str
    path_prefix: str | None


async def rules_of_projects(
    db: AsyncSession, workspace_id: UUID, project_ids: Collection[UUID]
) -> list[ProjectRule]:
    """The domain rules of every live role in these projects."""
    if not project_ids:
        return []
    statement = (
        select(
            project_entities.c.project_id,
            project_entities.c.entity_id,
            project_entities.c.role,
            domains.c.host,
            domains.c.registrable_domain,
            domains.c.public_suffix,
            domains.c.is_ip,
            entity_domains.c.match_scope,
            entity_domains.c.path_prefix,
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
            project_entities.c.project_id.in_(project_ids),
            project_entities.c.removed_at.is_(None),
        )
    )
    return [
        ProjectRule(
            project_id=row.project_id,
            entity_id=row.entity_id,
            role=row.role,
            host=row.host,
            registrable_domain=row.registrable_domain,
            public_suffix=row.public_suffix,
            is_ip=row.is_ip,
            match_scope=row.match_scope,
            path_prefix=row.path_prefix,
        )
        for row in await db.execute(statement)
    ]


async def live_projects_naming(db: AsyncSession, workspace_id: UUID, entity_id: UUID) -> list[UUID]:
    rows = await db.execute(
        select(project_entities.c.project_id).where(
            project_entities.c.workspace_id == workspace_id,
            project_entities.c.entity_id == entity_id,
            project_entities.c.removed_at.is_(None),
        )
    )
    return [row.project_id for row in rows]
