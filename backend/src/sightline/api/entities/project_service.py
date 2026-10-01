"""Rules for the roles a project gives entities, its domains, and the alias test
(docs/19-api-specification.md section 3.4).

A role change bumps the project's `entity_config_version` (plan decision D7) and is audited, in
the same transaction. Role writes lock the project row, so the primary own entity and the
competitor limit are checked one write at a time. A removed role keeps its row; adding the
entity again brings the same row back.
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Final, cast
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.api import audit
from sightline.api.entities import project_repository as roles
from sightline.api.entities import repository as entities
from sightline.api.entities.project_repository import (
    MatcherEntity,
    PrimaryOwnTakenError,
    ProjectDomainRow,
    RoleRow,
)
from sightline.api.entities.repository import EntityDomainRecord
from sightline.api.problems import (
    CannotRemovePrimaryOwnError,
    CompetitorLimitError,
    DuplicateError,
    NotFoundError,
    PayloadTooLargeError,
    PrimaryOwnExistsError,
    TooManyMatchesError,
    invalid_field,
)
from sightline.api.projects import repository as projects
from sightline.api.request_info import RequestInfo
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.db.engine import workspace_transaction
from sightline.extraction.aliases import (
    AliasMatcher,
    AliasRule,
    EntityRule,
    MatchMode,
    MatchResult,
)
from sightline.extraction.aliases import TooManyMatchesError as TooManyHitsError

# docs/08-seo-keyword-system.md section 4: up to 10 competitors tracked in SEO per project.
COMPETITOR_LIMIT: Final = 10
ALIAS_TEST_MAX_BYTES: Final = 100 * 1024
_ROLE_FIELDS: Final = ("role", "is_primary", "track_seo", "track_ai", "color_index")


@dataclass(frozen=True, slots=True)
class RoleView:
    role: RoleRow
    domains: list[EntityDomainRecord]


@dataclass(frozen=True, slots=True)
class AliasTestOutcome:
    result: MatchResult  # offsets in UTF-16 code units
    entities: dict[UUID, MatcherEntity]
    skipped_alias_ids: tuple[UUID, ...]


def _seo_competitor(values: Mapping[str, object]) -> bool:
    return values["role"] == "competitor" and bool(values["track_seo"])


def _snapshot(values: Mapping[str, object]) -> dict[str, str | int | bool | None]:
    return {field: cast(str | int | bool | None, values[field]) for field in _ROLE_FIELDS}


class ProjectEntityService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    async def list_roles(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        role: str | None,
        include_removed: bool,
    ) -> list[RoleView]:
        async with self._transaction(access) as db:
            await self._project(db, access, project_id)
            found = await roles.list_roles(
                db, access.workspace_id, project_id, role=role, include_removed=include_removed
            )
            claimed = await entities.domains_of(
                db, access.workspace_id, [row.entity_id for row in found]
            )
        return [
            RoleView(row, [domain for domain in claimed if domain.entity_id == row.entity_id])
            for row in found
        ]

    async def add(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        entity_id: UUID,
        values: Mapping[str, object],
        info: RequestInfo,
    ) -> RoleView:
        """Give an entity a role; an entity whose role was removed gets it back."""
        try:
            async with self._transaction(access) as db:
                await self._project(db, access, project_id, lock=True)
                found = await entities.get_entity(
                    db, access.workspace_id, entity_id, visible=access.project_ids
                )
                if found is None:
                    raise invalid_field(
                        "entity_id", code="entity_unknown", message="No such entity."
                    )
                current = await roles.get_role(db, access.workspace_id, project_id, entity_id)
                if current is not None and current.removed_at is None:
                    raise DuplicateError("The project has given this entity a role already.")
                await self._check_competitors(db, access, project_id, entity_id, values)
                write = {**values, "removed_at": None}
                if current is None:
                    await roles.insert_role(
                        db,
                        workspace_id=access.workspace_id,
                        project_id=project_id,
                        entity_id=entity_id,
                        values=write,
                    )
                else:
                    await roles.update_role(
                        db,
                        workspace_id=access.workspace_id,
                        project_id=project_id,
                        entity_id=entity_id,
                        values={**write, "added_at": datetime.now(UTC)},
                    )
                await self._changed(db, access, project_id)
                await audit.record(
                    db,
                    workspace_id=access.workspace_id,
                    actor_id=access.user_id,
                    action="project_entity.created",
                    target_type="project_entity",
                    target_id=entity_id,
                    info=info,
                    after={"project_id": str(project_id), **_snapshot(values)},
                )
                return await self._view(db, access, project_id, entity_id)
        except PrimaryOwnTakenError:
            raise PrimaryOwnExistsError(
                "The project has a primary own entity. Make that one not primary first."
            ) from None

    async def update(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        entity_id: UUID,
        changes: Mapping[str, object],
        info: RequestInfo,
    ) -> RoleView:
        """Change a live role. Nothing is written, logged or bumped when nothing differs."""
        try:
            async with self._transaction(access) as db:
                await self._project(db, access, project_id, lock=True)
                current = await self._live_role(db, access, project_id, entity_id)
                before = {field: getattr(current, field) for field in _ROLE_FIELDS}
                after = {**before, **changes}
                if after["is_primary"] and after["role"] != "own":
                    if before["is_primary"]:
                        raise CannotRemovePrimaryOwnError(
                            "The primary own entity stays own. Make another one primary first."
                        )
                    raise invalid_field(
                        "is_primary", code="primary_needs_own", message="Only an own entity."
                    )
                differing = {
                    field: after[field] for field in _ROLE_FIELDS if after[field] != before[field]
                }
                if differing:
                    if _seo_competitor(after) and not _seo_competitor(before):
                        await self._check_competitors(db, access, project_id, entity_id, after)
                    await roles.update_role(
                        db,
                        workspace_id=access.workspace_id,
                        project_id=project_id,
                        entity_id=entity_id,
                        values=differing,
                    )
                    await self._changed(db, access, project_id)
                    await audit.record(
                        db,
                        workspace_id=access.workspace_id,
                        actor_id=access.user_id,
                        action="project_entity.updated",
                        target_type="project_entity",
                        target_id=entity_id,
                        info=info,
                        before={
                            "project_id": str(project_id),
                            **{
                                field: cast(str | int | bool | None, before[field])
                                for field in differing
                            },
                        },
                        after={
                            "project_id": str(project_id),
                            **{
                                field: cast(str | int | bool | None, value)
                                for field, value in differing.items()
                            },
                        },
                    )
                return await self._view(db, access, project_id, entity_id)
        except PrimaryOwnTakenError:
            raise PrimaryOwnExistsError(
                "The project has a primary own entity. Make that one not primary first."
            ) from None

    async def remove(
        self, access: WorkspaceAccess, project_id: UUID, entity_id: UUID, info: RequestInfo
    ) -> RoleView:
        """End a role. Its row stays, with `removed_at`, for the history it explains."""
        async with self._transaction(access) as db:
            await self._project(db, access, project_id, lock=True)
            current = await self._live_role(db, access, project_id, entity_id)
            if current.is_primary:
                raise CannotRemovePrimaryOwnError(
                    "The primary own entity stays. Make another one primary first."
                )
            await roles.update_role(
                db,
                workspace_id=access.workspace_id,
                project_id=project_id,
                entity_id=entity_id,
                values={"removed_at": datetime.now(UTC)},
            )
            await self._changed(db, access, project_id)
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="project_entity.removed",
                target_type="project_entity",
                target_id=entity_id,
                info=info,
                before={"project_id": str(project_id), "role": current.role},
            )
            return await self._view(db, access, project_id, entity_id)

    async def domains(
        self, access: WorkspaceAccess, project_id: UUID, *, role: str | None
    ) -> list[ProjectDomainRow]:
        async with self._transaction(access) as db:
            await self._project(db, access, project_id)
            return await roles.project_domains(db, access.workspace_id, project_id, role=role)

    async def alias_test(
        self, access: WorkspaceAccess, project_id: UUID, text: str
    ) -> AliasTestOutcome:
        """What extraction would count in `text` with the project's current entities."""
        size = len(text.encode("utf-8", "surrogatepass"))
        if size > ALIAS_TEST_MAX_BYTES:
            raise PayloadTooLargeError(
                "The alias test takes up to 100 KB of text.", limit_bytes=ALIAS_TEST_MAX_BYTES
            )
        async with self._transaction(access) as db:
            await self._project(db, access, project_id)
            named = await roles.matcher_entities(db, access.workspace_id, project_id)
            ids = [entity.id for entity in named]
            hosts = await roles.matcher_hosts(db, access.workspace_id, ids)
            stored = await entities.aliases_of(db, access.workspace_id, ids)
        matcher = AliasMatcher(
            [
                EntityRule(
                    id=entity.id,
                    canonical_name=entity.canonical_name,
                    parent_entity_id=entity.parent_entity_id,
                    is_ambiguous=entity.is_ambiguous,
                    hints=entity.hints,
                    domains=tuple(hosts[entity.id]),
                )
                for entity in named
            ],
            [
                AliasRule(
                    id=alias.id,
                    entity_id=alias.entity_id,
                    alias=alias.alias,
                    match_mode=cast(MatchMode, alias.match_mode),
                    case_sensitive=alias.case_sensitive,
                    is_negative=alias.is_negative,
                    requires_context=alias.requires_context,
                )
                for alias in stored
            ],
        )
        try:
            # Up to 100 KB of matching is CPU work: off the event loop.
            result = await asyncio.to_thread(matcher.match, text)
        except TooManyHitsError:
            raise TooManyMatchesError(
                "The aliases match this text too many times. Narrow a substring alias."
            ) from None
        return AliasTestOutcome(
            result=to_utf16(result, text),
            entities={entity.id: entity for entity in named},
            skipped_alias_ids=matcher.skipped_alias_ids,
        )

    # Shared steps.

    @staticmethod
    async def _project(
        db: AsyncSession, access: WorkspaceAccess, project_id: UUID, *, lock: bool = False
    ) -> None:
        """The project exists; with `lock`, role writes to it wait for this one."""
        found = await projects.get_project(db, access.workspace_id, project_id, for_update=lock)
        if found is None:
            raise NotFoundError

    @staticmethod
    async def _live_role(
        db: AsyncSession, access: WorkspaceAccess, project_id: UUID, entity_id: UUID
    ) -> RoleRow:
        current = await roles.get_role(db, access.workspace_id, project_id, entity_id)
        if current is None or current.removed_at is not None:
            raise NotFoundError
        return current

    @staticmethod
    async def _check_competitors(
        db: AsyncSession,
        access: WorkspaceAccess,
        project_id: UUID,
        entity_id: UUID,
        values: Mapping[str, object],
    ) -> None:
        if not _seo_competitor(values):
            return
        others = await roles.count_seo_competitors(
            db, access.workspace_id, project_id, besides=entity_id
        )
        if others >= COMPETITOR_LIMIT:
            raise CompetitorLimitError(
                "A project tracks up to 10 competitors in SEO. Stop tracking one first.",
                limit=COMPETITOR_LIMIT,
            )

    @staticmethod
    async def _changed(db: AsyncSession, access: WorkspaceAccess, project_id: UUID) -> None:
        await entities.bump_entity_config(db, access.workspace_id, [project_id])

    @staticmethod
    async def _view(
        db: AsyncSession, access: WorkspaceAccess, project_id: UUID, entity_id: UUID
    ) -> RoleView:
        row = await roles.get_role(db, access.workspace_id, project_id, entity_id)
        if row is None:  # pragma: no cover - written by this transaction
            raise NotFoundError
        return RoleView(row, await entities.domains_of(db, access.workspace_id, [entity_id]))


def to_utf16(result: MatchResult, text: str) -> MatchResult:
    """The same result with offsets in UTF-16 code units, as a JavaScript string indexes the
    text. Each character past U+FFFF is two units."""
    if all(ord(char) <= 0xFFFF for char in text):
        return result
    units = [0]
    for char in text:
        units.append(units[-1] + (2 if ord(char) > 0xFFFF else 1))
    return MatchResult(
        mentions=tuple(
            replace(
                mention,
                spans=tuple(
                    replace(span, start=units[span.start], end=units[span.end])
                    for span in mention.spans
                ),
            )
            for mention in result.mentions
        ),
        negatives_applied=tuple(
            replace(negative, start=units[negative.start], end=units[negative.end])
            for negative in result.negatives_applied
        ),
    )
