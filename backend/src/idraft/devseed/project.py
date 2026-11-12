"""The project, its brand and its competitors, made or brought in line with the fixture.

Every write goes through the service the matching route uses (`ProjectService`,
`EntityService`, `ProjectEntityService`), so the same rules, locks and audit entries apply.
Reads that only decide what to write use the repositories. Nothing the fixture does not name is
removed or renamed: an alias, domain or competitor a developer added stays.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final
from uuid import UUID

from sqlalchemy import func, select

from idraft.api.entities import project_repository as roles
from idraft.api.entities import repository as entity_rows
from idraft.api.entities.project_service import ProjectEntityService
from idraft.api.entities.service import EntityService, stored_host
from idraft.api.projects.service import ProjectService
from idraft.api.schemas.entities import AliasInput, DomainInput, ProjectEntityCreate
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.db.tables import entities, projects
from idraft.devseed.context import SEED_INFO, SeedError, Sessions
from idraft.devseed.fixture import CompetitorPart, EntityPart, ProjectPart
from idraft.extraction.domains import ProjectRole

ENTITY_TYPE: Final = "brand"
# The API's default (`ProjectCreate.deep_check_weekday`).
DEEP_CHECK_WEEKDAY: Final = 1


@dataclass(frozen=True, slots=True)
class EntityChanges:
    created: int
    aliases_added: int
    domains_added: int
    updated: int
    roles_given: int


@dataclass(frozen=True, slots=True)
class _Found:
    entity_id: UUID
    is_ambiguous: bool
    hints: list[str]
    # Case-folded.
    aliases: set[str]
    # The hosts of its `host` rules.
    hosts: set[str]


async def find_project(sessions: Sessions, access: WorkspaceAccess, slug: str) -> UUID | None:
    """The live project of the workspace with this slug, or None. One that is deleted, archived
    or paused stops the seed: bringing it back is a person's decision."""
    async with workspace_transaction(sessions, access.workspace_id, user_id=access.user_id) as db:
        row = (
            await db.execute(
                select(projects.c.id, projects.c.status, projects.c.deleted_at).where(
                    projects.c.workspace_id == access.workspace_id, projects.c.slug == slug
                )
            )
        ).one_or_none()
    if row is None:
        return None
    if row.deleted_at is not None or row.status != "active":
        state = "deleted" if row.deleted_at is not None else row.status
        raise SeedError(
            f"The project {slug!r} exists and is {state}. Bring it back in the app first; the "
            "seed does not change that. Nothing was written."
        )
    project_id: UUID = row.id
    return project_id


async def ensure_project(
    sessions: Sessions, access: WorkspaceAccess, part: ProjectPart, location_id: int
) -> tuple[UUID, bool]:
    """The project's id, and whether it was made now. A found one gets the fixture's name, time
    zone, language, domain and default location; `ProjectService.update` writes and audits
    nothing when they already match."""
    service = ProjectService(sessions=sessions)
    project_id = await find_project(sessions, access, part.slug)
    if project_id is None:
        created = await service.create(
            access=access,
            name=part.name,
            slug=part.slug,
            timezone=part.timezone,
            deep_check_weekday=DEEP_CHECK_WEEKDAY,
            default_language_code=part.language_code,
            primary_domain=part.host,
            default_location_id=location_id,
            info=SEED_INFO,
        )
        return created.id, True
    await service.update(
        access=access,
        project_id=project_id,
        changes={
            "name": part.name,
            "timezone": part.timezone,
            "default_language_code": part.language_code,
            "primary_domain": part.host,
            "default_location_id": location_id,
        },
        info=SEED_INFO,
    )
    return project_id, False


def _aliases(part: EntityPart) -> list[AliasInput]:
    """The fixture's aliases as word aliases that ignore case, each once, without the canonical
    name: the matcher matches an entity's own name without an alias."""
    seen = {part.name.casefold()}
    wanted: list[AliasInput] = []
    for alias in part.aliases:
        given = AliasInput(alias=alias)
        if given.alias.casefold() not in seen:
            seen.add(given.alias.casefold())
            wanted.append(given)
    return wanted


async def _found(sessions: Sessions, access: WorkspaceAccess, name: str) -> _Found | None:
    """The workspace's entity of this canonical name, case-insensitive."""
    async with workspace_transaction(sessions, access.workspace_id, user_id=access.user_id) as db:
        entity_id: UUID | None = (
            await db.execute(
                select(entities.c.id).where(
                    entities.c.workspace_id == access.workspace_id,
                    func.lower(entities.c.canonical_name) == name.lower(),
                )
            )
        ).scalar_one_or_none()
        if entity_id is None:
            return None
        record = await entity_rows.get_entity(db, access.workspace_id, entity_id, visible=None)
        aliases = await entity_rows.aliases_of(db, access.workspace_id, [entity_id])
        domains = await entity_rows.domains_of(db, access.workspace_id, [entity_id])
    if record is None:  # pragma: no cover - read in this transaction
        return None
    return _Found(
        entity_id=entity_id,
        is_ambiguous=record.is_ambiguous,
        hints=list(record.disambiguation_hints),
        aliases={alias.alias.casefold() for alias in aliases},
        hosts={domain.host for domain in domains if domain.match_scope == "host"},
    )


async def _ensure_entity(
    sessions: Sessions,
    access: WorkspaceAccess,
    part: EntityPart,
    *,
    is_ambiguous: bool,
    hints: Sequence[str],
    counts: Counter[str],
) -> UUID:
    service = EntityService(sessions=sessions)
    aliases = _aliases(part)
    domains = [DomainInput(domain=domain) for domain in part.domains]
    found = await _found(sessions, access, part.name)
    if found is None:
        row = await service.create(
            access,
            entity_type=ENTITY_TYPE,
            canonical_name=part.name,
            parent_entity_id=None,
            description=None,
            is_ambiguous=is_ambiguous,
            disambiguation_hints=list(hints),
            aliases=aliases,
            domains=domains,
            info=SEED_INFO,
        )
        counts["created"] += 1
        return row.entity.id
    missing_aliases = [alias for alias in aliases if alias.alias.casefold() not in found.aliases]
    if missing_aliases:
        await service.add_aliases(access, found.entity_id, missing_aliases, SEED_INFO)
        counts["aliases_added"] += len(missing_aliases)
    for domain in domains:
        if stored_host(domain).name not in found.hosts:
            await service.add_domain(access, found.entity_id, domain, SEED_INFO)
            counts["domains_added"] += 1
    changes: dict[str, object] = {}
    if found.is_ambiguous != is_ambiguous:
        changes["is_ambiguous"] = is_ambiguous
    if found.hints != list(hints):
        changes["disambiguation_hints"] = list(hints)
    if changes:
        await service.update(access, found.entity_id, changes, SEED_INFO)
        counts["updated"] += 1
    return found.entity_id


async def _give_role(
    sessions: Sessions,
    access: WorkspaceAccess,
    project_id: UUID,
    entity_id: UUID,
    name: str,
    *,
    role: ProjectRole,
) -> bool:
    """Whether a role was given now. A live role that differs stops the seed."""
    async with workspace_transaction(sessions, access.workspace_id, user_id=access.user_id) as db:
        current = await roles.get_role(db, access.workspace_id, project_id, entity_id)
    if current is not None and current.removed_at is None:
        if current.role != role or (role == "own" and not current.is_primary):
            wanted = "the primary own role" if role == "own" else f"the {role} role"
            raise SeedError(
                f"{name} has the {current.role} role in the project; the fixture gives it "
                f"{wanted}. Change it in the app; the seed does not."
            )
        return False
    body = ProjectEntityCreate(
        entity_id=entity_id,
        role=role,
        is_primary=role == "own",
        track_seo=role == "own",
        track_ai=True,
    )
    await ProjectEntityService(sessions=sessions).add(
        access,
        project_id,
        entity_id=entity_id,
        values=body.model_dump(exclude={"entity_id"}),
        info=SEED_INFO,
    )
    return True


async def ensure_entities(
    sessions: Sessions,
    access: WorkspaceAccess,
    project_id: UUID,
    brand: EntityPart,
    competitors: Sequence[CompetitorPart],
) -> EntityChanges:
    """The brand with the primary own role, and each competitor with the competitor role, AI
    tracking on and SEO tracking off."""
    counts: Counter[str] = Counter()
    brand_id = await _ensure_entity(
        sessions, access, brand, is_ambiguous=False, hints=(), counts=counts
    )
    if await _give_role(sessions, access, project_id, brand_id, brand.name, role="own"):
        counts["roles_given"] += 1
    for part in competitors:
        entity_id = await _ensure_entity(
            sessions,
            access,
            part,
            is_ambiguous=part.ambiguous,
            hints=part.disambiguation_hints,
            counts=counts,
        )
        if await _give_role(sessions, access, project_id, entity_id, part.name, role="competitor"):
            counts["roles_given"] += 1
    return EntityChanges(
        created=counts["created"],
        aliases_added=counts["aliases_added"],
        domains_added=counts["domains_added"],
        updated=counts["updated"],
        roles_given=counts["roles_given"],
    )
