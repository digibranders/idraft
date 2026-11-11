"""Bodies of the AI routes (docs/19-api-specification.md section 3.7, cut to slice 1 as spec
2026-11-11 section 4.5 says). This plan defines the prompt and engine models; plan B adds the
answer and summary models.

Slice 1 leaves out what it does not build: panels, keyword links, personas, context preambles,
versions after the first, and the Idempotency-Key header (the "As built" notes of doc 19
sections 3.7.1 and 3.7.4).
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Final, Literal
from uuid import UUID

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)
from pydantic.json_schema import SkipJsonSchema
from pydantic_core import PydanticCustomError

from idraft.ai.text import normalize
from idraft.api.pagination import CursorPageInfo
from idraft.api.schemas.common import Body, LanguageCode, Patch, UserRef, printable, refuse_null
from idraft.api.schemas.entities import EntityRef
from idraft.api.schemas.keywords import FunnelStage, Intent, LocationId
from idraft.api.schemas.metrics import Usd
from idraft.domain.ai_engines import PROMPT_TEXT_MAX, EngineCode, ObservationClass

PromptType = Literal[
    "question",
    "comparison",
    "recommendation",
    "how_to",
    "definition",
    "local",
    "transactional",
    "other",
]
ChangeKind = Literal["initial", "wording", "typo", "context"]
CreationMethod = Literal["human", "template", "llm_generated", "imported"]
LintRule = Literal["contains_brand_alias", "engine_limit"]
LintSeverity = Literal["info", "warning", "error"]

BULK_CREATE_MAX: Final = 1000
LINT_MAX: Final = 1000
TERMS_MAX: Final = 20
LOCATIONS_MAX: Final = 50
IMMUTABLE_FIELDS: Final = ("text", "language_code", "country_iso")
# A character decomposes into at most four, so a text up to four times the limit may still
# compose under it; anything longer cannot, and is not composed at all.
_RAW_TEXT_MAX: Final = 4 * PROMPT_TEXT_MAX


def _prompt_text(value: object) -> object:
    """Trimmed and composed before the limits are checked (`idraft.ai.text`), so "é" counts
    once however it was typed. Longer than any engine takes is `prompt_too_long` (docs/19
    section 3.7.1)."""
    if not isinstance(value, str):
        return value
    if len(value) > _RAW_TEXT_MAX or len(composed := normalize(value)) > PROMPT_TEXT_MAX:
        raise PydanticCustomError(
            "prompt_too_long",
            "A prompt has at most {max_length} characters.",
            {"max_length": PROMPT_TEXT_MAX},
        )
    return composed


def _lint_text(value: object) -> object:
    """As a prompt, but a text too long to save is linted (and told so), not refused."""
    if not isinstance(value, str):
        return value
    if len(value) > _RAW_TEXT_MAX:
        raise PydanticCustomError(
            "string_too_long",
            "String should have at most {max_length} characters",
            {"max_length": _RAW_TEXT_MAX},
        )
    return normalize(value)


# The constraints first, so they are the string's own and report as such; the validator below
# them still runs before they are checked (as `Email` in idraft.api.schemas.common).
PromptText = Annotated[
    str,
    StringConstraints(min_length=1, max_length=PROMPT_TEXT_MAX),
    BeforeValidator(_prompt_text),
    AfterValidator(printable),
]
LintText = Annotated[
    str,
    StringConstraints(min_length=1, max_length=_RAW_TEXT_MAX),
    BeforeValidator(_lint_text),
    AfterValidator(printable),
]
# ISO 3166-1 alpha-2, as `core.locations.country_iso` holds it.
CountryIso = Annotated[str, StringConstraints(pattern=r"^[A-Z]{2}$")]
Importance = Annotated[int, Field(ge=1, le=5)]
TermIds = Annotated[list[UUID], Field(max_length=TERMS_MAX)]


class PromptCreate(Body):
    """One prompt. Its text is fixed once saved: to change it, archive the prompt and add a new
    one."""

    text: PromptText = Field(description="Trimmed and composed (NFC); one line.")
    language_code: LanguageCode
    country_iso: CountryIso = Field(
        description="The market the prompt stands for. Every enabled engine needs a location "
        "in it (`location_not_supported` otherwise)."
    )
    intent: Intent = "unknown"
    funnel_stage: FunnelStage = "unknown"
    prompt_type: PromptType = "question"
    importance: Importance = 3
    term_ids: TermIds = Field(
        default_factory=list, description="Topics and other terms the project may use."
    )


class PromptBulkCreate(Body):
    items: Annotated[list[PromptCreate], Field(min_length=1, max_length=BULK_CREATE_MAX)]
    on_duplicate: Literal["skip", "error"] = Field(
        default="skip",
        description="A prompt the project has already: `skip` lists it in `skipped`, `error` "
        "in `rejected` with `duplicate`.",
    )


class PromptPatch(Patch):
    """At least one member. The text, language and country are fixed (`immutable_field`)."""

    intent: Intent | None = None
    funnel_stage: FunnelStage | None = None
    prompt_type: PromptType | None = None
    importance: Importance | None = None
    is_branded: bool | None = None
    is_active: bool | None = Field(
        default=None,
        description="`true` brings an archived prompt back; it counts against the quota.",
    )
    term_ids: TermIds | None = Field(default=None, description="Replaces the prompt's terms.")

    # Accepted only to be refused by name, so a client learns which field it was. Not in the
    # API document.
    text: SkipJsonSchema[object] = None
    language_code: SkipJsonSchema[object] = None
    country_iso: SkipJsonSchema[object] = None

    _not_null = field_validator(
        "intent", "funnel_stage", "prompt_type", "importance", "is_branded", "is_active", "term_ids"
    )(refuse_null)

    @field_validator(*IMMUTABLE_FIELDS, mode="before")
    @classmethod
    def _immutable(cls, value: object) -> object:
        raise PydanticCustomError(
            "immutable_field", "Fixed once saved: archive the prompt and add a new one."
        )

    @model_validator(mode="after")
    def _says_something(self) -> PromptPatch:
        if not self.model_fields_set:
            raise ValueError("give at least one field to change")
        return self


class PromptVersion(BaseModel):
    prompt_version_id: UUID
    version_no: int
    text: str = Field(description="Exactly what the engines receive.")
    text_hash: str = Field(description="sha256 of the text, hex.")
    change_kind: ChangeKind
    created_at: datetime


class PromptTerm(BaseModel):
    term_id: UUID
    vocabulary_kind: str
    name: str
    path: str


class Prompt(BaseModel):
    prompt_id: UUID
    current_version: PromptVersion
    language_code: str
    country_iso: str | None
    intent: Intent
    funnel_stage: FunnelStage
    prompt_type: PromptType
    importance: int
    is_branded: bool = Field(
        description="Names an own brand: computed from the project's own aliases when the "
        "prompt is saved; a change may set it."
    )
    source: str
    creation_method: CreationMethod
    is_active: bool
    terms: list[PromptTerm]
    created_by: UserRef | None
    created_at: datetime
    updated_at: datetime


class PromptResponse(BaseModel):
    data: Prompt


class PromptPage(BaseModel):
    data: list[Prompt]
    page: CursorPageInfo


class PromptSkipped(BaseModel):
    index: int
    existing_id: UUID


class PromptRejected(BaseModel):
    index: int
    code: str
    message: str


class PromptBulkResult(BaseModel):
    created: list[UUID]
    skipped: list[PromptSkipped]
    rejected: list[PromptRejected]


class PromptBulkResponse(BaseModel):
    data: PromptBulkResult


class PromptLintRequest(Body):
    texts: Annotated[list[LintText], Field(min_length=1, max_length=LINT_MAX)]
    engine_codes: Annotated[list[EngineCode], Field(min_length=1)] | None = Field(
        default=None, description="The engines whose length limits apply. Left out: every one."
    )


class LintSpan(BaseModel):
    start: int
    end: int


class LintWarning(BaseModel):
    rule: LintRule
    severity: LintSeverity
    message: str
    engine_code: EngineCode | None = Field(description="For `engine_limit`: the engine.")
    span: LintSpan | None = Field(
        description="UTF-16 code units, as a JavaScript string indexes the text."
    )


class MatchedAlias(BaseModel):
    entity: EntityRef
    alias: str = Field(description="The text that matched.")


class PromptLint(BaseModel):
    text: str = Field(description="As it would be saved.")
    is_branded: bool
    matched_aliases: list[MatchedAlias] = Field(description="Own brand names found, each once.")
    warnings: list[LintWarning]


class PromptQuota(BaseModel):
    limit: int
    used: int = Field(description="Active prompts in the whole workspace.")


class PromptLintResponse(BaseModel):
    data: list[PromptLint]
    quota: PromptQuota


class Engine(BaseModel):
    engine_code: EngineCode
    label: str
    observation_class: ObservationClass
    vendor: str
    exposes_citations: bool
    exposes_fanout: bool
    max_prompt_chars: int


class ProjectEngine(BaseModel):
    engine: Engine
    is_configured: bool = Field(description="The project has settings for the engine.")
    is_enabled: bool
    location_ids: list[int]
    replicates: int
    provider_code: str
    active_prompts: int = Field(
        description="Active prompts that fit the engine's length limit: what one run asks it."
    )
    estimated_monthly_cost_usd: Usd | None = Field(
        description="Active prompts x runs a week x 52 / 12 x the task price, as if the engine "
        "were on. Null when the price book has no price."
    )


class ProjectEngineList(BaseModel):
    data: list[ProjectEngine]


class ProjectEngineResponse(BaseModel):
    data: ProjectEngine


class EngineUpdate(Body):
    location_ids: Annotated[list[LocationId], Field(min_length=1, max_length=LOCATIONS_MAX)] = (
        Field(description="Active countries the engine runs the prompts in.")
    )
    is_enabled: bool = Field(
        default=True, description="On starts weekly spend; off keeps the settings."
    )


class RunNow(Body):
    """The engines to ask the prompt on now, each once, through the standard queue."""

    engine_codes: Annotated[list[EngineCode], Field(min_length=1, max_length=3)]
