"""Statements for connections and integrations. Every function runs inside
`workspace_transaction` and names the workspace as well: row-level security is the second line,
not the first."""

from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import Row, ScalarSelect, Select, func, insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.db.errors import violated_unique_constraint
from idraft.db.tables import (
    connections,
    domains,
    integrations,
    projects,
    schedules,
    users,
    workspaces,
)

LIVE = ("active", "reauth_required", "error")


class PropertyTakenError(Exception):
    """The property is already linked to a project of the workspace (or the project already has
    a live property). The transaction cannot be used after it."""


class ConnectionTakenError(Exception):
    """Another request connected the same account at the same moment. The transaction cannot be
    used after it."""


@dataclass(frozen=True, slots=True)
class ProjectContext:
    project_id: UUID
    project_slug: str
    workspace_slug: str
    workspace_status: str
    host: str | None
    registrable_domain: str | None


@dataclass(frozen=True, slots=True)
class ConnectionRecord:
    id: UUID
    workspace_id: UUID
    product: str
    auth_method: str
    subject_id: str
    subject_label: str | None
    credential_ref: UUID | None
    scopes: list[str]
    status: str
    connected_by_id: UUID | None
    connected_by_name: str | None
    connected_by_email: str | None
    connected_at: datetime
    last_refresh_at: datetime | None
    last_error_code: str | None
    integration_count: int


@dataclass(frozen=True, slots=True)
class IntegrationRecord:
    id: UUID
    workspace_id: UUID
    project_id: UUID | None
    connection_id: UUID | None
    kind: str
    external_property: str
    external_account: str | None
    status: str
    connection_status: str | None
    last_success_at: datetime | None
    last_error: str | None
    backfill_state: dict[str, object]
    # The next daily sync of a Search Console property, from its schedule.
    next_sync_at: datetime | None
    created_at: datetime


async def project_context(
    db: AsyncSession, workspace_id: UUID, project_id: UUID
) -> ProjectContext | None:
    row = (
        await db.execute(
            select(
                projects.c.id,
                projects.c.slug,
                workspaces.c.slug.label("workspace_slug"),
                workspaces.c.status.label("workspace_status"),
                domains.c.host,
                domains.c.registrable_domain,
            )
            .join(workspaces, workspaces.c.id == projects.c.workspace_id)
            .outerjoin(domains, domains.c.id == projects.c.primary_domain_id)
            .where(
                projects.c.workspace_id == workspace_id,
                projects.c.id == project_id,
                projects.c.deleted_at.is_(None),
            )
        )
    ).one_or_none()
    if row is None:
        return None
    return ProjectContext(
        project_id=row.id,
        project_slug=str(row.slug),
        workspace_slug=str(row.workspace_slug),
        workspace_status=row.workspace_status,
        host=row.host,
        registrable_domain=row.registrable_domain,
    )


async def projects_with_domains(
    db: AsyncSession, workspace_id: UUID
) -> list[tuple[UUID, str, str]]:
    """The workspace's live projects that have a primary domain: id, host, registrable domain.
    Oldest first, so a property two projects match goes to the older one."""
    rows = await db.execute(
        select(projects.c.id, domains.c.host, domains.c.registrable_domain)
        .join(domains, domains.c.id == projects.c.primary_domain_id)
        .where(
            projects.c.workspace_id == workspace_id,
            projects.c.deleted_at.is_(None),
            projects.c.status != "archived",
        )
        .order_by(projects.c.created_at, projects.c.id)
    )
    return [(row.id, row.host, row.registrable_domain) for row in rows]


def _integration_count() -> ScalarSelect[int]:
    return (
        select(func.count())
        .select_from(integrations)
        .where(
            integrations.c.connection_id == connections.c.id,
            integrations.c.workspace_id == connections.c.workspace_id,
            integrations.c.status != "disabled",
        )
        .scalar_subquery()
    )


def _connection(row: Row[tuple[object, ...]]) -> ConnectionRecord:
    fields = row._mapping
    email = fields["connected_by_email"]
    return ConnectionRecord(
        id=fields["id"],
        workspace_id=fields["workspace_id"],
        product=fields["product"],
        auth_method=fields["auth_method"],
        subject_id=fields["subject_id"],
        subject_label=fields["subject_label"],
        credential_ref=fields["credential_ref"],
        scopes=list(fields["scopes"]),
        status=fields["status"],
        connected_by_id=fields["connected_by_id"],
        connected_by_name=fields["connected_by_name"],
        connected_by_email=None if email is None else str(email),
        connected_at=fields["connected_at"],
        last_refresh_at=fields["last_refresh_at"],
        last_error_code=fields["last_error_code"],
        integration_count=fields["integration_count"],
    )


def _connections(workspace_id: UUID) -> Select[tuple[object, ...]]:
    return (
        select(
            connections.c.id,
            connections.c.workspace_id,
            connections.c.product,
            connections.c.auth_method,
            connections.c.subject_id,
            connections.c.subject_label,
            connections.c.credential_ref,
            connections.c.scopes,
            connections.c.status,
            connections.c.connected_at,
            connections.c.last_refresh_at,
            connections.c.last_error_code,
            users.c.id.label("connected_by_id"),
            users.c.name.label("connected_by_name"),
            users.c.email.label("connected_by_email"),
            _integration_count().label("integration_count"),
        )
        .outerjoin(users, users.c.id == connections.c.connected_by)
        .where(connections.c.workspace_id == workspace_id)
    )


async def get_connection(
    db: AsyncSession, workspace_id: UUID, connection_id: UUID, *, lock: bool = False
) -> ConnectionRecord | None:
    statement = _connections(workspace_id).where(connections.c.id == connection_id)
    if lock:
        statement = statement.with_for_update(of=connections)
    row = (await db.execute(statement)).one_or_none()
    return None if row is None else _connection(row)


async def list_connections(
    db: AsyncSession,
    workspace_id: UUID,
    *,
    product: str | None,
    status: str | None,
    offset: int,
    limit: int,
) -> tuple[list[ConnectionRecord], int]:
    matching = _connections(workspace_id)
    if product is not None:
        matching = matching.where(connections.c.product == product)
    if status is not None:
        matching = matching.where(connections.c.status == status)
    total: int = (
        await db.execute(select(func.count()).select_from(matching.subquery()))
    ).scalar_one()
    page = (
        matching.order_by(connections.c.connected_at.desc(), connections.c.id)
        .offset(offset)
        .limit(limit)
    )
    return [_connection(row) for row in await db.execute(page)], total


async def connection_by_subject(
    db: AsyncSession, workspace_id: UUID, product: str, subject_id: str
) -> ConnectionRecord | None:
    statement = (
        _connections(workspace_id)
        .where(connections.c.product == product, connections.c.subject_id == subject_id)
        .with_for_update(of=connections)
    )
    row = (await db.execute(statement)).one_or_none()
    return None if row is None else _connection(row)


async def insert_connection(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    product: str,
    subject_id: str,
    subject_label: str | None,
    credential_ref: UUID,
    scopes: Collection[str],
    connected_by: UUID,
) -> UUID:
    try:
        async with db.begin_nested():
            connection_id: UUID = (
                await db.execute(
                    insert(connections)
                    .values(
                        workspace_id=workspace_id,
                        product=product,
                        auth_method="oauth",
                        subject_id=subject_id,
                        subject_label=subject_label,
                        credential_ref=credential_ref,
                        scopes=sorted(scopes),
                        connected_by=connected_by,
                    )
                    .returning(connections.c.id)
                )
            ).scalar_one()
    except IntegrityError as error:
        if violated_unique_constraint(error) is not None:
            raise ConnectionTakenError from None
        raise
    return connection_id


async def renew_connection(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    connection_id: UUID,
    subject_label: str | None,
    credential_ref: UUID,
    scopes: Collection[str],
    connected_by: UUID,
) -> None:
    """The same account connecting again: a new credential, and the connection works again."""
    await db.execute(
        update(connections)
        .where(connections.c.workspace_id == workspace_id, connections.c.id == connection_id)
        .values(
            subject_label=subject_label,
            credential_ref=credential_ref,
            scopes=sorted(scopes),
            status="active",
            connected_by=connected_by,
            connected_at=func.now(),
            last_error_code=None,
        )
    )
    await db.execute(
        update(integrations)
        .where(
            integrations.c.workspace_id == workspace_id,
            integrations.c.connection_id == connection_id,
            integrations.c.status == "reauth_required",
        )
        .values(status="active", last_error=None)
    )


async def mark_reauth_required(
    db: AsyncSession, *, workspace_id: UUID, connection_id: UUID, error_code: str
) -> None:
    """The credential no longer works: the connection and its integrations wait for a new one."""
    await db.execute(
        update(connections)
        .where(
            connections.c.workspace_id == workspace_id,
            connections.c.id == connection_id,
            connections.c.status == "active",
        )
        .values(status="reauth_required", last_error_code=error_code)
    )
    await db.execute(
        update(integrations)
        .where(
            integrations.c.workspace_id == workspace_id,
            integrations.c.connection_id == connection_id,
            integrations.c.status == "active",
        )
        .values(status="reauth_required", last_error=error_code)
    )


async def note_refresh(db: AsyncSession, *, workspace_id: UUID, connection_id: UUID) -> None:
    await db.execute(
        update(connections)
        .where(connections.c.workspace_id == workspace_id, connections.c.id == connection_id)
        .values(last_refresh_at=func.now())
    )


async def revoke_connection(db: AsyncSession, *, workspace_id: UUID, connection_id: UUID) -> None:
    """Disconnect: the credential reference goes first (the secret is deleted after), and every
    property of the connection stops. The stored numbers stay."""
    await db.execute(
        update(connections)
        .where(connections.c.workspace_id == workspace_id, connections.c.id == connection_id)
        .values(status="revoked", credential_ref=None, last_error_code=None)
    )
    await db.execute(
        update(integrations)
        .where(
            integrations.c.workspace_id == workspace_id,
            integrations.c.connection_id == connection_id,
            integrations.c.status != "disabled",
        )
        .values(status="disabled")
    )


def _integration(row: Row[tuple[object, ...]]) -> IntegrationRecord:
    fields = row._mapping
    return IntegrationRecord(
        id=fields["id"],
        workspace_id=fields["workspace_id"],
        project_id=fields["project_id"],
        connection_id=fields["connection_id"],
        kind=fields["kind"],
        external_property=fields["external_property"],
        external_account=fields["external_account"],
        status=fields["status"],
        connection_status=fields["connection_status"],
        last_success_at=fields["last_success_at"],
        last_error=fields["last_error"],
        backfill_state=dict(fields["backfill_state"] or {}),
        next_sync_at=fields["next_sync_at"],
        created_at=fields["created_at"],
    )


def _next_sync() -> ScalarSelect[datetime]:
    """When the property's schedule next runs; None without one, or while it is paused."""
    return (
        select(func.min(schedules.c.next_run_at))
        .where(
            schedules.c.workspace_id == integrations.c.workspace_id,
            schedules.c.project_id == integrations.c.project_id,
            schedules.c.workload == "gsc_sync",
            schedules.c.is_active,
            schedules.c.deleted_at.is_(None),
        )
        .correlate(integrations)
        .scalar_subquery()
    )


def _integrations(workspace_id: UUID) -> Select[tuple[object, ...]]:
    return (
        select(
            integrations.c.id,
            integrations.c.workspace_id,
            integrations.c.project_id,
            integrations.c.connection_id,
            integrations.c.kind,
            integrations.c.external_property,
            integrations.c.external_account,
            integrations.c.status,
            connections.c.status.label("connection_status"),
            integrations.c.last_success_at,
            integrations.c.last_error,
            integrations.c.backfill_state,
            _next_sync().label("next_sync_at"),
            integrations.c.created_at,
        )
        .outerjoin(
            connections,
            (connections.c.id == integrations.c.connection_id)
            & (connections.c.workspace_id == integrations.c.workspace_id),
        )
        .where(integrations.c.workspace_id == workspace_id)
    )


async def list_integrations(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, *, offset: int, limit: int
) -> tuple[list[IntegrationRecord], int]:
    matching = _integrations(workspace_id).where(integrations.c.project_id == project_id)
    total: int = (
        await db.execute(select(func.count()).select_from(matching.subquery()))
    ).scalar_one()
    page = (
        matching.order_by(integrations.c.created_at.desc(), integrations.c.id)
        .offset(offset)
        .limit(limit)
    )
    return [_integration(row) for row in await db.execute(page)], total


async def get_integration(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, integration_id: UUID
) -> IntegrationRecord | None:
    row = (
        await db.execute(
            _integrations(workspace_id).where(
                integrations.c.project_id == project_id, integrations.c.id == integration_id
            )
        )
    ).one_or_none()
    return None if row is None else _integration(row)


async def linked_properties(db: AsyncSession, workspace_id: UUID, kind: str) -> dict[str, UUID]:
    """The properties of the workspace linked to a project and not disabled: property to project."""
    rows = await db.execute(
        select(integrations.c.external_property, integrations.c.project_id).where(
            integrations.c.workspace_id == workspace_id,
            integrations.c.kind == kind,
            integrations.c.status != "disabled",
            integrations.c.project_id.is_not(None),
        )
    )
    return {row.external_property: row.project_id for row in rows}


async def property_row(
    db: AsyncSession, workspace_id: UUID, kind: str, external_property: str
) -> tuple[UUID, UUID | None, str] | None:
    """The row for a property, lock held: its id, its project and its status."""
    row = (
        await db.execute(
            select(integrations.c.id, integrations.c.project_id, integrations.c.status)
            .where(
                integrations.c.workspace_id == workspace_id,
                integrations.c.kind == kind,
                integrations.c.external_property == external_property,
            )
            .with_for_update()
        )
    ).one_or_none()
    return None if row is None else (row.id, row.project_id, row.status)


async def insert_integration(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    project_id: UUID,
    kind: str,
    external_property: str,
    external_account: str | None,
    connection_id: UUID,
    scopes: Collection[str],
) -> UUID:
    try:
        async with db.begin_nested():
            integration_id: UUID = (
                await db.execute(
                    insert(integrations)
                    .values(
                        workspace_id=workspace_id,
                        project_id=project_id,
                        kind=kind,
                        external_property=external_property,
                        external_account=external_account,
                        connection_id=connection_id,
                        scopes=sorted(scopes),
                    )
                    .returning(integrations.c.id)
                )
            ).scalar_one()
    except IntegrityError as error:
        if violated_unique_constraint(error) is not None:
            raise PropertyTakenError from None
        raise
    return integration_id


async def reactivate_integration(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    integration_id: UUID,
    external_account: str | None,
    connection_id: UUID,
    scopes: Collection[str],
) -> None:
    """A property that was switched off and is chosen again by the project it belonged to."""
    try:
        async with db.begin_nested():
            await db.execute(
                update(integrations)
                .where(
                    integrations.c.workspace_id == workspace_id,
                    integrations.c.id == integration_id,
                )
                .values(
                    status="active",
                    last_error=None,
                    external_account=external_account,
                    connection_id=connection_id,
                    scopes=sorted(scopes),
                )
            )
    except IntegrityError as error:
        if violated_unique_constraint(error) is not None:
            raise PropertyTakenError from None
        raise


async def disable_integration(
    db: AsyncSession, *, workspace_id: UUID, integration_id: UUID
) -> None:
    await db.execute(
        update(integrations)
        .where(integrations.c.workspace_id == workspace_id, integrations.c.id == integration_id)
        .values(status="disabled")
    )


async def live_integration_status(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, kind: str
) -> str | None:
    """The status of the project's live integration of `kind`, or None when it has none."""
    status: str | None = (
        await db.execute(
            select(integrations.c.status).where(
                integrations.c.workspace_id == workspace_id,
                integrations.c.project_id == project_id,
                integrations.c.kind == kind,
                integrations.c.status != "disabled",
            )
        )
    ).scalar_one_or_none()
    return status
