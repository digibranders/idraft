"""Workspace routes (docs/19-api-specification.md section 3.2).

Thin on purpose: the dependency decides who may call, the service decides what happens.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Response

from sightline.api.auth.dependencies import CurrentSession
from sightline.api.pagination import Offset, OffsetPageInfo
from sightline.api.permissions import Permission, Role
from sightline.api.request_info import Info
from sightline.api.resources import Resources, get_resources
from sightline.api.schemas.common import UserRef
from sightline.api.schemas.workspaces import (
    AcceptedInvitation,
    AcceptedInvitationResponse,
    Invitation,
    InvitationAccept,
    InvitationCreate,
    InvitationPage,
    InvitationResponse,
    JoinedWorkspace,
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
from sightline.api.workspaces.invitations import InvitationService
from sightline.api.workspaces.members import MemberService
from sightline.api.workspaces.repository import InvitationRecord, MemberRecord, WorkspaceRecord
from sightline.api.workspaces.service import WorkspaceService

router = APIRouter(prefix="/api/v1", tags=["workspaces"])
_W = "/workspaces/{workspace_id}"


def get_workspace_service(
    resources: Annotated[Resources, Depends(get_resources)],
) -> WorkspaceService:
    return resources.workspaces


def get_member_service(resources: Annotated[Resources, Depends(get_resources)]) -> MemberService:
    return resources.members


def get_invitation_service(
    resources: Annotated[Resources, Depends(get_resources)],
) -> InvitationService:
    return resources.invitations


Workspaces = Annotated[WorkspaceService, Depends(get_workspace_service)]
Members = Annotated[MemberService, Depends(get_member_service)]
Invitations = Annotated[InvitationService, Depends(get_invitation_service)]
MayUpdateWorkspace = Annotated[
    WorkspaceAccess, Depends(require_permission(Permission.WORKSPACE_UPDATE))
]
MayManageMembers = Annotated[
    WorkspaceAccess, Depends(require_permission(Permission.MEMBERS_MANAGE, fresh=True))
]
MayInvite = Annotated[WorkspaceAccess, Depends(require_permission(Permission.MEMBERS_MANAGE))]


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


def _member(record: MemberRecord, *, in_full: bool) -> Member:
    """`in_full` adds what only someone who manages members, or the member themself, is shown."""
    return Member(
        user=UserRef(user_id=record.user_id, name=record.name, email=record.email),
        role=Role(record.role),
        project_ids=record.project_ids,
        two_factor_enabled=record.two_factor_enabled if in_full else None,
        joined_at=record.joined_at,
        last_active_at=record.last_active_at if in_full else None,
    )


@router.get(_W + "/members", summary="The members of a workspace")
async def list_members(access: MemberAccess, page: Offset, members: Members) -> MemberPage:
    records, total = await members.page(access, offset=page.offset, limit=page.limit)
    return MemberPage(
        data=[
            _member(
                record,
                in_full=access.holds(Permission.MEMBERS_MANAGE) or record.user_id == access.user_id,
            )
            for record in records
        ],
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
    return MemberResponse(data=_member(record, in_full=True))


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


# -------------------------------------------------------------------------------------------------
# Invitations


def _invitation(record: InvitationRecord) -> Invitation:
    return Invitation(
        invitation_id=record.id,
        email=record.email,
        role=Role(record.role),
        project_ids=record.project_ids,
        status=record.status_at(datetime.now(UTC)),
        invited_by=UserRef(
            user_id=record.invited_by_id, name=record.invited_by_name, email=record.invited_by_email
        ),
        expires_at=record.expires_at,
        created_at=record.created_at,
    )


@router.get(_W + "/invitations", summary="The invitations sent for a workspace")
async def list_invitations(
    access: MayInvite, page: Offset, invitations: Invitations
) -> InvitationPage:
    records, total = await invitations.page(access, offset=page.offset, limit=page.limit)
    return InvitationPage(
        data=[_invitation(record) for record in records],
        page=OffsetPageInfo(offset=page.offset, limit=page.limit, total=total),
    )


@router.post(
    _W + "/invitations",
    status_code=201,
    summary="Invite someone by email",
    description=(
        "Sends a link that works for 7 days and only for an account with this address. "
        "Only an owner can invite an owner, and inviting an owner or admin needs a fresh session."
    ),
)
async def create_invitation(
    body: InvitationCreate,
    access: MayInvite,
    background: BackgroundTasks,
    invitations: Invitations,
    info: Info,
) -> InvitationResponse:
    record, message = await invitations.create(
        access=access, email=body.email, role=body.role, project_ids=body.project_ids, info=info
    )
    background.add_task(invitations.deliver, message)
    return InvitationResponse(data=_invitation(record))


@router.delete(
    _W + "/invitations/{invitation_id}",
    status_code=204,
    summary="Withdraw a pending invitation",
    description="The link stops working. Withdrawing twice is not an error.",
)
async def cancel_invitation(
    invitation_id: UUID, access: MayInvite, invitations: Invitations, info: Info
) -> Response:
    await invitations.cancel(access=access, invitation_id=invitation_id, info=info)
    return Response(status_code=204)


@router.post(
    "/invitations/accept",
    summary="Join the workspace an invitation link invites to",
    description=(
        "For a signed-in account whose verified address is the one the invitation was sent to. "
        "Accepting again returns the same membership."
    ),
)
async def accept_invitation(
    body: InvitationAccept, session: CurrentSession, invitations: Invitations, info: Info
) -> AcceptedInvitationResponse:
    workspace, member = await invitations.accept(session=session, token=body.token, info=info)
    return AcceptedInvitationResponse(
        data=AcceptedInvitation(
            workspace=JoinedWorkspace(
                workspace_id=workspace.id, name=workspace.name, slug=workspace.slug
            ),
            member=_member(member, in_full=True),
        )
    )
