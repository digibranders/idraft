"""Request and response models of budgets, the forecast and unit costs (WP-30 runs-costs-health;
docs/19-api-specification.md section 3.11.2, docs/ai-visibility/contracts/budgets-costs.md).

`Budget` is the shape `GET {W}/budgets/status` already returns; the models here add the writes, the
page and the two cost reads. Money is a decimal string (`Usd`), and a figure that cannot be
computed is `null`, never 0.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Annotated, Final, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from idraft.api.pagination import OffsetPageInfo
from idraft.api.schemas.common import Body, Patch, refuse_null
from idraft.api.schemas.metrics import Usd
from idraft.api.schemas.operations import Budget
from idraft.domain.ai_engines import EngineCode

# What `ops.budgets.limit_usd` (numeric(14,2)) is allowed to hold in this API: a limit of 0 is
# valid and blocks every run.
LIMIT_USD_MAX: Final = Decimal("99999999999.99")

# A budget group (doc 04 section 11.4.1); `all` is stored as no group.
BudgetGroup = Literal[
    "seo_rank",
    "ai_prompt",
    "keyword_research",
    "ai_benchmark",
    "extraction_llm",
    "first_party",
    "all",
]
ActionOnHard = Literal["pause", "alert_only"]
LimitUsd = Annotated[Usd, Field(ge=0, le=LIMIT_USD_MAX, decimal_places=2)]
SoftLimitPct = Annotated[int, Field(ge=1, le=100)]


class BudgetCreate(Body):
    project_id: UUID | None = Field(
        default=None, description="Left out, the budget covers the whole workspace."
    )
    workload: BudgetGroup
    limit_usd: LimitUsd = Field(description="Per month, UTC. 0 blocks every run of the group.")
    soft_limit_pct: SoftLimitPct | None = Field(
        default=None, description="The soft share of the limit; 80 when left out."
    )
    action_on_hard: ActionOnHard | None = Field(
        default=None, description="What reaching the limit does; `pause` when left out."
    )


class BudgetUpdate(Patch):
    """At least one member; the scope and the group cannot change."""

    limit_usd: LimitUsd | None = None
    soft_limit_pct: SoftLimitPct | None = None
    action_on_hard: ActionOnHard | None = None

    _not_null = field_validator("limit_usd", "soft_limit_pct", "action_on_hard")(refuse_null)

    @model_validator(mode="after")
    def _says_something(self) -> BudgetUpdate:
        if not self.model_fields_set:
            raise ValueError("give at least one field to change")
        return self


class BudgetResponse(BaseModel):
    data: Budget


class BudgetPage(BaseModel):
    data: list[Budget] = Field(description="Oldest first.")
    page: OffsetPageInfo


class ForecastRow(BaseModel):
    project_id: UUID
    workload: Literal["ai_prompt"]
    estimated_cost_usd: Usd = Field(
        description="What the project's live schedules are expected to cost in the month."
    )
    method: Literal["price_book_x_schedules"]
    is_estimate: Literal[True]


class ForecastResponse(BaseModel):
    data: list[ForecastRow] = Field(
        description="A row per visible project with live AI schedules and a price; a project "
        "with no price is left out, not shown as 0."
    )


class UnitCostRow(BaseModel):
    project_id: UUID
    per_tracked_keyword_month: Usd | None = Field(
        description="Rank spend of the month per active tracked keyword; null with none."
    )
    per_serp_check: Usd | None = Field(
        description="Rank spend of the month per provider request; null with none."
    )
    per_active_prompt_month: Usd | None = Field(
        description="AI spend of the month per active prompt; null with none."
    )
    per_ai_observation: Usd | None = Field(
        description="Mean cost of the month's AI answers that have a cost; null with none."
    )
    extraction_llm_usd: Usd | None = Field(
        description="Extraction spend of the month; null when none was recorded."
    )
    per_engine: dict[EngineCode, Usd | None] = Field(
        description="`per_ai_observation` by engine; null for an engine with no costed answer."
    )
    ai_answers_by_engine: dict[EngineCode, int] = Field(
        description="The costed answers behind `per_engine`."
    )


class UnitCostResponse(BaseModel):
    data: list[UnitCostRow]
