"""Entity, alias and entity domain routes (docs/19-api-specification.md section 3.4).

Reading needs `data:read`; a member limited to some projects sees the entities those projects
name and gets `404` for the others. Changing a workspace entity needs `entities:write` and a
membership that is not limited to some projects, since the entity is shared by them all.
"""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from sightline.api.entities.repository import AliasRecord, EntityDomainRecord, EntityRecord
from sightline.api.entities.service import EntityFilters, EntityService
from sightline.api.pagination import Cursor, CursorPageInfo
from sightline.api.permissions import Permission
from sightline.api.request_info import Info
from sightline.api.resources import Resources, get_resources
from sightline.api.schemas.common import DomainRef, QueryText, UserRef
from sightline.api.schemas.entities import (
    Alias,
    AliasBatch,
    AliasInput,
    AliasList,
    AliasResponse,
    AliasUpdate,
    DomainInput,
    Entity,
    EntityCreate,
    EntityDetail,
    EntityDetailResponse,
    EntityDomain,
    EntityDomainCreated,
    EntityDomainList,
    EntityDomainMeta,
    EntityPage,
    EntityProjectRole,
    EntityResponse,
    EntityType,
    EntityUpdate,
)
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.api.workspaces.dependencies import require_permission

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}/entities", tags=["entities"])

Role = Literal["own", "competitor", "watch"]
ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
# A workspace entity is shared by every project, so a member limited to some cannot change it.
WriteEntities = Annotated[
    WorkspaceAccess, Depends(require_permission(Permission.ENTITIES_WRITE, every_project=True))
]


def get_entity_service(resources: Annotated[Resources, Depends(get_resources)]) -> EntityService:
    return resources.entities


Entities = Annotated[EntityService, Depends(get_entity_service)]


def domain_ref(record: EntityDomainRecord) -> DomainRef:
    return DomainRef(
        domain_id=record.domain_id,
        host=record.host,
        registrable_domain=record.registrable_domain,
        category=record.category,
        category_source=record.category_source,
    )


def entity_domain(record: EntityDomainRecord) -> EntityDomain:
    return EntityDomain(
        entity_domain_id=record.id,
        entity_id=record.entity_id,
        domain=domain_ref(record),
        match_scope=record.match_scope,
        path_prefix=record.path_prefix,
    )


def _entity_fields(record: EntityRecord, claimed: list[EntityDomainRecord]) -> dict[str, object]:
    return {
        "entity_id": record.id,
        "entity_type": record.entity_type,
        "canonical_name": record.canonical_name,
        "parent_entity_id": record.parent_entity_id,
        "description": record.description,
        "is_ambiguous": record.is_ambiguous,
        "disambiguation_hints": record.disambiguation_hints,
        "alias_count": record.alias_count,
        "domains": [entity_domain(domain) for domain in claimed],
        "created_at": record.created_at,
        "updated_at": record.updated_at,
    }


def _entity(record: EntityRecord, claimed: list[EntityDomainRecord]) -> Entity:
    return Entity.model_validate(_entity_fields(record, claimed))


def _alias(record: AliasRecord) -> Alias:
    created_by = None
    if (
        record.created_by_id is not None
        and record.created_by_name is not None
        and record.created_by_email is not None
    ):
        created_by = UserRef(
            user_id=record.created_by_id,
            name=record.created_by_name,
            email=record.created_by_email,
        )
    return Alias.model_validate(
        {
            "alias_id": record.id,
            "entity_id": record.entity_id,
            "alias": record.alias,
            "match_mode": record.match_mode,
            "case_sensitive": record.case_sensitive,
            "language_code": record.language_code,
            "is_negative": record.is_negative,
            "requires_context": record.requires_context,
            "created_by": created_by,
            "created_at": record.created_at,
        }
    )


@router.get("", summary="The workspace's entities, by name")
async def list_entities(
    access: ReadData,
    page: Cursor,
    entities: Entities,
    entity_type: Annotated[EntityType | None, Query(alias="filter[entity_type]")] = None,
    q: Annotated[QueryText | None, Query(alias="filter[q]")] = None,
    project_id: Annotated[UUID | None, Query(alias="filter[project_id]")] = None,
    role: Annotated[
        Role | None,
        Query(alias="filter[role]", description="A live role, in any project or the one given."),
    ] = None,
) -> EntityPage:
    result = await entities.page(
        access,
        EntityFilters(entity_type=entity_type, q=q, project_id=project_id, role=role),
        page,
    )
    return EntityPage(
        data=[_entity(row.entity, row.domains) for row in result.rows],
        page=CursorPageInfo(
            limit=page.limit,
            next_cursor=result.next_cursor,
            has_more=result.next_cursor is not None,
        ),
    )


@router.post("", status_code=201, summary="Create an entity, with aliases and domains")
async def create_entity(
    body: EntityCreate, access: WriteEntities, entities: Entities, info: Info
) -> EntityResponse:
    row = await entities.create(
        access,
        entity_type=body.entity_type,
        canonical_name=body.canonical_name,
        parent_entity_id=body.parent_entity_id,
        description=body.description,
        is_ambiguous=body.is_ambiguous,
        disambiguation_hints=body.disambiguation_hints,
        aliases=body.aliases,
        domains=body.domains,
        info=info,
    )
    return EntityResponse(data=_entity(row.entity, row.domains))


@router.get("/{entity_id}", summary="One entity, with aliases, domains and project roles")
async def get_entity(entity_id: UUID, access: ReadData, entities: Entities) -> EntityDetailResponse:
    detail = await entities.get(access, entity_id)
    return EntityDetailResponse(
        data=EntityDetail.model_validate(
            {
                **_entity_fields(detail.entity, detail.domains),
                "aliases": [_alias(alias) for alias in detail.aliases],
                "projects": [
                    EntityProjectRole.model_validate(
                        {
                            "project_id": role.project_id,
                            "role": role.role,
                            "is_primary": role.is_primary,
                            "removed_at": role.removed_at,
                        }
                    )
                    for role in detail.roles
                ],
            }
        )
    )


@router.patch("/{entity_id}", summary="Change an entity")
async def update_entity(
    entity_id: UUID, body: EntityUpdate, access: WriteEntities, entities: Entities, info: Info
) -> EntityResponse:
    row = await entities.update(
        access, entity_id, body.model_dump(include=body.model_fields_set), info
    )
    return EntityResponse(data=_entity(row.entity, row.domains))


@router.delete(
    "/{entity_id}",
    status_code=204,
    summary="Delete an entity no project has ever named",
    description="Its aliases and domains go with it. `409 entity_in_use` when a project role, "
    "even a removed one, or a product names it.",
)
async def delete_entity(
    entity_id: UUID, access: WriteEntities, entities: Entities, info: Info
) -> Response:
    await entities.delete(access, entity_id, info)
    return Response(status_code=204)


@router.get("/{entity_id}/aliases", summary="An entity's aliases")
async def list_aliases(entity_id: UUID, access: ReadData, entities: Entities) -> AliasList:
    return AliasList(
        data=[_alias(alias) for alias in await entities.list_aliases(access, entity_id)]
    )


@router.post("/{entity_id}/aliases", status_code=201, summary="Add one alias or a batch")
async def add_aliases(
    entity_id: UUID,
    body: AliasInput | AliasBatch,
    access: WriteEntities,
    entities: Entities,
    info: Info,
) -> AliasList:
    given = body.items if isinstance(body, AliasBatch) else [body]
    added = await entities.add_aliases(access, entity_id, given, info)
    return AliasList(data=[_alias(alias) for alias in added])


@router.patch("/{entity_id}/aliases/{alias_id}", summary="Change an alias")
async def update_alias(
    entity_id: UUID,
    alias_id: UUID,
    body: AliasUpdate,
    access: WriteEntities,
    entities: Entities,
    info: Info,
) -> AliasResponse:
    alias = await entities.update_alias(
        access, entity_id, alias_id, body.model_dump(include=body.model_fields_set), info
    )
    return AliasResponse(data=_alias(alias))


@router.delete("/{entity_id}/aliases/{alias_id}", status_code=204, summary="Remove an alias")
async def delete_alias(
    entity_id: UUID, alias_id: UUID, access: WriteEntities, entities: Entities, info: Info
) -> Response:
    await entities.delete_alias(access, entity_id, alias_id, info)
    return Response(status_code=204)


@router.get("/{entity_id}/domains", summary="An entity's domains")
async def list_entity_domains(
    entity_id: UUID, access: ReadData, entities: Entities
) -> EntityDomainList:
    return EntityDomainList(
        data=[entity_domain(domain) for domain in await entities.list_domains(access, entity_id)]
    )


@router.post(
    "/{entity_id}/domains",
    status_code=201,
    summary="Add a domain",
    description="A registrable rule is stored against the registrable domain itself "
    "(`https://www.acme.com/x` is `acme.com`); host and path prefix rules keep the host.",
)
async def add_entity_domain(
    entity_id: UUID, body: DomainInput, access: WriteEntities, entities: Entities, info: Info
) -> EntityDomainCreated:
    created, warnings = await entities.add_domain(access, entity_id, body, info)
    return EntityDomainCreated(
        data=entity_domain(created), meta=EntityDomainMeta(warnings=warnings)
    )


@router.delete(
    "/{entity_id}/domains/{entity_domain_id}", status_code=204, summary="Remove a domain"
)
async def delete_entity_domain(
    entity_id: UUID,
    entity_domain_id: UUID,
    access: WriteEntities,
    entities: Entities,
    info: Info,
) -> Response:
    await entities.delete_domain(access, entity_id, entity_domain_id, info)
    return Response(status_code=204)
