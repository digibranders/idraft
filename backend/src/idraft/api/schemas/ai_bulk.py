"""Bodies and answers of the bulk prompt actions (plan D2): Run now for many prompts as one
manual run, and archiving or bringing back many prompts at once."""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from idraft.api.schemas.common import Body
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
