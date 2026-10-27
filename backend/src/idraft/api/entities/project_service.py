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

from idraft.api import audit
from idraft.api.entities import project_repository as roles
from idraft.api.entities import repository as entities
from idraft.api.entities.project_repository import (
    MatcherEntity,
    ProjectDomainRow,
    RoleRow,
)
from idraft.api.entities.repository import EntityDomainRecord
from idraft.api.problems import (
    CannotRemovePrimaryOwnError,
    CompetitorLimitError,
    DuplicateError,
    NotFoundError,
    PayloadTooLargeError,
    TooManyMatchesError,
    invalid_field,
)
from idraft.api.projects import repository as projects
from idraft.api.request_info import RequestInfo
from idraft.api.schemas.entities import PRIMARY_NEEDS_OWN
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.extraction.aliases import (
    AliasMatcher,
    AliasRule,
    EntityRule,
    MatchMode,
    MatchResult,
)
from idraft.extraction.aliases import TooManyMatchesError as TooManyHitsError

# docs/08-seo-keyword-system.md section 4: up to 10 competitors tracked in SEO per project.
COMPETITOR_LIMIT: Final = 10
ALIAS_TEST_MAX_BYTES: Final = 100 * 1024
_ROLE_FIELDS: Final = ("role", "is_primary", "track_seo", "track_ai", "color_index")
_PRIMARY_STAYS: Final = (
    "The primary own entity stays own and primary. Make another own entity primary: it takes "
    "over, and this one can then change or go."
)


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


def _row_snapshot(project_id: UUID, row: RoleRow) -> dict[str, str | int | bool | None]:
    """A role as it was, removed or not, for the audit entry of the change that ends it."""
    return {
        "project_id": str(project_id),
        **_snapshot({field: getattr(row, field) for field in _ROLE_FIELDS}),
        "removed_at": None if row.removed_at is None else row.removed_at.isoformat(),
    }


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
        """Give an entity a role; an entity whose role was removed gets it back. A primary own
        entity takes over from the project's current one."""
        async with self._transaction(access) as db:
            await self._project(db, access, project_id, lock=True)
            found = await entities.get_entity(
                db, access.workspace_id, entity_id, visible=access.project_ids
            )
            # Held, so a delete racing this request waits for the role and is then refused.
            if found is None or not await entities.hold_entity(db, access.workspace_id, entity_id):
                raise invalid_field("entity_id", code="entity_unknown", message="No such entity.")
            current = await roles.get_role(db, access.workspace_id, project_id, entity_id)
            if current is not None and current.removed_at is None:
                raise DuplicateError("The project has given this entity a role already.")
            await self._check_competitors(db, access, project_id, entity_id, values)
            if values["is_primary"]:
                await self._hand_over(db, access, project_id, entity_id, info)
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
                before=None if current is None else _row_snapshot(project_id, current),
                after={"project_id": str(project_id), **_snapshot(values)},
            )
            return await self._view(db, access, project_id, entity_id)

    async def update(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        entity_id: UUID,
        changes: Mapping[str, object],
        info: RequestInfo,
    ) -> RoleView:
        """Change a live role. Nothing is written, logged or bumped when nothing differs. The
        primary own entity stays primary and own until another own entity takes over."""
        async with self._transaction(access) as db:
            await self._project(db, access, project_id, lock=True)
            current = await self._live_role(db, access, project_id, entity_id)
            before = {field: getattr(current, field) for field in _ROLE_FIELDS}
            after = {**before, **changes}
            if before["is_primary"] and (not after["is_primary"] or after["role"] != "own"):
                raise CannotRemovePrimaryOwnError(_PRIMARY_STAYS)
            if after["is_primary"] and after["role"] != "own":
                raise invalid_field(
                    "is_primary", code="primary_needs_own", message=PRIMARY_NEEDS_OWN
                )
            differing = {
                field: after[field] for field in _ROLE_FIELDS if after[field] != before[field]
            }
            if differing:
                if _seo_competitor(after) and not _seo_competitor(before):
                    await self._check_competitors(db, access, project_id, entity_id, after)
                if after["is_primary"] and not before["is_primary"]:
                    await self._hand_over(db, access, project_id, entity_id, info)
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

    async def remove(
        self, access: WorkspaceAccess, project_id: UUID, entity_id: UUID, info: RequestInfo
    ) -> RoleView:
        """End a role. Its row stays, with `removed_at`, for the history it explains."""
        async with self._transaction(access) as db:
            await self._project(db, access, project_id, lock=True)
            current = await self._live_role(db, access, project_id, entity_id)
            if current.is_primary:
                raise CannotRemovePrimaryOwnError(_PRIMARY_STAYS)
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
                before=_row_snapshot(project_id, current),
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
        async with self._transaction(access) as db:
            await self._project(db, access, project_id)
            if len(text.encode("utf-8", "surrogatepass")) > ALIAS_TEST_MAX_BYTES:
                raise PayloadTooLargeError(
                    "The alias test takes up to 100 KB of text.",
                    limit_bytes=ALIAS_TEST_MAX_BYTES,
                )
            named = await roles.matcher_entities(db, access.workspace_id, project_id)
            ids = [entity.id for entity in named]
            hosts = await roles.matcher_hosts(db, access.workspace_id, ids)
            stored = await entities.aliases_of(db, access.workspace_id, ids)
        rules = [
            EntityRule(
                id=entity.id,
                canonical_name=entity.canonical_name,
                parent_entity_id=entity.parent_entity_id,
                is_ambiguous=entity.is_ambiguous,
                hints=entity.hints,
                domains=tuple(hosts[entity.id]),
            )
            for entity in named
        ]
        aliases = [
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
        ]

        def run() -> tuple[MatchResult, tuple[UUID, ...]]:
            matcher = AliasMatcher(rules, aliases)
            return matcher.match(text), matcher.skipped_alias_ids

        try:
            # Compiling the patterns and matching up to 100 KB is CPU work: off the event loop.
            result, skipped = await asyncio.to_thread(run)
        except TooManyHitsError:
            raise TooManyMatchesError(
                "The aliases match this text too many times. Narrow a substring alias."
            ) from None
        return AliasTestOutcome(
            result=to_utf16(result, text),
            entities={entity.id: entity for entity in named},
            skipped_alias_ids=skipped,
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
    async def _hand_over(
        db: AsyncSession,
        access: WorkspaceAccess,
        project_id: UUID,
        entity_id: UUID,
        info: RequestInfo,
    ) -> None:
        """The project's primary own entity, when it is another one, stops being primary, so
        `entity_id` can take over. The caller holds the project lock."""
        live_own = await roles.list_roles(
            db, access.workspace_id, project_id, role="own", include_removed=False
        )
        for row in live_own:
            if not row.is_primary or row.entity_id == entity_id:
                continue
            await roles.update_role(
                db,
                workspace_id=access.workspace_id,
                project_id=project_id,
                entity_id=row.entity_id,
                values={"is_primary": False},
            )
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="project_entity.updated",
                target_type="project_entity",
                target_id=row.entity_id,
                info=info,
                before={"project_id": str(project_id), "is_primary": True},
                after={"project_id": str(project_id), "is_primary": False},
            )

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
