"""Notes on a project's charts (contract N13; WP-38 builds the bodies). Reading needs
`data:read`, writing `notes:write` (owner, admin, editor; owner decision D-18)."""

from __future__ import annotations

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from idraft.api.permissions import Permission
from idraft.api.schemas.ai_notes import NoteCreate, NoteList, NoteResponse
from idraft.api.stubs import not_built, not_built_yet
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/notes", tags=["notes"]
)

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
WriteNotes = Annotated[WorkspaceAccess, Depends(require_permission(Permission.NOTES_WRITE))]
_NOT_BUILT = " Not built yet: `501 not_implemented`."


@router.get(
    "",
    summary="The project's chart notes",
    description="Notes drawn on days from `from` to `to` (default the 28 days ending today; at "
    "most 92, `422 window_too_large`), project wide and per term." + _NOT_BUILT,
)
@not_built
async def list_notes(
    project_id: UUID,
    access: ReadData,
    start: Annotated[date | None, Query(alias="from")] = None,
    end: Annotated[date | None, Query(alias="to")] = None,
) -> NoteList:
    raise not_built_yet()


@router.post(
    "",
    status_code=201,
    summary="Add a chart note",
    description="At most 140 characters on one line, for the project or one term "
    "(`term_unknown` for a term the project may not use)." + _NOT_BUILT,
)
@not_built
async def create_note(project_id: UUID, body: NoteCreate, access: WriteNotes) -> NoteResponse:
    raise not_built_yet()


@router.delete(
    "/{note_id}", status_code=204, summary="Delete a chart note", description=_NOT_BUILT.strip()
)
@not_built
async def delete_note(project_id: UUID, note_id: UUID, access: WriteNotes) -> Response:
    raise not_built_yet()
