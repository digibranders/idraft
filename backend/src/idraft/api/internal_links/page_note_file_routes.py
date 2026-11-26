"""The upload of a note's file (spec 9.8.6). Writing needs `notes:write`. The route reads the part
with a bound of one byte over the cap, so a file is never read whole to be refused."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, UploadFile

from idraft.api.internal_links.page_note_files import PageNoteFileService
from idraft.api.internal_links.page_note_routes import WriteNotes
from idraft.api.internal_links.read_routes import UrlIdPath
from idraft.api.request_info import Info
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.page_notes import PageNoteFileResponse
from idraft.storage.file_sniff import NOTE_FILE_MAX_BYTES

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/pages/{url_id}",
    tags=["internal-links"],
)


def get_page_note_files(
    resources: Annotated[Resources, Depends(get_resources)],
) -> PageNoteFileService:
    return resources.page_note_files


PageNoteFiles = Annotated[PageNoteFileService, Depends(get_page_note_files)]


@router.post(
    "/note-attachments",
    status_code=201,
    summary="Upload a file for a note",
    description="Multipart, one part `file`, one file per request. The type is decided by the "
    "content, never by the name or the type the browser sends: an image (PNG, JPEG, GIF, WebP), a "
    "PDF, a CSV or a text file. The file belongs to no note until a note is saved with its id. "
    "`413 payload_too_large` over 10 MB (`limit_bytes`), `415 unsupported_media_type` for "
    "any other kind of file (a web page, an SVG, a script, an archive), `422` for an empty file or "
    "a missing `file` part and for `quota_exceeded` (`limit`, `used`, `requested`: the workspace "
    "stores 1 GiB of note files unless its limit says otherwise), `503 storage_unavailable` when "
    "the file could not be stored, and `404 not_found` for an address no crawl of the project "
    "holds.",
)
async def upload_page_note_file(
    project_id: UUID,
    url_id: UrlIdPath,
    access: WriteNotes,
    service: PageNoteFiles,
    info: Info,
    file: Annotated[UploadFile, File(description="The file, at most 10 MB.")],
) -> PageNoteFileResponse:
    data = await file.read(NOTE_FILE_MAX_BYTES + 1)
    return PageNoteFileResponse(
        data=await service.upload(
            access, project_id, url_id, filename=file.filename, data=data, info=info
        )
    )
