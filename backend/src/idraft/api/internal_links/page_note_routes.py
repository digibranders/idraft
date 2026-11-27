"""Notes on a page (spec 9.7.2). Reading needs `data:read`; writing needs `notes:write`, and
the service then asks who wrote, or who deleted, the note."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from idraft.api.internal_links.page_notes import PageNoteService
from idraft.api.internal_links.read_routes import UrlIdPath
from idraft.api.pagination import CURSOR_MAX
from idraft.api.permissions import Permission
from idraft.api.request_info import Info
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.page_notes import PageNoteList, PageNoteResponse, PageNoteWrite
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/pages/{url_id}"
    "/notes",
    tags=["internal-links"],
)

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
WriteNotes = Annotated[WorkspaceAccess, Depends(require_permission(Permission.NOTES_WRITE))]


def get_page_notes(resources: Annotated[Resources, Depends(get_resources)]) -> PageNoteService:
    return resources.page_notes


PageNotes = Annotated[PageNoteService, Depends(get_page_notes)]


@router.get(
    "",
    summary="One page: its notes, newest first",
    description="The notes that are not deleted, of every crawl: a note is kept by address. "
    "`can_edit` and `can_delete` say what the caller may do with each. `404 not_found` for an "
    "address no crawl of the project holds.",
)
async def list_page_notes(
    project_id: UUID,
    url_id: UrlIdPath,
    access: ReadData,
    service: PageNotes,
    cursor: Annotated[
        str | None,
        Query(max_length=CURSOR_MAX, description="`meta.next_cursor` of the previous page."),
    ] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> PageNoteList:
    return await service.list(access, project_id, url_id, cursor=cursor, limit=limit)


@router.post(
    "",
    status_code=201,
    summary="Add a note to a page",
    description="Plain text, 1 to 2,000 characters once trimmed; line breaks inside are kept.",
)
async def create_page_note(
    project_id: UUID,
    url_id: UrlIdPath,
    body: PageNoteWrite,
    access: WriteNotes,
    service: PageNotes,
    info: Info,
) -> PageNoteResponse:
    return PageNoteResponse(data=await service.create(access, project_id, url_id, body, info))


@router.patch(
    "/{note_id}",
    summary="Change your note",
    description="Only the one who wrote the note; anyone else gets `403 forbidden`. `edited_at` "
    "is set only when the body really changed.",
)
async def update_page_note(
    project_id: UUID,
    url_id: UrlIdPath,
    note_id: UUID,
    body: PageNoteWrite,
    access: WriteNotes,
    service: PageNotes,
    info: Info,
) -> PageNoteResponse:
    return PageNoteResponse(
        data=await service.update(access, project_id, url_id, note_id, body, info)
    )


@router.delete(
    "/{note_id}",
    status_code=204,
    summary="Delete a note",
    description="The one who wrote it, an owner or an admin. The one who deleted can bring it "
    "back with `POST .../restore`. Deleting a deleted note is `404 not_found`.",
)
async def delete_page_note(
    project_id: UUID,
    url_id: UrlIdPath,
    note_id: UUID,
    access: WriteNotes,
    service: PageNotes,
    info: Info,
) -> Response:
    await service.delete(access, project_id, url_id, note_id, info)
    return Response(status_code=204)


@router.post(
    "/{note_id}/restore",
    summary="Bring a deleted note back",
    description="Only the one who deleted it. A note that is not deleted is `404 not_found`.",
)
async def restore_page_note(
    project_id: UUID,
    url_id: UrlIdPath,
    note_id: UUID,
    access: WriteNotes,
    service: PageNotes,
    info: Info,
) -> PageNoteResponse:
    return PageNoteResponse(data=await service.restore(access, project_id, url_id, note_id, info))
