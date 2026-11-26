"""Files for a page note (spec 9.8.5, decisions D21 to D27). A file is sent on its own before the
note exists: the type is the content's, the bytes go to the raw bucket first and the row after, and
a workspace's files are counted under a lock so two uploads cannot both pass the cap. A note then
names its files by id, and they are served through the API, never by a link that outlives the
permission.

No file is ever deleted from the bucket: the store cannot delete and no purge is built (D27). A
removed file, a deleted note's file and an orphan stay stored, and stay counted against the cap."""

from __future__ import annotations

from collections.abc import Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

import structlog
from sqlalchemy import Row, func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api import audit
from idraft.api.ai.engine_service import live_project
from idraft.api.problems import (
    FieldError,
    NotFoundError,
    PayloadTooLargeError,
    QuotaExceededError,
    StorageUnavailableError,
    UnsupportedMediaTypeError,
    invalid_fields,
)
from idraft.api.request_info import RequestInfo
from idraft.api.schemas.page_notes import FILES_MAX, PageNoteFile
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.db.tables import (
    crawl_pages,
    crawl_runs,
    page_note_attachments,
    page_notes,
    workspace_quotas,
)
from idraft.storage.file_sniff import (
    IMAGE_TYPES,
    NOTE_FILE_MAX_BYTES,
    FileRefused,
    display_name,
    sniff,
)
from idraft.storage.note_files import get_note_file, put_note_file
from idraft.storage.raw import ObjectStore, RawStorageError

_log = structlog.get_logger(__name__)

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


async def require_page(
    db: AsyncSession, access: WorkspaceAccess, project_id: UUID, url_id: int
) -> None:
    """The project is live and one of its crawls, any of them, holds the address."""
    await live_project(db, access, project_id)
    found = (
        await db.execute(
            select(crawl_pages.c.url_id)
            .join(
                crawl_runs,
                (crawl_runs.c.id == crawl_pages.c.run_id)
                & (crawl_runs.c.workspace_id == crawl_pages.c.workspace_id),
            )
            .where(
                crawl_pages.c.workspace_id == access.workspace_id,
                crawl_pages.c.url_id == url_id,
                crawl_runs.c.project_id == project_id,
            )
            .limit(1)
        )
    ).first()
    if found is None:
        raise NotFoundError


async def attachments_of(
    db: AsyncSession, workspace_id: UUID, note_ids: Sequence[UUID]
) -> dict[UUID, list[PageNoteFile]]:
    """The live files of every note given, oldest first, in one statement however many notes."""
    if not note_ids:
        return {}
    rows = (
        await db.execute(
            select(
                page_note_attachments.c.id,
                page_note_attachments.c.note_id,
                page_note_attachments.c.project_id,
                page_note_attachments.c.url_id,
                page_note_attachments.c.original_name,
                page_note_attachments.c.size_bytes,
                page_note_attachments.c.content_type,
            )
            .where(
                page_note_attachments.c.workspace_id == workspace_id,
                page_note_attachments.c.note_id.in_(note_ids),
                page_note_attachments.c.removed_at.is_(None),
            )
            .order_by(page_note_attachments.c.created_at, page_note_attachments.c.id)
        )
    ).all()
    files: dict[UUID, list[PageNoteFile]] = {}
    for row in rows:
        files.setdefault(row.note_id, []).append(
            PageNoteFile(
                id=row.id,
                name=row.original_name,
                size=row.size_bytes,
                content_type=row.content_type,
                is_image=row.content_type in IMAGE_TYPES,
                url=file_path(workspace_id, row.project_id, row.url_id, row.id),
            )
        )
    return files


type FileEntry = dict[str, str | int]


@dataclass(frozen=True)
class FileChange:
    """The files of a note before and after a write, as an audit entry records them."""

    before: list[FileEntry]
    after: list[FileEntry]

    @property
    def changed(self) -> bool:
        return {entry["id"] for entry in self.before} != {entry["id"] for entry in self.after}


def _entry(row: Row[Any]) -> FileEntry:
    return {"id": str(row.id), "name": row.original_name, "size": row.size_bytes}


async def attach(
    db: AsyncSession,
    access: WorkspaceAccess,
    project_id: UUID,
    url_id: int,
    note_id: UUID,
    ids: Sequence[UUID] | None,
    *,
    replace: bool,
) -> FileChange:
    """Make `ids` the live files of the note. `None` leaves them as they are. Each id must be a
    file this caller uploaded for this page and not yet attached (or, for a note's own change, one
    the note already holds); a file is attached once and a dropped one is marked removed for good.
    The caller has locked the note, so two changes of it cannot both pass the count of five."""
    current = (
        await db.execute(
            select(
                page_note_attachments.c.id,
                page_note_attachments.c.original_name,
                page_note_attachments.c.size_bytes,
            )
            .where(
                page_note_attachments.c.workspace_id == access.workspace_id,
                page_note_attachments.c.note_id == note_id,
                page_note_attachments.c.removed_at.is_(None),
            )
            .order_by(page_note_attachments.c.created_at, page_note_attachments.c.id)
        )
    ).all()
    before = [_entry(row) for row in current]
    if ids is None:
        return FileChange(before, before)
    if len(ids) > FILES_MAX:
        raise invalid_fields(
            [
                FieldError(
                    "attachment_ids",
                    "too_many_attachments",
                    f"A note holds at most {FILES_MAX} files.",
                )
            ]
        )
    held = {row.id for row in current}
    found = {
        row.id: row
        for row in (
            await db.execute(
                select(
                    page_note_attachments.c.id,
                    page_note_attachments.c.uploaded_by,
                    page_note_attachments.c.project_id,
                    page_note_attachments.c.url_id,
                    page_note_attachments.c.note_id,
                    page_note_attachments.c.original_name,
                    page_note_attachments.c.size_bytes,
                )
                .where(
                    page_note_attachments.c.workspace_id == access.workspace_id,
                    page_note_attachments.c.id.in_(ids),
                )
                .order_by(page_note_attachments.c.id)
                .with_for_update()
            )
        ).all()
    }
    wrong: list[FieldError] = []
    seen: set[UUID] = set()
    for index, file_id in enumerate(ids):
        row = found.get(file_id)
        usable = (
            row is not None
            and file_id not in seen
            and row.uploaded_by == access.user_id
            and row.project_id == project_id
            and row.url_id == url_id
            and (row.note_id is None or (replace and file_id in held))
        )
        seen.add(file_id)
        if not usable:
            wrong.append(
                FieldError(
                    f"attachment_ids[{index}]",
                    "attachment_unavailable",
                    "This file cannot be attached to this note.",
                )
            )
    if wrong:
        raise invalid_fields(wrong)
    added = [file_id for file_id in ids if file_id not in held]
    if added:
        await db.execute(
            update(page_note_attachments)
            .where(
                page_note_attachments.c.workspace_id == access.workspace_id,
                page_note_attachments.c.id.in_(added),
            )
            .values(note_id=note_id)
        )
    dropped = held - set(ids)
    if dropped:
        await db.execute(
            update(page_note_attachments)
            .where(
                page_note_attachments.c.workspace_id == access.workspace_id,
                page_note_attachments.c.id.in_(dropped),
            )
            .values(removed_at=func.now())
        )
    return FileChange(before, [_entry(found[file_id]) for file_id in ids])


@dataclass(frozen=True)
class NoteFileBody:
    body: bytes
    name: str
    content_type: str


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
            await require_page(db, access, project_id, url_id)
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

    async def download(
        self, access: WorkspaceAccess, project_id: UUID, url_id: int, attachment_id: UUID
    ) -> NoteFileBody:
        """The bytes of a file, or `404`. A file is visible only while it is attached, not removed
        and its note is not deleted, so a note's delete and restore need no change to its files.
        One statement checks the workspace, project, page, note and file together."""
        async with self._transaction(access) as db:
            await require_page(db, access, project_id, url_id)
            row = (
                await db.execute(
                    select(
                        page_note_attachments.c.storage_key,
                        page_note_attachments.c.original_name,
                        page_note_attachments.c.content_type,
                        page_note_attachments.c.size_bytes,
                    )
                    .join(
                        page_notes,
                        (page_notes.c.id == page_note_attachments.c.note_id)
                        & (page_notes.c.workspace_id == page_note_attachments.c.workspace_id),
                    )
                    .where(
                        page_note_attachments.c.id == attachment_id,
                        page_note_attachments.c.workspace_id == access.workspace_id,
                        page_note_attachments.c.project_id == project_id,
                        page_note_attachments.c.url_id == url_id,
                        page_note_attachments.c.removed_at.is_(None),
                        page_notes.c.deleted_at.is_(None),
                    )
                )
            ).one_or_none()
        if row is None:
            raise NotFoundError
        if self._store is None:
            raise _unavailable()
        try:
            body = await get_note_file(self._store, row.storage_key)
            if len(body) != row.size_bytes:
                raise RawStorageError("the stored file is not the size recorded")
        except (RawStorageError, KeyError):
            # The id only: no name, no key and no bytes in a log line.
            _log.warning("note_file_unreadable", attachment_id=str(attachment_id))
            raise NotFoundError from None
        return NoteFileBody(body, row.original_name, row.content_type)

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
