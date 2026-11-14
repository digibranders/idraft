"""Request and response models of the AI coverage of a run and daily AI collection (WP-30
runs-costs-health; contracts C3 and N5)."""

from __future__ import annotations

from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from idraft.api.schemas.ai import MetricCell
from idraft.api.schemas.metrics import MetricWindow
from idraft.domain.ai_engines import EngineCode

ENGINES_MAX = 3  # one entry per engine
WINDOW_DAYS_MAX = 92  # the longest AI read window

# `ops.collection_tasks.status` (migration 0004).
TaskStatus = Literal[
    "pending",
    "submit_unknown",
    "submitted",
    "ready",
    "fetched",
    "ingested",
    "failed",
    "dead",
    "cancelled",
    "skipped_cached",
]


class InvalidByStatus(BaseModel):
    """The stored answers that are not valid. A partial answer counts as valid (doc 07 section
    5.5), so it is not here."""

    empty: int
    refused: int
    error: int


class AiCoverageEngine(BaseModel):
    engine_code: EngineCode
    planned: int = Field(description="Tasks the run planned on the engine.")
    observed: int = Field(
        description="Answers stored, of any status: `valid` plus `invalid_by_status`."
    )
    valid: int = Field(description="Answers stored with status `complete` or `partial`.")
    partial: int = Field(description="Of the valid answers, the ones flagged `partial`.")
    invalid_by_status: InvalidByStatus
    valid_rate: MetricCell = Field(description="`valid` of `planned`.")


class AiCoverageMissing(BaseModel):
    prompt_id: UUID
    engine_code: EngineCode
    location_id: int | None
    replicate_index: int
    task_status: TaskStatus


class AiCoverage(BaseModel):
    by_engine: list[AiCoverageEngine] = Field(max_length=ENGINES_MAX)
    missing: list[AiCoverageMissing] = Field(
        description="Every planned task with no stored answer, at most the run's tasks."
    )


class AiCoverageResponse(BaseModel):
    data: AiCoverage


class AnswerStatusCounts(BaseModel):
    complete: int
    partial: int
    empty: int
    refused: int
    error: int


class CollectionDay(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    date_: date = Field(alias="date", serialization_alias="date", description="A project day.")
    engine_code: EngineCode
    scheduled: int | None = Field(
        description="Answers the schedules active that day planned; null when unknown, never "
        "0 for unknown."
    )
    answers: int
    by_status: AnswerStatusCounts
    valid: int = Field(description="Answers with status `complete` or `partial`.")
    budget_blocked: int = Field(description="Runs of the day a budget blocked.")
    runs: list[UUID] = Field(description="The runs whose answers the day holds.")


class CollectionDailyMeta(BaseModel):
    window: MetricWindow
    engine_codes: list[EngineCode] = Field(max_length=ENGINES_MAX)


class CollectionDailyResponse(BaseModel):
    data: list[CollectionDay] = Field(
        max_length=WINDOW_DAYS_MAX * ENGINES_MAX, description="A row per day and engine."
    )
    meta: CollectionDailyMeta
