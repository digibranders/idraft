"""Workspace routes (docs/19-api-specification.md section 3.2).

Thin on purpose: the dependency decides who may call, the service decides what happens.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response

from sightline.api.auth.dependencies import CurrentSession
from sightline.api.pagination import Offset, OffsetPageInfo
from sightline.api.permissions import Permission, Role
from sightline.api.request_info import Info
from sightline.api.resources import Resources, get_resources
from sightline.api.schemas.common import UserRef
from sightline.api.schemas.workspaces import (
    Member,
    MemberPage,
    MemberResponse,
    MemberUpdate,
    Workspace,
    WorkspaceCreate,
    WorkspaceList,
    WorkspaceResponse,
    WorkspaceUpdate,
)
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.api.workspaces.dependencies import MemberAccess, require_permission
from sightline.api.workspaces.members import MemberService
from sightline.api.workspaces.repository import MemberRecord, WorkspaceRecord
from sightline.api.workspaces.service import WorkspaceService

router = APIRouter(prefix="/api/v1", tags=["workspaces"])
_W = "/workspaces/{workspace_id}"


def get_workspace_service(
    resources: Annotated[Resources, Depends(get_resources)],
) -> WorkspaceService:
    return resources.workspaces


def get_member_service(resources: Annotated[Resources, Depends(get_resources)]) -> MemberService:
    return resources.members


Workspaces = Annotated[WorkspaceService, Depends(get_workspace_service)]
Members = Annotated[MemberService, Depends(get_member_service)]
MayUpdateWorkspace = Annotated[
    WorkspaceAccess, Depends(require_permission(Permission.WORKSPACE_UPDATE))
]


MayManageMembers = Annotated[
    WorkspaceAccess, Depends(require_permission(Permission.MEMBERS_MANAGE, fresh=True))
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
    return WorkspaceList(data=[_workspace(record) for record in await workspaces.list_for(session)])


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
async def get_workspace(access: MemberAccess, workspaces: Workspaces) -> WorkspaceResponse:
    return WorkspaceResponse(data=_workspace(await workspaces.get(access)))


@router.patch(_W, summary="Change a workspace's name, slug, logo or time zone")
async def update_workspace(
    body: WorkspaceUpdate, access: MayUpdateWorkspace, workspaces: Workspaces, info: Info
) -> WorkspaceResponse:
    changes = body.model_dump(include=body.model_fields_set)
    record = await workspaces.update(access=access, changes=changes, info=info)
    return WorkspaceResponse(data=_workspace(record))


# -------------------------------------------------------------------------------------------------
# Members


def _member(record: MemberRecord) -> Member:
    return Member(
        user=UserRef(user_id=record.user_id, name=record.name, email=record.email),
        role=Role(record.role),
        project_ids=record.project_ids,
        two_factor_enabled=record.two_factor_enabled,
        joined_at=record.joined_at,
        last_active_at=record.last_active_at,
    )


@router.get(_W + "/members", summary="The members of a workspace")
async def list_members(access: MemberAccess, page: Offset, members: Members) -> MemberPage:
    records, total = await members.page(access, offset=page.offset, limit=page.limit)
    return MemberPage(
        data=[_member(record) for record in records],
        page=OffsetPageInfo(offset=page.offset, limit=page.limit, total=total),
    )


@router.patch(
    _W + "/members/{user_id}",
    summary="Change a member's role or project scope",
    description=(
        "Needs a fresh session. Only an owner can grant the owner role or change an owner. "
        "The last owner cannot be demoted."
    ),
)
async def update_member(
    user_id: UUID, body: MemberUpdate, access: MayManageMembers, members: Members, info: Info
) -> MemberResponse:
    record = await members.update(
        access=access,
        user_id=user_id,
        role=body.role,
        scope_given="project_ids" in body.model_fields_set,
        project_ids=body.project_ids,
        info=info,
    )
    return MemberResponse(data=_member(record))


@router.delete(
    _W + "/members/{user_id}",
    status_code=204,
    summary="Remove a member",
    description="Needs a fresh session. The member loses access with their next request.",
)
async def remove_member(
    user_id: UUID, access: MayManageMembers, members: Members, info: Info
) -> Response:
    await members.remove(access=access, user_id=user_id, info=info)
    return Response(status_code=204)
