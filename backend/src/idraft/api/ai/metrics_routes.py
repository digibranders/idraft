"""Overview metrics, their series and breakdowns (contract C8, docs/ai-visibility/contracts/
c8-metrics.md). Reading needs `data:read`; the membership dependency has already refused a project
outside the caller's scope.

WP-32 (overview-aggregates) builds the bodies; api/main.py includes this router already (docs/
ai-visibility/MASTER-PLAN.md section 3.3). The router has no prefix, because routes 1 to 5 live
under both `ai/` and `overview/`. `overview` is declared before `{metric}`, so that it is a route
and never a metric key. The scope and compare dependencies are shared with competitor_routes.py.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query
from pydantic import BeforeValidator
from pydantic_core import PydanticCustomError

from idraft.api.ai.metrics import MetricsService, resolve
from idraft.api.ai.summary import SummaryQuery, compare_dates, summary_dates
from idraft.api.pagination import Commas
from idraft.api.permissions import Permission
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.ai import SummaryCompare
from idraft.api.schemas.ai_metrics import (
    AiBreakdownResponse,
    AiMetricResponse,
    AiOverviewResponse,
    AiSeriesResponse,
    BreakdownDimension,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission
from idraft.domain.ai_engines import EngineCode

PROJECT = "/api/v1/workspaces/{workspace_id}/projects/{project_id}"
router = APIRouter(tags=["ai"])

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]


def get_metrics_service(resources: Annotated[Resources, Depends(get_resources)]) -> MetricsService:
    return MetricsService(sessions=resources.sessions, summaries=resources.ai_summary)


Metrics = Annotated[MetricsService, Depends(get_metrics_service)]

SCOPE = (
    "Over `from` to `to`, project-local days both included (default the 28 days ending today; at "
    "most 92, `422 window_too_large`), on the answers the prompts summary counts: valid, current "
    "ones of the active prompts. Branded prompts are left out unless `include_branded` is true "
    "(`branded_only` keeps them alone), `filter[country_iso]` keeps the prompts of one market and "
    "`filter[term]` the prompts given a term or one below it. Rates and shares are read from the "
    "project summary, so they are the same numbers as on the Topics & Prompts page; citation "
    "shares, lost prompts and top sources are read from the same answers as the Sources page. "
    "Engines are never pooled: "
    "each engine has its own value, and the equal-weight average of the engines is a value of "
    "its own. "
)
COMPARE = (
    "`compare=previous_period` (as many days just before the window), `compare=previous_year` (the "
    "same dates a year earlier) or `compare_from` with `compare_to` (both or neither, at most 92 "
    "days; they win over `compare`) add `meta.compare_window`, `meta.previous_answers` and, on the "
    "keys that compare, `previous` beside the value. "
)
KEYS = (
    "A registry key of docs/16 section 2.1: `ai.prompts_in_scope`, `ai.valid_answers`, "
    "`ai.mention_rate`, `ai.citation_rate`, `ai.mention_and_citation_rate`, `ai.outcome_mix` (and "
    "its four `.x` keys), `ai.share_of_voice`, `ai.citation_rate_given_citations`, "
    "`ai.first_mention_rate`, `ai.fanout_presence_rate`, `ai.fanout_mean_queries`, "
    "`ai.citation_share`, `ai.recommendation_rate` and `ai.recommended_given_mentioned` "
    "(suppressed: nothing classifies a recommendation yet). Any other AI key of that table "
    "answers `not_implemented`, naming the key; any other key `404 unknown_metric`."
)


def _refuse_granularity(value: object) -> object:
    """No card reads a day or month series, so refuse them with that reason, where any other
    unknown value gets the plain "input should be"."""
    if value in ("day", "month"):
        raise PydanticCustomError(
            "not_built",
            "`granularity={value}` is not built: no card reads a {value} series, and collection "
            "per day is `ai/collection/daily`.",
            {"value": value},
        )
    return value


Granularity = Annotated[Literal["week"], BeforeValidator(_refuse_granularity)]


def metric_scope(
    start: Annotated[
        date | None, Query(alias="from", description="First day of the window, project-local.")
    ] = None,
    end: Annotated[
        date | None,
        Query(alias="to", description="Last day of the window, included; at most 92 days."),
    ] = None,
    engine_codes: Annotated[
        list[EngineCode] | None,
        Commas,
        Query(
            alias="filter[engine_code_in]",
            max_length=3,
            description="The engines shown. Default: every engine of the project that is "
            "enabled or has an answer in the window. A code outside the three engines is a "
            "`422`; a listed engine that is neither enabled nor answering is left out of the "
            "engines shown.",
        ),
    ] = None,
    include_branded: Annotated[bool, Query(description="Count the branded prompts too.")] = False,
    branded_only: Annotated[
        bool, Query(description="Only the branded prompts; wins over `include_branded`.")
    ] = False,
    country_iso: Annotated[
        str | None,
        Query(
            alias="filter[country_iso]",
            pattern=r"^[A-Z]{2}$",
            description="The prompts of one market, ISO 3166-1 alpha-2.",
        ),
    ] = None,
    term_id: Annotated[
        UUID | None,
        Query(alias="filter[term]", description="The prompts given the term or one under it."),
    ] = None,
) -> SummaryQuery:
    """The scope of every route here: the prompts summary's, with its meaning and errors."""
    if start is not None and end is not None:
        # A window of two dates needs no project zone to be checked. The service checks the rest
        # (`from` or `to` left out) once it reads the project.
        summary_dates(start, end, end)
    return SummaryQuery(
        start=start,
        end=end,
        engine_codes=engine_codes,
        include_branded=include_branded,
        branded_only=branded_only,
        country_iso=country_iso,
        term_id=term_id,
    )


def compare_scope(
    scope: Annotated[SummaryQuery, Depends(metric_scope)],
    compare: Annotated[
        SummaryCompare,
        Query(
            description="`previous_period`: as many days just before the window; "
            "`previous_year`: the same dates a year earlier."
        ),
    ] = "none",
    compare_from: Annotated[
        date | None,
        Query(
            description="First day of a window to compare with, project-local; needs "
            "`compare_to`, and wins over `compare`."
        ),
    ] = None,
    compare_to: Annotated[
        date | None,
        Query(
            description="Last day of the window to compare with, included; at most 92 days from "
            "`compare_from`."
        ),
    ] = None,
) -> SummaryQuery:
    """The scope of the routes that compare: both dates or neither, in order, at most 92 days."""
    if compare_from is not None or compare_to is not None:
        compare_dates(date.min, date.min, "none", compare_from, compare_to, date.min)
    return replace(scope, compare=compare, compare_from=compare_from, compare_to=compare_to)


Scoped = Annotated[SummaryQuery, Depends(metric_scope)]
Compared = Annotated[SummaryQuery, Depends(compare_scope)]
Metric = Annotated[
    str,
    Path(
        pattern=r"^[a-z][a-z0-9_.]{0,63}$",
        description="A registry key of docs/16 section 2.1, for example `ai.mention_rate`.",
    ),
]
EntityIds = Annotated[
    list[UUID] | None,
    Commas,
    Query(
        max_length=20,
        description="One value per listed tracked entity (the own brand or a competitor tracked in "
        "AI answers) and engine, in place of the engine's own cells; only for `ai.mention_rate` "
        "and `ai.share_of_voice`. An id that is not a tracked entity of the project is left out, "
        "never a `404`.",
    ),
]


@router.get(
    f"{PROJECT}/ai/metrics/overview",
    summary="The Overview numbers of the AI answers, per engine",
    description=SCOPE
    + "Per engine shown: the valid answers, Mentioned, Cited, named and cited, the four "
    "outcomes, recommendation (suppressed: `not_classified`), share of voice, citation share "
    "(own citation units over all those of the engine, as the Sources page counts them), Cited "
    "given citations, first mention and, on an engine that exposes fan-out, its presence and "
    "mean. `engine_average` holds the equal-weight average of the engines for five of them when "
    "two engines have a value. `prompts_in_scope`, `topics_in_scope`, `last_observed_at` and "
    "`last_valid_at` sit beside the engines. " + COMPARE + "`overview/ai` answers the same body.",
)
async def metrics_overview(
    project_id: UUID, access: ReadData, query: Compared, service: Metrics
) -> AiOverviewResponse:
    return await service.overview(access, project_id, query)


@router.get(
    f"{PROJECT}/overview/ai",
    summary="The Overview numbers of the AI answers, per engine (Overview alias)",
    description="The same body, parameters and errors as `GET .../ai/metrics/overview`, under the "
    "path the Overview report reads. " + SCOPE + COMPARE,
)
async def overview_ai(
    project_id: UUID, access: ReadData, query: Compared, service: Metrics
) -> AiOverviewResponse:
    return await service.overview(access, project_id, query)


@router.get(
    f"{PROJECT}/ai/metrics/{{metric}}",
    summary="One AI metric, per engine",
    description=SCOPE
    + KEYS
    + " One value per engine, sorted by engine code, then the engine averages for the keys that "
    "have them; `ai.outcome_mix` gives four values per engine that add up to the whole. "
    "`entity_ids` gives one value per listed entity and engine instead. " + COMPARE,
)
async def metric_value(
    project_id: UUID,
    access: ReadData,
    query: Compared,
    service: Metrics,
    metric: Metric,
    entity_ids: EntityIds = None,
) -> AiMetricResponse:
    # The key is checked before any read: a bad key is `unknown_metric` whatever the project.
    keys = resolve(metric, "value", entities=bool(entity_ids))
    return await service.metric(access, project_id, query, keys, entity_ids)


@router.get(
    f"{PROJECT}/ai/metrics/{{metric}}/series",
    summary="One AI metric over the weeks of the window, per engine",
    description=SCOPE
    + "One series per engine (and per listed entity with `entity_ids`) for `ai.mention_rate`, "
    "`ai.citation_rate` and `ai.share_of_voice`: a point for each week the window touches "
    "(weeks start on Monday in the project's timezone), oldest first, at most 14. A point holds "
    "the week's own answers, or the trailing four weeks inside the window when fewer than 10 "
    "prompts answered that week (`is_pooled`, `pool`); the first and last weeks may be partial "
    "(`is_partial`). They are the weekly points of the prompts summary's `total` row. `day` and "
    "`month` granularities are refused (`422`, code `not_built`). A series has no compare "
    "parameters: a previous window drawn over it is a second read with `from` and `to` shifted.",
)
async def metric_series(
    project_id: UUID,
    access: ReadData,
    query: Scoped,
    service: Metrics,
    metric: Metric,
    entity_ids: EntityIds = None,
    granularity: Annotated[
        Granularity, Query(description="`week`: the only granularity.")
    ] = "week",
) -> AiSeriesResponse:
    (key,) = resolve(metric, "series", entities=bool(entity_ids))
    return await service.series(access, project_id, query, key, entity_ids)


@router.get(
    f"{PROJECT}/ai/metrics/{{metric}}/breakdown",
    summary="One AI metric broken down by a dimension of the prompts",
    description=SCOPE
    + "One row per group of `dimension`, each with its prompts and one value per engine (four per "
    "engine for `ai.outcome_mix`), sorted by prompts, most first, then label, at most 300 "
    "(`meta.rows_total`, `meta.truncated`). Prompts with no value of the dimension (for example "
    "no persona) form one row with `dimension.id` null. A prompt in two topics counts in each, so "
    "topic values do not add up to the total (`meta.notes`). A breakdown has no compare "
    "parameters.",
)
async def metric_breakdown(
    project_id: UUID,
    access: ReadData,
    query: Scoped,
    service: Metrics,
    metric: Metric,
    dimension: Annotated[BreakdownDimension, Query(description="What the rows are.")],
) -> AiBreakdownResponse:
    keys = resolve(metric, "breakdown")
    return await service.breakdown(access, project_id, query, keys, dimension)
