"""Project routes (docs/19-api-specification.md section 3.3).

The membership dependency has already refused a project outside the caller's scope: it reads the
`project_id` of the path.
"""

from __future__ import annotations

from typing import Annotated, get_args
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.exceptions import RequestValidationError
from pydantic import StringConstraints

from sightline.api.pagination import Offset, OffsetPageInfo
from sightline.api.permissions import Permission
from sightline.api.projects.repository import ProjectRecord
from sightline.api.projects.service import ProjectService
from sightline.api.request_info import Info
from sightline.api.resources import Resources, get_resources
from sightline.api.schemas.common import DomainRef, LocationRef, UserRef
from sightline.api.schemas.projects import (
    Project,
    ProjectChanged,
    ProjectChangeMeta,
    ProjectCreate,
    ProjectPage,
    ProjectResponse,
    ProjectStatus,
    ProjectUpdate,
)
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.api.workspaces.dependencies import MemberAccess, require_permission

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}/projects", tags=["projects"])
_STATUSES: frozenset[str] = frozenset(get_args(ProjectStatus))
_LISTED_BY_DEFAULT = frozenset({"active", "paused"})
_STATUS_FILTER = "filter[status_in]"
_STATUS_FILTER_REPEATS = 10


def get_project_service(resources: Annotated[Resources, Depends(get_resources)]) -> ProjectService:
    return resources.projects


Projects = Annotated[ProjectService, Depends(get_project_service)]
MayWriteProjects = Annotated[
    WorkspaceAccess, Depends(require_permission(Permission.PROJECTS_WRITE))
]
# Someone limited to some projects could not see what they had just made.
MayCreateProjects = Annotated[
    WorkspaceAccess, Depends(require_permission(Permission.PROJECTS_WRITE, every_project=True))
]


def _primary_domain(record: ProjectRecord) -> DomainRef | None:
    if (
        record.primary_domain_id is None
        or record.primary_host is None
        or record.primary_registrable_domain is None
    ):
        return None
    return DomainRef.model_validate(
        {
            "domain_id": record.primary_domain_id,
            "host": record.primary_host,
            "registrable_domain": record.primary_registrable_domain,
            "category": record.primary_category,
            "category_source": record.primary_category_source,
        }
    )


def _default_location(record: ProjectRecord) -> LocationRef | None:
    if (
        record.default_location_id is None
        or record.default_location_name is None
        or record.default_location_country is None
        or record.default_location_type is None
    ):
        return None
    return LocationRef(
        location_id=record.default_location_id,
        name=record.default_location_name,
        country_iso=record.default_location_country,
        location_type=record.default_location_type,
    )


def _project(record: ProjectRecord) -> Project:
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
    return Project(
        project_id=record.id,
        workspace_id=record.workspace_id,
        name=record.name,
        slug=record.slug,
        primary_domain=_primary_domain(record),
        default_location_id=record.default_location_id,
        default_location=_default_location(record),
        default_language_code=record.default_language_code,
        timezone=record.timezone,
        deep_check_weekday=record.deep_check_weekday,
        status=record.status,
        data_version=record.data_version,
        entity_config_version=record.entity_config_version,
        created_by=created_by,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def status_filter(
    values: Annotated[
        list[Annotated[str, StringConstraints(max_length=64)]] | None,
        Query(
            alias=_STATUS_FILTER,
            max_length=_STATUS_FILTER_REPEATS,
            description="Comma-separated statuses. Default: `active,paused`.",
        ),
    ] = None,
) -> frozenset[str]:
    """The statuses to list. Given more than once, every value counts."""
    if values is None:
        return _LISTED_BY_DEFAULT
    wanted = frozenset(status for value in values for status in value.split(","))
    if not wanted <= _STATUSES:
        raise RequestValidationError(
            [
                {
                    "loc": ("query", _STATUS_FILTER),
                    "type": "enum",
                    "msg": f"Allowed: {', '.join(sorted(_STATUSES))}.",
                }
            ]
        )
    return wanted


@router.get("", summary="The projects of a workspace that the caller can see")
async def list_projects(
    access: MemberAccess,
    page: Offset,
    statuses: Annotated[frozenset[str], Depends(status_filter)],
    projects: Projects,
) -> ProjectPage:
    records, total = await projects.page(
        access, statuses=statuses, offset=page.offset, limit=page.limit
    )
    return ProjectPage(
        data=[_project(record) for record in records],
        page=OffsetPageInfo(offset=page.offset, limit=page.limit, total=total),
    )


@router.post(
    "",
    status_code=201,
    summary="Create a project",
    description=(
        "Counts against the workspace's project limit, as every active or paused project does; "
        "an archived one does not. A member limited to some projects cannot create one."
    ),
)
async def create_project(
    body: ProjectCreate, access: MayCreateProjects, projects: Projects, info: Info
) -> ProjectResponse:
    record = await projects.create(
        access=access,
        name=body.name,
        slug=body.slug,
        timezone=body.timezone,
        deep_check_weekday=body.deep_check_weekday,
        default_language_code=body.default_language_code,
        primary_domain=body.primary_domain,
        default_location_id=body.default_location_id,
        own_entity=body.own_entity,
        info=info,
    )
    return ProjectResponse(data=_project(record))


@router.get("/{project_id}", summary="One project")
async def get_project(
    project_id: UUID, access: MemberAccess, projects: Projects
) -> ProjectResponse:
    return ProjectResponse(data=_project(await projects.get(access, project_id)))


@router.patch(
    "/{project_id}",
    summary="Change a project",
    description=(
        "A new time zone applies to business dates from now on; dates already computed stay, "
        "and the response says so in `meta.warnings`. Bringing a project back from the archive "
        "needs a free slot in the workspace's project limit."
    ),
)
async def update_project(
    project_id: UUID, body: ProjectUpdate, access: MayWriteProjects, projects: Projects, info: Info
) -> ProjectChanged:
    changes = body.model_dump(include=body.model_fields_set)
    record, timezone_changed = await projects.update(
        access=access, project_id=project_id, changes=changes, info=info
    )
    return ProjectChanged(
        data=_project(record),
        meta=ProjectChangeMeta(
            warnings=["timezone_change_applies_forward"] if timezone_changed else []
        ),
    )
