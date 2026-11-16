"""Bodies and answers of the internal link tracker's routes (plan 02, API contract)."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Final, Literal
from uuid import UUID

from pydantic import (
    AfterValidator,
    BaseModel,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from idraft.api.schemas.common import Body, Patch, printable, refuse_null

TierName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=60),
    AfterValidator(printable),
]
TierDescription = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=200), AfterValidator(printable)
]


class TierRef(BaseModel):
    tier_id: UUID
    code: str
    name: str


class PageTier(BaseModel):
    tier_id: UUID
    position: int
    code: str = Field(description="T1 to T8, from the position.")
    name: str
    description: str
    label: str = Field(description='Code and name as filters show it: "T1 Money pages".')
    page_count: int = Field(description="Pages of the workspace's projects on this tier.")
    rule_count: int
    updated_at: datetime


class PageTierList(BaseModel):
    data: list[PageTier]


class PageTierResponse(BaseModel):
    data: PageTier


class PageTierCreate(Body):
    name: TierName
    description: TierDescription = ""


class PageTierPatch(Patch):
    name: TierName | None = None
    description: TierDescription | None = None

    _not_null = field_validator("name", "description")(refuse_null)

    @model_validator(mode="after")
    def _says_something(self) -> PageTierPatch:
        if not self.model_fields_set:
            raise ValueError("give a name or a description")
        return self


StatusClass = Literal["2xx", "3xx", "4xx", "5xx"]
PageFlag = Literal[
    "orphan",
    "editorial_orphan",
    "deep_only_through_auto",
    "placement_unknown",
    "has_broken_outlinks",
]
PageWorklist = Literal["under_linked_t1", "orphans", "editorial_orphans", "deep_only_through_auto"]
UrlId = Annotated[int, Field(gt=0, le=9_223_372_036_854_775_807)]
BULK_IDS_MAX: Final = 5_000
BULK_MATCH_MAX: Final = 20_000
TERMS_MAX: Final = 50
CSV_MAX: Final = 900_000
CSV_ROWS_MAX: Final = 20_000


class PageFilter(Body):
    """The Pages list's filters as a bulk body (`run` is always the latest crawl)."""

    tier_ids: Annotated[list[UUID | Literal["none"]], Field(max_length=9)] | None = None
    tag_ids: Annotated[list[UUID], Field(max_length=TERMS_MAX)] | None = None
    status: Annotated[list[StatusClass], Field(max_length=4)] | None = None
    indexable: bool | None = None
    flags: Annotated[list[PageFlag], Field(max_length=5)] | None = None
    worklist: PageWorklist | None = None
    q: Annotated[str, StringConstraints(min_length=1, max_length=200)] | None = None


class PageSelection(Body):
    """Exactly one of `url_ids` and `filter`."""

    url_ids: Annotated[list[UrlId], Field(min_length=1, max_length=BULK_IDS_MAX)] | None = None
    filter: PageFilter | None = None

    @model_validator(mode="after")
    def _one_way(self) -> PageSelection:
        if (self.url_ids is None) == (self.filter is None):
            raise ValueError("give exactly one of `url_ids` and `filter`")
        return self


class PageTierSet(PageSelection):
    tier_id: UUID | None = Field(description="null sets the pages to Untiered by hand.")


class BulkResult(BaseModel):
    matched: int = Field(description="Pages of the latest crawl the selection named.")
    changed: int


class BulkResponse(BaseModel):
    data: BulkResult


class TierImportRequest(Body):
    csv: Annotated[str, StringConstraints(min_length=1, max_length=CSV_MAX)] = Field(
        description="Columns `url` and `tier` (a code such as T1, a name, or `none`)."
    )


class ImportPending(BaseModel):
    line: int
    url: str


class ImportProblem(BaseModel):
    line: int
    code: Literal["invalid_url", "other_site", "unknown_tier", "missing_column", "too_many_rows"]
    message: str


class TierImportResult(BaseModel):
    accepted: int
    pending: list[ImportPending] = Field(
        description="Valid rows whose URL the latest crawl did not find; they apply when a "
        "crawl finds it."
    )
    errors: list[ImportProblem]
    applied: bool = Field(description="False while `errors` is not empty: nothing was changed.")


class TierImportResponse(BaseModel):
    data: TierImportResult


MatchTypeName = Literal["exact", "prefix", "pattern"]
RuleValue = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
RulePosition = Annotated[int, Field(ge=1, le=500)]


class TierRuleView(BaseModel):
    rule_id: UUID
    position: int
    match_type: MatchTypeName
    value: str
    tier: TierRef
    created_at: datetime


class TierRuleList(BaseModel):
    data: list[TierRuleView]


class TierRuleResponse(BaseModel):
    data: TierRuleView


class TierRuleCreate(Body):
    match_type: MatchTypeName
    value: RuleValue
    tier_id: UUID
    position: RulePosition | None = Field(default=None, description="Left out, the rule goes last.")


class TierRulePatch(Patch):
    match_type: MatchTypeName | None = None
    value: RuleValue | None = None
    tier_id: UUID | None = None
    position: RulePosition | None = None

    _not_null = field_validator("match_type", "value", "tier_id", "position")(refuse_null)

    @model_validator(mode="after")
    def _says_something(self) -> TierRulePatch:
        if not self.model_fields_set:
            raise ValueError("give at least one member")
        return self


class TierRulePreviewRequest(Body):
    match_type: MatchTypeName
    value: RuleValue
    position: RulePosition | None = None
    rule_id: UUID | None = Field(default=None, description="The rule being edited, if any.")


class TierRulePreview(BaseModel):
    matching_pages: int = Field(description="Pages of the latest crawl whose path matches.")
    would_apply: int = Field(
        description="Of those, the pages with no manual tier that no earlier rule claims."
    )


class TierRulePreviewResponse(BaseModel):
    data: TierRulePreview


class PageTagChange(PageSelection):
    add: Annotated[list[UUID], Field(max_length=TERMS_MAX)]
    remove: Annotated[list[UUID], Field(max_length=TERMS_MAX)]


class TagChangeResult(BaseModel):
    matched: int
    added: int
    removed: int


class TagChangeResponse(BaseModel):
    data: TagChangeResult
