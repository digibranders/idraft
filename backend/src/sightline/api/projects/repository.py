"""Statements for projects. Every function runs inside `workspace_transaction`, and every
statement names the workspace as well: row-level security is the second line, not the first."""

from __future__ import annotations

from collections.abc import Collection, Mapping
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import Row, Select, exists, func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from sightline.db.errors import violated_unique_constraint
from sightline.db.tables import domains, locations, projects, users, workspace_quotas


class ProjectSlugTakenError(Exception):
    """Another project of the workspace has this slug. The transaction cannot be used after it."""


@dataclass(frozen=True, slots=True)
class ProjectRecord:
    id: UUID
    workspace_id: UUID
    name: str
    slug: str
    primary_domain_id: int | None
    primary_host: str | None
    primary_registrable_domain: str | None
    primary_category: str | None
    primary_category_source: str | None
    default_location_id: int | None
    default_location_name: str | None
    default_location_country: str | None
    default_location_type: str | None
    default_language_code: str | None
    timezone: str
    deep_check_weekday: int
    status: str
    data_version: int
    entity_config_version: int
    created_by_id: UUID | None
    created_by_name: str | None
    created_by_email: str | None
    created_at: datetime
    updated_at: datetime


def _projects(workspace_id: UUID) -> Select[tuple[object, ...]]:
    """The workspace's projects that have not been deleted."""
    return (
        select(
            projects.c.id,
            projects.c.workspace_id,
            projects.c.name,
            projects.c.slug,
            projects.c.primary_domain_id,
            domains.c.host.label("primary_host"),
            domains.c.registrable_domain.label("primary_registrable_domain"),
            domains.c.default_category.label("primary_category"),
            domains.c.category_source.label("primary_category_source"),
            projects.c.default_location_id,
            locations.c.name.label("default_location_name"),
            locations.c.country_iso.label("default_location_country"),
            locations.c.location_type.label("default_location_type"),
            projects.c.default_language_code,
            projects.c.timezone,
            projects.c.deep_check_weekday,
            projects.c.status,
            projects.c.data_version,
            projects.c.entity_config_version,
            projects.c.created_at,
            projects.c.updated_at,
            users.c.id.label("created_by_id"),
            users.c.name.label("created_by_name"),
            users.c.email.label("created_by_email"),
        )
        .outerjoin(users, users.c.id == projects.c.created_by)
        .outerjoin(domains, domains.c.id == projects.c.primary_domain_id)
        .outerjoin(locations, locations.c.id == projects.c.default_location_id)
        .where(projects.c.workspace_id == workspace_id, projects.c.deleted_at.is_(None))
    )


def _project(row: Row[tuple[object, ...]]) -> ProjectRecord:
    fields = row._mapping
    email = fields["created_by_email"]
    return ProjectRecord(
        id=fields["id"],
        workspace_id=fields["workspace_id"],
        name=fields["name"],
        slug=str(fields["slug"]),
        primary_domain_id=fields["primary_domain_id"],
        primary_host=fields["primary_host"],
        primary_registrable_domain=fields["primary_registrable_domain"],
        primary_category=fields["primary_category"],
        primary_category_source=fields["primary_category_source"],
        default_location_id=fields["default_location_id"],
        default_location_name=fields["default_location_name"],
        default_location_country=fields["default_location_country"],
        default_location_type=fields["default_location_type"],
        default_language_code=fields["default_language_code"],
        timezone=fields["timezone"],
        deep_check_weekday=fields["deep_check_weekday"],
        status=fields["status"],
        data_version=fields["data_version"],
        entity_config_version=fields["entity_config_version"],
        created_by_id=fields["created_by_id"],
        created_by_name=fields["created_by_name"],
        created_by_email=None if email is None else str(email),
        created_at=fields["created_at"],
        updated_at=fields["updated_at"],
    )


async def list_projects(
    db: AsyncSession,
    workspace_id: UUID,
    *,
    statuses: Collection[str],
    visible: Collection[UUID] | None,
    offset: int,
    limit: int,
) -> tuple[list[ProjectRecord], int]:
    """One page of projects in these statuses. `visible` limits them to a member's scope; None
    means every project."""
    matching = _projects(workspace_id).where(projects.c.status.in_(statuses))
    if visible is not None:
        matching = matching.where(projects.c.id.in_(visible))
    total: int = (
        await db.execute(select(func.count()).select_from(matching.subquery()))
    ).scalar_one()
    page = matching.order_by(func.lower(projects.c.name), projects.c.id).offset(offset).limit(limit)
    return [_project(row) for row in await db.execute(page)], total


async def get_project(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, *, for_update: bool = False
) -> ProjectRecord | None:
    statement = _projects(workspace_id).where(projects.c.id == project_id)
    if for_update:
        # FOR NO KEY UPDATE: a plain FOR UPDATE would wait for, and block, every insert of a row
        # that references the project, which is every collected observation. A change of slug
        # still takes the stronger lock when it is written, because the slug is part of a key.
        statement = statement.with_for_update(of=projects, key_share=True)
    row = (await db.execute(statement)).one_or_none()
    return None if row is None else _project(row)


async def lock_project_limit(db: AsyncSession, workspace_id: UUID) -> int:
    """The workspace's project limit, its quota row locked until the transaction ends, so two
    creations count one after the other. A workspace without a row gets the defaults."""
    await db.execute(
        upsert(workspace_quotas).values(workspace_id=workspace_id).on_conflict_do_nothing()
    )
    limit: int = (
        await db.execute(
            select(workspace_quotas.c.max_projects)
            .where(workspace_quotas.c.workspace_id == workspace_id)
            .with_for_update(key_share=True)
        )
    ).scalar_one()
    return limit


async def count_projects(db: AsyncSession, workspace_id: UUID) -> int:
    """Projects that count against the limit: active and paused ones. An archived project
    collects nothing, and a deleted one is gone."""
    count: int = (
        await db.execute(
            select(func.count())
            .select_from(projects)
            .where(
                projects.c.workspace_id == workspace_id,
                projects.c.deleted_at.is_(None),
                projects.c.status != "archived",
            )
        )
    ).scalar_one()
    return count


async def location_is_active(db: AsyncSession, location_id: int) -> bool:
    """Whether a project may name the location: it exists and the provider still lists it."""
    found: bool = (
        await db.execute(
            select(exists().where(locations.c.id == location_id, locations.c.is_active))
        )
    ).scalar_one()
    return found


def _raise_if_slug_taken(error: IntegrityError) -> None:
    if violated_unique_constraint(error) == "projects_workspace_id_slug_key":
        raise ProjectSlugTakenError from None


async def insert_project(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    name: str,
    slug: str,
    timezone: str,
    deep_check_weekday: int,
    default_language_code: str | None,
    primary_domain_id: int | None,
    default_location_id: int | None,
    created_by: UUID,
) -> UUID:
    statement = (
        insert(projects)
        .values(
            workspace_id=workspace_id,
            name=name,
            slug=slug,
            timezone=timezone,
            deep_check_weekday=deep_check_weekday,
            default_language_code=default_language_code,
            primary_domain_id=primary_domain_id,
            default_location_id=default_location_id,
            created_by=created_by,
        )
        .returning(projects.c.id)
    )
    try:
        project_id: UUID = (await db.execute(statement)).scalar_one()
    except IntegrityError as error:
        _raise_if_slug_taken(error)
        raise
    return project_id


async def update_project(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    project_id: UUID,
    changes: Mapping[str, str | int | None],
    now: datetime,
) -> None:
    statement = (
        update(projects)
        .where(projects.c.workspace_id == workspace_id, projects.c.id == project_id)
        .values(**changes, updated_at=now)
    )
    try:
        await db.execute(statement)
    except IntegrityError as error:
        _raise_if_slug_taken(error)
        raise
