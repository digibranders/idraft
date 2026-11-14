"""The AI metric routes (contract C8, docs/ai-visibility/contracts/c8-metrics.md): the Overview,
one metric per engine, a metric over the weeks and a metric broken down by a dimension of the
prompts.

Every number is a cell of the prompts summary, relabelled: `MetricsService` reads the summary once
for the scope and maps its cells to `AiMetricValue`, so a figure is the same here, on the
Topics & Prompts page and in a topic row (rule R12). The one number the summary does not hold is
citation share, which is read from the sources lane (citation units by engine and role, flagged
citations left out) so that it equals the Sources page. A breakdown by an attribute of the prompt
(intent, funnel stage, type, language, market, persona) groups the summary's prompt rows by that
attribute and reduces each group's per-prompt cells with `reduce_cells`, the rule a topic row
is built by. The mapping is pure and tested alone."""

from __future__ import annotations

from collections.abc import Callable, Collection, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from typing import Final, Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi.exceptions import RequestValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.ai import metrics_repository as repository
from idraft.api.ai import source_repository
from idraft.api.ai.source_repository import SourceScope
from idraft.api.ai.summary import SummaryQuery, SummaryService
from idraft.api.problems import ProblemError
from idraft.api.ranks.service import instants
from idraft.api.schemas.ai import (
    NOT_ASKED,
    Aggregation,
    EngineCells,
    EngineDetailCells,
    EngineSummary,
    EntityCells,
    EntityPreviousCells,
    MetricCell,
    OutcomeCells,
    Pooled,
    PromptsSummary,
    SummaryRows,
    SummaryTotal,
    WeekCells,
    _NotAsked,
)
from idraft.api.schemas.ai_metrics import (
    AiBreakdownMeta,
    AiBreakdownResponse,
    AiBreakdownRow,
    AiDimension,
    AiEntityConfigChange,
    AiFilters,
    AiMetricMeta,
    AiMetricPoint,
    AiMetricResponse,
    AiMetricSeries,
    AiMetricValue,
    AiOverview,
    AiOverviewEngine,
    AiOverviewResponse,
    AiSeriesResponse,
    AiUnit,
    BreakdownDimension,
)
from idraft.api.schemas.metrics import MetricWindow
from idraft.api.stubs import not_built_yet
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.domain.ai_engines import ENGINES, EngineCode, ObservationClass

# A formula change raises it (docs/16 rule 7); every key is at 1.
METHOD_VERSION: Final = 1
# The citation flags citation share leaves out: what the sources routes leave out by default
# (docs/14 section 9), so the Overview and the Sources page count the same units.
EXCLUDED_FLAGS: Final = ("engine_internal", "unresolved_redirect")
_PROMPT: Final[Aggregation] = "prompt_weighted"
_OBSERVATION: Final[Aggregation] = "observation_weighted"
_OUTCOME: Final = (
    "Valid answers with this outcome, prompt weighted; the four outcomes add up to the whole."
)
_NOT_CLASSIFIED: Final = "Not classified yet: no answer carries a recommendation label."
_AVERAGE: Final = "Equal-weight average of per-engine values."
_OUTCOME_KEYS: Final = (
    "ai.outcome_mix.mentioned_and_cited",
    "ai.outcome_mix.mentioned_only",
    "ai.outcome_mix.cited_only",
    "ai.outcome_mix.neither",
)
# The tiles of an engine, in the order of the note; the two fan-out ones come last, and only on
# an engine that exposes fan-out.
TILES: Final = (
    "ai.valid_answers",
    "ai.mention_rate",
    "ai.citation_rate",
    "ai.mention_and_citation_rate",
    *_OUTCOME_KEYS,
    "ai.recommendation_rate",
    "ai.share_of_voice",
    "ai.citation_share",
    "ai.citation_rate_given_citations",
    "ai.first_mention_rate",
    "ai.fanout_presence_rate",
    "ai.fanout_mean_queries",
)
# The tiles that have an average of the engines, in the order of the note.
AVERAGED: Final = (
    "ai.mention_rate",
    "ai.citation_rate",
    "ai.mention_and_citation_rate",
    "ai.share_of_voice",
    "ai.citation_share",
)


@dataclass(frozen=True, slots=True)
class Metric:
    """What a registry key is: its unit, its weighting, how it is said, and where the summary
    holds it. `cell` picks the cell of an engine's row (None: the value is not a cell of it) and
    `earlier` the cell of the same engine over the window compared with (None: it does not
    compare). A cell that is None is a value the engine does not have."""

    unit: AiUnit
    aggregation: Aggregation | None
    method: str
    cell: Callable[[EngineSummary], MetricCell | None] | None = None
    earlier: Callable[[EngineCells], MetricCell] | None = None


def _detail(engine: EngineSummary) -> EngineDetailCells:
    if engine.detail is None:
        raise ValueError("The summary was read without include=cells.")
    return engine.detail


def _outcome(pick: Callable[[OutcomeCells], MetricCell]) -> Metric:
    return Metric(
        "ratio",
        _PROMPT,
        _OUTCOME,
        cell=lambda engine: pick(engine.outcomes),
        earlier=lambda before: pick(before.outcomes),
    )


METRICS: Final[dict[str, Metric]] = {
    "ai.prompts_in_scope": Metric(
        "count", None, "Prompts counted once, with a valid answer or not."
    ),
    "ai.valid_answers": Metric(
        "count", None, "Valid, current answers in scope; n_observations counts every answer."
    ),
    "ai.mention_rate": Metric(
        "ratio",
        _PROMPT,
        "Valid answers that name the own brand, prompt weighted.",
        cell=lambda engine: engine.mentioned,
        earlier=lambda before: before.mentioned,
    ),
    "ai.citation_rate": Metric(
        "ratio",
        _PROMPT,
        "Valid answers that cite the own domain, prompt weighted.",
        cell=lambda engine: engine.cited,
        earlier=lambda before: before.cited,
    ),
    "ai.mention_and_citation_rate": Metric(
        "ratio",
        _PROMPT,
        "Valid answers that name the own brand and cite the own domain, prompt weighted.",
        cell=lambda engine: engine.outcomes.mentioned_and_cited,
        earlier=lambda before: before.outcomes.mentioned_and_cited,
    ),
    "ai.outcome_mix.mentioned_and_cited": _outcome(lambda outcomes: outcomes.mentioned_and_cited),
    "ai.outcome_mix.mentioned_only": _outcome(lambda outcomes: outcomes.mentioned_only),
    "ai.outcome_mix.cited_only": _outcome(lambda outcomes: outcomes.cited_only),
    "ai.outcome_mix.neither": _outcome(lambda outcomes: outcomes.neither),
    "ai.share_of_voice": Metric(
        "ratio",
        _OBSERVATION,
        "The own share of the tracked entities each answer names, summed over the answers that "
        "name one.",
        cell=lambda engine: engine.share_of_voice,
        earlier=lambda before: before.share_of_voice,
    ),
    "ai.citation_rate_given_citations": Metric(
        "ratio",
        _PROMPT,
        "Valid answers that cite the own domain, of the valid answers with a citation, prompt "
        "weighted.",
        cell=lambda engine: _detail(engine).cited_given_citations,
    ),
    "ai.first_mention_rate": Metric(
        "ratio",
        _PROMPT,
        "The own brand named before any other tracked entity, of the valid answers that name "
        "it, prompt weighted.",
        cell=lambda engine: _detail(engine).first_mention,
    ),
    "ai.fanout_presence_rate": Metric(
        "ratio",
        _PROMPT,
        "Valid answers with at least one fan-out query, prompt weighted.",
        cell=lambda engine: _detail(engine).fanout_presence,
    ),
    "ai.fanout_mean_queries": Metric(
        "count",
        _OBSERVATION,
        "Fan-out queries per valid answer that has some.",
        cell=lambda engine: _detail(engine).fanout_mean,
    ),
    "ai.citation_share": Metric(
        "ratio",
        _OBSERVATION,
        "Own citation units over all citation units of the engine; each unit is a distinct "
        "canonical URL of an answer.",
    ),
    "ai.recommendation_rate": Metric("ratio", None, _NOT_CLASSIFIED),
    "ai.recommended_given_mentioned": Metric("ratio", None, _NOT_CLASSIFIED),
}
# Built and answered `200` with no value: nothing classifies a recommendation yet (S2).
SUPPRESSED: Final = frozenset({"ai.recommendation_rate", "ai.recommended_given_mentioned"})
OUTCOME_MIX: Final = "ai.outcome_mix"
# The keys read from the summary's small cells (`include=cells`).
DETAIL: Final = frozenset(
    {
        "ai.citation_rate_given_citations",
        "ai.first_mention_rate",
        "ai.fanout_presence_rate",
        "ai.fanout_mean_queries",
    }
)
# The keys that have weekly points, and the keys that can be asked for per entity.
SERIES_KEYS: Final = ("ai.mention_rate", "ai.citation_rate", "ai.share_of_voice")
ENTITY_KEYS: Final = ("ai.mention_rate", "ai.share_of_voice")
# The keys a breakdown builds: those that are a cell of a prompt's row of the summary, so that a
# group of prompts is reduced from them. The others are a count, a value withheld, or a read of
# the sources lane that has no prompt row.
BREAKDOWN: Final = frozenset(key for key, spec in METRICS.items() if spec.cell is not None)
# The rows of a breakdown past which `meta.truncated` is true.
BREAKDOWN_MAX: Final = 300
TOPIC_NOTE: Final = (
    "A prompt in two topics counts in each; topic values do not add up to the total."
)
# The keys a route that does not take them all builds.
_ROUTE_KEYS: Final = {"series": frozenset(SERIES_KEYS), "breakdown": BREAKDOWN}
# Registry keys of docs/16 section 2.1 that no route builds yet (doc 19 names the four sentiment
# keys; the note says "its four `.x` keys").
UNBUILT: Final = frozenset(
    {
        "ai.mention_count_share",
        "ai.structured_top3_rate",
        "ai.structured_top5_rate",
        "ai.ranked_list_presence_rate",
        "ai.structured_rank",
        "ai.prominence",
        "ai.sentiment",
        "ai.sentiment.positive",
        "ai.sentiment.neutral",
        "ai.sentiment.negative",
        "ai.sentiment.mixed",
        "ai.competitor_gap",
        "ai.source_share",
        "ai.source_diversity",
        "ai.surface_presence_rate",
        "ai.fanout_keyword_coverage",
        "ai.fanout_own_top10_share",
        "ai.flip_rate",
        "ai.citation_jaccard_distance",
        "ai.within_run_disagreement",
    }
)
# What an entity's value says in place of the own brand's.
_ENTITY_METHOD: Final = {
    "ai.mention_rate": "Valid answers that name the entity, prompt weighted.",
    "ai.share_of_voice": (
        "The entity's share of the tracked entities each answer names, summed over the answers "
        "that name one."
    ),
}

Route = Literal["value", "series", "breakdown"]


class UnknownMetricError(ProblemError):
    """A key that is no registry key of the AI answers (a `seo.*` key included)."""

    status, code, title = 404, "unknown_metric", "Unknown metric"


def resolve(key: str, route: Route, *, entities: bool = False) -> tuple[str, ...]:
    """The registry keys a route builds for the path key: the key, or the four outcomes of the mix.
    A key outside the registry is `404 unknown_metric`; a known key that is not built, or not for
    this route, is `501` naming it; `entity_ids` on a key that has no entity cells is `422` at
    `entity_ids`. It reads nothing, so the route body calls it before any service."""
    keys = _OUTCOME_KEYS if key == OUTCOME_MIX else ((key,) if key in METRICS else ())
    if not keys:
        if key in UNBUILT:
            raise not_built_yet(f"Not built yet: {key}.")
        raise UnknownMetricError(f"`{key}` is not a metric of the AI answers.")
    built = _ROUTE_KEYS.get(route)
    if built is not None and not set(keys) <= built:
        raise not_built_yet(f"Not built yet: {key} on {route}.")
    if entities and key not in ENTITY_KEYS:
        raise RequestValidationError(
            [
                {
                    "loc": ("query", "entity_ids"),
                    "type": "not_supported",
                    "msg": "`entity_ids` is for `ai.mention_rate` and `ai.share_of_voice` only.",
                }
            ]
        )
    return keys


@dataclass(frozen=True, slots=True)
class Frame:
    """What every value of a response shares: the window and the scope it was counted over."""

    window: MetricWindow
    filters: AiFilters


def observation_class(code: str) -> ObservationClass:
    return ENGINES[EngineCode(code)].observation_class


def cell_value(
    key: str,
    cell: MetricCell,
    frame: Frame,
    code: str,
    previous: MetricCell | _NotAsked | None = NOT_ASKED,
    *,
    entity_id: UUID | None = None,
    method: str | None = None,
) -> AiMetricValue:
    """A summary cell as the value of `key` for one engine: its counts are copied, and a prompt
    weighted cell (the one with `pooled`) says how many prompts it is over. `entity_id` and
    `method` are for the value of a tracked entity."""
    spec = METRICS[key]
    return AiMetricValue(
        metric=key,
        value=cell.value,
        numerator=cell.numerator,
        denominator=cell.denominator,
        unit=spec.unit,
        n_observations=cell.n_observations,
        n_prompts=None if cell.pooled is None else cell.denominator,
        aggregation=spec.aggregation,
        window=frame.window,
        filters=frame.filters,
        observation_class=observation_class(code),
        engine_code=code,
        entity_id=entity_id,
        is_estimate=False,
        method=method or spec.method,
        method_version=METHOD_VERSION,
        pooled=cell.pooled,
        previous=previous,
    )


def count_value(
    key: str, count: int, n_observations: int, frame: Frame, code: str | None
) -> AiMetricValue:
    """A plain count: `value` and `numerator` are the count and there is no denominator."""
    spec = METRICS[key]
    return AiMetricValue(
        metric=key,
        value=count,
        numerator=count,
        denominator=None,
        unit=spec.unit,
        n_observations=n_observations,
        window=frame.window,
        filters=frame.filters,
        observation_class=None if code is None else observation_class(code),
        engine_code=code,
        is_estimate=False,
        method=spec.method,
        method_version=METHOD_VERSION,
    )


def suppressed_value(key: str, n_valid: int, frame: Frame, code: str) -> AiMetricValue:
    """A value withheld because nothing classifies it: no value and no counts, never a rate of
    0; `n_observations` is the engine's valid answers."""
    spec = METRICS[key]
    return AiMetricValue(
        metric=key,
        value=None,
        numerator=None,
        denominator=None,
        unit=spec.unit,
        n_observations=n_valid,
        window=frame.window,
        filters=frame.filters,
        observation_class=observation_class(code),
        engine_code=code,
        is_estimate=False,
        method=spec.method,
        method_version=METHOD_VERSION,
        suppressed_reason="not_classified",
    )


def citation_share_value(
    own_units: int, all_units: int, n_valid: int, frame: Frame, code: str
) -> AiMetricValue:
    """The own citation units over all those of the engine, in answers that count: one unit one
    weight. `n_observations` is the engine's valid answers (C-18)."""
    spec = METRICS["ai.citation_share"]
    return AiMetricValue(
        metric="ai.citation_share",
        value=None if all_units == 0 else own_units / all_units,
        numerator=own_units,
        denominator=all_units,
        unit=spec.unit,
        n_observations=n_valid,
        aggregation=spec.aggregation,
        window=frame.window,
        filters=frame.filters,
        observation_class=observation_class(code),
        engine_code=code,
        is_estimate=False,
        method=spec.method,
        method_version=METHOD_VERSION,
    )


def engine_average(
    key: str, values: Sequence[AiMetricValue], frame: Frame, *, entity_id: UUID | None = None
) -> AiMetricValue | None:
    """The equal-weight mean of the engines' values of `key` (docs/19 section 2.6 rule 5): the
    sum of the values over the number of engines that have one. An engine with no value is left
    out, and fewer than two engines with a value make no average. Engines are never pooled.
    `entity_id` is set on the average of one entity's values."""
    have = [(v.engine_code, v.value, v.n_observations) for v in values if v.value is not None]
    if len(have) < 2:
        return None
    numerator = sum(value for _, value, _ in have if value is not None)
    return AiMetricValue(
        metric=f"{key}.engine_average",
        value=numerator / len(have),
        numerator=numerator,
        denominator=len(have),
        unit="ratio",
        n_observations=sum(n for _, _, n in have),
        aggregation=METRICS[key].aggregation,
        window=frame.window,
        filters=frame.filters,
        engines=[code for code, _, _ in have if code is not None],
        entity_id=entity_id,
        is_estimate=False,
        method=_AVERAGE,
        method_version=METHOD_VERSION,
    )


def _valid_answers(engine: EngineSummary) -> int:
    """The engine's valid answers in scope: the answers behind its Mentioned cell."""
    pooled = engine.mentioned.pooled
    return 0 if pooled is None else pooled.trials


def _previous(
    spec: Metric, previous: EngineCells | _NotAsked | None
) -> MetricCell | _NotAsked | None:
    """`previous` of a tile: absent without compare and on a key that does not compare, null
    when the engine had no answer in the window compared with, else the cell there."""
    if spec.earlier is None or isinstance(previous, _NotAsked):
        return NOT_ASKED
    return None if previous is None else spec.earlier(previous)


def engine_value(
    key: str, engine: EngineSummary, frame: Frame, citation: tuple[int, int]
) -> AiMetricValue | None:
    """The value of `key` for one engine, or None when the engine has none: a fan-out value on an
    engine that does not expose fan-out (not exposed is not 0). `citation` is the own citation
    units of the engine and all of them."""
    code, valid = engine.engine_code, _valid_answers(engine)
    if key == "ai.valid_answers":
        return count_value(key, valid, engine.mentioned.n_observations, frame, code)
    if key in SUPPRESSED:
        return suppressed_value(key, valid, frame, code)
    if key == "ai.citation_share":
        return citation_share_value(*citation, valid, frame, code)
    spec = METRICS[key]
    if spec.cell is None:
        raise ValueError(f"{key} is not a cell of the summary.")
    cell = spec.cell(engine)
    if cell is None:
        return None
    return cell_value(key, cell, frame, code, _previous(spec, engine.previous))


def engine_tiles(
    engine: EngineSummary, frame: Frame, citation: tuple[int, int]
) -> list[AiMetricValue]:
    """The tiles of one engine in the order of the note."""
    return [
        tile for key in TILES if (tile := engine_value(key, engine, frame, citation)) is not None
    ]


def engine_values(
    keys: Sequence[str],
    engines: Sequence[EngineSummary],
    frame: Frame,
    units: Mapping[str, tuple[int, int]],
) -> list[AiMetricValue]:
    """The values of `keys` for each engine, engines in the order given, then the average of the
    engines for each key that has one (the outcomes have none)."""
    values = [
        value
        for engine in engines
        for key in keys
        if (value := engine_value(key, engine, frame, units.get(engine.engine_code, (0, 0))))
        is not None
    ]
    return [
        *values,
        *(
            average
            for key in keys
            if key in AVERAGED
            and (average := engine_average(key, [v for v in values if v.metric == key], frame))
            is not None
        ),
    ]


# The cell of an entity for a key, and the cell of the same entity over the window compared with.
_ENTITY_CELLS: Final[
    dict[
        str,
        tuple[Callable[[EntityCells], MetricCell], Callable[[EntityPreviousCells], MetricCell]],
    ]
] = {
    "ai.mention_rate": (lambda e: e.mentioned, lambda p: p.mentioned),
    "ai.share_of_voice": (lambda e: e.share_of_voice, lambda p: p.share_of_voice),
}


def entity_value(key: str, code: str, cells: EntityCells, frame: Frame) -> AiMetricValue:
    """The value of `key` for one tracked entity on one engine: `previous` is absent without
    compare, null when the engine had no answer in the window compared with, else a cell."""
    pick, before = _ENTITY_CELLS[key]
    previous: MetricCell | _NotAsked | None
    if isinstance(cells.previous, _NotAsked):
        previous = NOT_ASKED
    else:
        previous = None if cells.previous is None else before(cells.previous)
    return cell_value(
        key,
        pick(cells),
        frame,
        code,
        previous,
        entity_id=cells.entity_id,
        method=_ENTITY_METHOD[key],
    )


def entity_values(
    key: str, engines: Sequence[EngineSummary], wanted: Collection[UUID], frame: Frame
) -> list[AiMetricValue]:
    """The values of `key` for the listed entities, per engine in the engine's own cell order (the
    summary's: the own entities first, and only tracked ones have cells), then one average of the
    engines for each entity."""
    values = [
        entity_value(key, engine.engine_code, cells, frame)
        for engine in engines
        for cells in engine.entities or []
        if cells.entity_id in wanted
    ]
    entities = dict.fromkeys(v.entity_id for v in values if v.entity_id is not None)
    return [
        *values,
        *(
            average
            for entity_id in entities
            if (
                average := engine_average(
                    key, [v for v in values if v.entity_id == entity_id], frame, entity_id=entity_id
                )
            )
            is not None
        ),
    ]


def is_partial(week_start: date, first: date, last: date, today: date) -> bool:
    """A week is partial when a window bound cuts it (it starts before `first` or its Sunday is
    after `last`) or it holds today, whose answers are not all in yet."""
    end = week_start + timedelta(days=6)
    return week_start < first or end > last or week_start <= today <= end


_WEEK_CELLS: Final[dict[str, Callable[[WeekCells], MetricCell]]] = {
    "ai.mention_rate": lambda week: week.mentioned,
    "ai.citation_rate": lambda week: week.cited,
    "ai.share_of_voice": lambda week: week.share_of_voice,
}


def series_of(
    key: str,
    engine: EngineSummary,
    frame: Frame,
    today: date,
    entity_id: UUID | None = None,
) -> AiMetricSeries:
    """The weekly points of `key` for one engine (or one entity of it): the weeks of the summary's
    row, with the pooling it gave, mapped point by point."""
    spec = METRICS[key]
    if spec.aggregation is None or engine.series is None:
        raise ValueError(f"The summary was read without include=series for {key}.")
    first, last = date.fromisoformat(frame.window.from_), date.fromisoformat(frame.window.to)
    points: list[AiMetricPoint] = []
    for week in engine.series:
        if entity_id is None:
            cell = _WEEK_CELLS[key](week)
        else:
            found = {cells.entity_id: cells for cells in week.entities or []}.get(entity_id)
            if found is None:
                raise ValueError(f"The week of {week.week_start} has no cells of {entity_id}.")
            cell = _ENTITY_CELLS[key][0](found)
        points.append(
            AiMetricPoint(
                t=week.week_start,
                value=cell.value,
                numerator=cell.numerator,
                denominator=cell.denominator,
                n_observations=cell.n_observations,
                n_prompts=week.prompts,
                is_partial=is_partial(week.week_start, first, last, today),
                is_pooled=week.is_pooled,
                pool=week.pool,
                pooled=cell.pooled,
            )
        )
    return AiMetricSeries(
        metric=key,
        unit=spec.unit,
        aggregation=spec.aggregation,
        engine_code=engine.engine_code,
        entity_id=entity_id,
        window=frame.window,
        filters=frame.filters,
        is_estimate=False,
        method=spec.method if entity_id is None else _ENTITY_METHOD[key],
        method_version=METHOD_VERSION,
        granularity="week",
        points=points,
    )


def entity_changes(
    data: PromptsSummary, starts: Mapping[int, datetime]
) -> list[AiEntityConfigChange] | None:
    """The day each entity configuration version first derived an answer, oldest first, in the
    project's zone: only when the window holds more than one version, else None."""
    if len(data.entity_config_versions) < 2:
        return None
    zone = ZoneInfo(data.window.timezone)
    return [
        AiEntityConfigChange(version=version, from_=starts[version].astimezone(zone).date())
        for version in data.entity_config_versions
        if version in starts
    ] or None


def meta_of(data: PromptsSummary, changes: list[AiEntityConfigChange] | None) -> AiMetricMeta:
    """What every body says about the scope, as the summary resolved it."""
    return AiMetricMeta(
        window=data.window,
        compare_window=data.compare_window,
        previous_answers=data.previous_answers,
        include_branded=data.include_branded,
        branded_only=data.branded_only,
        engine_codes=data.engine_codes,
        entities=data.entities,
        entity_config_versions=data.entity_config_versions,
        entity_config_changes=changes,
        notes=[],
    )


def frame_of(data: PromptsSummary, query: SummaryQuery) -> Frame:
    return Frame(
        window=data.window,
        filters=AiFilters(
            include_branded=data.include_branded,
            branded_only=data.branded_only,
            country_iso=query.country_iso,
            term_id=query.term_id,
        ),
    )


def total_of(data: PromptsSummary) -> SummaryTotal:
    if data.total is None:
        raise RuntimeError("The summary was asked for its total row and has none.")
    return data.total


def reduce_cells(parts: Sequence[MetricCell], weighting: Aggregation) -> MetricCell:
    """One cell from the cells of several prompts (each a count of answers over another): the rule
    a topic row of the summary is built by, and the only reduce of a group of prompts here. Prompt
    weighted: each prompt with a valid answer counts once, as its rate; the numerator is the sum of
    those rates, the denominator their number and `pooled` the answers behind them. Observation
    weighted: the sum of the numerators over the sum of the denominators. `n_observations` is every
    answer of every prompt either way."""
    n_observations = sum(part.n_observations for part in parts)
    if weighting == _OBSERVATION:
        numerator = sum(part.numerator for part in parts)
        denominator = sum(part.denominator for part in parts)
        return MetricCell(
            value=None if denominator == 0 else numerator / denominator,
            numerator=numerator,
            denominator=denominator,
            n_observations=n_observations,
        )
    rated = [part for part in parts if part.denominator > 0]
    rates = sum(part.numerator / part.denominator for part in rated)
    return MetricCell(
        value=None if not rated else rates / len(rated),
        numerator=rates,
        denominator=len(rated),
        n_observations=n_observations,
        pooled=Pooled(
            successes=round(sum(part.numerator for part in rated)),
            trials=sum(part.denominator for part in rated),
        ),
    )


def group_values(
    keys: Sequence[str], prompts: Sequence[Sequence[EngineSummary]], frame: Frame
) -> list[AiMetricValue]:
    """The values of `keys` for a group of prompts, given the engine rows of each prompt: per
    engine in the order the rows have them, then per key, each reduced over the prompts. An
    engine with no value of a key (fan-out it does not expose) has none, and an engine is never
    averaged with another."""
    codes = dict.fromkeys(engine.engine_code for engines in prompts for engine in engines)
    values: list[AiMetricValue] = []
    for code in codes:
        rows = [engine for engines in prompts for engine in engines if engine.engine_code == code]
        for key in keys:
            spec = METRICS[key]
            if spec.cell is None or spec.aggregation is None:
                raise ValueError(f"{key} is not a cell of a prompt's row.")
            cells = [cell for row in rows if (cell := spec.cell(row)) is not None]
            if cells:
                values.append(cell_value(key, reduce_cells(cells, spec.aggregation), frame, code))
    return values


def _engine_values(
    keys: Sequence[str], engines: Sequence[EngineSummary], frame: Frame
) -> list[AiMetricValue]:
    """The values of `keys` read from the rows of the summary that are built for a group already
    (a topic row, the total row): no average, no citation units."""
    return [
        value
        for engine in engines
        for key in keys
        if (value := engine_value(key, engine, frame, (0, 0))) is not None
    ]


def topic_rows(data: PromptsSummary, keys: Sequence[str], frame: Frame) -> list[AiBreakdownRow]:
    """A row per topic row of the summary, the prompts with no topic included (id null)."""
    return [
        AiBreakdownRow(
            dimension=AiDimension(
                type="topic",
                id=None if topic.term_id is None else str(topic.term_id),
                label=topic.name,
            ),
            prompts=topic.prompt_count,
            values=_engine_values(keys, topic.engines, frame),
        )
        for topic in data.topics
    ]


def engine_rows(data: PromptsSummary, keys: Sequence[str], frame: Frame) -> list[AiBreakdownRow]:
    """A row per engine, each holding the prompts in scope and the one value of its engine; no row
    when no prompt is in scope."""
    total = total_of(data)
    if total.prompt_count == 0:
        return []
    return [
        AiBreakdownRow(
            dimension=AiDimension(
                type="engine",
                id=engine.engine_code,
                label=ENGINES[EngineCode(engine.engine_code)].label,
            ),
            prompts=total.prompt_count,
            values=_engine_values(keys, [engine], frame),
        )
        for engine in total.engines
    ]


def _same(value: str | None) -> tuple[str | None, str | None]:
    """The id and the label of a group that is named by its stored value."""
    return value, value


def _persona(attributes: repository.PromptAttributes) -> tuple[str | None, str | None]:
    """The persona is a term: its id and its name. No persona is no value."""
    term = attributes.persona_term_id
    return (None if term is None else str(term)), attributes.persona_name


# The (id, label) of the group a prompt is in, for each attribute dimension.
_ATTRIBUTES: Final[
    dict[str, Callable[[repository.PromptAttributes], tuple[str | None, str | None]]]
] = {
    "intent": lambda a: _same(a.intent),
    "funnel_stage": lambda a: _same(a.funnel_stage),
    "prompt_type": lambda a: _same(a.prompt_type),
    "language": lambda a: _same(a.language_code),
    "country": lambda a: _same(a.country_iso),
    "persona": _persona,
}


def attribute_rows(
    dimension: BreakdownDimension,
    data: PromptsSummary,
    attributes: Mapping[UUID, repository.PromptAttributes],
    keys: Sequence[str],
    frame: Frame,
) -> list[AiBreakdownRow]:
    """A row per value of the attribute among the prompt rows of the summary (the prompts in
    scope, each in one group), the prompts with no value together (id null)."""
    pick = _ATTRIBUTES[dimension]
    groups: dict[tuple[str | None, str | None], list[Sequence[EngineSummary]]] = {}
    for prompt in data.prompts:
        found = attributes.get(prompt.prompt_id)
        # Left out when the prompt was archived or deleted between the two reads.
        if found is not None:
            groups.setdefault(pick(found), []).append(prompt.engines)
    return [
        AiBreakdownRow(
            dimension=AiDimension(type=dimension, id=group[0], label=group[1]),
            prompts=len(members),
            values=group_values(keys, members, frame),
        )
        for group, members in groups.items()
    ]


def ordered(rows: Sequence[AiBreakdownRow]) -> list[AiBreakdownRow]:
    """Most prompts first, then by label, the group with no value last, then by id."""
    return sorted(
        rows,
        key=lambda row: (
            -row.prompts,
            row.dimension.label is None,
            row.dimension.label or "",
            row.dimension.id or "",
        ),
    )


class MetricsService:
    def __init__(
        self, *, sessions: async_sessionmaker[AsyncSession], summaries: SummaryService
    ) -> None:
        self._sessions = sessions
        self._summaries = summaries

    async def overview(
        self, access: WorkspaceAccess, project_id: UUID, query: SummaryQuery
    ) -> AiOverviewResponse:
        """The Overview: one summary read for the scope (`rows` left out, so that the prompts in
        scope are known), then the citation units of the sources lane in a second transaction."""
        data = await self._summaries.summary(
            access,
            project_id,
            replace(
                query,
                include=frozenset({"total", "cells"}),
                rows=None,
                group_by=None,
                outcome=None,
                opportunity=None,
            ),
        )
        total = total_of(data)
        frame = frame_of(data, query)
        units, starts = await self._own_reads(access, project_id, data)
        engines = [
            AiOverviewEngine(
                engine_code=engine.engine_code,
                observation_class=observation_class(engine.engine_code),
                tiles=engine_tiles(engine, frame, units.get(engine.engine_code, (0, 0))),
            )
            for engine in total.engines
        ]
        average = [
            found
            for key in AVERAGED
            if (
                found := engine_average(
                    key,
                    [tile for engine in engines for tile in engine.tiles if tile.metric == key],
                    frame,
                )
            )
            is not None
        ]
        return AiOverviewResponse(
            data=AiOverview(
                engines=engines,
                engine_average=average,
                prompts_in_scope=count_value(
                    "ai.prompts_in_scope",
                    total.prompt_count,
                    sum(engine.mentioned.n_observations for engine in total.engines),
                    frame,
                    None,
                ),
                last_observed_at=total.last_observed_at,
                last_valid_at=total.last_valid_at,
                topics_in_scope=sum(1 for topic in data.topics if topic.term_id is not None),
            ),
            meta=meta_of(data, entity_changes(data, starts)),
        )

    async def metric(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        query: SummaryQuery,
        keys: Sequence[str],
        entity_ids: Collection[UUID] | None = None,
    ) -> AiMetricResponse:
        """One metric (the `keys` `resolve` gave): one summary read for the scope, asking only for
        what the keys need (the entities' cells, the small cells, and for citation share the
        prompts in scope), then in a second transaction the citation units (citation share) and
        the days each entity configuration took effect (the meta)."""
        citation = "ai.citation_share" in keys
        data = await self._summaries.summary(
            access,
            project_id,
            replace(
                query,
                include=frozenset(
                    {
                        "total",
                        *(("entities",) if entity_ids else ()),
                        *(("cells",) if DETAIL.intersection(keys) else ()),
                    }
                ),
                # The prompts in scope are only needed to count citation units over them.
                rows=None if citation else "none",
                group_by=None,
                outcome=None,
                opportunity=None,
            ),
        )
        total = total_of(data)
        frame = frame_of(data, query)
        if citation:
            units, starts = await self._own_reads(access, project_id, data)
        else:
            units, starts = {}, await self._starts(access, project_id, data)
        values: list[AiMetricValue]
        if keys == ("ai.prompts_in_scope",):
            values = [
                count_value(
                    keys[0],
                    total.prompt_count,
                    sum(engine.mentioned.n_observations for engine in total.engines),
                    frame,
                    None,
                )
            ]
        elif entity_ids:
            values = entity_values(keys[0], total.engines, entity_ids, frame)
        else:
            values = engine_values(keys, total.engines, frame, units)
        return AiMetricResponse(data=values, meta=meta_of(data, entity_changes(data, starts)))

    async def series(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        query: SummaryQuery,
        key: str,
        entity_ids: Collection[UUID] | None = None,
    ) -> AiSeriesResponse:
        """A metric over the weeks: the weekly points of the summary's `total` row (and of its
        entity cells with `entity_ids`), mapped. The pooling is the summary's."""
        data = await self._summaries.summary(
            access,
            project_id,
            replace(
                query,
                include=frozenset({"total", "series", *(("entities",) if entity_ids else ())}),
                rows="none",
                group_by=None,
                outcome=None,
                opportunity=None,
            ),
        )
        total = total_of(data)
        frame = frame_of(data, query)
        today = datetime.now(ZoneInfo(data.window.timezone)).date()
        if entity_ids:
            # In place of the engine's own cells: one series per listed tracked entity (only a
            # tracked entity has cells), the engine's own order.
            series = [
                series_of(key, engine, frame, today, cells.entity_id)
                for engine in total.engines
                for cells in engine.entities or []
                if cells.entity_id in entity_ids
            ]
        else:
            series = [series_of(key, engine, frame, today) for engine in total.engines]
        starts = await self._starts(access, project_id, data)
        return AiSeriesResponse(data=series, meta=meta_of(data, entity_changes(data, starts)))

    async def breakdown(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        query: SummaryQuery,
        keys: Sequence[str],
        dimension: BreakdownDimension,
    ) -> AiBreakdownResponse:
        """A metric by a dimension of the prompts: one summary read for the scope, the rows of
        which depend on the dimension (the topic rows, the total row for the engines, the prompt
        rows for an attribute of the prompt), then in a second transaction the attributes of the
        prompts in scope and the days each entity configuration took effect. Rows by prompts, at
        most `BREAKDOWN_MAX`."""
        # The prompt rows are read for an attribute of the prompt only: they are what is grouped.
        selector: SummaryRows | None = (
            "topics" if dimension == "topic" else "none" if dimension == "engine" else None
        )
        data = await self._summaries.summary(
            access,
            project_id,
            replace(
                query,
                include=frozenset({"total", *(("cells",) if DETAIL.intersection(keys) else ())}),
                rows=selector,
                group_by=None,
                outcome=None,
                opportunity=None,
            ),
        )
        frame = frame_of(data, query)
        attributes, starts = await self._breakdown_reads(access, project_id, data)
        if dimension == "topic":
            rows = topic_rows(data, keys, frame)
        elif dimension == "engine":
            rows = engine_rows(data, keys, frame)
        else:
            rows = attribute_rows(dimension, data, attributes, keys, frame)
        rows = ordered(rows)
        meta = meta_of(data, entity_changes(data, starts))
        return AiBreakdownResponse(
            data=rows[:BREAKDOWN_MAX],
            meta=AiBreakdownMeta(
                **{
                    **dict(meta),
                    "notes": [TOPIC_NOTE] if dimension == "topic" else [],
                    "rows_total": len(rows),
                    "truncated": len(rows) > BREAKDOWN_MAX,
                }
            ),
        )

    async def _breakdown_reads(
        self, access: WorkspaceAccess, project_id: UUID, data: PromptsSummary
    ) -> tuple[dict[UUID, repository.PromptAttributes], dict[int, datetime]]:
        """What the summary does not hold, in one transaction: the attributes of the prompt rows
        (only an attribute dimension has prompt rows) and the days the entity configurations took
        effect (as `_starts`). Nothing is read when no prompt is in scope."""
        ids = tuple(prompt.prompt_id for prompt in data.prompts)
        versions = bool(data.engine_codes) and total_of(data).prompt_count > 0
        if not ids and not versions:
            return {}, {}
        async with workspace_transaction(
            self._sessions, access.workspace_id, user_id=access.user_id
        ) as db:
            attributes = await repository.prompt_attributes(
                db, access.workspace_id, project_id, ids
            )
            starts = (
                await repository.version_starts(
                    db, access.workspace_id, project_id, data.entity_config_versions
                )
                if versions
                else {}
            )
        return attributes, starts

    async def _starts(
        self, access: WorkspaceAccess, project_id: UUID, data: PromptsSummary
    ) -> dict[int, datetime]:
        """When each entity configuration version took effect, for the meta. Read for every request
        with a prompt in scope, whatever the number of versions (so the count of statements does not
        depend on the data); nothing is read when no prompt is in scope."""
        if not data.engine_codes or total_of(data).prompt_count == 0:
            return {}
        async with workspace_transaction(
            self._sessions, access.workspace_id, user_id=access.user_id
        ) as db:
            return await repository.version_starts(
                db, access.workspace_id, project_id, data.entity_config_versions
            )

    async def _own_reads(
        self, access: WorkspaceAccess, project_id: UUID, data: PromptsSummary
    ) -> tuple[dict[str, tuple[int, int]], dict[int, datetime]]:
        """What the summary does not hold, in one transaction: the own and all citation units of
        each engine over the prompts and window the summary counted, and when each entity
        configuration version took effect. Nothing is read when no prompt is in scope."""
        ids = tuple(row.prompt_id for row in data.prompts)
        if not ids or not data.engine_codes:
            return {}, {}
        since, until = instants(
            date.fromisoformat(data.window.from_),
            date.fromisoformat(data.window.to),
            ZoneInfo(data.window.timezone),
        )
        scope = SourceScope(
            workspace_id=access.workspace_id,
            project_id=project_id,
            since=since,
            until=until,
            engine_codes=tuple(data.engine_codes),
            prompt_ids=ids,
            excluded_flags=EXCLUDED_FLAGS,
        )
        async with workspace_transaction(
            self._sessions, access.workspace_id, user_id=access.user_id
        ) as db:
            # The citation read joins answers to citations on a key; a planner without table
            # statistics (a new month's partition, a backfill) nests loops there and is 30 to 100
            # times slower. Local to this transaction, as in the sources and competitors reads.
            await db.execute(text("SET LOCAL enable_nestloop = off"))
            by_role = await source_repository.role_engine_totals(db, scope)
            starts = await repository.version_starts(
                db, access.workspace_id, project_id, data.entity_config_versions
            )
        units = {
            code: (
                by_role.get((code, "own"), (0, 0))[0],
                sum(by_role.get((code, role), (0, 0))[0] for role in source_repository.ROLES),
            )
            for code in data.engine_codes
        }
        return units, starts
