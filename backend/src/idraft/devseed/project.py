"""The project, its brand and its competitors, made or brought in line with the fixture.

Every write goes through the service the matching route uses (`ProjectService`,
`EntityService`, `ProjectEntityService`), so the same rules, locks and audit entries apply.
Reads that only decide what to write use the repositories. The seed never overwrites what a person
set: nothing the fixture does not name is removed or renamed (an alias, domain or competitor a
developer added stays), a project value that differs stops the seed, and a role that is not the
fixture's, or that a person removed, stops it before the first write.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.api.entities import project_repository as roles
from idraft.api.entities import repository as entity_rows
from idraft.api.entities.project_service import ProjectEntityService
from idraft.api.entities.service import EntityService, stored_host
from idraft.api.projects import repository as project_rows
from idraft.api.projects.repository import ProjectRecord
from idraft.api.projects.service import ProjectService
from idraft.api.schemas.entities import (
    AliasInput,
    DomainInput,
    EntityCreate,
    ProjectEntityCreate,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.db.tables import entities, projects
from idraft.devseed.context import SEED_INFO, SeedError, Sessions
from idraft.devseed.fixture import CompetitorPart, EntityPart, ProjectPart
from idraft.extraction.domains import ProjectRole
from idraft.extraction.urls import normalize_host

# The brand and its competitors are all brands, the type the entity form makes by default.
ENTITY_TYPE: Final = "brand"
# The API's default (`ProjectCreate.deep_check_weekday`).
DEEP_CHECK_WEEKDAY: Final = 1
# The project is made before the entities are read, so a stop in the entity step can follow it.
_PROJECT_MAY_BE_WRITTEN: Final = (
    "No entity, topic, engine or prompt was written. The project itself may already be made or "
    "filled in; run the seed again after the fix and it completes the rest."
)


@dataclass(frozen=True, slots=True)
class EntityChanges:
    created: int
    aliases_added: int
    domains_added: int
    roles_given: int
    # Competitors that were already there with an ambiguity or hints other than the fixture's.
    # They are left as they are: the fixture's values apply only to a competitor made by the seed.
    differing: tuple[str, ...] = ()
    # A domain added to an entity that another entity of one of its projects claims too. The API
    # allows it and answers with a `domain_role_conflict` warning, so the seed keeps going and
    # reports it: stopping after the write would leave the domain behind and a second run would
    # not look at it again.
    domain_conflicts: tuple[str, ...] = ()


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
    """The project's id, and whether it was made now. A found project keeps what a person set: a
    value it has not got (no default location, say) is filled from the fixture, and one that
    differs stops the seed. A time zone or a domain changed under the project would move its check
    times or its own domain, so nothing is ever written over a different value."""
    project_id = await find_project(sessions, access, part.slug)
    if project_id is None:
        created = await ProjectService(sessions=sessions).create(
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
    async with workspace_transaction(sessions, access.workspace_id, user_id=access.user_id) as db:
        current = await project_rows.get_project(db, access.workspace_id, project_id)
    if current is None:  # pragma: no cover - found a moment ago
        raise SeedError(f"The project {part.slug!r} is gone. Nothing was written.")
    fills = _project_fills(current, part, location_id)
    if fills:
        await ProjectService(sessions=sessions).update(
            access=access, project_id=project_id, changes=fills, info=SEED_INFO
        )
    return project_id, False


def _project_fills(
    current: ProjectRecord, part: ProjectPart, location_id: int
) -> dict[str, str | int | None]:
    """What a found project lacks, from the fixture. A value that is there and differs raises."""
    wanted: dict[str, str | int] = {
        "name": part.name,
        "timezone": part.timezone,
        "default_language_code": part.language_code,
        "primary_domain": normalize_host(part.host).name,
        "default_location_id": location_id,
    }
    has: dict[str, str | int | None] = {
        "name": current.name,
        "timezone": current.timezone,
        "default_language_code": current.default_language_code,
        "primary_domain": current.primary_host,
        "default_location_id": current.default_location_id,
    }
    fills: dict[str, str | int | None] = {}
    differs: list[str] = []
    for field, value in wanted.items():
        held = has[field]
        if held is None:
            fills[field] = value
        elif held != value and not (
            field == "name" and isinstance(held, str) and held.casefold() == str(value).casefold()
        ):
            differs.append(f"{field} is {held!r} in the project and {value!r} in the fixture")
    if differs:
        raise SeedError(
            f"The project {part.slug!r} differs from the fixture: {'; '.join(differs)}. "
            "The seed does not overwrite what a person set. Change it in the app or the fixture. "
            "Nothing was written."
        )
    return fills


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


def _body(part: EntityPart) -> EntityCreate:
    """The entity as the create route reads it, so the name, hints, aliases and domains are
    normalised and limited as a person's would be. A brand has no ambiguity of its own in the
    fixture: it is made with the API's defaults."""
    ambiguous = part.ambiguous if isinstance(part, CompetitorPart) else False
    hints = part.disambiguation_hints if isinstance(part, CompetitorPart) else []
    try:
        return EntityCreate(
            entity_type=ENTITY_TYPE,
            canonical_name=part.name,
            is_ambiguous=ambiguous,
            disambiguation_hints=list(hints),
            aliases=_aliases(part),
            domains=[DomainInput(domain=domain) for domain in part.domains],
        )
    except ValidationError as error:
        problems = "; ".join(
            f"{'.'.join(str(step) for step in item['loc'])}: {item['msg']}"
            for item in error.errors()
        )
        raise SeedError(
            f"The fixture's entity {part.name!r} is not valid for the API: {problems}. "
            f"{_PROJECT_MAY_BE_WRITTEN}"
        ) from error


async def _entity_id(db: AsyncSession, access: WorkspaceAccess, name: str) -> UUID | None:
    """The workspace's brand of this canonical name, case-insensitive. The name is unique per
    type, so another type's entity of the same name is not this one."""
    found: UUID | None = (
        await db.execute(
            select(entities.c.id).where(
                entities.c.workspace_id == access.workspace_id,
                entities.c.entity_type == ENTITY_TYPE,
                func.lower(entities.c.canonical_name) == func.lower(name),
            )
        )
    ).scalar_one_or_none()
    return found


async def _found(sessions: Sessions, access: WorkspaceAccess, name: str) -> _Found | None:
    async with workspace_transaction(sessions, access.workspace_id, user_id=access.user_id) as db:
        entity_id = await _entity_id(db, access, name)
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
    body: EntityCreate,
    *,
    counts: Counter[str],
    conflicts: list[str],
) -> tuple[UUID, _Found | None]:
    """The entity of this body, made or completed, and what was found of it (None when it was
    made now). The body's ambiguity and hints apply only to an entity made here: a found entity
    keeps its own, and the caller reports a difference."""
    service = EntityService(sessions=sessions)
    found = await _found(sessions, access, body.canonical_name)
    if found is None:
        row = await service.create(
            access,
            entity_type=body.entity_type,
            canonical_name=body.canonical_name,
            parent_entity_id=None,
            description=None,
            is_ambiguous=body.is_ambiguous,
            disambiguation_hints=body.disambiguation_hints,
            aliases=body.aliases,
            domains=body.domains,
            info=SEED_INFO,
        )
        counts["created"] += 1
        return row.entity.id, None
    missing_aliases = [
        alias for alias in body.aliases if alias.alias.casefold() not in found.aliases
    ]
    if missing_aliases:
        await service.add_aliases(access, found.entity_id, missing_aliases, SEED_INFO)
        counts["aliases_added"] += len(missing_aliases)
    for domain in body.domains:
        host = stored_host(domain).name
        if host not in found.hosts:
            _, warnings = await service.add_domain(access, found.entity_id, domain, SEED_INFO)
            counts["domains_added"] += 1
            if warnings:
                conflicts.append(
                    f"{host} was added to {body.canonical_name}, and another entity of a project "
                    "that names it claims it too"
                )
    return found.entity_id, found


def _role_problem(current: roles.RoleRow | None, name: str, role: ProjectRole) -> str | None:
    """Why the entity's row in the project is not what the fixture gives it, or None."""
    if current is None:
        return None
    if current.removed_at is not None:
        return (
            f"{name}: the project removed this {role} role; add it again in the app, the seed "
            "does not bring it back."
        )
    if current.role != role or (role == "own" and not current.is_primary):
        wanted = "the primary own role" if role == "own" else f"the {role} role"
        return (
            f"{name}: it has the {current.role} role in the project and the fixture gives it "
            f"{wanted}; change it in the app, the seed does not."
        )
    return None


async def _check_roles(
    sessions: Sessions,
    access: WorkspaceAccess,
    project_id: UUID,
    brand: EntityCreate,
    competitors: Sequence[EntityCreate],
) -> None:
    """Every role the project has for these entities, read before the first write: all that are
    not the fixture's are listed in one error, with nothing written."""
    problems: list[str] = []
    wanted: list[tuple[EntityCreate, ProjectRole]] = [(brand, "own")]
    wanted.extend((body, "competitor") for body in competitors)
    async with workspace_transaction(sessions, access.workspace_id, user_id=access.user_id) as db:
        brand_id = await _entity_id(db, access, brand.canonical_name)
        for body, role in wanted:
            entity_id = await _entity_id(db, access, body.canonical_name)
            if entity_id is None:
                continue
            current = await roles.get_role(db, access.workspace_id, project_id, entity_id)
            problem = _role_problem(current, body.canonical_name, role)
            if problem is not None:
                problems.append(problem)
        for row in await roles.list_roles(
            db, access.workspace_id, project_id, role="own", include_removed=False
        ):
            # Adding the brand as primary would demote this one without a word.
            if row.is_primary and row.entity_id != brand_id:
                problems.append(
                    f"{row.canonical_name}: it is the project's primary own entity and the "
                    f"fixture's brand is {brand.canonical_name}; change it in the app, the seed "
                    "does not demote it."
                )
    if problems:
        raise SeedError(
            f"The project's roles are not the fixture's. {_PROJECT_MAY_BE_WRITTEN}\n- "
            + "\n- ".join(problems)
        )


async def _give_role(
    sessions: Sessions,
    access: WorkspaceAccess,
    project_id: UUID,
    entity_id: UUID,
    name: str,
    *,
    role: ProjectRole,
) -> bool:
    """Whether a role was given now. A role that is not the fixture's stops the seed (it was
    checked before the first write; this holds if it changed since)."""
    async with workspace_transaction(sessions, access.workspace_id, user_id=access.user_id) as db:
        current = await roles.get_role(db, access.workspace_id, project_id, entity_id)
    problem = _role_problem(current, name, role)
    if problem is not None:
        raise SeedError(problem)
    if current is not None:
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
    tracking on and SEO tracking off. The fixture is validated and every existing role read
    before the first write."""
    brand_body = _body(brand)
    competitor_bodies = [_body(part) for part in competitors]
    await _check_roles(sessions, access, project_id, brand_body, competitor_bodies)
    counts: Counter[str] = Counter()
    conflicts: list[str] = []
    differing: list[str] = []
    # The fixture names no ambiguity or hints for the brand, so a brand's own are never compared.
    brand_id, _ = await _ensure_entity(
        sessions, access, brand_body, counts=counts, conflicts=conflicts
    )
    if await _give_role(sessions, access, project_id, brand_id, brand.name, role="own"):
        counts["roles_given"] += 1
    for part, body in zip(competitors, competitor_bodies, strict=True):
        entity_id, found = await _ensure_entity(
            sessions, access, body, counts=counts, conflicts=conflicts
        )
        if found is not None and (
            found.is_ambiguous != body.is_ambiguous or found.hints != body.disambiguation_hints
        ):
            differing.append(part.name)
        if await _give_role(sessions, access, project_id, entity_id, part.name, role="competitor"):
            counts["roles_given"] += 1
    return EntityChanges(
        created=counts["created"],
        aliases_added=counts["aliases_added"],
        domains_added=counts["domains_added"],
        roles_given=counts["roles_given"],
        differing=tuple(differing),
        domain_conflicts=tuple(conflicts),
    )
