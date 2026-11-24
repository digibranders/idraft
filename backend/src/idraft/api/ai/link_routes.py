"""Links between tracked keywords and prompts, and prompts generated from keywords.

WP-44 (links-generate) fills this router; api/main.py includes it already (docs/ai-visibility/
MASTER-PLAN.md section 3.3). Its service comes from a dependency in this file, built from
`Resources`, so resources.py and main.py stay as they are. This part makes, lists and removes
links; reading needs `data:read`, writing `prompts:write`.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from idraft.api.ai.link_service import LIST_LIMIT, LinkService
from idraft.api.permissions import Permission
from idraft.api.request_info import Info
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.ai_links import (
    KeywordPromptLinkCreate,
    KeywordPromptLinkList,
    KeywordPromptLinkResponse,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-prompt-links",
    tags=["ai"],
)

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
WritePrompts = Annotated[WorkspaceAccess, Depends(require_permission(Permission.PROMPTS_WRITE))]


def get_link_service(resources: Annotated[Resources, Depends(get_resources)]) -> LinkService:
    return LinkService(sessions=resources.sessions)


Links = Annotated[LinkService, Depends(get_link_service)]


@router.get(
    "",
    summary="The keywords prompts are linked to",
    description="The project's active and suggested links, newest first, at most 200 (no "
    "cursor yet). `filter[prompt_id]` and `filter[keyword_id]` narrow them.",
)
async def list_links(
    project_id: UUID,
    access: ReadData,
    links: Links,
    prompt_id: Annotated[UUID | None, Query(alias="filter[prompt_id]")] = None,
    keyword_id: Annotated[UUID | None, Query(alias="filter[keyword_id]")] = None,
    limit: Annotated[int, Query(ge=1, le=LIST_LIMIT)] = LIST_LIMIT,
) -> KeywordPromptLinkList:
    found = await links.list(
        access, project_id, prompt_id=prompt_id, keyword_id=keyword_id, limit=limit
    )
    return KeywordPromptLinkList(data=found)


@router.post(
    "",
    status_code=201,
    summary="Link a keyword to a prompt",
    description="A manual, active link between a keyword of the workspace and a prompt of the "
    "project (`404` for either that is not found). The prompt's search volume is read from its "
    "primary link, so linking does not track the keyword and costs no rank checks. "
    "`409 duplicate` when the pair is linked already.",
)
async def create_link(
    project_id: UUID,
    body: KeywordPromptLinkCreate,
    access: WritePrompts,
    links: Links,
    info: Info,
) -> KeywordPromptLinkResponse:
    return KeywordPromptLinkResponse(data=await links.create(access, project_id, body, info))


@router.delete(
    "/{link_id}",
    status_code=204,
    summary="Remove a link between a keyword and a prompt",
    description="Only the link goes; the keyword and the prompt stay.",
)
async def delete_link(
    project_id: UUID, link_id: UUID, access: WritePrompts, links: Links, info: Info
) -> Response:
    await links.delete(access, project_id, link_id, info)
    return Response(status_code=204)
