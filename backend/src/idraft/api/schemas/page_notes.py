"""Notes on a page (spec 9.7.2). The body is plain text: stored as written, never read as markup."""

from __future__ import annotations

from datetime import datetime
from typing import Final
from uuid import UUID

from pydantic import BaseModel, field_validator

from idraft.api.pagination import CursorPageInfo
from idraft.api.schemas.common import Body

NOTE_MAX: Final = 2000


class PageNoteAuthor(BaseModel):
    id: UUID
    name: str


class PageNote(BaseModel):
    id: UUID
    author: PageNoteAuthor
    body: str
    created_at: datetime
    edited_at: datetime | None
    can_edit: bool
    can_delete: bool


class PageNoteWrite(Body):
    """The body of a create and of a change. Trimmed, 1 to 2,000 characters, no null character."""

    body: str

    @field_validator("body")
    @classmethod
    def _plain(cls, value: str) -> str:
        # Every kind of white space goes from the ends: the table's check knows only spaces.
        text = value.replace("\r\n", "\n").strip()
        if not text:
            raise ValueError("Write something first.")
        if len(text) > NOTE_MAX:
            raise ValueError("A note is at most 2,000 characters.")
        if "\x00" in text:
            raise ValueError("A note cannot hold a null character.")
        return text


class PageNoteResponse(BaseModel):
    data: PageNote


class PageNoteListMeta(CursorPageInfo):
    total: int


class PageNoteList(BaseModel):
    data: list[PageNote]
    meta: PageNoteListMeta
