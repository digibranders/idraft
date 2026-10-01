"""Rules for projects (docs/19-api-specification.md section 3.3)."""

from __future__ import annotations

from collections.abc import Collection, Mapping
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.api import audit
from sightline.api.entities import project_repository as project_roles
from sightline.api.entities import repository as entities
from sightline.api.entities.repository import EntityNameTakenError, NewAlias
from sightline.api.entities.service import stored_host
from sightline.api.problems import (
    DuplicateError,
    NotFoundError,
    QuotaExceededError,
    invalid_field,
)
from sightline.api.projects import repository
from sightline.api.projects.repository import ProjectRecord, ProjectSlugTakenError
from sightline.api.request_info import RequestInfo
from sightline.api.schemas.entities import DomainInput, OwnEntityInput
from sightline.api.timezones import check_timezone
from sightline.api.workspaces import repository as workspaces
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.db.engine import workspace_transaction
from sightline.extraction.urls import normalize_host


def _slug_taken() -> DuplicateError:
    return DuplicateError("A project with this slug already exists in the workspace.")


async def _check_location(db: AsyncSession, location_id: int) -> None:
    if not await repository.location_is_active(db, location_id):
        raise invalid_field(
            "default_location_id",
            code="location_unknown",
            message="No such location. Choose one from GET /api/v1/locations.",
        )


async def _create_own_entity(
    db: AsyncSession,
    access: WorkspaceAccess,
    project_id: UUID,
    own: OwnEntityInput,
    info: RequestInfo,
) -> None:
    """The project's brand: a word alias for each other name (its own name is matched without
    one), a registrable rule for each domain, and the primary own role."""
    entity_id = await entities.insert_entity(
        db,
        workspace_id=access.workspace_id,
        entity_type="brand",
        canonical_name=own.canonical_name,
        parent_entity_id=None,
        description=None,
        is_ambiguous=False,
        disambiguation_hints=(),
    )
    seen = {own.canonical_name.casefold()}
    aliases = []
    for alias in own.aliases:
        if alias.casefold() not in seen:
            seen.add(alias.casefold())
            aliases.append(
                NewAlias(
                    alias=alias,
                    match_mode="word_boundary",
                    case_sensitive=False,
                    language_code=None,
                    is_negative=False,
                    requires_context=False,
                )
            )
    await entities.insert_aliases(
        db,
        workspace_id=access.workspace_id,
        entity_id=entity_id,
        aliases=aliases,
        created_by=access.user_id,
        skip_taken=True,
    )
    stored = await entities.aliases_of(db, access.workspace_id, [entity_id])
    hosts = []
    for domain in own.domains:
        host = stored_host(DomainInput(domain=domain))
        if host.name not in hosts:
            hosts.append(host.name)
            await entities.insert_entity_domain(
                db,
                workspace_id=access.workspace_id,
                entity_id=entity_id,
                domain_id=await entities.domain_id_for(db, host),
                match_scope="registrable",
                path_prefix=None,
            )
    await project_roles.insert_role(
        db,
        workspace_id=access.workspace_id,
        project_id=project_id,
        entity_id=entity_id,
        values={"role": "own", "is_primary": True},
    )
    await entities.bump_entity_config(db, access.workspace_id, [project_id])
    await audit.record(
        db,
        workspace_id=access.workspace_id,
        actor_id=access.user_id,
        action="entity.created",
        target_type="entity",
        target_id=entity_id,
        info=info,
        after={
            "entity_type": "brand",
            "canonical_name": own.canonical_name,
            "aliases": [alias.alias for alias in stored],
            "domains": hosts,
        },
    )
    await audit.record(
        db,
        workspace_id=access.workspace_id,
        actor_id=access.user_id,
        action="project_entity.created",
        target_type="project_entity",
        target_id=entity_id,
        info=info,
        after={"project_id": str(project_id), "role": "own", "is_primary": True},
    )


class ProjectService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    async def page(
        self, access: WorkspaceAccess, *, statuses: Collection[str], offset: int, limit: int
    ) -> tuple[list[ProjectRecord], int]:
        """The projects the member can see, in these statuses."""
        async with workspace_transaction(
            self._sessions, access.workspace_id, user_id=access.user_id
        ) as db:
            return await repository.list_projects(
                db,
                access.workspace_id,
                statuses=statuses,
                visible=access.project_ids,
                offset=offset,
                limit=limit,
            )

    async def create(
        self,
        *,
        access: WorkspaceAccess,
        name: str,
        slug: str,
        timezone: str | None,
        deep_check_weekday: int,
        default_language_code: str | None,
        primary_domain: str | None = None,
        default_location_id: int | None = None,
        own_entity: OwnEntityInput | None = None,
        info: RequestInfo,
    ) -> ProjectRecord:
        """With `own_entity`, the entity, its aliases and domains and its primary own role are
        made in the same transaction."""
        try:
            async with workspace_transaction(
                self._sessions, access.workspace_id, user_id=access.user_id
            ) as db:
                if timezone is None:
                    workspace = await workspaces.get(db, access.workspace_id)
                    if workspace is None:
                        raise NotFoundError
                    timezone = workspace.timezone
                else:
                    await check_timezone(db, timezone)
                if default_location_id is not None:
                    await _check_location(db, default_location_id)
                await self._take_a_slot(db, access.workspace_id)
                domain_id = None
                if primary_domain is not None:
                    domain_id = await entities.domain_id_for(db, normalize_host(primary_domain))
                project_id = await repository.insert_project(
                    db,
                    workspace_id=access.workspace_id,
                    name=name,
                    slug=slug,
                    timezone=timezone,
                    deep_check_weekday=deep_check_weekday,
                    default_language_code=default_language_code,
                    primary_domain_id=domain_id,
                    default_location_id=default_location_id,
                    created_by=access.user_id,
                )
                await audit.record(
                    db,
                    workspace_id=access.workspace_id,
                    actor_id=access.user_id,
                    action="project.created",
                    target_type="project",
                    target_id=project_id,
                    info=info,
                    after={
                        "name": name,
                        "slug": slug,
                        "timezone": timezone,
                        "deep_check_weekday": deep_check_weekday,
                        "default_language_code": default_language_code,
                        "primary_domain": None
                        if primary_domain is None
                        else normalize_host(primary_domain).name,
                        "default_location_id": default_location_id,
                    },
                )
                if own_entity is not None:
                    await _create_own_entity(db, access, project_id, own_entity, info)
                project = await repository.get_project(db, access.workspace_id, project_id)
        except ProjectSlugTakenError:
            raise _slug_taken() from None
        except EntityNameTakenError:
            raise invalid_field(
                "own_entity.canonical_name",
                code="entity_exists",
                message="The workspace has a brand with this name. Give it the own role instead.",
            ) from None
        if project is None:  # pragma: no cover - inserted by this transaction
            raise NotFoundError
        return project

    async def get(self, access: WorkspaceAccess, project_id: UUID) -> ProjectRecord:
        async with workspace_transaction(
            self._sessions, access.workspace_id, user_id=access.user_id
        ) as db:
            project = await repository.get_project(db, access.workspace_id, project_id)
        if project is None:
            raise NotFoundError
        return project

    async def update(
        self,
        *,
        access: WorkspaceAccess,
        project_id: UUID,
        changes: Mapping[str, str | int | None],
        info: RequestInfo,
    ) -> tuple[ProjectRecord, bool]:
        """Change the given fields. Returns the project and whether its time zone changed.

        Nothing is written, or logged, when nothing differs.
        """
        try:
            async with workspace_transaction(
                self._sessions, access.workspace_id, user_id=access.user_id
            ) as db:
                current = await repository.get_project(
                    db, access.workspace_id, project_id, for_update=True
                )
                if current is None:
                    raise NotFoundError
                columns = dict(changes)
                new_host: str | None = None
                if "primary_domain" in columns:
                    # The host a person typed becomes the row of its domain.
                    given = columns.pop("primary_domain")
                    host = None if given is None else normalize_host(str(given))
                    new_host = None if host is None else host.name
                    columns["primary_domain_id"] = (
                        None if host is None else await entities.domain_id_for(db, host)
                    )
                differing = {
                    field: value
                    for field, value in columns.items()
                    if getattr(current, field) != value
                }
                if not differing:
                    return current, False
                timezone = differing.get("timezone")
                if isinstance(timezone, str):
                    await check_timezone(db, timezone)
                location = differing.get("default_location_id")
                if isinstance(location, int):
                    await _check_location(db, location)
                if current.status == "archived" and "status" in differing:
                    # Coming back from the archive takes a slot again.
                    await self._take_a_slot(db, access.workspace_id)
                await repository.update_project(
                    db,
                    workspace_id=access.workspace_id,
                    project_id=project_id,
                    changes=differing,
                    now=datetime.now(UTC),
                )
                before = {field: getattr(current, field) for field in differing}
                after = dict(differing)
                if "primary_domain_id" in differing:
                    # Hosts, as the creation entry has them: a domain row id says nothing.
                    del before["primary_domain_id"], after["primary_domain_id"]
                    before["primary_domain"] = current.primary_host
                    after["primary_domain"] = new_host
                await audit.record(
                    db,
                    workspace_id=access.workspace_id,
                    actor_id=access.user_id,
                    action="project.updated",
                    target_type="project",
                    target_id=project_id,
                    info=info,
                    before=before,
                    after=after,
                )
                updated = await repository.get_project(db, access.workspace_id, project_id)
        except ProjectSlugTakenError:
            raise _slug_taken() from None
        if updated is None:  # pragma: no cover - the row was locked by this transaction
            raise NotFoundError
        return updated, "timezone" in differing

    @staticmethod
    async def _take_a_slot(db: AsyncSession, workspace_id: UUID) -> None:
        """Refuse when the workspace has as many live projects as its limit. Archived projects
        do not count, so archiving one frees a slot and reviving it needs one."""
        limit = await repository.lock_project_limit(db, workspace_id)
        used = await repository.count_projects(db, workspace_id)
        if used >= limit:
            raise QuotaExceededError(
                "The workspace has as many projects as its plan allows. Archive one first.",
                limit=limit,
                used=used,
                requested=1,
            )
