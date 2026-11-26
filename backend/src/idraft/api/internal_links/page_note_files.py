"""Files for a page note, sent on their own before the note exists (spec 9.8.5, decisions D21 to
D26). The type is the content's, the bytes go to the raw bucket first and the row after, and a
workspace's files are counted under a lock so two uploads cannot both pass the cap."""

from __future__ import annotations

from contextlib import AbstractAsyncContextManager
from uuid import UUID, uuid4

from sqlalchemy import func, insert, select
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api import audit
from idraft.api.internal_links.page_notes import _require_page
from idraft.api.problems import (
    FieldError,
    PayloadTooLargeError,
    QuotaExceededError,
    StorageUnavailableError,
    UnsupportedMediaTypeError,
    invalid_fields,
)
from idraft.api.request_info import RequestInfo
from idraft.api.schemas.page_notes import PageNoteFile
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.db.tables import page_note_attachments, workspace_quotas
from idraft.storage.file_sniff import (
    IMAGE_TYPES,
    NOTE_FILE_MAX_BYTES,
    FileRefused,
    display_name,
    sniff,
)
from idraft.storage.note_files import put_note_file
from idraft.storage.raw import ObjectStore, RawStorageError

_REFUSED = {
    "type": "This kind of file cannot be attached. Use an image, a PDF, a CSV or a text file.",
    "markup": "A file that holds a web page or a script cannot be attached.",
    "name": "A file with this name cannot be attached.",
}


def file_path(workspace_id: UUID, project_id: UUID, url_id: int, attachment_id: UUID) -> str:
    """The API path of a note's file, as every answer that names a file gives it."""
    return (
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}"
        f"/internal-links/pages/{url_id}/note-attachments/{attachment_id}"
    )


def _unavailable() -> StorageUnavailableError:
    return StorageUnavailableError("Files cannot be stored right now.")


class PageNoteFileService:
    def __init__(
        self, *, sessions: async_sessionmaker[AsyncSession], store: ObjectStore | None
    ) -> None:
        self._sessions = sessions
        self._store = store

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    async def upload(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        url_id: int,
        *,
        filename: str | None,
        data: bytes,
        info: RequestInfo,
    ) -> PageNoteFile:
        """Store one file for a page and answer with it. The file belongs to no note yet."""
        if self._store is None:
            raise _unavailable()
        if len(data) > NOTE_FILE_MAX_BYTES:
            raise PayloadTooLargeError(
                "A note file is at most 10 MB.", limit_bytes=NOTE_FILE_MAX_BYTES
            )
        try:
            content_type = sniff(data, filename or "")
        except FileRefused as refused:
            if refused.reason == "empty":
                raise invalid_fields(
                    [FieldError("file", "file_empty", "The file is empty.")]
                ) from None
            raise UnsupportedMediaTypeError(
                _REFUSED.get(refused.reason, _REFUSED["type"])
            ) from None
        name = display_name(filename)
        async with self._transaction(access) as db:
            await _require_page(db, access, project_id, url_id)
            await self._within_the_quota(db, access, len(data))
            attachment_id = uuid4()
            try:
                key = await put_note_file(
                    self._store, access.workspace_id, project_id, attachment_id, data
                )
            except RawStorageError:
                # Leaving the block rolls the transaction back: no row without its object.
                raise _unavailable() from None
            await db.execute(
                insert(page_note_attachments).values(
                    id=attachment_id,
                    workspace_id=access.workspace_id,
                    project_id=project_id,
                    url_id=url_id,
                    uploaded_by=access.user_id,
                    storage_key=key,
                    original_name=name,
                    size_bytes=len(data),
                    content_type=content_type,
                )
            )
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="page_note.file_uploaded",
                target_type="page_note_attachment",
                target_id=attachment_id,
                info=info,
                after={
                    "url_id": str(url_id),
                    "name": name,
                    "size": len(data),
                    "content_type": content_type,
                },
            )
        return PageNoteFile(
            id=attachment_id,
            name=name,
            size=len(data),
            content_type=content_type,
            is_image=content_type in IMAGE_TYPES,
            url=file_path(access.workspace_id, project_id, url_id, attachment_id),
        )

    @staticmethod
    async def _within_the_quota(db: AsyncSession, access: WorkspaceAccess, requested: int) -> None:
        """Every row of the workspace counts (attached, removed or orphaned: the bytes are still
        stored). The lock makes the count and the insert one step, so two uploads at the edge
        cannot both pass."""
        await db.execute(
            select(
                func.pg_advisory_xact_lock(
                    func.hashtextextended(f"note-files:{access.workspace_id}", 0)
                )
            )
        )
        await db.execute(
            upsert(workspace_quotas)
            .values(workspace_id=access.workspace_id)
            .on_conflict_do_nothing()
        )
        limit: int = (
            await db.execute(
                select(workspace_quotas.c.max_note_file_bytes).where(
                    workspace_quotas.c.workspace_id == access.workspace_id
                )
            )
        ).scalar_one()
        used: int = (
            await db.execute(
                select(func.coalesce(func.sum(page_note_attachments.c.size_bytes), 0)).where(
                    page_note_attachments.c.workspace_id == access.workspace_id
                )
            )
        ).scalar_one()
        if used + requested > limit:
            raise QuotaExceededError(
                "The workspace has used its space for note files.",
                limit=limit,
                used=used,
                requested=requested,
            )
