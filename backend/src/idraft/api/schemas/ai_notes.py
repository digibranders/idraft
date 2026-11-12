"""Request and response models of notes and annotations (WP-38 notes-annotations; contracts N9
and N13)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Final, Literal
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from idraft.api.schemas.common import Body, printable
from idraft.domain.ai_engines import EngineCode

NOTE_TEXT_MAX: Final = 140

AnnotationKind = Literal[
    "model_changed", "entity_set_changed", "extractor_changed", "prompt_set_changed"
]


class Annotation(BaseModel):
    """A boundary drawn on every time chart (overview-and-charts N9)."""

    model_config = ConfigDict(populate_by_name=True)

    at: datetime
    kind: AnnotationKind
    engine_code: EngineCode | None = Field(description="Set for a model change.")
    from_: int | str | None = Field(
        alias="from", serialization_alias="from", description="The value before the change."
    )
    to: int | str | None = Field(description="The value after the change.")
    label: str


class AnnotationList(BaseModel):
    data: list[Annotation] = Field(description="Oldest first.")


# One line, shown escaped; a control character is refused.
NoteText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=NOTE_TEXT_MAX),
    AfterValidator(printable),
]


class ProjectNoteScope(Body):
    kind: Literal["project"]


class TermNoteScope(Body):
    kind: Literal["term"]
    term_id: UUID = Field(description="A term the project may use (`term_unknown` otherwise).")


NoteScope = Annotated[ProjectNoteScope | TermNoteScope, Field(discriminator="kind")]


class NoteCreate(Body):
    on: date = Field(description="The project day the note is drawn on.")
    text: NoteText
    scope: NoteScope


class NoteAuthor(BaseModel):
    user_id: UUID
    name: str


class Note(BaseModel):
    note_id: UUID
    on: date
    text: str = Field(description="Shown as text, never as markup.")
    scope: NoteScope
    created_by: NoteAuthor | None
    created_at: datetime


class NoteResponse(BaseModel):
    data: Note


class NoteList(BaseModel):
    data: list[Note] = Field(description="By `on`, then `created_at`, oldest first.")
