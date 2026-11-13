"""Bodies of the Overview aggregate routes (contracts C8 and C5, docs/ai-visibility/contracts/
c8-metrics.md and c5-competitors.md; docs/19-api-specification.md sections 2.6 and 3.7.9).

`AiMetricValue` is doc 16 section 2 `MetricValue` for AI answers, as a model of its own: the one in
`schemas.metrics` is the SEO side's and carries `n_keywords` and `source`. An optional member is
left out of the JSON when it is not set; the others are always written, as null when they have no
value.
Every member the contract declares and this package does not return (`ci`, `seo`,
`seo_other_domains`) is declared here, so a later package fills it without a second shape.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field
from pydantic.json_schema import SkipJsonSchema

from idraft.api.schemas.ai import (
    NOT_ASKED,
    Aggregation,
    MetricCell,
    PointPool,
    Pooled,
    SummaryEntity,
    _absent,
    _not_asked,
    _NotAsked,
)
from idraft.api.schemas.entities import EntityRef
from idraft.api.schemas.metrics import MetricValue, MetricWindow
from idraft.domain.ai_engines import ObservationClass

AiUnit = Literal["ratio", "count"]
SuppressedReason = Literal[
    "insufficient_data", "no_surface", "not_classified", "below_min_impressions"
]
BreakdownDimension = Literal[
    "topic", "intent", "funnel_stage", "engine", "country", "language", "persona", "prompt_type"
]
_META = "The scope the numbers were computed over."


class AiFilters(BaseModel):
    """The scope a value was counted over, resolved: what the request left out is null."""

    include_branded: bool = Field(description="Branded prompts are counted.")
    branded_only: bool = Field(description="Only branded prompts are counted.")
    country_iso: str | None = Field(description="The market the prompts were limited to, or null.")
    term_id: UUID | None = Field(
        description="The term whose prompts (and those of the terms below it) were counted, or "
        "null."
    )


class AiCi(BaseModel):
    """A confidence interval. Declared and never returned in this package: the interval stays on
    the client (Wilson, rule R8) until the statistics package adds it."""

    lower: float = Field(description="The lower bound, in the unit of the value.")
    upper: float = Field(description="The upper bound, in the unit of the value.")
    level: float = Field(description="The confidence level, for example 0.95.")
    method: str = Field(description="How the interval was computed, for example `wilson`.")


class AiMetricValue(BaseModel):
    """One metric over one scope and one engine (or one entity), with what it was computed from."""

    metric: str = Field(
        description="The registry key of docs/16 section 2.1; `<key>.engine_average` for an "
        "average of engines."
    )
    value: float | None = Field(
        description="numerator / denominator; null when the denominator is 0 or the metric is "
        "suppressed. Never 0 for an empty denominator."
    )
    numerator: float | None = Field(
        description="A count of answers, or the sum of the prompts' rates for a prompt weighted "
        "rate. Null when suppressed."
    )
    denominator: float | None = Field(
        description="Answers, or the prompts with a valid answer for a prompt weighted rate. Null "
        "for a count and when suppressed; otherwise value = numerator / denominator."
    )
    unit: AiUnit = Field(
        description="`ratio` (0 to 1) for rates and shares; `count` for valid answers, prompts in "
        "scope and fan-out queries per answer."
    )
    n_observations: int = Field(description="Every answer behind the value, valid or not.")
    n_prompts: int | None = Field(
        default=None,
        exclude_if=_absent,
        description="Prompt weighted values only: the prompts with a valid answer (the "
        "denominator). Left out otherwise.",
    )
    aggregation: Aggregation | None = Field(
        default=None,
        exclude_if=_absent,
        description="How the value is weighted. Left out on counts and on averages of engines.",
    )
    window: MetricWindow = Field(description="The window the value covers: project-local days.")
    filters: AiFilters = Field(description="The scope the value was counted over.")
    observation_class: ObservationClass | None = Field(
        default=None,
        exclude_if=_absent,
        description="How the engine's answers were observed. Left out on an average of engines "
        "and on the prompts in scope.",
    )
    engine_code: str | None = Field(
        default=None,
        exclude_if=_absent,
        description="Set when the value is for exactly one engine. Left out otherwise.",
    )
    entity_id: UUID | None = Field(
        default=None,
        exclude_if=_absent,
        description="Set when the value is about one tracked entity. Left out otherwise.",
    )
    engines: list[str] | None = Field(
        default=None,
        exclude_if=_absent,
        description="On an engine average only: the engines averaged.",
    )
    is_estimate: bool = Field(description="Always false for AI answers.")
    method: str = Field(description="A short human description of the computation.")
    method_version: int = Field(
        description="1 for every key now; a change of the formula raises it (docs/16 rule 7)."
    )
    suppressed_reason: SuppressedReason | None = Field(
        default=None,
        exclude_if=_absent,
        description="Why the value is withheld; `not_classified` for the recommendation keys, "
        "which nothing classifies yet. Left out when the value is shown.",
    )
    pooled: Pooled | None = Field(
        default=None,
        exclude_if=_absent,
        description="The answers behind a prompt weighted rate: 4 of 8 answers. Left out on share "
        "of voice, shares of units and counts.",
    )
    previous: MetricCell | SkipJsonSchema[_NotAsked] | None = Field(
        default=NOT_ASKED,
        exclude_if=_not_asked,
        json_schema_extra={"default": None},
        description="With a compare window, on the keys that compare: the same value over "
        "`meta.compare_window`. Null when the engine had no answer of the scope there (no data is "
        "not a rate of 0); a cell with a denominator of 0 when it had answers and none valid. "
        "Left out when no compare window was asked for and on the keys that do not compare.",
    )
    ci: AiCi | None = Field(
        default=None,
        exclude_if=_absent,
        description="Not returned yet: left out of every response until it is built.",
    )


class AiMetricMeta(BaseModel):
    """What every body says about the scope it was computed over."""

    window: MetricWindow = Field(description="The window; project-local days both included.")
    compare_window: MetricWindow | None = Field(
        default=None,
        exclude_if=_absent,
        description="With a compare window: the days compared with. Left out otherwise.",
    )
    previous_answers: int | None = Field(
        default=None,
        exclude_if=_absent,
        description="With a compare window: the valid answers in scope there, on the engines "
        "shown; 0 means it has no data. Left out otherwise.",
    )
    include_branded: bool = Field(description="Branded prompts are counted.")
    branded_only: bool = Field(description="Only branded prompts are counted.")
    engine_codes: list[str] = Field(
        description="The engines shown, sorted: enabled or answering, after the filter."
    )
    entities: list[SummaryEntity] = Field(
        description="The tracked entity set share of voice is computed over now, as the prompts "
        "summary lists it (competitors by name, then the own entities); watched entities are not "
        "in it. Read `role`: do not assume the own brand is first."
    )
    entity_config_versions: list[int] = Field(
        description="More than one means the entity set changed inside the window and older "
        "answers keep their set."
    )
    notes: list[str] = Field(
        description="What a route has to say about its numbers; [] if nothing."
    )


# Routes 1 and 2: the Overview.


class AiOverviewEngine(BaseModel):
    engine_code: str = Field(description="The engine.")
    observation_class: ObservationClass = Field(
        description="How the engine's answers are observed."
    )
    tiles: list[AiMetricValue] = Field(
        description="The tiles of the engine, in the order of the contract: valid answers, "
        "Mentioned, Cited, named and cited, the four outcomes, recommendation (suppressed), "
        "share of voice, citation share, Cited given citations, first mention and, on an engine "
        "that exposes fan-out, its presence and mean. An engine that does not has no such tile."
    )


class AiOverview(BaseModel):
    engines: list[AiOverviewEngine] = Field(
        description="One entry per engine shown, sorted by engine code."
    )
    engine_average: list[AiMetricValue] = Field(
        description="The equal-weight average of the engines' values for Mentioned, Cited, named "
        "and cited, share of voice and citation share, in that order; [] under two engines with "
        "a value."
    )
    prompts_in_scope: AiMetricValue = Field(
        description="The prompts counted once, whether they have a valid answer or not."
    )
    last_observed_at: datetime | None = Field(
        description="The newest counted answer of any status; null when there is none."
    )
    last_valid_at: datetime | None = Field(
        description="The newest valid answer; null when there is none."
    )


class AiOverviewResponse(BaseModel):
    data: AiOverview = Field(description="The Overview numbers, per engine.")
    meta: AiMetricMeta = Field(description=_META)


# Route 3: one metric.


class AiMetricResponse(BaseModel):
    data: list[AiMetricValue] = Field(
        description="One value per engine sorted by engine code (per listed entity and engine "
        "with `entity_ids`, the own entities first), then the engine averages. An outcome key "
        "gives four values per engine."
    )
    meta: AiMetricMeta = Field(description=_META)


# Route 4: a series.


class AiMetricPoint(BaseModel):
    t: date = Field(description="The Monday the week starts on, in the project's zone.")
    value: float | None = Field(description="numerator / denominator; null when it is 0.")
    numerator: float | None = Field(description="As in `AiMetricValue`.")
    denominator: float | None = Field(description="As in `AiMetricValue`.")
    n_observations: int = Field(description="Every answer behind the point, valid or not.")
    n_prompts: int = Field(
        description="The prompts with a valid answer in that week alone, whether the point is "
        "pooled or not."
    )
    is_partial: bool = Field(
        description="The week is cut by a window bound (`t` before `window.from`, or the Sunday "
        "after `window.to`), or holds today."
    )
    is_pooled: bool = Field(
        description="The cells hold the trailing weeks, inside the window, and not the week alone."
    )
    pool: PointPool | None = Field(
        default=None,
        exclude_if=_absent,
        description="Present exactly when `is_pooled`: the weeks and days the cells hold, and why.",
    )
    pooled: Pooled | None = Field(
        default=None,
        exclude_if=_absent,
        description="The answers behind a prompt weighted point. Left out on share of voice.",
    )


class AiMetricSeries(BaseModel):
    metric: str = Field(description="The registry key of docs/16 section 2.1.")
    unit: AiUnit = Field(description="`ratio` for every key a series has.")
    aggregation: Aggregation = Field(description="How the points are weighted.")
    engine_code: str = Field(description="The engine of the series.")
    entity_id: UUID | None = Field(
        default=None,
        exclude_if=_absent,
        description="Set on the series of one tracked entity. Left out otherwise.",
    )
    window: MetricWindow = Field(description="The window the points cover.")
    filters: AiFilters = Field(description="The scope the points were counted over.")
    is_estimate: bool = Field(description="Always false for AI answers.")
    method: str = Field(description="A short human description of the computation.")
    method_version: int = Field(description="As in `AiMetricValue`.")
    granularity: Literal["week"] = Field(description="`week`: the only granularity.")
    points: list[AiMetricPoint] = Field(
        description="A point for each week the window touches, oldest first, at most 14; a week "
        "without answers has counts of 0 and no value."
    )


class AiSeriesResponse(BaseModel):
    data: list[AiMetricSeries] = Field(
        description="One series per engine, and with `entity_ids` one per listed entity and engine."
    )
    meta: AiMetricMeta = Field(description=_META)


# Route 5: a breakdown.


class AiDimension(BaseModel):
    type: BreakdownDimension = Field(description="The dimension the rows are of.")
    id: str | None = Field(description="The id of the group; null for the prompts with no value.")
    label: str | None = Field(
        description="The name of the group; null for the prompts with no value."
    )


class AiBreakdownRow(BaseModel):
    dimension: AiDimension = Field(description="The group this row is of.")
    prompts: int = Field(description="The prompts of the group.")
    values: list[AiMetricValue] = Field(
        description="One value per engine, no averages; four per engine for `ai.outcome_mix`. "
        "With `dimension=engine` the row is one engine."
    )


class AiBreakdownMeta(AiMetricMeta):
    rows_total: int = Field(description="The rows before the cap of 300.")
    truncated: bool = Field(description="True when `rows_total` is over 300.")


class AiBreakdownResponse(BaseModel):
    data: list[AiBreakdownRow] = Field(
        description="Sorted by prompts, most first, then label; at most 300."
    )
    meta: AiBreakdownMeta = Field(description=_META)


# Route 6: the competitors.


class LostPrompt(BaseModel):
    prompt_id: UUID = Field(description="The prompt.")
    text: str = Field(description="The prompt's current text.")
    importance: int = Field(description="The prompt's importance, 1 to 5.")
    lost: MetricCell = Field(
        description="`numerator`: the answers on the engine that name the competitor and not the "
        "own brand; `denominator`: the prompt's valid answers on the engine; `n_observations`: "
        "all its answers; `value` null when the denominator is 0."
    )


class CompetitorSource(BaseModel):
    registrable_domain: str = Field(description="A domain cited with the entity as its role.")
    citation_units: int = Field(
        description="Its citation units: distinct canonical URLs per answer."
    )
    answers: int = Field(description="The answers that cite it for the entity.")


class AiCompetitorEngine(BaseModel):
    engine_code: str = Field(description="The engine.")
    mention_rate: AiMetricValue = Field(description="`ai.mention_rate` of the entity.")
    recommendation_rate: AiMetricValue = Field(
        description="`ai.recommendation_rate` of the entity: suppressed, `not_classified`."
    )
    citation_share: AiMetricValue = Field(
        description="`ai.citation_share`: the entity's citation units over all those of the engine."
    )
    share_of_voice: AiMetricValue = Field(description="`ai.share_of_voice` of the entity.")
    is_top_competitor: bool = Field(
        description="True for exactly the competitor with the most share of voice on the engine; "
        "false for every row when no competitor was named."
    )
    lost_prompts: list[LostPrompt] | None = Field(
        default=None,
        exclude_if=_absent,
        description="With `include=lost_prompts`, on a competitor: the prompts where it is named "
        "and the own brand is not; [] when none. Left out otherwise.",
    )


class AiCompetitor(BaseModel):
    entity: EntityRef = Field(description="The tracked entity of the row.")
    by_engine: list[AiCompetitorEngine] = Field(
        description="One entry per engine shown, sorted by engine code."
    )
    top_sources: list[CompetitorSource] | None = Field(
        default=None,
        exclude_if=_absent,
        description="With `include=top_sources`: the domains cited most with the entity, over all "
        "engines. Left out otherwise.",
    )


class AiCompetitorsResponse(BaseModel):
    data: list[AiCompetitor] = Field(
        description="The tracked set: the own entities, then the competitors by name; at most 20."
    )
    meta: AiMetricMeta = Field(description=_META)


# Route 7: the Overview competitor table.


class OverviewCompetitorEngine(BaseModel):
    engine_code: str = Field(description="The engine.")
    share_of_voice: AiMetricValue = Field(description="`ai.share_of_voice` of the entity.")
    mention_rate: AiMetricValue = Field(description="`ai.mention_rate` of the entity.")


class OverviewSeoCells(BaseModel):
    """Declared and never returned in this package: SEO share of voice is built nowhere yet."""

    share_of_voice: MetricValue = Field(description="The entity's SEO share of voice.")
    visibility: MetricValue = Field(description="The entity's SEO visibility.")


class OverviewCompetitorRow(BaseModel):
    entity: EntityRef = Field(description="The tracked entity of the row.")
    ai: list[OverviewCompetitorEngine] = Field(
        description="One entry per engine shown, sorted by engine code."
    )
    seo: OverviewSeoCells | None = Field(
        default=None,
        exclude_if=_absent,
        description="Not returned yet: left out of every response until it is built.",
    )


class OverviewCompetitors(BaseModel):
    rows: list[OverviewCompetitorRow] = Field(
        description="The tracked set: the own entities, then the competitors by name; at most 20."
    )
    seo_other_domains: MetricValue | None = Field(
        default=None,
        exclude_if=_absent,
        description="Not returned yet: the SEO share of the domains that are not tracked.",
    )


class OverviewCompetitorsResponse(BaseModel):
    data: OverviewCompetitors = Field(description="The AI half of the Overview competitor table.")
    meta: AiMetricMeta = Field(description=_META)
