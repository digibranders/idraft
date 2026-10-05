"""Bodies of the keyword import routes (docs/19-api-specification.md section 3.6.3; plan
decisions D11 to D13).

A CSV upload is a `multipart/form-data` request with parts `file` and `options` (the JSON of
`ImportOptions`); paste text and rows are JSON (`KeywordImportCreate`).
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AfterValidator, BaseModel, Field, StringConstraints, model_validator

from sightline.api.pagination import CursorPageInfo
from sightline.api.schemas.common import Body, LanguageCode, UserRef, printable
from sightline.api.schemas.keywords import DepthProfile, DeviceChoice
from sightline.api.schemas.operations import Operation

IMPORT_ROWS_MAX = 10_000
PASTE_MAX = 1_000_000  # characters; the JSON body limit is 1 MB
CELL_MAX = 2000

ImportStatus = Literal[
    "uploaded",
    "parsing",
    "needs_mapping",
    "preview_ready",
    "writing",
    "completed",
    "completed_with_errors",
    "failed",
    "cancelled",
    "expired",
]
Outcome = Literal["new", "duplicate", "variant", "conflict", "invalid"]
RowAction = Literal["create", "skip", "merge", "force_separate"]


class ImportField(StrEnum):
    """A field a column maps to. A named enum, so the API document gives the mapping's values a
    schema of their own that generated clients can index."""

    KEYWORD = "keyword"
    COUNTRY = "country"
    LOCATION = "location"
    LANGUAGE = "language"
    DEVICE = "device"
    TAGS = "tags"
    TOPIC = "topic"
    GROUP = "group"
    INTENT = "intent"
    FUNNEL_STAGE = "funnel_stage"
    PRIORITY = "priority"
    TARGET_URL = "target_url"
    DEPTH_PROFILE = "depth_profile"


Cell = Annotated[str, StringConstraints(max_length=CELL_MAX), AfterValidator(printable)]
Header = Annotated[str, StringConstraints(min_length=1, max_length=200), AfterValidator(printable)]


class ImportDefaults(Body):
    """Values for rows that leave a field out; the project's defaults otherwise."""

    location_id: int | None = None
    language_code: LanguageCode | None = None
    device: DeviceChoice | None = None
    depth_profile: DepthProfile | None = None
    priority: Annotated[int, Field(ge=1, le=5)] | None = None
    group_path: (
        Annotated[str, StringConstraints(min_length=1, max_length=1000), AfterValidator(printable)]
        | None
    ) = None
    tags_vocabulary_id: UUID | None = Field(
        default=None, description="The vocabulary the `tags` column names terms of."
    )
    topic_vocabulary_id: UUID | None = Field(
        default=None, description="The vocabulary the `topic` column names term paths of."
    )


class ImportOptions(Body):
    column_mapping: Annotated[dict[Header, ImportField], Field(max_length=50)] | None = Field(
        default=None, description="File header to field; headers are matched by name otherwise."
    )
    defaults: ImportDefaults = Field(default_factory=ImportDefaults)


class KeywordImportCreate(ImportOptions):
    """`paste`: one keyword per line, tags after a TAB. `api`: `rows`, each a field to value
    map."""

    source: Literal["paste", "api"]
    paste: Annotated[str, StringConstraints(min_length=1, max_length=PASTE_MAX)] | None = None
    rows: (
        Annotated[
            list[Annotated[dict[Header, Cell], Field(max_length=50)]],
            Field(min_length=1, max_length=IMPORT_ROWS_MAX),
        ]
        | None
    ) = None

    @model_validator(mode="after")
    def _matches_source(self) -> KeywordImportCreate:
        if (self.source == "paste") != (self.paste is not None):
            raise ValueError("`paste` is given exactly when the source is paste")
        if (self.source == "api") != (self.rows is not None):
            raise ValueError("`rows` is given exactly when the source is api")
        return self


class RowActionInput(Body):
    row_no: Annotated[int, Field(ge=1)]
    part: Annotated[int, Field(ge=1, le=2)] = 1
    action: RowAction


class KeywordImportUpdate(Body):
    """A new mapping or new defaults read the source again; row actions apply to the current
    preview."""

    column_mapping: Annotated[dict[Header, ImportField], Field(max_length=50)] | None = None
    defaults: ImportDefaults | None = None
    row_actions: Annotated[list[RowActionInput], Field(max_length=IMPORT_ROWS_MAX * 2)] | None = (
        None
    )

    @model_validator(mode="after")
    def _says_something(self) -> KeywordImportUpdate:
        if not self.model_fields_set:
            raise ValueError("give at least one field to change")
        return self


class KeywordImportConfirm(Body):
    duplicate_action: Literal["skip", "merge_terms"] = Field(
        default="skip",
        description="For rows left at the default action: `merge_terms` merges groups and terms "
        "into the duplicate.",
    )


class ImportCounts(BaseModel):
    rows_total: int
    new: int
    duplicate: int
    variant: int
    conflict: int
    invalid: int
    created: int
    skipped: int
    merged: int


class ImportQuota(BaseModel):
    limit: int
    used: int
    would_use: int = Field(description="Active tracked keywords after the import as previewed.")


class KeywordImport(BaseModel):
    import_id: UUID
    source: Literal["upload", "paste", "api"]
    original_filename: str | None
    status: ImportStatus
    column_mapping: dict[str, str]
    defaults: dict[str, object]
    counts: ImportCounts
    quota: ImportQuota | None = Field(description="Once the preview is ready.")
    error_code: str | None
    created_by: UserRef
    created_at: datetime
    expires_at: datetime
    finished_at: datetime | None
    operation: Operation


class KeywordImportResponse(BaseModel):
    data: KeywordImport


class KeywordImportPage(BaseModel):
    data: list[KeywordImport]
    page: CursorPageInfo


class ImportRow(BaseModel):
    row_no: int
    part: int = Field(description="1, or 2 for the mobile half of a `both` row.")
    raw: dict[str, str]
    keyword: str | None
    normalized_text: str | None
    language_code: str | None
    device: str | None
    location_id: int | None
    outcome: Outcome
    reason_code: str | None
    reason: str | None
    existing_tracked_keyword_id: UUID | None
    action: RowAction


class ImportRowPage(BaseModel):
    data: list[ImportRow]
    page: CursorPageInfo
