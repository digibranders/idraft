"""Project roles, project domains and the alias test (docs/19-api-specification.md
section 3.4).

The membership dependency has already refused a project outside the caller's scope: it reads
the `project_id` of the path. A role belongs to one project, so a member limited to that project
may change it.
"""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from sightline.api.entities.project_service import ProjectEntityService, RoleView
from sightline.api.entities.routes import entity_domain
from sightline.api.permissions import Permission
from sightline.api.request_info import Info
from sightline.api.resources import Resources, get_resources
from sightline.api.schemas.common import DomainRef
from sightline.api.schemas.entities import (
    AliasTestMention,
    AliasTestNegative,
    AliasTestRequest,
    AliasTestResponse,
    AliasTestResult,
    AliasTestSpan,
    EntityRef,
    ProjectDomain,
    ProjectDomainList,
    ProjectEntity,
    ProjectEntityCreate,
    ProjectEntityList,
    ProjectEntityResponse,
    ProjectEntityUpdate,
)
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.api.workspaces.dependencies import require_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}", tags=["entities"]
)

Role = Literal["own", "competitor", "watch"]
ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
WriteRoles = Annotated[WorkspaceAccess, Depends(require_permission(Permission.ENTITIES_WRITE))]


def get_project_entity_service(
    resources: Annotated[Resources, Depends(get_resources)],
) -> ProjectEntityService:
    return resources.project_entities


Roles = Annotated[ProjectEntityService, Depends(get_project_entity_service)]


def _project_entity(view: RoleView) -> ProjectEntity:
    row = view.role
    return ProjectEntity.model_validate(
        {
            "project_id": row.project_id,
            "entity": EntityRef.model_validate(
                {
                    "entity_id": row.entity_id,
                    "canonical_name": row.canonical_name,
                    "entity_type": row.entity_type,
                    "role": row.role,
                    "color_index": row.color_index,
                }
            ),
            "role": row.role,
            "is_primary": row.is_primary,
            "track_seo": row.track_seo,
            "track_ai": row.track_ai,
            "color_index": row.color_index,
            "added_at": row.added_at,
            "removed_at": row.removed_at,
            "alias_count": row.alias_count,
            "domains": [entity_domain(domain) for domain in view.domains],
        }
    )


@router.get("/entities", summary="The entities a project has given a role")
async def list_project_entities(
    project_id: UUID,
    access: ReadData,
    project_roles: Roles,
    role: Annotated[Role | None, Query(alias="filter[role]")] = None,
    include_removed: Annotated[bool, Query(alias="filter[include_removed]")] = False,
) -> ProjectEntityList:
    found = await project_roles.list_roles(
        access, project_id, role=role, include_removed=include_removed
    )
    return ProjectEntityList(data=[_project_entity(view) for view in found])


@router.post(
    "/entities",
    status_code=201,
    summary="Give an entity a role in the project",
    description="An entity whose role was removed gets it back, on the same row.",
)
async def add_project_entity(
    project_id: UUID,
    body: ProjectEntityCreate,
    access: WriteRoles,
    project_roles: Roles,
    info: Info,
) -> ProjectEntityResponse:
    view = await project_roles.add(
        access,
        project_id,
        entity_id=body.entity_id,
        values=body.model_dump(exclude={"entity_id"}),
        info=info,
    )
    return ProjectEntityResponse(data=_project_entity(view))


@router.patch("/entities/{entity_id}", summary="Change an entity's role in the project")
async def update_project_entity(
    project_id: UUID,
    entity_id: UUID,
    body: ProjectEntityUpdate,
    access: WriteRoles,
    project_roles: Roles,
    info: Info,
) -> ProjectEntityResponse:
    view = await project_roles.update(
        access, project_id, entity_id, body.model_dump(include=body.model_fields_set), info
    )
    return ProjectEntityResponse(data=_project_entity(view))


@router.delete("/entities/{entity_id}", summary="Remove an entity's role; its history is kept")
async def remove_project_entity(
    project_id: UUID, entity_id: UUID, access: WriteRoles, project_roles: Roles, info: Info
) -> ProjectEntityResponse:
    view = await project_roles.remove(access, project_id, entity_id, info)
    return ProjectEntityResponse(data=_project_entity(view))


@router.get("/domains", summary="The domains of the project's entities, with their roles")
async def list_project_domains(
    project_id: UUID,
    access: ReadData,
    project_roles: Roles,
    role: Annotated[Role | None, Query(alias="filter[role]")] = None,
) -> ProjectDomainList:
    rows = await project_roles.domains(access, project_id, role=role)
    return ProjectDomainList(
        data=[
            ProjectDomain.model_validate(
                {
                    "entity": {
                        "entity_id": row.entity_id,
                        "canonical_name": row.canonical_name,
                        "entity_type": row.entity_type,
                        "role": row.role,
                        "color_index": row.color_index,
                    },
                    "domain": DomainRef(
                        domain_id=row.domain_id,
                        host=row.host,
                        registrable_domain=row.registrable_domain,
                        category=row.category,
                        category_source=row.category_source,
                    ),
                    "match_scope": row.match_scope,
                    "path_prefix": row.path_prefix,
                }
            )
            for row in rows
        ]
    )


@router.post(
    "/alias-test",
    summary="What extraction would count in a text, with today's aliases",
    description="Nothing is stored. Offsets are UTF-16 code units, as JavaScript indexes the "
    "text. `413 payload_too_large` over 100 KB; `422 too_many_matches` over 250,000 matches.",
)
async def alias_test(
    project_id: UUID, body: AliasTestRequest, access: ReadData, project_roles: Roles
) -> AliasTestResponse:
    text = body.text if body.text is not None else body.markdown
    outcome = await project_roles.alias_test(access, project_id, text or "")
    mentions = []
    for mention in outcome.result.mentions:
        entity = outcome.entities[mention.entity_id]
        mentions.append(
            AliasTestMention(
                entity=EntityRef.model_validate(
                    {
                        "entity_id": entity.id,
                        "canonical_name": entity.canonical_name,
                        "entity_type": entity.entity_type,
                        "role": entity.role,
                        "color_index": entity.color_index,
                    }
                ),
                spans=[
                    AliasTestSpan(
                        start=span.start,
                        end=span.end,
                        alias_id=span.alias_id,
                        match_method=span.match_method,
                        score=span.score,
                        status=span.status,
                    )
                    for span in mention.spans
                ],
                confidence=mention.confidence,
                status=mention.status,
            )
        )
    return AliasTestResponse(
        data=AliasTestResult(
            mentions=mentions,
            negatives_applied=[
                AliasTestNegative(
                    start=negative.start, end=negative.end, alias_id=negative.alias_id
                )
                for negative in outcome.result.negatives_applied
            ],
            skipped_alias_ids=list(outcome.skipped_alias_ids),
        )
    )
