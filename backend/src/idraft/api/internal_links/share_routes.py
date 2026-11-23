"""Shareable client summary links, managed by people (plan 06 Task 4, decision D15). Listing
needs `data:read`; making and revoking a link need `projects:write`. The public read of the
summary is `public_summary_routes`."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from idraft.api.internal_links.shares import ShareService
from idraft.api.permissions import Permission
from idraft.api.request_info import Info
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.internal_links_share import (
    CreatedShareResponse,
    ShareCreate,
    ShareList,
    ShareResponse,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/shares",
    tags=["internal-links"],
)
ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
WriteProject = Annotated[WorkspaceAccess, Depends(require_permission(Permission.PROJECTS_WRITE))]


def get_shares(resources: Annotated[Resources, Depends(get_resources)]) -> ShareService:
    return resources.link_shares


Shares = Annotated[ShareService, Depends(get_shares)]


@router.post(
    "",
    status_code=201,
    summary="Make a read-only link to the client summary that anyone holding it can open",
    description="The token in the answer is shown once and is not stored; only its hash is. "
    "The link stops working at `expires_at` (7, 30 or 90 days, default 30) or when revoked.",
    response_model=CreatedShareResponse,
)
async def create_share(
    project_id: UUID,
    body: ShareCreate,
    access: WriteProject,
    shares: Shares,
    info: Info,
) -> CreatedShareResponse:
    return CreatedShareResponse(
        data=await shares.create(
            access, project_id, expires_in_days=body.expires_in_days, info=info
        )
    )


@router.get(
    "",
    summary="The client summary links of the project, newest first, without their tokens",
    response_model=ShareList,
)
async def list_shares(project_id: UUID, access: ReadData, shares: Shares) -> ShareList:
    return ShareList(data=await shares.list(access, project_id))


@router.delete(
    "/{share_id}",
    summary="Revoke a client summary link",
    description="Revoking a link that is already revoked changes nothing.",
    response_model=ShareResponse,
)
async def revoke_share(
    project_id: UUID, share_id: UUID, access: WriteProject, shares: Shares, info: Info
) -> ShareResponse:
    return ShareResponse(data=await shares.revoke(access, project_id, share_id, info))
