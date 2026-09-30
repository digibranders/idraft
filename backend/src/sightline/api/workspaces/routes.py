"""Workspace routes (docs/19-api-specification.md section 3.2).

Thin on purpose: the dependency decides who may call, the service decides what happens.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from sightline.api.auth.dependencies import CurrentSession
from sightline.api.permissions import Permission
from sightline.api.request_info import Info
from sightline.api.resources import Resources, get_resources
from sightline.api.schemas.workspaces import (
    Workspace,
    WorkspaceCreate,
    WorkspaceList,
    WorkspaceResponse,
    WorkspaceUpdate,
)
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.api.workspaces.dependencies import Member, require_permission
from sightline.api.workspaces.repository import WorkspaceRecord
from sightline.api.workspaces.service import WorkspaceService

router = APIRouter(prefix="/api/v1", tags=["workspaces"])
_W = "/workspaces/{workspace_id}"


def get_workspace_service(
    resources: Annotated[Resources, Depends(get_resources)],
) -> WorkspaceService:
    return resources.workspaces


Workspaces = Annotated[WorkspaceService, Depends(get_workspace_service)]
MayUpdateWorkspace = Annotated[
    WorkspaceAccess, Depends(require_permission(Permission.WORKSPACE_UPDATE))
]


def _workspace(record: WorkspaceRecord) -> Workspace:
    return Workspace(
        workspace_id=record.id,
        name=record.name,
        slug=record.slug,
        logo=record.logo,
        plan_code=record.plan_code,
        timezone=record.timezone,
        status=record.status,
        created_at=record.created_at,
        purge_after=record.purge_after,
    )


@router.get("/workspaces", summary="The workspaces the caller belongs to")
async def list_workspaces(session: CurrentSession, workspaces: Workspaces) -> WorkspaceList:
    return WorkspaceList(data=[_workspace(record) for record in await workspaces.list(session)])


@router.post(
    "/workspaces",
    status_code=201,
    summary="Create a workspace",
    description=(
        "The caller becomes its owner. Needs a verified email address. While registration is by "
        "invitation, only a platform operator may create a workspace."
    ),
)
async def create_workspace(
    body: WorkspaceCreate, session: CurrentSession, workspaces: Workspaces, info: Info
) -> WorkspaceResponse:
    record = await workspaces.create(
        session=session, name=body.name, slug=body.slug, timezone=body.timezone, info=info
    )
    return WorkspaceResponse(data=_workspace(record))


@router.get(_W, summary="One workspace")
async def get_workspace(access: Member, workspaces: Workspaces) -> WorkspaceResponse:
    return WorkspaceResponse(data=_workspace(await workspaces.get(access)))


@router.patch(_W, summary="Change a workspace's name, slug, logo or time zone")
async def update_workspace(
    body: WorkspaceUpdate, access: MayUpdateWorkspace, workspaces: Workspaces, info: Info
) -> WorkspaceResponse:
    changes = body.model_dump(include=body.model_fields_set)
    record = await workspaces.update(access=access, changes=changes, info=info)
    return WorkspaceResponse(data=_workspace(record))
