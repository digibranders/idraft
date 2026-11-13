"""Bodies of the AI routes (docs/19-api-specification.md section 3.7, cut to slice 1 as spec
2026-11-11 section 4.5 says). This plan defines the prompt and engine models; plan B adds the
answer and summary models.

Slice 1 leaves out what it does not build: panels, keyword links, personas, context preambles,
versions after the first, and the Idempotency-Key header (the "As built" notes of doc 19
sections 3.7.1 and 3.7.4).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Final, Literal
from uuid import UUID

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    Discriminator,
    Field,
    GetCoreSchemaHandler,
    StringConstraints,
    Tag,
    field_validator,
    model_validator,
)
from pydantic.json_schema import SkipJsonSchema
from pydantic_core import PydanticCustomError, core_schema

from idraft.ai.text import normalize
from idraft.api.pagination import CursorPageInfo
from idraft.api.schemas.common import (
    BATCH_TAG,
    ONE_TAG,
    Body,
    LanguageCode,
    Patch,
    UserRef,
    body_shape,
    printable,
    refuse_null,
)
from idraft.api.schemas.entities import EntityRef
from idraft.api.schemas.keywords import FunnelStage, Intent, LocationId
from idraft.api.schemas.metrics import MetricWindow, Usd
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
LintRule = Literal[
    "contains_brand_alias",
    "engine_limit",
    # Contract C1 (prompt-dialogs section 16): not returned yet.
    "word_count",
    "multiple_questions",
    "leading_wording",
    "language_mismatch",
    "contains_competitor_alias",
]
LintSeverity = Literal["info", "warning", "error"]
PromptSort = Literal[
    "text",
    "-text",
    "importance",
    "-importance",
    "created_at",
    "-created_at",
    "updated_at",
    "-updated_at",
]
# What a caller may say a prompt came from when it adds one (prompt-dialogs N07). The column
# holds more values (migration 0018), which only the server sets.
PromptSource = Literal["manual", "csv_import", "seo_keyword", "paa", "gsc_query"]
CreateMethod = Literal["human", "template", "imported"]
# The templates of `POST {P}/prompts/from-keywords/preview` (docs/19 section 3.7.1).
GeneratedTemplate = Literal["recommendation", "comparison", "how_to", "procurement"]
_NOT_BUILT = "Not built yet: `501 not_implemented`."
_NOT_RETURNED = "Not returned yet: absent from every response until it is built."

BULK_CREATE_MAX: Final = 1000
LINT_MAX: Final = 1000
TERMS_MAX: Final = 20
LOCATIONS_MAX: Final = 50
IMMUTABLE_FIELDS: Final = ("text", "language_code", "country_iso")
# A character decomposes into at most four, so a text up to four times the limit may still
# compose under it; anything longer cannot, and is not composed at all.
_RAW_TEXT_MAX: Final = 4 * PROMPT_TEXT_MAX


def _absent(value: object) -> bool:
    """A block nobody asked for is left out of the answer, not sent as null."""
    return value is None


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


class GeneratedFrom(Body):
    tracked_keyword_id: UUID
    template: GeneratedTemplate


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
    is_branded: bool | None = Field(
        default=None,
        description="Overrides the branded flag computed from the own aliases. " + _NOT_BUILT,
    )
    source: PromptSource | None = Field(
        default=None, description="Where the prompt came from; left out: `manual`. " + _NOT_BUILT
    )
    creation_method: CreateMethod | None = Field(
        default=None, description="How it was written; left out: `human`. " + _NOT_BUILT
    )
    generated_from: GeneratedFrom | None = Field(
        default=None,
        description="The tracked keyword and template it was generated from. " + _NOT_BUILT,
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
    prompt_type_source: Literal["rule", "person"] | None = Field(
        default=None, exclude_if=_absent, description=_NOT_RETURNED
    )
    importance: int
    is_branded: bool = Field(
        description="Names an own brand: computed from the project's own aliases when the "
        "prompt is saved; a change may set it."
    )
    is_branded_source: Literal["computed", "override"] | None = Field(
        default=None, exclude_if=_absent, description=_NOT_RETURNED
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
    language_code: LanguageCode | None = Field(
        default=None,
        description="The language the texts should be in, for `language_mismatch`. " + _NOT_BUILT,
    )


class PromptLintItem(Body):
    text: LintText
    language_code: LanguageCode
    country_iso: CountryIso


class PromptLintItems(Body):
    """Texts with their language and country, so the lint can say which are tracked already."""

    items: Annotated[list[PromptLintItem], Field(min_length=1, max_length=LINT_MAX)]
    engine_codes: Annotated[list[EngineCode], Field(min_length=1)] | None = Field(
        default=None, description="The engines whose length limits apply. Left out: every one."
    )


# `texts` or `items`: the shape sent is the one validated. `items`: not built yet (`501`).
PromptLintBody = Annotated[
    Annotated[PromptLintRequest, Tag(ONE_TAG)] | Annotated[PromptLintItems, Tag(BATCH_TAG)],
    Discriminator(body_shape),
]


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


class LintTracked(BaseModel):
    prompt_id: UUID
    is_active: bool


class LintNearDuplicate(BaseModel):
    prompt_id: UUID
    text: str


class PromptLint(BaseModel):
    text: str = Field(description="As it would be saved.")
    is_branded: bool
    matched_aliases: list[MatchedAlias] = Field(description="Own brand names found, each once.")
    warnings: list[LintWarning]
    tracked: LintTracked | None = Field(
        default=None,
        exclude_if=_absent,
        description="The project's prompt with this identity, archived ones too (with `items`). "
        + _NOT_RETURNED,
    )
    near_duplicate_of: LintNearDuplicate | None = Field(
        default=None,
        exclude_if=_absent,
        description="A prompt that differs only in case and spacing. " + _NOT_RETURNED,
    )
    suggested_prompt_type: PromptType | None = Field(
        default=None,
        exclude_if=_absent,
        description="The type the server rule gives the text. " + _NOT_RETURNED,
    )


class PromptQuota(BaseModel):
    limit: int
    used: int = Field(description="Active prompts in the whole workspace.")
    would_create: int | None = Field(
        default=None,
        exclude_if=_absent,
        description="Of the items, those neither tracked nor repeated. " + _NOT_RETURNED,
    )


class EngineEstimate(BaseModel):
    engine_code: EngineCode
    prompts_fit: int = Field(description="Prompts it would create that the engine takes.")
    answers_per_month: int
    monthly_cost_usd: Usd | None = Field(description="Null when the price book has no price.")
    run_now_answers: int
    run_now_cost_usd: Usd | None


class LintEstimate(BaseModel):
    """What the prompts that would be created cost on the standard queue (prompt-dialogs N05)."""

    engines: list[EngineEstimate]
    total_monthly_cost_usd: Usd | None


class PromptLintResponse(BaseModel):
    data: list[PromptLint]
    quota: PromptQuota
    estimate: LintEstimate | None = Field(
        default=None, exclude_if=_absent, description=_NOT_RETURNED
    )


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


AnswerStatus = Literal["complete", "partial", "empty", "refused", "error"]
# The cross product of own mentioned and own domain cited, never collapsed (doc 04 section 8.5).
Outcome = Literal["mentioned_and_cited", "mentioned_only", "cited_only", "neither"]


class ObservationFacts(BaseModel):
    """The fact row of the current derivation."""

    derivation_id: int
    is_valid: bool
    # Null for an answer that is not valid (a refusal, an empty or a failed answer): it is not
    # in any bucket, and `filter[outcome_in]` leaves it out.
    outcome: Outcome | None
    own_mentioned: bool
    own_domain_cited: bool
    own_mention_order: int | None
    own_prominence: float | None
    own_citation_count: int
    total_citation_count: int
    tracked_entities_mentioned: int
    competitor_mentions: list[UUID]
    competitor_cited: list[UUID]
    had_structured_list: bool


class PromptSubject(BaseModel):
    type: Literal["prompt"]
    prompt_id: UUID
    prompt_version_id: UUID
    version_no: int


class ObservationSummary(BaseModel):
    # A 64-bit id, as a string: JavaScript numbers lose precision past 2^53.
    observation_id: str
    observed_at: datetime
    observed_date: date
    engine_code: str
    observation_class: str
    subject: PromptSubject
    query_text: str
    run_id: UUID | None
    replicate_index: int
    location_id: int | None
    language_code: str | None
    device: str | None
    status: AnswerStatus
    model_reported: str | None
    answer_char_count: int | None
    citation_count: int
    fanout_count: int
    served_from_cache: bool
    # Null before extraction or without a current derivation.
    facts: ObservationFacts | None


class ObservationPage(BaseModel):
    data: list[ObservationSummary]
    page: CursorPageInfo


class CitationOut(BaseModel):
    citation_index: int
    # The link to follow.
    url: str
    # As the provider gave it: evidence, not a link, and no scheme is checked.
    raw_url: str
    host: str
    title: str | None
    source_name: str | None
    citation_kind: str
    domain_role: Literal["own", "competitor", "third_party"]
    role_entity_id: UUID | None
    occurrences: int
    first_char_offset: int | None
    answer_block_index: int | None
    referral_tag: str | None
    flags: list[str]


class MentionOut(BaseModel):
    entity_id: UUID
    name: str
    role: Literal["own", "competitor", "watch", "untracked"]
    mention_count: int
    first_char_offset: int
    # Null for an uncertain mention, a watched entity or a product counted as its brand: only
    # the accepted mentions of own and competitor entities are numbered (migration 0019).
    mention_order: int | None
    match_method: str
    mention_status: Literal["accepted", "uncertain"]
    confidence: float
    # Half-open [start, end) ranges in `answer_text`.
    evidence_spans: list[tuple[int, int]]


class ObservationDetail(ObservationSummary):
    answer_text: str | None
    error_code: str | None
    # The provider's page to check the answer by; only an http or https address is given.
    check_url: str | None
    offsets_unit: Literal["utf16"]
    citations: list[CitationOut]
    mentions: list[MentionOut]


class ObservationResponse(BaseModel):
    data: ObservationDetail


class Pooled(BaseModel):
    """The raw counts behind a prompt weighted rate: "2 of 5 answers"."""

    successes: int
    trials: int


class MetricCell(BaseModel):
    """One count of answers over another, with every answer of the cell: "5 of 8". The
    compact form of `MetricValue` (docs/19 section 2.6); the window is the response's, and
    `metric_context` says how each kind of cell is aggregated.

    In a row of one prompt `numerator` and `denominator` are counts of answers. In a topic row,
    a prompt weighted cell has the sum of its prompts' rates as `numerator` and the number of
    prompts with a valid answer as `denominator` (`pooled` holds the counts of answers); Share
    of voice stays counts of answers."""

    value: float | None = Field(description="numerator / denominator; null when it is 0.")
    numerator: float
    denominator: int
    n_observations: int = Field(description="Every answer of the cell, valid or not.")
    pooled: Pooled | None = Field(
        default=None, description="Set on a prompt weighted cell: the answers behind it."
    )


SummaryInclude = Literal["series", "entities", "total", "co_mentions", "cells"]
SummaryCompare = Literal["none", "previous_period", "previous_year"]
SummaryRows = Literal["topics", "none"]


def _refuse_language(value: object) -> object:
    """BE-METRICS-22 names a language breakdown that C2 does not have: refuse `language` with
    that reason, where any other unknown value gets the plain "input should be"."""
    if value == "language":
        raise PydanticCustomError(
            "not_built",
            "`group_by=language` is not built: the language half of the breakdown (BE-METRICS-22) "
            "is not in contract C2, which has `country` alone.",
        )
    return value


SummaryGroupBy = Annotated[Literal["country"], BeforeValidator(_refuse_language)]
OPPORTUNITY_PATTERN = (
    r"^(named_not_cited|cited_not_named|nobody_named"
    r"|lost_to:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$"
)


class OutcomeCells(BaseModel):
    mentioned_and_cited: MetricCell
    mentioned_only: MetricCell
    cited_only: MetricCell
    neither: MetricCell


class _NotAsked:
    """The default of `previous`, which tells "compare was not asked" (the key is left out)
    from None, "asked, and the window has no answer" (the key is null): the contract keeps
    them apart (C2 change log, C-2). Only `NOT_ASKED` is ever an instance."""

    @classmethod
    def __get_pydantic_core_schema__(
        cls, source: type[object], handler: GetCoreSchemaHandler
    ) -> core_schema.CoreSchema:
        # Serialized as null, which is how its default reads in the JSON schema.
        return core_schema.is_instance_schema(
            cls, serialization=core_schema.plain_serializer_function_ser_schema(lambda _: None)
        )


NOT_ASKED: Final = _NotAsked()


def _not_asked(value: object) -> bool:
    return value is NOT_ASKED


class EngineCells(BaseModel):
    """The cells of one engine over the comparison window, weighted as the current ones."""

    mentioned: MetricCell
    cited: MetricCell
    outcomes: OutcomeCells
    share_of_voice: MetricCell


class EntityPreviousCells(BaseModel):
    mentioned: MetricCell
    share_of_voice: MetricCell


class EntityCells(BaseModel):
    """One tracked entity's cells, weighted as the engine's: in a topic row Mentioned is prompt
    weighted, Share of voice one answer one weight. The shares of all the entities an answer
    names add up to 1; the cells shown may hold fewer (at most 20, and an entity no longer
    tracked has none)."""

    entity_id: UUID
    mentioned: MetricCell = Field(
        description="Valid answers whose share of voice set names the entity."
    )
    share_of_voice: MetricCell = Field(
        description="The entity's share of each answer that names a tracked entity: 1 / the "
        "tracked entities the answer names."
    )
    previous: EntityPreviousCells | SkipJsonSchema[_NotAsked] | None = Field(
        default=NOT_ASKED,
        exclude_if=_not_asked,
        json_schema_extra={"default": None},
        description="With a compare window and `include=entities`: Mentioned and Share of voice "
        "over `compare_window`. Null exactly when the engine's `previous` is null, that is, when "
        "none of the row's prompts has an answer of the engine there; otherwise cells, an "
        "entity not named in the valid answers being 0 of their number. Never set inside a week. "
        "Left out when no compare window was asked for.",
    )


class EngineDetailCells(BaseModel):
    """The small cells of one engine over the window (contract C2, change log C-9): each is a
    count of answers over another, with `value` null when the denominator is 0. In a topic, total
    or country row the three rates are prompt weighted (`pooled` holds the answers) and the
    share and the mean are sums over sums."""

    cited_given_citations: MetricCell = Field(
        description="Valid answers that cite the own domain over valid answers with at least "
        "one citation (docs/16 A2 variant)."
    )
    citation_share: MetricCell = Field(
        description="The own domain's citation units over all the citation units of the valid "
        "answers (docs/16 A8): a unit is a distinct canonical URL of an answer."
    )
    first_mention: MetricCell = Field(
        description="Valid answers that name the own brand before any other tracked entity over "
        "valid answers that name it (docs/16 A12)."
    )
    fanout_presence: MetricCell | None = Field(
        description="Valid answers with at least one fan-out query over valid answers (docs/16 "
        "F1). Null on an engine that does not expose fan-out, never a rate of 0."
    )
    fanout_mean: MetricCell | None = Field(
        description="Fan-out queries over the valid answers that have some (docs/16 F2). Null on "
        "an engine that does not expose fan-out, never 0."
    )


class PointPool(BaseModel):
    """What a pooled point holds: the answers of its own week and of the weeks before it, inside
    the window (contract C2, change log C-11)."""

    weeks: int = Field(
        description="The weeks pooled, 1 to 4: fewer than 4 when the window opens inside the "
        "four weeks before the point."
    )
    window: MetricWindow = Field(
        description="The first and last day the pool covers, never outside the response's `window`."
    )
    reason: Literal["prompt_point", "few_prompts"] = Field(
        description="`prompt_point`: the point is of a prompt row, which always pools. "
        "`few_prompts`: the point is of a topic, total or country row and fewer than "
        "`below_prompts` of its prompts answered that week."
    )
    below_prompts: int = Field(
        description="The number of prompts under which a topic, total or country point pools."
    )


class WeekCells(BaseModel):
    """One point of a series, for the week starting `week_start`. It holds the answers of that
    week alone when `is_pooled` is false (a topic, total or country row with enough prompts
    answering). Otherwise it holds the trailing four weeks to that week, inside the window, and
    `pool` says which days (a prompt row always pools: one prompt answers once or twice a week).
    A pooled prompt cell is answers over answers. A pooled topic, total or country cell sums
    each prompt's counts over the pooled weeks first and is then prompt weighted, as the window
    cell is. The points of a prompt row therefore do not add up to its window cell. Weeks before
    the window are never read, so the first points of a window pool fewer weeks."""

    week_start: date = Field(description="The Monday the week starts on, in the project's zone.")
    prompts: int = Field(
        description="The prompts of the row with a valid answer on the engine in that week "
        "alone, whether the point is pooled or not."
    )
    is_pooled: bool = Field(description="Whether the cells hold more than the week's own answers.")
    pool: PointPool | None = Field(
        default=None,
        exclude_if=_absent,
        description="Present exactly when `is_pooled`: the weeks and days the cells hold, and why.",
    )
    mentioned: MetricCell
    cited: MetricCell
    share_of_voice: MetricCell
    entities: list[EntityCells] | None = Field(
        default=None,
        exclude_if=_absent,
        description="With `include=series,entities`: the cells of each tracked entity of the "
        "engine's `entities` (the own ones first, at most 20) over the weeks the point holds: "
        "its own week, or, when `is_pooled`, the weeks of `pool`. Weighted as the point's own "
        "cells are: Mentioned prompt weighted in a topic, total or country row. Has no "
        "`previous`. Left out otherwise.",
    )


class EngineSummary(BaseModel):
    engine_code: str
    mentioned: MetricCell
    cited: MetricCell
    outcomes: OutcomeCells
    share_of_voice: MetricCell
    previous: EngineCells | SkipJsonSchema[_NotAsked] | None = Field(
        default=NOT_ASKED,
        exclude_if=_not_asked,
        json_schema_extra={"default": None},
        description="With a compare window: the same cells over `compare_window`. Null when none "
        "of the row's prompts has an answer of any status on the engine there (no data is not a "
        "rate of 0); with answers but no valid one, cells with a denominator of 0 and no value. "
        "Left out when no compare window was asked for.",
    )
    series: list[WeekCells] | None = Field(
        default=None,
        exclude_if=_absent,
        description="With `include=series`: a point for each week the window touches, oldest "
        "first, at most 14; a week without answers has counts of 0. The first and last weeks "
        "may be partial (cut at the window bounds). The points of a prompt row are always "
        "pooled over the trailing four weeks; those of a topic, total or country row are when "
        "fewer than 10 of its prompts answered that week (`is_pooled`, `pool`). A pool stays "
        "inside the window. Left out otherwise.",
    )
    entities: list[EntityCells] | None = Field(
        default=None,
        exclude_if=_absent,
        description="With `include=entities`: a cell for each tracked entity of `entities`, "
        "the own ones first, then competitors by name, at most 20. Left out otherwise.",
    )
    detail: EngineDetailCells | None = Field(
        default=None,
        exclude_if=_absent,
        description="With `include=cells`: the small cells of the engine over the window, "
        "weighted as the row's cells are. Never in `previous` or in a week. Left out otherwise.",
    )


_LAST_OBSERVED = (
    "The newest answer counted in the window (current, not superseded), of any status, on the "
    "engines shown; null when there is none."
)
_LAST_VALID = "The newest valid answer counted in the window, on the engines shown; null if none."


class PromptSummaryRow(BaseModel):
    prompt_id: UUID
    text: str
    is_branded: bool
    topic_term_ids: list[UUID]
    last_observed_at: datetime | None = Field(description=_LAST_OBSERVED)
    last_valid_at: datetime | None = Field(description=_LAST_VALID)
    engines: list[EngineSummary]


class TopicSummaryRow(BaseModel):
    # Null for the prompts without a topic.
    term_id: UUID | None
    name: str | None
    prompt_count: int
    last_observed_at: datetime | None = Field(description=_LAST_OBSERVED)
    last_valid_at: datetime | None = Field(description=_LAST_VALID)
    engines: list[EngineSummary]


class SummaryTotal(BaseModel):
    """Every prompt in scope as one row, aggregated as a topic row is (OV-N1)."""

    prompt_count: int = Field(description="The prompts in scope, whatever the engines shown.")
    last_observed_at: datetime | None = Field(description=_LAST_OBSERVED)
    last_valid_at: datetime | None = Field(description=_LAST_VALID)
    engines: list[EngineSummary]


class CoMentionPair(BaseModel):
    a: UUID = Field(description="A tracked entity.")
    b: UUID = Field(description="Another tracked entity.")
    answers: int = Field(description="Valid answers in scope that name both.")


class EngineCoMentions(BaseModel):
    engine_code: str
    answers: int = Field(description="Valid answers in scope on the engine: the denominator.")
    pairs: list[CoMentionPair]


class CountrySummary(BaseModel):
    country_iso: str
    engines: list[EngineSummary]


class SummaryEntity(BaseModel):
    entity_id: UUID
    name: str
    role: Literal["own", "competitor"]


Aggregation = Literal["observation_weighted", "prompt_weighted"]


class MetricContext(BaseModel):
    """What is true of every cell of one metric in the response (docs/19 section 2.6 rule 10)."""

    metric: str = Field(description="The registry key of docs/16 section 2.1.")
    prompt_rows: Aggregation = Field(description="How the cells of a prompt row are weighted.")
    topic_rows: Aggregation = Field(description="How the cells of a topic row are weighted.")
    method: str


class SummaryDetailContext(BaseModel):
    """What is true of every cell of `EngineSummary.detail` in the response."""

    cited_given_citations: MetricContext
    citation_share: MetricContext
    first_mention: MetricContext
    fanout_presence: MetricContext
    fanout_mean: MetricContext


class SummaryMetricContext(BaseModel):
    mentioned: MetricContext
    cited: MetricContext
    outcomes: MetricContext
    share_of_voice: MetricContext
    detail: SummaryDetailContext | None = Field(
        default=None,
        exclude_if=_absent,
        description="With `include=cells`: how the cells of `detail` are weighted. Left out "
        "otherwise.",
    )


class PromptsSummary(BaseModel):
    window: MetricWindow
    compare_window: MetricWindow | None = Field(
        default=None,
        exclude_if=_absent,
        description="With a compare window (`compare`, or `compare_from` and `compare_to`): the "
        "days compared with. The window before `window`, as many days, for `previous_period`; "
        "the same dates a year earlier for `previous_year`; the two dates given, which win over "
        "`compare`.",
    )
    previous_answers: int | None = Field(
        default=None,
        exclude_if=_absent,
        description="With a compare window: the valid answers in scope in that window, on the "
        "engines shown; 0 means it has no data.",
    )
    include_branded: bool = Field(
        description="Branded prompts are counted: `include_branded` or `branded_only` was set."
    )
    branded_only: bool = Field(description="Only branded prompts are counted.")
    engine_codes: list[str]
    metric_context: SummaryMetricContext
    entities: list[SummaryEntity] = Field(
        description="The tracked entity set Share of voice is computed over now: the own brand "
        "and the competitors (watched entities are not in it)."
    )
    entity_config_versions: list[int] = Field(
        description="The entity configuration versions of the answers counted. More than one "
        "means the entity set changed inside the window and older answers keep their set."
    )
    prompts: list[PromptSummaryRow]
    topics: list[TopicSummaryRow]
    total: SummaryTotal | None = Field(
        default=None,
        exclude_if=_absent,
        description="With `include=total`: every prompt in scope as one row, aggregated as a "
        "topic row is, and carrying the blocks the rows carry when asked. It does not depend on "
        "`rows`. Left out otherwise.",
    )
    co_mentions: list[EngineCoMentions] | None = Field(
        default=None,
        exclude_if=_absent,
        description="With `include=co_mentions`: one entry per engine shown, with how often two "
        "tracked entities are named in one valid answer. It does not depend on `rows`. Left out "
        "otherwise.",
    )
    by_country: list[CountrySummary] | None = Field(
        default=None,
        exclude_if=_absent,
        description="With `group_by=country`: one entry per market (`country_iso`) of the prompts "
        "in scope, sorted by code, each with the engines built as a topic row of those prompts "
        "(the same blocks the rows carry when asked). The market is the prompt's, not the "
        "location of its answers; a prompt without a market is in no entry, and a market with "
        "prompts and no answer has an entry of zero cells. `filter[country_iso]` leaves that one "
        "entry. It does not depend on `rows`. Left out otherwise.",
    )


class PromptsSummaryResponse(BaseModel):
    data: PromptsSummary
