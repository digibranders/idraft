"""Bodies of the operations routes (docs/19-api-specification.md sections 3.3 settings, 3.11.1
to 3.11.4): schedules, runs, costs, budget status, the price book and project settings."""

from __future__ import annotations

from datetime import date, datetime, time
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    AfterValidator,
    BaseModel,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from sightline.api.pagination import CursorPageInfo, OffsetPageInfo
from sightline.api.schemas.common import Body, Patch, printable, refuse_null
from sightline.api.schemas.keywords import DepthProfile
from sightline.api.schemas.metrics import Usd
from sightline.api.timezones import Timezone

Workload = Literal[
    "seo_rank",
    "ai_prompt",
    "ai_mode_keyword",
    "keyword_metrics",
    "discovery",
    "ai_benchmark",
    "gsc_sync",
    "bing_sync",
    "ga4_sync",
    "cloudflare_sync",
]
Cadence = Literal["daily", "weekly", "monthly", "cron"]
SchedulePriority = Literal["high", "standard", "low"]
ProviderMode = Literal["standard_queue", "priority_queue", "live"]


def _local_minute(value: time) -> time:
    """A wall-clock `HH:MM` in the schedule's zone: no offset of its own, no seconds."""
    if value.tzinfo is not None:
        raise ValueError("a local time, without an offset: the schedule's zone gives it")
    if value.second or value.microsecond:
        raise ValueError("hours and minutes only")
    return value


LocalMinute = Annotated[time, AfterValidator(_local_minute)]
ScheduleName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
    AfterValidator(printable),
]


class Selector(Body):
    """Which subjects a schedule collects. `keyword_metrics` takes `stale_days`, `all`,
    `groups` and `terms`; `seo_rank` takes `all`, `groups`, `terms` and `priority_lte`."""

    all: Literal[True] | None = None
    groups: Annotated[list[UUID], Field(max_length=100)] | None = None
    terms: Annotated[list[UUID], Field(max_length=100)] | None = None
    priority_lte: Annotated[int, Field(ge=1, le=5)] | None = None
    stale_days: Annotated[int, Field(ge=0, le=365)] | None = None


class ScheduleInput(Body):
    workload: Workload
    name: ScheduleName
    cadence: Cadence
    cron_expr: Annotated[str, StringConstraints(max_length=100)] | None = None
    timezone: Timezone
    window_start_local: LocalMinute = Field(description="Local `HH:MM`.")
    window_hours: Annotated[int, Field(ge=1, le=24)] = 6
    weekday: Annotated[int, Field(ge=0, le=6)] | None = Field(
        default=None, description="Weekly cadence: 0 is Sunday."
    )
    month_day: Annotated[int, Field(ge=1, le=28)] | None = Field(
        default=None, description="Monthly cadence: 1 to 28, so every month has the day."
    )
    priority: SchedulePriority = "standard"
    provider_mode: ProviderMode | None = Field(
        default=None,
        description="Left out: `live` for `keyword_metrics`, `standard_queue` for `seo_rank`.",
    )
    selector: Selector = Field(default_factory=Selector)

    @model_validator(mode="after")
    def _named_day(self) -> ScheduleInput:
        if (self.cadence == "weekly") != (self.weekday is not None):
            raise ValueError("`weekday` is given exactly when the cadence is weekly")
        if (self.cadence == "monthly") != (self.month_day is not None):
            raise ValueError("`month_day` is given exactly when the cadence is monthly")
        return self


class ScheduleUpdate(Patch):
    """At least one member; `next_run_at` is computed again."""

    name: ScheduleName | None = None
    timezone: Timezone | None = None
    window_start_local: LocalMinute | None = None
    window_hours: Annotated[int, Field(ge=1, le=24)] | None = None
    weekday: Annotated[int, Field(ge=0, le=6)] | None = None
    month_day: Annotated[int, Field(ge=1, le=28)] | None = None
    cadence: Cadence | None = None
    priority: SchedulePriority | None = None
    provider_mode: ProviderMode | None = None
    selector: Selector | None = None

    nullable = frozenset({"weekday", "month_day"})
    _not_null = field_validator(
        "name",
        "timezone",
        "window_start_local",
        "window_hours",
        "cadence",
        "priority",
        "provider_mode",
        "selector",
    )(refuse_null)

    @model_validator(mode="after")
    def _says_something(self) -> ScheduleUpdate:
        if not self.model_fields_set:
            raise ValueError("give at least one field to change")
        return self


class Schedule(BaseModel):
    schedule_id: UUID
    project_id: UUID
    workload: Workload
    name: str
    cadence: Cadence
    cron_expr: str | None
    timezone: str
    window_start_local: time
    window_hours: int
    weekday: int | None
    month_day: int | None
    priority: SchedulePriority
    provider_mode: ProviderMode
    selector: Selector
    is_active: bool
    next_run_at: datetime
    last_run_id: UUID | None
    created_at: datetime


class ScheduleResponse(BaseModel):
    data: Schedule


class SchedulePage(BaseModel):
    data: list[Schedule]
    page: OffsetPageInfo


class SchedulePause(Body):
    reason: Annotated[str, StringConstraints(max_length=500)] | None = None


# Runs (docs/19 section 3.11.4).

RunStatus = Literal[
    "planned",
    "running",
    "completed",
    "completed_with_errors",
    "failed",
    "cancelled",
    "budget_blocked",
]
Trigger = Literal["schedule", "manual", "backfill", "retry"]


class Actor(BaseModel):
    actor_type: Literal["user", "api_key", "system"]
    actor_id: str
    label: str


class Progress(BaseModel):
    done: int
    total: int | None
    unit: Literal["tasks", "rows", "observations", "days", "items"]


class OperationError(BaseModel):
    code: str
    detail: str


class OperationLinks(BaseModel):
    self: str
    result: str | None = None
    cancel: str | None = None


OperationStatus = Literal[
    "queued",
    "running",
    "waiting_for_input",
    "succeeded",
    "succeeded_with_errors",
    "failed",
    "cancelled",
    "blocked",
]


class Operation(BaseModel):
    kind: Literal["collection_run", "keyword_import"]
    status: OperationStatus
    progress: Progress
    started_at: datetime | None
    finished_at: datetime | None
    error: OperationError | None
    links: OperationLinks


class Run(BaseModel):
    run_id: UUID
    project_id: UUID
    schedule_id: UUID | None
    workload: Workload
    trigger: Trigger
    status: RunStatus
    status_reason: str | None
    window_start: datetime
    window_end: datetime
    tasks_total: int
    tasks_succeeded: int
    tasks_failed: int
    estimated_cost_usd: Usd | None
    actual_cost_usd: Usd | None
    blocked_by_budget_id: UUID | None
    created_by: Actor | None
    created_at: datetime
    completed_at: datetime | None
    operation: Operation


class RunDetail(Run):
    tasks_by_status: dict[str, int]
    config_snapshot: dict[str, object]


class RunResponse(BaseModel):
    data: Run


class RunDetailResponse(BaseModel):
    data: RunDetail


class ManualRuns(BaseModel):
    used: int = Field(description="Manual runs people started in the project today (UTC).")
    limit: int


class RunPageMeta(BaseModel):
    manual_runs_today: ManualRuns | None = Field(
        default=None, description="On a project's list: how many manual runs are left today."
    )


class RunPage(BaseModel):
    data: list[Run]
    page: CursorPageInfo
    meta: RunPageMeta


class RunCancel(Body):
    reason: Annotated[str, StringConstraints(max_length=500)] | None = None


# Costs (docs/19 section 3.11.2).

CostGroup = Literal["project", "workload", "provider", "endpoint", "engine", "day", "channel"]


class CostRow(BaseModel):
    keys: dict[str, str]
    cost_usd: Usd
    request_count: int
    subjects: int


class CostSources(BaseModel):
    provider_reported: Usd
    computed_from_tokens: Usd
    price_book_estimate: Usd


class CostMeta(BaseModel):
    total_cost_usd: Usd
    cost_sources: CostSources


class CostList(BaseModel):
    data: list[CostRow]
    meta: CostMeta


class Budget(BaseModel):
    budget_id: UUID
    project_id: UUID | None
    workload: Literal[
        "seo_rank",
        "ai_prompt",
        "keyword_research",
        "ai_benchmark",
        "extraction_llm",
        "first_party",
        "all",
    ]
    period: Literal["month"]
    limit_usd: Usd
    soft_limit_pct: int
    action_on_hard: Literal["pause", "alert_only"]
    created_at: datetime


class BudgetStatus(BaseModel):
    budget: Budget
    spent_usd: Usd
    committed_estimate_usd: Usd
    pct_used: float
    state: Literal["ok", "soft_exceeded", "hard_exceeded"]
    blocked_runs: int


class BudgetStatusList(BaseModel):
    data: list[BudgetStatus]


class Price(BaseModel):
    price_id: UUID
    provider_code: str
    endpoint: str
    price_unit: str
    unit_price_usd: Usd
    conditions: dict[str, object]
    valid_from: date
    valid_to: date | None
    source_url: str
    verified_at: date


class PricePage(BaseModel):
    data: list[Price]
    page: OffsetPageInfo


# Project settings (docs/19 section 3.3). The `ai` and `matrix` parts arrive with their first
# readers.


class SeoSettings(BaseModel):
    default_device: Literal["desktop", "mobile", "both"] = "desktop"
    default_depth_profile: DepthProfile = "standard"
    default_frequency: Literal["daily", "weekly"] = "daily"
    visibility_weight_scheme: Literal["uniform", "priority", "business_value"] = "uniform"
    visibility_volume_mode: Literal["annual_average", "seasonal"] = "annual_average"


class ProjectSettings(BaseModel):
    version: Literal[1] = 1
    seo: SeoSettings = Field(default_factory=SeoSettings)
    entity_config_version: int = Field(description="Read-only: bumped by entity changes.")


class ProjectSettingsResponse(BaseModel):
    data: ProjectSettings


class SeoSettingsPatch(Patch):
    default_device: Literal["desktop", "mobile", "both"] | None = None
    default_depth_profile: DepthProfile | None = None
    default_frequency: Literal["daily", "weekly"] | None = None
    visibility_weight_scheme: Literal["uniform", "priority", "business_value"] | None = None
    visibility_volume_mode: Literal["annual_average", "seasonal"] | None = None

    _not_null = field_validator(
        "default_device",
        "default_depth_profile",
        "default_frequency",
        "visibility_weight_scheme",
        "visibility_volume_mode",
    )(refuse_null)

    @model_validator(mode="after")
    def _says_something(self) -> SeoSettingsPatch:
        if not self.model_fields_set:
            raise ValueError("give at least one setting to change")
        return self


class ProjectSettingsPatch(Body):
    """A JSON merge patch (RFC 7396) of the settings: members left out keep their value."""

    seo: SeoSettingsPatch
