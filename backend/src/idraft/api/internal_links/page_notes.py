"""Notes on a page (spec 9.7.2; decision D16). A note is keyed by the address, so it shows in
every crawl. Only its author changes it; the author, an owner or an admin deletes it; a delete
is soft and the one who deleted can bring the note back. Every write is audited."""

from __future__ import annotations

from collections.abc import Sequence
from contextlib import AbstractAsyncContextManager
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Row, Select, func, insert, select, tuple_, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api import audit
from idraft.api.ai.engine_service import live_project
from idraft.api.internal_links.mention_sources import IssueChecks, NoIssueChecks
from idraft.api.internal_links.page_note_mentions import (
    StoredMention,
    as_snapshot,
    check_mentions,
    of_row,
    paths_of,
    stored_in_text,
)
from idraft.api.pagination import cursor_instant, decode_cursor, encode_cursor, invalid_cursor
from idraft.api.permissions import Permission, Role
from idraft.api.problems import ForbiddenError, NotFoundError
from idraft.api.request_info import RequestInfo
from idraft.api.schemas.page_notes import (
    PageNote,
    PageNoteAuthor,
    PageNoteList,
    PageNoteListMeta,
    PageNoteMention,
    PageNoteWrite,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.db.tables import crawl_pages, crawl_runs, page_notes, users


def _of_page(workspace_id: UUID, project_id: UUID, url_id: int) -> tuple[Any, ...]:
    return (
        page_notes.c.workspace_id == workspace_id,
        page_notes.c.project_id == project_id,
        page_notes.c.url_id == url_id,
    )


async def notes_count(db: AsyncSession, workspace_id: UUID, project_id: UUID, url_id: int) -> int:
    """The notes of an address that are not deleted, whatever crawl is in view."""
    count: int = (
        await db.execute(
            select(func.count())
            .select_from(page_notes)
            .where(*_of_page(workspace_id, project_id, url_id), page_notes.c.deleted_at.is_(None))
        )
    ).scalar_one()
    return count


def _notes(access: WorkspaceAccess, project_id: UUID, url_id: int) -> Select[Any]:
    """The page's notes that are not deleted, each with its author's name."""
    return (
        select(
            page_notes.c.id,
            page_notes.c.author_id,
            users.c.name.label("author_name"),
            page_notes.c.body,
            page_notes.c.mentions,
            page_notes.c.created_at,
            page_notes.c.edited_at,
        )
        .join(users, users.c.id == page_notes.c.author_id)
        .where(
            *_of_page(access.workspace_id, project_id, url_id), page_notes.c.deleted_at.is_(None)
        )
    )


def _may_delete(access: WorkspaceAccess, author_id: UUID) -> bool:
    return author_id == access.user_id or access.role in (Role.OWNER, Role.ADMIN)


async def _views(
    db: AsyncSession, access: WorkspaceAccess, rows: Sequence[Row[Any]]
) -> list[PageNote]:
    """The notes as the API shows them. A page chip shows the address's current path, read once
    for the whole list and never taken from what the client sent."""
    stored = [of_row(row.mentions) for row in rows]
    paths = await paths_of(db, [mention for mentions in stored for mention in mentions])
    writes = access.holds(Permission.NOTES_WRITE)
    return [
        PageNote(
            id=row.id,
            author=PageNoteAuthor(id=row.author_id, name=row.author_name),
            body=row.body,
            mentions=[
                PageNoteMention(
                    **mention,
                    path=paths.get(mention["target"]) if mention["type"] == "page" else None,
                )
                for mention in mentions
            ],
            created_at=row.created_at,
            edited_at=row.edited_at,
            can_edit=writes and row.author_id == access.user_id,
            can_delete=writes and _may_delete(access, row.author_id),
        )
        for row, mentions in zip(rows, stored, strict=True)
    ]


def _after(cursor: str, scope: dict[str, object]) -> tuple[datetime, UUID]:
    key = decode_cursor(cursor, scope=scope)
    if len(key) != 2 or not isinstance(key[1], str):
        raise invalid_cursor()
    try:
        return cursor_instant(key[0]), UUID(key[1])
    except ValueError:
        raise invalid_cursor() from None


async def _require_page(
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


async def _locked(
    db: AsyncSession,
    access: WorkspaceAccess,
    project_id: UUID,
    url_id: int,
    note_id: UUID,
    *,
    deleted: bool,
) -> Row[Any]:
    """The note of this page, locked for a write: one that is deleted, or one that is not."""
    state = page_notes.c.deleted_at.is_not(None) if deleted else page_notes.c.deleted_at.is_(None)
    row = (
        await db.execute(
            select(
                page_notes.c.author_id,
                page_notes.c.body,
                page_notes.c.mentions,
                page_notes.c.deleted_by,
            )
            .where(
                *_of_page(access.workspace_id, project_id, url_id),
                page_notes.c.id == note_id,
                state,
            )
            .with_for_update()
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError
    return row


async def _change(
    db: AsyncSession, access: WorkspaceAccess, project_id: UUID, note_id: UUID, **values: object
) -> None:
    await db.execute(
        update(page_notes)
        .where(
            page_notes.c.workspace_id == access.workspace_id,
            page_notes.c.project_id == project_id,
            page_notes.c.id == note_id,
        )
        .values(**values)
    )


class PageNoteService:
    def __init__(
        self,
        *,
        sessions: async_sessionmaker[AsyncSession],
        issues: IssueChecks | None = None,
    ) -> None:
        self._sessions = sessions
        self._issues: IssueChecks = NoIssueChecks() if issues is None else issues

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    @staticmethod
    async def _one(
        db: AsyncSession, access: WorkspaceAccess, project_id: UUID, url_id: int, note_id: UUID
    ) -> PageNote:
        row = (
            await db.execute(_notes(access, project_id, url_id).where(page_notes.c.id == note_id))
        ).one()
        return (await _views(db, access, [row]))[0]

    @staticmethod
    async def _audit(
        db: AsyncSession,
        access: WorkspaceAccess,
        action: audit.AuditAction,
        note_id: UUID,
        info: RequestInfo,
        *,
        before: audit.Snapshot | None = None,
        after: audit.Snapshot | None = None,
    ) -> None:
        await audit.record(
            db,
            workspace_id=access.workspace_id,
            actor_id=access.user_id,
            action=action,
            target_type="page_note",
            target_id=note_id,
            info=info,
            before=before,
            after=after,
        )

    async def list(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        url_id: int,
        *,
        cursor: str | None,
        limit: int,
    ) -> PageNoteList:
        """Newest first."""
        scope: dict[str, object] = {
            "list": "page-notes",
            "project_id": str(project_id),
            "url_id": url_id,
        }
        async with self._transaction(access) as db:
            await _require_page(db, access, project_id, url_id)
            statement = _notes(access, project_id, url_id)
            if cursor is not None:
                created, note_id = _after(cursor, scope)
                statement = statement.where(
                    tuple_(page_notes.c.created_at, page_notes.c.id) < tuple_(created, note_id)
                )
            rows = (
                await db.execute(
                    statement.order_by(
                        page_notes.c.created_at.desc(), page_notes.c.id.desc()
                    ).limit(limit + 1)
                )
            ).all()
            total = await notes_count(db, access.workspace_id, project_id, url_id)
            shown = rows[:limit]
            views = await _views(db, access, shown)
        next_cursor = (
            encode_cursor([shown[-1].created_at.isoformat(), str(shown[-1].id)], scope=scope)
            if len(rows) > limit
            else None
        )
        return PageNoteList(
            data=views,
            meta=PageNoteListMeta(
                limit=limit, next_cursor=next_cursor, has_more=next_cursor is not None, total=total
            ),
        )

    async def create(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        url_id: int,
        body: PageNoteWrite,
        info: RequestInfo,
    ) -> PageNote:
        async with self._transaction(access) as db:
            await _require_page(db, access, project_id, url_id)
            mentions = await check_mentions(
                db, access, project_id, body.body, body.mentions or [], self._issues
            )
            note_id: UUID = (
                await db.execute(
                    insert(page_notes)
                    .values(
                        workspace_id=access.workspace_id,
                        project_id=project_id,
                        url_id=url_id,
                        author_id=access.user_id,
                        body=body.body,
                        mentions=mentions,
                    )
                    .returning(page_notes.c.id)
                )
            ).scalar_one()
            await self._audit(
                db,
                access,
                "page_note.created",
                note_id,
                info,
                after={
                    "url_id": str(url_id),
                    "body": body.body,
                    "mentions": as_snapshot(mentions),
                },
            )
            return await self._one(db, access, project_id, url_id, note_id)

    async def update(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        url_id: int,
        note_id: UUID,
        body: PageNoteWrite,
        info: RequestInfo,
    ) -> PageNote:
        async with self._transaction(access) as db:
            await _require_page(db, access, project_id, url_id)
            note = await _locked(db, access, project_id, url_id, note_id, deleted=False)
            if note.author_id != access.user_id:
                raise ForbiddenError("Only the one who wrote a note can change it.")
            before = of_row(note.mentions)
            kept: list[StoredMention] = (
                stored_in_text(body.body, before)
                if body.mentions is None
                else await check_mentions(
                    db, access, project_id, body.body, body.mentions, self._issues
                )
            )
            if note.body != body.body or kept != before:
                await _change(
                    db,
                    access,
                    project_id,
                    note_id,
                    body=body.body,
                    mentions=kept,
                    edited_at=func.now(),
                )
                await self._audit(
                    db,
                    access,
                    "page_note.updated",
                    note_id,
                    info,
                    before={"body": note.body, "mentions": as_snapshot(before)},
                    after={"body": body.body, "mentions": as_snapshot(kept)},
                )
            return await self._one(db, access, project_id, url_id, note_id)

    async def delete(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        url_id: int,
        note_id: UUID,
        info: RequestInfo,
    ) -> None:
        """Soft: the row stays, so the one who deleted can bring the note back."""
        async with self._transaction(access) as db:
            await _require_page(db, access, project_id, url_id)
            note = await _locked(db, access, project_id, url_id, note_id, deleted=False)
            if not _may_delete(access, note.author_id):
                raise ForbiddenError(
                    "Only the one who wrote a note, an owner or an admin can delete it."
                )
            await _change(
                db,
                access,
                project_id,
                note_id,
                deleted_at=func.now(),
                deleted_by=access.user_id,
            )
            await self._audit(
                db,
                access,
                "page_note.deleted",
                note_id,
                info,
                before={
                    "url_id": str(url_id),
                    "body": note.body,
                    "author_id": str(note.author_id),
                },
            )

    async def restore(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        url_id: int,
        note_id: UUID,
        info: RequestInfo,
    ) -> PageNote:
        async with self._transaction(access) as db:
            await _require_page(db, access, project_id, url_id)
            note = await _locked(db, access, project_id, url_id, note_id, deleted=True)
            if note.deleted_by != access.user_id:
                raise ForbiddenError("Only the one who deleted a note can bring it back.")
            await _change(db, access, project_id, note_id, deleted_at=None, deleted_by=None)
            await self._audit(db, access, "page_note.restored", note_id, info)
            return await self._one(db, access, project_id, url_id, note_id)
