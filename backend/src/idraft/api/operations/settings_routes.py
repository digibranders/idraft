"""Project settings routes (docs/19-api-specification.md section 3.3). Reading needs
`data:read` and changing `projects:write`. The membership dependency has already refused a
project outside the caller's scope.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from idraft.api.operations.settings import SettingsService
from idraft.api.permissions import Permission
from idraft.api.request_info import Info
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.operations import ProjectSettingsPatch, ProjectSettingsResponse
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/settings",
    tags=["projects"],
)

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
WriteProjects = Annotated[WorkspaceAccess, Depends(require_permission(Permission.PROJECTS_WRITE))]


def get_settings_service(
    resources: Annotated[Resources, Depends(get_resources)],
) -> SettingsService:
    return resources.project_settings


ProjectSettingsDep = Annotated[SettingsService, Depends(get_settings_service)]


@router.get("", summary="The project's settings")
async def get_settings(
    project_id: UUID, access: ReadData, settings: ProjectSettingsDep
) -> ProjectSettingsResponse:
    return ProjectSettingsResponse(data=await settings.get(access, project_id))


@router.patch(
    "",
    summary="Change the project's settings",
    description="A JSON merge patch of `seo`: members left out keep their value. The `seo` "
    "defaults apply to tracked keywords created after the change.",
)
async def update_settings(
    project_id: UUID,
    body: ProjectSettingsPatch,
    access: WriteProjects,
    settings: ProjectSettingsDep,
    info: Info,
) -> ProjectSettingsResponse:
    return ProjectSettingsResponse(data=await settings.update(access, project_id, body, info))
