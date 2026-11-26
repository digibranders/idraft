"""Notes on a page (spec 9.7.2). The body is plain text: stored as written, never read as markup."""

from __future__ import annotations

from datetime import datetime
from typing import Final, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from idraft.api.pagination import CursorPageInfo
from idraft.api.schemas.common import Body

NOTE_MAX: Final = 2000
MENTIONS_MAX: Final = 20
MentionType = Literal["page", "user", "issue", "keyword"]


class PageNoteAuthor(BaseModel):
    id: UUID
    name: str


class PageNoteMentionIn(Body):
    """One `@` in a note. The label is display text the server never interprets; the target is
    checked against the database by type (spec 9.8.1)."""

    type: MentionType
    label: str = Field(min_length=2, max_length=200)
    target: str = Field(min_length=1, max_length=200)

    @field_validator("label")
    @classmethod
    def _label(cls, value: str) -> str:
        if not value.startswith("@"):
            raise ValueError("A mention label starts with @.")
        if "\n" in value or "\r" in value or "\x00" in value:
            raise ValueError("A mention label is one line.")
        return value

    @field_validator("target")
    @classmethod
    def _target(cls, value: str) -> str:
        if "\x00" in value:
            raise ValueError("A mention target cannot hold a null character.")
        return value


class PageNoteMention(PageNoteMentionIn):
    # The page's current path, derived on every read and never stored; null for other types.
    path: str | None = None


class PageNote(BaseModel):
    id: UUID
    author: PageNoteAuthor
    body: str
    mentions: list[PageNoteMention] = []
    created_at: datetime
    edited_at: datetime | None
    can_edit: bool
    can_delete: bool


class PageNoteWrite(Body):
    """The body of a create and of a change. Trimmed, 1 to 2,000 characters, no null character.
    `mentions` omitted on a change: the stored ones whose label is still in the text stay."""

    body: str
    mentions: list[PageNoteMentionIn] | None = Field(default=None, max_length=MENTIONS_MAX)

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
