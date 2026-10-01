"""Rules for entities, aliases and entity domains (docs/19-api-specification.md section 3.4).

Every change is audited and bumps `entity_config_version` of every project that names the
entity, removed roles included (plan decision D7), in the same transaction. Members limited to
some projects see only the entities those projects name, and cannot change workspace entities.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import cast
from uuid import UUID

from pydantic_core import PydanticCustomError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.api import audit
from sightline.api.entities import repository
from sightline.api.entities.repository import (
    AliasRecord,
    AliasTakenError,
    EntityDomainRecord,
    EntityDomainTakenError,
    EntityInUseError,
    EntityNameTakenError,
    EntityRecord,
    NewAlias,
    RoleRecord,
)
from sightline.api.pagination import CursorParams, decode_cursor, encode_cursor, invalid_cursor
from sightline.api.problems import (
    CycleDetectedError,
    DuplicateError,
    EntityInUseProblemError,
    NotFoundError,
    invalid_field,
)
from sightline.api.request_info import RequestInfo
from sightline.api.schemas.entities import (
    AliasInput,
    DomainInput,
    EntityDomainWarning,
    alias_shape,
)
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.db.engine import workspace_transaction
from sightline.extraction.aliases import MatchMode
from sightline.extraction.domains import DomainResolver, DomainRule, MatchScope, ProjectRole
from sightline.extraction.urls import Host, normalize_host


@dataclass(frozen=True, slots=True)
class EntityFilters:
    entity_type: str | None
    q: str | None
    project_id: UUID | None
    role: str | None

    def scope(self) -> dict[str, object]:
        """What a cursor is bound to."""
        return {
            "sort": "name",
            "entity_type": self.entity_type,
            "q": self.q,
            "project_id": self.project_id,
            "role": self.role,
        }


@dataclass(frozen=True, slots=True)
class EntityRow:
    entity: EntityRecord
    domains: list[EntityDomainRecord]


@dataclass(frozen=True, slots=True)
class EntityPageResult:
    rows: list[EntityRow]
    next_cursor: str | None


@dataclass(frozen=True, slots=True)
class EntityDetailResult:
    entity: EntityRecord
    domains: list[EntityDomainRecord]
    aliases: list[AliasRecord]
    roles: list[RoleRecord]


def _name_taken() -> DuplicateError:
    return DuplicateError("The workspace has an entity of this type with this name.")


def _alias_taken() -> DuplicateError:
    return DuplicateError("The entity has this alias already.")


def _domain_taken() -> DuplicateError:
    return DuplicateError("The entity claims this domain at this scope already.")


def _new_alias(alias: AliasInput) -> NewAlias:
    return NewAlias(
        alias=alias.alias,
        match_mode=alias.match_mode,
        case_sensitive=alias.case_sensitive,
        language_code=alias.language_code,
        is_negative=alias.is_negative,
        requires_context=alias.requires_context,
    )


def stored_host(domain: DomainInput) -> Host:
    """The host a rule is stored against. A registrable rule names its registrable domain, so
    `www.acme.com` entered as registrable is stored as `acme.com`."""
    host = normalize_host(domain.domain)
    if domain.match_scope == "registrable" and not host.is_ip:
        return normalize_host(host.registrable_domain)
    return host


def _snapshot(entity: EntityRecord) -> dict[str, str | bool | list[str] | None]:
    return {
        "entity_type": entity.entity_type,
        "canonical_name": entity.canonical_name,
        "parent_entity_id": None
        if entity.parent_entity_id is None
        else str(entity.parent_entity_id),
        "description": entity.description,
        "is_ambiguous": entity.is_ambiguous,
        "disambiguation_hints": entity.disambiguation_hints,
    }


def _audit_value(value: object) -> str | bool | list[str] | None:
    if value is None or isinstance(value, str | bool):
        return value
    if isinstance(value, list):
        return [str(item) for item in value]
    return str(value)


class EntityService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    # Entities.

    async def page(
        self, access: WorkspaceAccess, filters: EntityFilters, page: CursorParams
    ) -> EntityPageResult:
        after: tuple[str, UUID] | None = None
        if page.cursor is not None:
            key = decode_cursor(page.cursor, scope=filters.scope())
            if len(key) != 2 or not all(isinstance(value, str) for value in key):
                raise invalid_cursor()
            try:
                after = (str(key[0]), UUID(str(key[1])))
            except ValueError:
                raise invalid_cursor() from None
        if (
            filters.project_id is not None
            and access.project_ids is not None
            and filters.project_id not in access.project_ids
        ):
            return EntityPageResult(rows=[], next_cursor=None)
        async with self._transaction(access) as db:
            found = await repository.list_entities(
                db,
                access.workspace_id,
                visible=access.project_ids,
                entity_type=filters.entity_type,
                q=filters.q,
                project_id=filters.project_id,
                role=filters.role,
                after=after,
                limit=page.limit + 1,
            )
            shown = found[: page.limit]
            claimed = await repository.domains_of(
                db, access.workspace_id, [entity.id for entity in shown]
            )
        next_cursor = None
        if len(found) > page.limit:
            last = shown[-1]
            next_cursor = encode_cursor([last.sort_key, str(last.id)], scope=filters.scope())
        return EntityPageResult(
            rows=[
                EntityRow(entity, [d for d in claimed if d.entity_id == entity.id])
                for entity in shown
            ],
            next_cursor=next_cursor,
        )

    async def get(self, access: WorkspaceAccess, entity_id: UUID) -> EntityDetailResult:
        async with self._transaction(access) as db:
            entity = await repository.get_entity(
                db, access.workspace_id, entity_id, visible=access.project_ids
            )
            if entity is None:
                raise NotFoundError
            return EntityDetailResult(
                entity=entity,
                domains=await repository.domains_of(db, access.workspace_id, [entity_id]),
                aliases=await repository.aliases_of(db, access.workspace_id, [entity_id]),
                roles=await repository.roles_of(
                    db, access.workspace_id, entity_id, visible=access.project_ids
                ),
            )

    async def create(
        self,
        access: WorkspaceAccess,
        *,
        entity_type: str,
        canonical_name: str,
        parent_entity_id: UUID | None,
        description: str | None,
        is_ambiguous: bool,
        disambiguation_hints: Sequence[str],
        aliases: Sequence[AliasInput],
        domains: Sequence[DomainInput],
        info: RequestInfo,
    ) -> EntityRow:
        try:
            async with self._transaction(access) as db:
                if parent_entity_id is not None:
                    await self._hold_parent(db, access, parent_entity_id)
                entity_id = await repository.insert_entity(
                    db,
                    workspace_id=access.workspace_id,
                    entity_type=entity_type,
                    canonical_name=canonical_name,
                    parent_entity_id=parent_entity_id,
                    description=description,
                    is_ambiguous=is_ambiguous,
                    disambiguation_hints=disambiguation_hints,
                )
                await repository.insert_aliases(
                    db,
                    workspace_id=access.workspace_id,
                    entity_id=entity_id,
                    aliases=[_new_alias(alias) for alias in aliases],
                    created_by=access.user_id,
                )
                # Hosts in one order, so two requests adding the same new hosts cannot each
                # wait on a host the other inserted first.
                for domain in sorted(domains, key=lambda given: stored_host(given).name):
                    await repository.insert_entity_domain(
                        db,
                        workspace_id=access.workspace_id,
                        entity_id=entity_id,
                        domain_id=await repository.domain_id_for(db, stored_host(domain)),
                        match_scope=domain.match_scope,
                        path_prefix=domain.path_prefix,
                    )
                entity = await repository.get_entity(
                    db, access.workspace_id, entity_id, visible=None
                )
                if entity is None:  # pragma: no cover - inserted by this transaction
                    raise NotFoundError
                await audit.record(
                    db,
                    workspace_id=access.workspace_id,
                    actor_id=access.user_id,
                    action="entity.created",
                    target_type="entity",
                    target_id=entity_id,
                    info=info,
                    after={
                        **_snapshot(entity),
                        "aliases": [alias.alias for alias in aliases],
                        "domains": [stored_host(domain).name for domain in domains],
                    },
                )
                claimed = await repository.domains_of(db, access.workspace_id, [entity_id])
        except EntityNameTakenError:
            raise _name_taken() from None
        except AliasTakenError:
            raise DuplicateError("An alias is given twice.") from None
        except EntityDomainTakenError:
            raise DuplicateError("A domain is given twice at the same scope.") from None
        return EntityRow(entity, claimed)

    async def update(
        self,
        access: WorkspaceAccess,
        entity_id: UUID,
        changes: Mapping[str, object],
        info: RequestInfo,
    ) -> EntityRow:
        """Change the given fields. Nothing is written, logged or bumped when nothing differs."""
        try:
            async with self._transaction(access) as db:
                current = await repository.get_entity(
                    db, access.workspace_id, entity_id, visible=None, for_update=True
                )
                if current is None:
                    raise NotFoundError
                differing = {
                    field: value
                    for field, value in changes.items()
                    if getattr(current, field) != value
                }
                if differing:
                    parent = differing.get("parent_entity_id")
                    if isinstance(parent, UUID):
                        # One parent change at a time per workspace: two at once could each
                        # pass the check below and together write a cycle.
                        await repository.lock_parent_changes(db, access.workspace_id)
                        await self._hold_parent(db, access, parent)
                        if entity_id in await repository.ancestors(db, access.workspace_id, parent):
                            raise CycleDetectedError(
                                "The parent is this entity or one of its products."
                            )
                    await repository.update_entity(
                        db,
                        workspace_id=access.workspace_id,
                        entity_id=entity_id,
                        changes=differing,
                        now=datetime.now(UTC),
                    )
                    await self._changed(db, access, entity_id)
                    await audit.record(
                        db,
                        workspace_id=access.workspace_id,
                        actor_id=access.user_id,
                        action="entity.updated",
                        target_type="entity",
                        target_id=entity_id,
                        info=info,
                        before={
                            field: _audit_value(getattr(current, field)) for field in differing
                        },
                        after={field: _audit_value(value) for field, value in differing.items()},
                    )
                entity = await repository.get_entity(
                    db, access.workspace_id, entity_id, visible=None
                )
                if entity is None:  # pragma: no cover - the row was locked by this transaction
                    raise NotFoundError
                claimed = await repository.domains_of(db, access.workspace_id, [entity_id])
        except EntityNameTakenError:
            raise _name_taken() from None
        return EntityRow(entity, claimed)

    async def delete(self, access: WorkspaceAccess, entity_id: UUID, info: RequestInfo) -> None:
        try:
            async with self._transaction(access) as db:
                current = await repository.get_entity(
                    db, access.workspace_id, entity_id, visible=None
                )
                if current is None:
                    raise NotFoundError
                await repository.delete_entity(db, access.workspace_id, entity_id)
                await audit.record(
                    db,
                    workspace_id=access.workspace_id,
                    actor_id=access.user_id,
                    action="entity.deleted",
                    target_type="entity",
                    target_id=entity_id,
                    info=info,
                    before=_snapshot(current),
                )
        except EntityInUseError:
            raise EntityInUseProblemError(
                "A project has named this entity, or it has products. Remove those first."
            ) from None

    # Aliases.

    async def list_aliases(self, access: WorkspaceAccess, entity_id: UUID) -> list[AliasRecord]:
        async with self._transaction(access) as db:
            await self._visible(db, access, entity_id)
            return await repository.aliases_of(db, access.workspace_id, [entity_id])

    async def add_aliases(
        self,
        access: WorkspaceAccess,
        entity_id: UUID,
        aliases: Sequence[AliasInput],
        info: RequestInfo,
    ) -> list[AliasRecord]:
        try:
            async with self._transaction(access) as db:
                await self._locked(db, access, entity_id)
                added = await repository.insert_aliases(
                    db,
                    workspace_id=access.workspace_id,
                    entity_id=entity_id,
                    aliases=[_new_alias(alias) for alias in aliases],
                    created_by=access.user_id,
                )
                await audit.record_each(
                    db,
                    workspace_id=access.workspace_id,
                    actor_id=access.user_id,
                    action="entity_alias.created",
                    target_type="entity_alias",
                    info=info,
                    entries=[
                        audit.Entry(
                            target_id=alias_id,
                            after={
                                "entity_id": str(entity_id),
                                **_alias_snapshot(_new_alias(alias)),
                            },
                        )
                        for alias_id, alias in zip(added, aliases, strict=True)
                    ],
                )
                await self._changed(db, access, entity_id)
                every = await repository.aliases_of(db, access.workspace_id, [entity_id])
        except AliasTakenError:
            raise _alias_taken() from None
        wanted = set(added)
        return [alias for alias in every if alias.id in wanted]

    async def update_alias(
        self,
        access: WorkspaceAccess,
        entity_id: UUID,
        alias_id: UUID,
        changes: Mapping[str, object],
        info: RequestInfo,
    ) -> AliasRecord:
        try:
            async with self._transaction(access) as db:
                await self._locked(db, access, entity_id)
                current = await repository.get_alias(db, access.workspace_id, entity_id, alias_id)
                if current is None:
                    raise NotFoundError
                merged = {
                    field: changes.get(field, getattr(current, field))
                    for field in ("alias", "match_mode", "case_sensitive")
                }
                try:
                    shaped = alias_shape(
                        cast(str, merged["alias"]),
                        cast(MatchMode, merged["match_mode"]),
                        case_sensitive=bool(merged["case_sensitive"]),
                    )
                except PydanticCustomError as error:
                    raise invalid_field("alias", code=error.type, message=str(error)) from None
                updates = dict(changes)
                if "alias" in changes or shaped != current.alias:
                    updates["alias"] = shaped
                differing = {
                    field: value
                    for field, value in updates.items()
                    if getattr(current, field) != value
                }
                if differing:
                    await repository.update_alias(
                        db, workspace_id=access.workspace_id, alias_id=alias_id, changes=differing
                    )
                    await self._changed(db, access, entity_id)
                    await audit.record(
                        db,
                        workspace_id=access.workspace_id,
                        actor_id=access.user_id,
                        action="entity_alias.updated",
                        target_type="entity_alias",
                        target_id=alias_id,
                        info=info,
                        before={
                            field: _audit_value(getattr(current, field)) for field in differing
                        },
                        after={field: _audit_value(value) for field, value in differing.items()},
                    )
                updated = await repository.get_alias(db, access.workspace_id, entity_id, alias_id)
        except AliasTakenError:
            raise _alias_taken() from None
        if updated is None:  # pragma: no cover - read in this transaction
            raise NotFoundError
        return updated

    async def delete_alias(
        self, access: WorkspaceAccess, entity_id: UUID, alias_id: UUID, info: RequestInfo
    ) -> None:
        async with self._transaction(access) as db:
            await self._locked(db, access, entity_id)
            current = await repository.get_alias(db, access.workspace_id, entity_id, alias_id)
            if current is None or not await repository.delete_alias(
                db, access.workspace_id, entity_id, alias_id
            ):
                raise NotFoundError
            await self._changed(db, access, entity_id)
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="entity_alias.deleted",
                target_type="entity_alias",
                target_id=alias_id,
                info=info,
                before={"entity_id": str(entity_id), "alias": current.alias},
            )

    # Domains.

    async def list_domains(
        self, access: WorkspaceAccess, entity_id: UUID
    ) -> list[EntityDomainRecord]:
        async with self._transaction(access) as db:
            await self._visible(db, access, entity_id)
            return await repository.domains_of(db, access.workspace_id, [entity_id])

    async def add_domain(
        self, access: WorkspaceAccess, entity_id: UUID, domain: DomainInput, info: RequestInfo
    ) -> tuple[EntityDomainRecord, list[EntityDomainWarning]]:
        host = stored_host(domain)
        try:
            async with self._transaction(access) as db:
                await self._locked(db, access, entity_id)
                entity_domain_id = await repository.insert_entity_domain(
                    db,
                    workspace_id=access.workspace_id,
                    entity_id=entity_id,
                    domain_id=await repository.domain_id_for(db, host),
                    match_scope=domain.match_scope,
                    path_prefix=domain.path_prefix,
                )
                await self._changed(db, access, entity_id)
                await audit.record(
                    db,
                    workspace_id=access.workspace_id,
                    actor_id=access.user_id,
                    action="entity_domain.created",
                    target_type="entity_domain",
                    target_id=entity_domain_id,
                    info=info,
                    after={
                        "entity_id": str(entity_id),
                        "host": host.name,
                        "match_scope": domain.match_scope,
                        "path_prefix": domain.path_prefix,
                    },
                )
                claim = DomainRule(
                    entity_id=entity_id,
                    role="watch",  # the role does not change what a rule claims
                    match_scope=domain.match_scope,
                    host=host,
                    path_prefix=domain.path_prefix,
                )
                warnings = await self._conflicts(db, access, entity_id, claim)
                created = await repository.get_entity_domain(
                    db, access.workspace_id, entity_id, entity_domain_id
                )
        except EntityDomainTakenError:
            raise _domain_taken() from None
        if created is None:  # pragma: no cover - inserted by this transaction
            raise NotFoundError
        return created, warnings

    async def delete_domain(
        self,
        access: WorkspaceAccess,
        entity_id: UUID,
        entity_domain_id: UUID,
        info: RequestInfo,
    ) -> None:
        async with self._transaction(access) as db:
            await self._locked(db, access, entity_id)
            current = await repository.get_entity_domain(
                db, access.workspace_id, entity_id, entity_domain_id
            )
            if current is None or not await repository.delete_entity_domain(
                db, access.workspace_id, entity_id, entity_domain_id
            ):
                raise NotFoundError
            await self._changed(db, access, entity_id)
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="entity_domain.deleted",
                target_type="entity_domain",
                target_id=entity_domain_id,
                info=info,
                before={
                    "entity_id": str(entity_id),
                    "host": current.host,
                    "match_scope": current.match_scope,
                    "path_prefix": current.path_prefix,
                },
            )

    # Shared steps.

    @staticmethod
    async def _visible(db: AsyncSession, access: WorkspaceAccess, entity_id: UUID) -> None:
        found = await repository.get_entity(
            db, access.workspace_id, entity_id, visible=access.project_ids
        )
        if found is None:
            raise NotFoundError

    @staticmethod
    async def _locked(db: AsyncSession, access: WorkspaceAccess, entity_id: UUID) -> None:
        """The entity, locked so changes to it and its aliases and domains run one at a time."""
        found = await repository.get_entity(
            db, access.workspace_id, entity_id, visible=None, for_update=True
        )
        if found is None:
            raise NotFoundError

    @staticmethod
    async def _hold_parent(
        db: AsyncSession, access: WorkspaceAccess, parent_entity_id: UUID
    ) -> None:
        """The parent exists, and cannot be deleted before this transaction ends."""
        if not await repository.hold_entity(db, access.workspace_id, parent_entity_id):
            raise invalid_field(
                "parent_entity_id", code="parent_unknown", message="No such entity."
            )

    @staticmethod
    async def _changed(db: AsyncSession, access: WorkspaceAccess, entity_id: UUID) -> None:
        naming = await repository.projects_naming(db, access.workspace_id, entity_id)
        await repository.bump_entity_config(db, access.workspace_id, naming)

    @staticmethod
    async def _conflicts(
        db: AsyncSession, access: WorkspaceAccess, entity_id: UUID, claim: DomainRule
    ) -> list[EntityDomainWarning]:
        """`domain_role_conflict` when, in a project that names the entity, another entity
        claims what `claim` claims at the same specificity (doc 13 stage 2)."""
        project_ids = await repository.live_projects_naming(db, access.workspace_id, entity_id)
        rules = await repository.rules_of_projects(db, access.workspace_id, project_ids)
        for project_id in project_ids:
            resolver = DomainResolver(
                DomainRule(
                    entity_id=rule.entity_id,
                    role=cast(ProjectRole, rule.role),
                    match_scope=cast(MatchScope, rule.match_scope),
                    host=Host(
                        name=rule.host,
                        registrable_domain=rule.registrable_domain,
                        public_suffix=rule.public_suffix,
                        is_ip=rule.is_ip,
                    ),
                    path_prefix=rule.path_prefix,
                )
                for rule in rules
                if rule.project_id == project_id
            )
            for conflict in resolver.conflicts():
                if (conflict.match_scope, conflict.key) == (claim.match_scope, claim.key):
                    return ["domain_role_conflict"]
        return []


def _alias_snapshot(alias: NewAlias) -> dict[str, str | bool | None]:
    return {
        "alias": alias.alias,
        "match_mode": alias.match_mode,
        "case_sensitive": alias.case_sensitive,
        "language_code": alias.language_code,
        "is_negative": alias.is_negative,
        "requires_context": alias.requires_context,
    }
