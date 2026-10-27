"""Keyword group routes (docs/19-api-specification.md section 3.6.2).

Reading needs `data:read`, changing `keywords:write`. The membership dependency has already
refused a project outside the caller's scope.
"""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from idraft.api.keywords.group_repository import GroupRecord
from idraft.api.keywords.group_service import GroupBranch, GroupService
from idraft.api.permissions import Permission
from idraft.api.request_info import Info
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.keywords import (
    GroupMembers,
    KeywordGroup,
    KeywordGroupCreate,
    KeywordGroupNode,
    KeywordGroupResponse,
    KeywordGroupTree,
    KeywordGroupUpdate,
    MembersAdded,
    MembersAddedResponse,
    MembersRemoved,
    MembersRemovedResponse,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-groups",
    tags=["keywords"],
)

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
WriteKeywords = Annotated[WorkspaceAccess, Depends(require_permission(Permission.KEYWORDS_WRITE))]


def get_group_service(resources: Annotated[Resources, Depends(get_resources)]) -> GroupService:
    return resources.keyword_groups


Groups = Annotated[GroupService, Depends(get_group_service)]


def _fields(record: GroupRecord) -> dict[str, object]:
    return {
        "group_id": record.id,
        "parent_id": record.parent_id,
        "name": record.name,
        "path": record.path,
        "keyword_count": record.keyword_count,
        "created_at": record.created_at,
    }


def _group(record: GroupRecord) -> KeywordGroup:
    return KeywordGroup.model_validate(_fields(record))


def _node(branch: GroupBranch) -> KeywordGroupNode:
    return KeywordGroupNode.model_validate(
        {**_fields(branch.group), "children": [_node(child) for child in branch.children]}
    )


@router.get(
    "",
    summary="Keyword groups as a tree or flat",
    description="In path order. `flat` lists every group with empty `children`. "
    "`keyword_count` counts the active tracked keywords in the group or under it, once each.",
)
async def list_groups(
    project_id: UUID,
    access: ReadData,
    groups: Groups,
    format: Annotated[Literal["tree", "flat"], Query()] = "tree",
) -> KeywordGroupTree:
    branches = await groups.list_groups(access, project_id, tree=format == "tree")
    return KeywordGroupTree(data=[_node(branch) for branch in branches])


@router.post(
    "",
    status_code=201,
    summary="Create a group",
    description="`409 duplicate` when a sibling has the name in any case. A `parent_id` that is "
    "not a group of the project is `422 validation_failed` with `group_unknown`.",
)
async def create_group(
    project_id: UUID,
    body: KeywordGroupCreate,
    access: WriteKeywords,
    groups: Groups,
    info: Info,
) -> KeywordGroupResponse:
    created = await groups.create(
        access, project_id, name=body.name, parent_id=body.parent_id, info=info
    )
    return KeywordGroupResponse(data=_group(created))


@router.patch(
    "/{group_id}",
    summary="Rename or move a group",
    description="The paths of the group and its subtree follow. A parent that is the group or "
    "under it is `422 cycle_detected`; `parent_id: null` moves it to the root.",
)
async def update_group(
    project_id: UUID,
    group_id: UUID,
    body: KeywordGroupUpdate,
    access: WriteKeywords,
    groups: Groups,
    info: Info,
) -> KeywordGroupResponse:
    updated = await groups.update(
        access, project_id, group_id, body.model_dump(include=body.model_fields_set), info
    )
    return KeywordGroupResponse(data=_group(updated))


@router.delete(
    "/{group_id}",
    status_code=204,
    summary="Delete a group (subgroups go too; members are unlinked)",
)
async def delete_group(
    project_id: UUID, group_id: UUID, access: WriteKeywords, groups: Groups, info: Info
) -> Response:
    await groups.delete(access, project_id, group_id, info)
    return Response(status_code=204)


@router.post(
    "/{group_id}/members",
    summary="Add tracked keywords to a group",
    description="Ids that are not live tracked keywords of the project are left out; `added` "
    "counts those that were not in the group.",
)
async def add_members(
    project_id: UUID,
    group_id: UUID,
    body: GroupMembers,
    access: WriteKeywords,
    groups: Groups,
    info: Info,
) -> MembersAddedResponse:
    added = await groups.add_members(access, project_id, group_id, body.tracked_keyword_ids, info)
    return MembersAddedResponse(data=MembersAdded(added=added))


@router.post("/{group_id}/members/remove", summary="Take tracked keywords out of a group")
async def remove_members(
    project_id: UUID,
    group_id: UUID,
    body: GroupMembers,
    access: WriteKeywords,
    groups: Groups,
    info: Info,
) -> MembersRemovedResponse:
    removed = await groups.remove_members(
        access, project_id, group_id, body.tracked_keyword_ids, info
    )
    return MembersRemovedResponse(data=MembersRemoved(removed=removed))
