"""The upload and the download of a note's file (spec 9.8.6). Writing needs `notes:write`, reading
`data:read`. The upload reads the part with a bound of one byte over the cap, so a file is never
read whole to be refused."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Response, UploadFile

from idraft.api.internal_links.page_note_files import PageNoteFileService
from idraft.api.internal_links.page_note_routes import ReadData, WriteNotes
from idraft.api.internal_links.read_routes import UrlIdPath
from idraft.api.request_info import Info
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.page_notes import PageNoteFileResponse
from idraft.storage.file_sniff import (
    ACCEPTED_TYPES,
    IMAGE_TYPES,
    NOTE_FILE_MAX_BYTES,
    content_disposition,
)

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


@router.get(
    "/note-attachments/{attachment_id}",
    summary="The bytes of a note's file",
    description="`data:read`. The file as it was stored, through the API so that the permission "
    "and the workspace are checked on every read. `404 not_found` for a file that is not "
    "attached to a note, was removed from its note, belongs to a deleted note, or is of another "
    "page, project or workspace; the file of a note comes back when the note is restored. The "
    "`Content-Type` is the one stored from the content, `X-Content-Type-Options: nosniff` and a "
    "sandboxing `Content-Security-Policy` are always sent, and `Content-Disposition` is `inline` "
    "for PNG, JPEG, GIF and WebP images and `attachment` for every other type.",
    response_class=Response,
    responses={200: {"content": {content_type: {} for content_type in sorted(ACCEPTED_TYPES)}}},
)
async def download_page_note_file(
    project_id: UUID,
    url_id: UrlIdPath,
    attachment_id: UUID,
    access: ReadData,
    service: PageNoteFiles,
) -> Response:
    stored = await service.download(access, project_id, url_id, attachment_id)
    return Response(
        content=stored.body,
        media_type=stored.content_type,
        headers={
            "Content-Disposition": "inline"
            if stored.content_type in IMAGE_TYPES
            else content_disposition(stored.name),
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )
