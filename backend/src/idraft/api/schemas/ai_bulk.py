"""Bodies and answers of the bulk prompt actions (plan D2): Run now for many prompts as one
manual run, and archiving or bringing back many prompts at once."""

from __future__ import annotations

from typing import Annotated, Final, Literal
from uuid import UUID

from pydantic import BaseModel, Discriminator, Field, Tag, field_validator, model_validator
from pydantic_core import PydanticCustomError

from idraft.api.schemas.ai import CountryIso, Importance, PromptType, TermIds
from idraft.api.schemas.common import (
    BATCH_TAG,
    ONE_TAG,
    Body,
    LanguageCode,
    Patch,
    QueryText,
    refuse_null,
)
from idraft.api.schemas.keywords import FilterList, FunnelStage, Intent
from idraft.api.schemas.metrics import Usd
from idraft.api.schemas.operations import ManualRuns, Run
from idraft.domain.ai_engines import BASE_PLAN, EngineCode

SkipReason = Literal["prompt_too_long", "location_not_enabled", "check_pending", "prompt_pending"]


class RunBulk(Body):
    """The prompts to ask now, each once on each engine, through the standard queue. Without
    `engine_codes`, every engine the project has turned on."""

    prompt_ids: Annotated[list[UUID], Field(min_length=1, max_length=BASE_PLAN.max_prompts)] = (
        Field(description="Up to 150, the base plan's prompts; a repeat is dropped.")
    )
    engine_codes: Annotated[list[EngineCode], Field(min_length=1, max_length=3)] | None = None


class RunSkip(BaseModel):
    prompt_id: UUID
    engine_code: EngineCode
    reason: SkipReason


class RunBulkMeta(BaseModel):
    prompts: int = Field(description="Prompts the run asks.")
    answers: int = Field(
        description="Tasks the run makes, one answer each: what counts against the month's "
        "AI answers."
    )
    estimated_cost_usd: Usd = Field(
        description="The price book's estimate on the standard queue; the worker checks the "
        "budget against it when it plans the run."
    )
    skipped: list[RunSkip] = Field(description="Every prompt and engine left out, with why.")
    manual_runs_today: ManualRuns


class RunBulkResponse(BaseModel):
    data: Run
    meta: RunBulkMeta


# Prompts one bulk archive names; a workspace keeps archived prompts, so more than its 150.
BULK_ARCHIVE_MAX: Final = 1000


class PromptBulkArchive(Body):
    """The project's prompts to archive (`archive: true`) or bring back (`false`)."""

    ids: Annotated[list[UUID], Field(min_length=1, max_length=BULK_ARCHIVE_MAX)]
    archive: bool = Field(
        description="false brings the prompts back, within the active prompt quota."
    )


class PromptSelectionFilter(Body):
    """The list's filters as a body: the names of `GET {P}/prompts` without the brackets. A list
    holds 1 to 100 values. `is_active` left out takes archived and active prompts alike."""

    q: QueryText | None = None
    term: UUID | None = Field(default=None, description="The term or one under it.")
    intent_in: FilterList[Intent] | None = None
    funnel_stage_in: FilterList[FunnelStage] | None = None
    prompt_type_in: FilterList[PromptType] | None = None
    importance_in: FilterList[Importance] | None = None
    is_branded: bool | None = None
    country_iso: CountryIso | None = None
    language_code: LanguageCode | None = None
    is_active: bool | None = None


class PromptBulkArchiveByFilter(Body):
    """Every prompt of the project the filter matches, at most 1,000 (`422 too_many_subjects`)."""

    filter: PromptSelectionFilter
    archive: bool = Field(
        description="false brings the prompts back, within the active prompt quota."
    )


def _selection_shape(value: object) -> str:
    """`ONE_TAG` names the `ids` shape and `BATCH_TAG` the `filter` one. The tags only pick the
    model; the error mapper leaves them out of a path."""
    return BATCH_TAG if isinstance(value, dict) and "filter" in value else ONE_TAG


PromptBulkArchiveBody = Annotated[
    Annotated[PromptBulkArchive, Tag(ONE_TAG)]
    | Annotated[PromptBulkArchiveByFilter, Tag(BATCH_TAG)],
    Discriminator(_selection_shape),
]


class PromptBulkSet(Patch):
    """At least one member; none may be null."""

    intent: Intent | None = None
    funnel_stage: FunnelStage | None = None
    prompt_type: PromptType | None = None
    importance: Importance | None = None
    is_branded: bool | None = None

    _not_null = field_validator(
        "intent", "funnel_stage", "prompt_type", "importance", "is_branded"
    )(refuse_null)

    @model_validator(mode="after")
    def _says_something(self) -> PromptBulkSet:
        if not self.model_fields_set:
            raise ValueError("give at least one field to change")
        return self


class PromptBulkUpdate(Body):
    """Exactly one of `ids` and `filter`; at least one of `set`, `add_term_ids` and
    `remove_term_ids`."""

    ids: Annotated[list[UUID], Field(min_length=1, max_length=BULK_ARCHIVE_MAX)] | None = None
    filter: PromptSelectionFilter | None = None
    set: PromptBulkSet | None = None
    add_term_ids: TermIds = Field(default_factory=list)
    remove_term_ids: TermIds = Field(default_factory=list)

    @model_validator(mode="after")
    def _one_way_and_something(self) -> PromptBulkUpdate:
        if (self.ids is None) == (self.filter is None):
            raise ValueError("give exactly one of `ids` and `filter`")
        if self.set is None and not self.add_term_ids and not self.remove_term_ids:
            raise PydanticCustomError("nothing_to_change", "Give `set`, or terms to add or remove.")
        if set(self.add_term_ids) & set(self.remove_term_ids):
            raise PydanticCustomError(
                "added_and_removed", "A term is either added or removed, not both."
            )
        return self


class PromptBulkUpdateResult(BaseModel):
    matched: int = Field(description="The project's prompts found.")
    updated: int = Field(description="Of those, the prompts that changed.")


class PromptBulkUpdateResponse(BaseModel):
    data: PromptBulkUpdateResult
