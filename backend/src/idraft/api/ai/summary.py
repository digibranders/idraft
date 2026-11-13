"""The prompts summary (spec section 4.5; docs/16-metrics-methodology.md sections 3 to 5): per
prompt and engine, and per topic and engine, over a window of project-local days."""

from __future__ import annotations

from collections.abc import Callable, Collection, Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from functools import partial
from typing import Any, Final, Literal, cast
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi.exceptions import RequestValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.ai import summary_repository as repository
from idraft.api.ai.summary_repository import Counts, EntityCounts, SummaryPrompt, TrackedEntity
from idraft.api.problems import NotFoundError, WindowTooLargeError
from idraft.api.ranks.repository import project_zone
from idraft.api.ranks.service import instants
from idraft.api.schemas.ai import (
    NOT_ASKED,
    CoMentionPair,
    CountrySummary,
    EngineCells,
    EngineCoMentions,
    EngineDetailCells,
    EngineSummary,
    EntityCells,
    EntityPreviousCells,
    MetricCell,
    MetricContext,
    Outcome,
    OutcomeCells,
    PointPool,
    Pooled,
    PromptsSummary,
    PromptSummaryRow,
    SummaryCompare,
    SummaryDetailContext,
    SummaryEntity,
    SummaryGroupBy,
    SummaryInclude,
    SummaryMetricContext,
    SummaryRows,
    SummaryTotal,
    TopicSummaryRow,
    WeekCells,
    _NotAsked,
)
from idraft.api.schemas.metrics import MetricWindow
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.domain.ai_engines import ENGINES
from idraft.domain.ai_metrics import POOL_BELOW_PROMPTS, pool_window, pools

# The default window, and the longest one, in project-local days.
SUMMARY_DAYS: Final = 28
SUMMARY_MAX_DAYS: Final = 92
_NONE: Final = Counts()
_NOT_NAMED: Final = EntityCounts()
_LOST_TO: Final = "lost_to:"
# The outcome each of the two opportunities that are one is (C-6).
_OPPORTUNITY_OUTCOME: Final[Mapping[str, Outcome]] = {
    "named_not_cited": "mentioned_only",
    "cited_not_named": "cited_only",
}
# Entity cells are given for at most this many tracked entities, the own ones first.
ENTITY_CELLS_MAX: Final = 20
# The engines that expose fan-out queries: the fan-out cells of any other are null (C-9).
_FANOUT_ENGINES: Final = frozenset(
    str(code) for code, engine in ENGINES.items() if engine.exposes_fanout
)


@dataclass(frozen=True, slots=True)
class SummaryQuery:
    """What one summary is asked for: the route's query parameters."""

    start: date | None = None
    end: date | None = None
    engine_codes: Sequence[str] | None = None
    include_branded: bool = False
    branded_only: bool = False
    country_iso: str | None = None
    term_id: UUID | None = None
    include: frozenset[SummaryInclude] = frozenset()
    compare: SummaryCompare = "none"
    # A window of the caller's own: both dates or neither, and they win over `compare`.
    compare_from: date | None = None
    compare_to: date | None = None
    # None: every row; "topics": no prompt rows; "none": neither list (C-3).
    rows: SummaryRows | None = None
    # Prompt rows by outcome, and by opportunity (`named_not_cited`, `cited_not_named`,
    # `nobody_named` or `lost_to:<entity id>`, the id's form already checked): C-5 and C-6.
    outcome: Outcome | None = None
    opportunity: str | None = None
    # "country": one entry per market of the prompts in scope (C-7).
    group_by: SummaryGroupBy | None = None


def _out_of_range(field: str) -> RequestValidationError:
    return RequestValidationError(
        [{"loc": ("query", field), "type": "out_of_range", "msg": f"`{field}` is out of range."}]
    )


def summary_dates(
    start: date | None,
    end: date | None,
    today: date,
    names: tuple[str, str] = ("from", "to"),
) -> tuple[date, date]:
    """The local days a summary covers, both included. `names` are the parameters the dates
    came from, for the error."""
    first_name, last_name = names
    last = end or today
    try:
        first = start or last - timedelta(days=SUMMARY_DAYS - 1)
        days = (last - first).days + 1
    except OverflowError:
        raise _out_of_range(last_name) from None
    if first > last:
        raise RequestValidationError(
            [
                {
                    "loc": ("query", first_name),
                    "type": "range_invalid",
                    "msg": f"`{first_name}` is after `{last_name}`.",
                }
            ]
        )
    if days > SUMMARY_MAX_DAYS:
        raise WindowTooLargeError(
            f"A window is at most {SUMMARY_MAX_DAYS} days.", limit_days=SUMMARY_MAX_DAYS
        )
    return first, last


def previous_dates(first: date, last: date) -> tuple[date, date]:
    """The days just before `first` to `last`, as many of them (docs/19 section 2.5
    `previous_period`)."""
    try:
        return first - (last - first) - timedelta(days=1), first - timedelta(days=1)
    except OverflowError:
        raise _out_of_range("from") from None


def _a_year_before(day: date) -> date:
    if (day.month, day.day) == (2, 29):
        return day.replace(year=day.year - 1, day=28)
    return day.replace(year=day.year - 1)


def previous_year_dates(first: date, last: date) -> tuple[date, date]:
    """The same dates one year earlier; 29 February becomes 28 February (C-1)."""
    try:
        return _a_year_before(first), _a_year_before(last)
    except ValueError:
        raise _out_of_range("from") from None


def compare_dates(
    first: date,
    last: date,
    compare: SummaryCompare,
    compare_from: date | None,
    compare_to: date | None,
    today: date,
) -> tuple[date, date] | None:
    """The days compared with, or None when nothing is compared. Two dates of the caller's own
    win over `compare` whatever it says; one alone is refused at the missing one (C-1)."""
    if compare_from is not None or compare_to is not None:
        if compare_from is None or compare_to is None:
            raise RequestValidationError(
                [
                    {
                        "loc": ("query", "compare_to" if compare_to is None else "compare_from"),
                        "type": "missing",
                        "msg": "`compare_from` and `compare_to` come together.",
                    }
                ]
            )
        return summary_dates(compare_from, compare_to, today, ("compare_from", "compare_to"))
    if compare == "previous_period":
        return previous_dates(first, last)
    if compare == "previous_year":
        return previous_year_dates(first, last)
    return None


def _instants(first: date, last: date, zone: ZoneInfo, name: str) -> tuple[datetime, datetime]:
    try:
        return instants(first, last, zone)
    except (OverflowError, ValueError):
        raise _out_of_range(name) from None


def summary_weeks(first: date, last: date) -> list[date]:
    """The Mondays of the weeks the days `first` to `last` touch: at most 14 in 92 days."""
    week = first - timedelta(days=first.weekday())
    weeks = [week]
    while last - week >= timedelta(days=7):
        week += timedelta(days=7)
        weeks.append(week)
    return weeks


def _cell(numerator: float, denominator: int, n_observations: int) -> MetricCell:
    return MetricCell(
        value=None if denominator == 0 else numerator / denominator,
        numerator=numerator,
        denominator=denominator,
        n_observations=n_observations,
    )


def _engine(counts: Counts) -> EngineCells:
    """The cells of one prompt and engine: counts of answers."""
    valid, total = counts.n_valid, counts.n_observations
    return EngineCells(
        mentioned=_cell(counts.mentioned, valid, total),
        cited=_cell(counts.cited, valid, total),
        outcomes=OutcomeCells(
            mentioned_and_cited=_cell(counts.mentioned_and_cited, valid, total),
            mentioned_only=_cell(counts.mentioned_only, valid, total),
            cited_only=_cell(counts.cited_only, valid, total),
            neither=_cell(counts.neither, valid, total),
        ),
        share_of_voice=_cell(counts.sov_share, counts.sov_answers, total),
    )


def _prompt_weighted(parts: Sequence[tuple[int, int]], n_observations: int) -> MetricCell:
    """The prompt weighted rate of a topic (docs/16 section 3, docs/17 section 4.1) from each
    prompt's (successes, valid answers): each prompt with a valid answer counts once, as
    successes / valid answers. The numerator is the sum of those rates, the denominator the
    number of such prompts, and `pooled` the answers."""
    rated = [(successes, valid) for successes, valid in parts if valid > 0]
    cell = _cell(sum(successes / valid for successes, valid in rated), len(rated), n_observations)
    return cell.model_copy(
        update={
            "pooled": Pooled(
                successes=sum(successes for successes, _ in rated),
                trials=sum(valid for _, valid in rated),
            )
        }
    )


def _weighted(members: Sequence[Counts], pick: Callable[[Counts], int]) -> MetricCell:
    return _prompt_weighted(
        [(pick(counts), counts.n_valid) for counts in members],
        sum(counts.n_observations for counts in members),
    )


def _topic_engine(members: Sequence[Counts]) -> EngineCells:
    """The cells of a topic and engine from the counts of the topic's prompts. Share of voice
    stays one answer one weight (docs/16 section 5), so it is the sum over the answers."""
    return EngineCells(
        mentioned=_weighted(members, lambda counts: counts.mentioned),
        cited=_weighted(members, lambda counts: counts.cited),
        outcomes=OutcomeCells(
            mentioned_and_cited=_weighted(members, lambda counts: counts.mentioned_and_cited),
            mentioned_only=_weighted(members, lambda counts: counts.mentioned_only),
            cited_only=_weighted(members, lambda counts: counts.cited_only),
            neither=_weighted(members, lambda counts: counts.neither),
        ),
        share_of_voice=_cell(
            sum(counts.sov_share for counts in members),
            sum(counts.sov_answers for counts in members),
            sum(counts.n_observations for counts in members),
        ),
    )


def _detail(code: str, members: Sequence[Counts], *, topic: bool) -> EngineDetailCells:
    """The small cells of an engine from the counts of the row's prompts (`members` holds the
    prompt alone, or the topic's, the total's or the country's prompts; C-9). Counts of answers in
    a prompt row; in the others the three rates are prompt weighted as Mentioned is, and the
    share and the mean stay sums over sums. A cell with a denominator of 0 has no value (a rate
    of 0 is a real one), and the fan-out cells of an engine without fan-out are null."""
    n_observations = sum(counts.n_observations for counts in members)

    def ratio(successes: Callable[[Counts], int], trials: Callable[[Counts], int]) -> MetricCell:
        return _cell(
            sum(successes(counts) for counts in members),
            sum(trials(counts) for counts in members),
            n_observations,
        )

    def rate(successes: Callable[[Counts], int], trials: Callable[[Counts], int]) -> MetricCell:
        if not topic:
            return ratio(successes, trials)
        return _prompt_weighted(
            [(successes(counts), trials(counts)) for counts in members], n_observations
        )

    fanout = code in _FANOUT_ENGINES
    return EngineDetailCells(
        cited_given_citations=rate(lambda c: c.citing_own, lambda c: c.n_citing),
        citation_share=ratio(lambda c: c.own_units, lambda c: c.all_units),
        first_mention=rate(lambda c: c.first_mentions, lambda c: c.mentioned),
        fanout_presence=rate(lambda c: c.fanout_answers, lambda c: c.n_valid) if fanout else None,
        fanout_mean=ratio(lambda c: c.fanout_queries, lambda c: c.fanout_answers)
        if fanout
        else None,
    )


def sum_counts(parts: Sequence[Counts]) -> Counts:
    """The counts of one prompt and engine over several weeks, added up: each count is the sum,
    each last time the newest."""
    observed = [part.last_observed_at for part in parts if part.last_observed_at is not None]
    valid = [part.last_valid_at for part in parts if part.last_valid_at is not None]
    return Counts(
        n_observations=sum(part.n_observations for part in parts),
        n_valid=sum(part.n_valid for part in parts),
        mentioned=sum(part.mentioned for part in parts),
        cited=sum(part.cited for part in parts),
        mentioned_and_cited=sum(part.mentioned_and_cited for part in parts),
        mentioned_only=sum(part.mentioned_only for part in parts),
        cited_only=sum(part.cited_only for part in parts),
        neither=sum(part.neither for part in parts),
        sov_answers=sum(part.sov_answers for part in parts),
        sov_share=sum(part.sov_share for part in parts),
        last_observed_at=max(observed, default=None),
        last_valid_at=max(valid, default=None),
        lost_to=sum(part.lost_to for part in parts),
        n_citing=sum(part.n_citing for part in parts),
        citing_own=sum(part.citing_own for part in parts),
        own_units=sum(part.own_units for part in parts),
        all_units=sum(part.all_units for part in parts),
        first_mentions=sum(part.first_mentions for part in parts),
        fanout_answers=sum(part.fanout_answers for part in parts),
        fanout_queries=sum(part.fanout_queries for part in parts),
    )


def sum_named(parts: Sequence[EntityCounts]) -> EntityCounts:
    """One entity's counts for one prompt and engine over several weeks, added up."""
    return EntityCounts(
        mentioned=sum(part.mentioned for part in parts),
        sov_share=sum(part.sov_share for part in parts),
    )


def entity_cell_ids(tracked: Sequence[TrackedEntity]) -> list[UUID]:
    """The tracked entities the entity cells and the co-mentions are given for: the own ones
    first, so that the cut keeps them, then the rest in the order given, at most
    `ENTITY_CELLS_MAX`."""
    return [entity.id for entity in sorted(tracked, key=lambda e: e.role != "own")][
        :ENTITY_CELLS_MAX
    ]


def co_mention_pairs(found: Mapping[tuple[UUID, UUID], int]) -> list[CoMentionPair]:
    """The pairs `(a, b)` (the lower id first) with the answers that name both, most answers
    first, then by id (C-8)."""
    return [
        CoMentionPair(a=a, b=b, answers=answers)
        for (a, b), answers in sorted(found.items(), key=lambda item: (-item[1], item[0]))
    ]


def _co_mentions(
    engine_codes: Sequence[str],
    by_prompt: Mapping[tuple[UUID, str], Counts],
    pairs: Mapping[tuple[str, UUID, UUID], int],
) -> list[EngineCoMentions]:
    """One entry per engine shown: its valid answers in scope, and the pairs read for it."""
    return [
        EngineCoMentions(
            engine_code=code,
            answers=sum(c.n_valid for (_, engine), c in by_prompt.items() if engine == code),
            pairs=co_mention_pairs(
                {(a, b): answers for (engine, a, b), answers in pairs.items() if engine == code}
            ),
        )
        for code in engine_codes
    ]


def _outcome_answers(counts: Counts, outcome: Outcome) -> int:
    """The valid answers of `counts` that had `outcome`."""
    if outcome == "mentioned_and_cited":
        return counts.mentioned_and_cited
    if outcome == "mentioned_only":
        return counts.mentioned_only
    if outcome == "cited_only":
        return counts.cited_only
    return counts.neither


def _opportunity_answers(counts: Counts, opportunity: str) -> int:
    """The valid answers of `counts` that are `opportunity` (C-6). `lost_to` holds what
    `counts_by_prompt` read for the competitor asked for, 0 when none was."""
    if opportunity == "nobody_named":
        return counts.n_valid - counts.sov_answers
    if opportunity.startswith(_LOST_TO):
        return counts.lost_to
    return _outcome_answers(counts, _OPPORTUNITY_OUTCOME[opportunity])


def lost_to_competitor(opportunity: str | None, tracked: Sequence[TrackedEntity]) -> UUID | None:
    """The competitor of the project that `lost_to:<entity id>` names. None for any other
    opportunity, and for an id that is not a competitor of the project (the own brand, an unknown
    entity, another project's or workspace's): that opportunity then matches no answer (C-6)."""
    if opportunity is None or not opportunity.startswith(_LOST_TO):
        return None
    entity_id = UUID(opportunity.removeprefix(_LOST_TO))
    competitor = any(e.id == entity_id and e.role == "competitor" for e in tracked)
    return entity_id if competitor else None


def narrowed_prompts(
    prompts: Sequence[SummaryPrompt],
    engine_codes: Sequence[str],
    by_prompt: Mapping[tuple[UUID, str], Counts],
    *,
    outcome: Outcome | None,
    opportunity: str | None,
) -> list[SummaryPrompt]:
    """The prompts that pass each filter asked for: one that has, on the engines shown, at least
    one valid answer of the outcome, and one that has at least one of the opportunity (C-5, C-6).
    The two are two rules of the row, not one rule of an answer."""
    tests: list[Callable[[Counts], int]] = []
    if outcome is not None:
        tests.append(partial(_outcome_answers, outcome=outcome))
    if opportunity is not None:
        tests.append(partial(_opportunity_answers, opportunity=opportunity))
    return [
        prompt
        for prompt in prompts
        if all(
            any(
                test(by_prompt[(prompt.id, code)]) > 0
                for code in engine_codes
                if (prompt.id, code) in by_prompt
            )
            for test in tests
        )
    ]


def _week(
    week: date,
    prompts: int,
    pool: PointPool | None,
    cells: EngineCells,
    entities: list[EntityCells] | None,
) -> WeekCells:
    """One point of a series, for the week starting `week`: the cells of its own week, or, with a
    `pool`, those of the weeks it pools (C-10, C-11); `entities` the same weeks' cells per
    entity, when they were asked for."""
    return WeekCells(
        week_start=week,
        prompts=prompts,
        is_pooled=pool is not None,
        pool=pool,
        mentioned=cells.mentioned,
        cited=cells.cited,
        share_of_voice=cells.share_of_voice,
        entities=entities,
    )


@dataclass(frozen=True, slots=True)
class _Read:
    """What the queries read, by prompt and engine. `entity_ids` is None unless the entity cells
    were asked for, `weeks` None unless the series was (`first` and `last` are then the days of
    the window and `timezone` the project's, which a pooled point states; `weekly_named` is the
    entity counts by week, when the entity cells were asked for too), and `previous` None
    unless a window was compared with (`previous_named` is then its entity counts, when the
    entity cells were asked for)."""

    counts: Mapping[tuple[UUID, str], Counts]
    entity_ids: Sequence[UUID] | None = None
    named: Mapping[tuple[UUID, str, UUID], EntityCounts] = field(default_factory=dict)
    weeks: Sequence[date] | None = None
    weekly: Mapping[tuple[UUID, str, date], Counts] = field(default_factory=dict)
    weekly_named: Mapping[tuple[UUID, str, date, UUID], EntityCounts] = field(default_factory=dict)
    first: date = date.min
    last: date = date.max
    timezone: str = "UTC"
    previous: Mapping[tuple[UUID, str], Counts] | None = None
    previous_named: Mapping[tuple[UUID, str, UUID], EntityCounts] = field(default_factory=dict)
    # Whether `counts` holds the small cells' counts (`include=cells`): the rows then carry them.
    detail: bool = False


def _entity_cells(
    code: str,
    entity_id: UUID,
    prompt_ids: Collection[UUID],
    window_counts: Mapping[tuple[UUID, str], Counts],
    window_named: Mapping[tuple[UUID, str, UUID], EntityCounts],
    *,
    topic: bool,
) -> EntityPreviousCells:
    """One entity's Mentioned and Share of voice over the window the counts were read for: the
    window itself, or the one compared with."""
    parts = [
        (
            window_counts.get((prompt, code), _NONE),
            window_named.get((prompt, code, entity_id), _NOT_NAMED),
        )
        for prompt in prompt_ids
    ]
    n_observations = sum(counts.n_observations for counts, _ in parts)
    if topic:
        mentioned = _prompt_weighted(
            [(named.mentioned, counts.n_valid) for counts, named in parts], n_observations
        )
    else:
        mentioned = _cell(
            sum(named.mentioned for _, named in parts),
            sum(counts.n_valid for counts, _ in parts),
            n_observations,
        )
    return EntityPreviousCells(
        mentioned=mentioned,
        share_of_voice=_cell(
            sum(named.sov_share for _, named in parts),
            sum(counts.sov_answers for counts, _ in parts),
            n_observations,
        ),
    )


def _week_entity(
    code: str,
    entity_id: UUID,
    counts: Mapping[tuple[UUID, str], Counts],
    weekly_named: Mapping[tuple[UUID, str, date, UUID], EntityCounts],
    weeks: Sequence[date],
    *,
    topic: bool,
) -> EntityCells:
    """One entity's cells of a point of a series: over the `weeks` the point holds, which are
    the weeks of its own cells (C-11). `counts` are the counts of the row's prompts over those
    weeks, already added up; the entity's counts over them are added up here, the same way."""
    named: dict[tuple[UUID, str, UUID], EntityCounts] = {}
    for prompt, _ in counts:
        held = [
            weekly_named[key]
            for w in weeks
            if (key := (prompt, code, w, entity_id)) in weekly_named
        ]
        if held:
            named[(prompt, code, entity_id)] = held[0] if len(held) == 1 else sum_named(held)
    cells = _entity_cells(
        code, entity_id, [prompt for prompt, _ in counts], counts, named, topic=topic
    )
    return EntityCells(
        entity_id=entity_id, mentioned=cells.mentioned, share_of_voice=cells.share_of_voice
    )


def _window_named(
    weekly_named: Mapping[tuple[UUID, str, date, UUID], EntityCounts],
) -> dict[tuple[UUID, str, UUID], EntityCounts]:
    """The entity counts of the whole window from those of its weeks."""
    weeks: dict[tuple[UUID, str, UUID], list[EntityCounts]] = {}
    for (prompt, code, _, entity_id), counts in weekly_named.items():
        weeks.setdefault((prompt, code, entity_id), []).append(counts)
    return {key: sum_named(held) for key, held in weeks.items()}


def _engine_row(
    code: str, prompt_ids: Collection[UUID], read: _Read, *, topic: bool
) -> EngineSummary:
    """One engine's cells for a prompt row (`prompt_ids` holds the prompt alone) or a topic row
    (its prompts)."""

    def found(source: Mapping[tuple[UUID, str], Counts]) -> list[Counts]:
        return [source[(prompt, code)] for prompt in prompt_ids if (prompt, code) in source]

    def cells(members: Sequence[Counts]) -> EngineCells:
        if topic:
            return _topic_engine(members)
        return _engine(members[0] if members else _NONE)

    current = found(read.counts)
    row = cells(current)
    previous: EngineCells | _NotAsked | None = NOT_ASKED
    if read.previous is not None:
        # No answer of the row's prompts in the window before is null, so that no data is never
        # read as a rate of 0; answers that are none valid are cells with a denominator of 0.
        before = found(read.previous)
        previous = cells(before) if before else None

    def entity(entity_id: UUID) -> EntityCells:
        current = _entity_cells(code, entity_id, prompt_ids, read.counts, read.named, topic=topic)
        earlier: EntityPreviousCells | _NotAsked | None = NOT_ASKED
        if read.previous is not None:
            # Null exactly when the engine's `previous` is null (C-2).
            earlier = (
                None
                if previous is None
                else _entity_cells(
                    code, entity_id, prompt_ids, read.previous, read.previous_named, topic=topic
                )
            )
        return EntityCells(
            entity_id=entity_id,
            mentioned=current.mentioned,
            share_of_voice=current.share_of_voice,
            previous=earlier,
        )

    def point(week: date) -> WeekCells:
        prompts = sum(
            1
            for p in prompt_ids
            if (counts := read.weekly.get((p, code, week))) is not None and counts.n_valid > 0
        )
        pool: PointPool | None = None
        held_weeks = [week]
        if pools(prompt_row=not topic, prompts=prompts):
            # The pooled weeks are read from the weeks already read, clipped to the window.
            start, end, weeks = pool_window(week, read.first, read.last)
            held_weeks = [week - timedelta(weeks=back) for back in range(weeks)]
            pool = PointPool(
                weeks=weeks,
                window=MetricWindow(
                    from_=start.isoformat(), to=end.isoformat(), timezone=read.timezone
                ),
                reason="few_prompts" if topic else "prompt_point",
                below_prompts=POOL_BELOW_PROMPTS,
            )
        # Each prompt's counts over the weeks the point holds are added first, then the cells are
        # built as the row's are; the entity cells are built over the same counts (C-11).
        members: dict[UUID, Counts] = {}
        for prompt in prompt_ids:
            held = [
                read.weekly[key] for w in held_weeks if (key := (prompt, code, w)) in read.weekly
            ]
            if held:
                members[prompt] = held[0] if len(held) == 1 else sum_counts(held)
        entities = None
        if read.entity_ids is not None:
            by_prompt = {(prompt, code): counts for prompt, counts in members.items()}
            entities = [
                _week_entity(code, entity_id, by_prompt, read.weekly_named, held_weeks, topic=topic)
                for entity_id in read.entity_ids
            ]
        return _week(week, prompts, pool, cells(list(members.values())), entities)

    return EngineSummary(
        engine_code=code,
        mentioned=row.mentioned,
        cited=row.cited,
        outcomes=row.outcomes,
        share_of_voice=row.share_of_voice,
        previous=previous,
        series=None if read.weeks is None else [point(week) for week in read.weeks],
        entities=None if read.entity_ids is None else [entity(e) for e in read.entity_ids],
        detail=_detail(code, current, topic=topic) if read.detail else None,
    )


def _last_answers(
    prompt_ids: Collection[UUID],
    engine_codes: Sequence[str],
    by_prompt: Mapping[tuple[UUID, str], Counts],
) -> tuple[datetime | None, datetime | None]:
    """When the newest counted answer of these prompts on these engines came, and the newest
    valid one; None when the window has none."""
    counted = [
        by_prompt[(prompt, code)]
        for prompt in prompt_ids
        for code in engine_codes
        if (prompt, code) in by_prompt
    ]
    observed = [c.last_observed_at for c in counted if c.last_observed_at is not None]
    valid = [c.last_valid_at for c in counted if c.last_valid_at is not None]
    return max(observed, default=None), max(valid, default=None)


def _prompt_row(
    prompt: SummaryPrompt, engine_codes: Sequence[str], read: _Read
) -> PromptSummaryRow:
    last_observed, last_valid = _last_answers([prompt.id], engine_codes, read.counts)
    return PromptSummaryRow(
        prompt_id=prompt.id,
        text=prompt.text,
        is_branded=prompt.is_branded,
        topic_term_ids=list(prompt.topic_term_ids),
        last_observed_at=last_observed,
        last_valid_at=last_valid,
        engines=[_engine_row(code, [prompt.id], read, topic=False) for code in engine_codes],
    )


def _topic_row(
    term_id: UUID | None,
    name: str | None,
    members: Collection[UUID],
    engine_codes: Sequence[str],
    read: _Read,
) -> TopicSummaryRow:
    last_observed, last_valid = _last_answers(members, engine_codes, read.counts)
    return TopicSummaryRow(
        term_id=term_id,
        name=name,
        prompt_count=len(members),
        last_observed_at=last_observed,
        last_valid_at=last_valid,
        engines=[_engine_row(code, members, read, topic=True) for code in engine_codes],
    )


def _countries(
    prompts: Sequence[SummaryPrompt], engine_codes: Sequence[str], read: _Read
) -> list[CountrySummary]:
    """One entry per market of the prompts in scope, sorted by code, each built as a topic row of
    its prompts (C-7). A prompt's market is its own, not the location of its answers, and a
    prompt without one is in no entry."""
    markets: dict[str, list[UUID]] = {}
    for prompt in prompts:
        if prompt.country_iso is not None:
            markets.setdefault(prompt.country_iso, []).append(prompt.id)
    return [
        CountrySummary(
            country_iso=iso,
            engines=[_engine_row(code, markets[iso], read, topic=True) for code in engine_codes],
        )
        for iso in sorted(markets)
    ]


def _detail_context() -> SummaryDetailContext:
    """How the cells of `EngineSummary.detail` are weighted, said once (C-9)."""
    per_prompt = "Counts of valid answers to one prompt, so each answer weighs the same."
    rates = (
        "Prompt weighted in a topic, total or country row: the mean over the prompts of each "
        "prompt's share (prompts with nothing to rate are left out); `pooled` holds the answers."
    )
    sums = "In a topic, total or country row, sums over sums: every answer weighs the same."

    def rate(metric: str, method: str) -> MetricContext:
        return MetricContext(
            metric=metric,
            prompt_rows="observation_weighted",
            topic_rows="prompt_weighted",
            method=f"{method} {per_prompt} {rates}",
        )

    def total(metric: str, method: str) -> MetricContext:
        return MetricContext(
            metric=metric,
            prompt_rows="observation_weighted",
            topic_rows="observation_weighted",
            method=f"{method} {per_prompt} {sums}",
        )

    return SummaryDetailContext(
        cited_given_citations=rate(
            "ai.citation_rate_given_citations",
            "Valid answers that cite the own domain, of the valid answers with a citation.",
        ),
        citation_share=total(
            "ai.citation_share",
            "The own domain's citation units of all the units of the valid answers (a unit is a "
            "distinct canonical URL of an answer).",
        ),
        first_mention=rate(
            "ai.first_mention_rate",
            "Valid answers that name the own brand before any other tracked entity, of the "
            "valid answers that name it.",
        ),
        fanout_presence=rate(
            "ai.fanout_presence_rate",
            "Valid answers with at least one fan-out query. Null on an engine without fan-out.",
        ),
        fanout_mean=total(
            "ai.fanout_mean_queries",
            "Fan-out queries per valid answer that has some. Null on an engine without fan-out.",
        ),
    )


def _context(*, detail: bool) -> SummaryMetricContext:
    per_prompt = "Counts of valid answers to one prompt, so each answer weighs the same."
    topic = (
        "Prompt weighted: the mean over the topic's prompts of each prompt's share of valid "
        "answers (prompts with no valid answer are left out); `pooled` holds the answers."
    )
    return SummaryMetricContext(
        mentioned=MetricContext(
            metric="ai.mention_rate",
            prompt_rows="observation_weighted",
            topic_rows="prompt_weighted",
            method=f"Valid answers that name the own brand. {per_prompt} {topic}",
        ),
        cited=MetricContext(
            metric="ai.citation_rate",
            prompt_rows="observation_weighted",
            topic_rows="prompt_weighted",
            method=f"Valid answers that cite the own domain. {per_prompt} {topic}",
        ),
        outcomes=MetricContext(
            metric="ai.outcome_mix",
            prompt_rows="observation_weighted",
            topic_rows="prompt_weighted",
            method=f"The four outcomes of valid answers, which add up to the denominator. "
            f"{per_prompt} {topic}",
        ),
        share_of_voice=MetricContext(
            metric="ai.share_of_voice",
            prompt_rows="observation_weighted",
            topic_rows="observation_weighted",
            method="Per answer that names a tracked entity, the own brands' share of the "
            "entities it names (docs/16 section 5), summed over those answers; also in a topic "
            "row, where every answer weighs the same.",
        ),
        detail=_detail_context() if detail else None,
    )


class SummaryService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    async def summary(
        self, access: WorkspaceAccess, project_id: UUID, query: SummaryQuery
    ) -> PromptsSummary:
        ws = access.workspace_id
        async with self._transaction(access) as db:
            zone_row = await project_zone(db, ws, project_id)
            if zone_row is None:
                raise NotFoundError
            zone = ZoneInfo(zone_row.timezone)
            today = datetime.now(zone).date()
            first, last = summary_dates(query.start, query.end, today)
            since, until = _instants(first, last, zone, "to")
            compared = compare_dates(
                first, last, query.compare, query.compare_from, query.compare_to, today
            )
            before = (
                None
                if compared is None
                else _instants(
                    *compared, zone, "from" if query.compare_from is None else "compare_to"
                )
            )
            prompts = await repository.summary_prompts(
                db,
                ws,
                project_id,
                include_branded=query.include_branded,
                branded_only=query.branded_only,
                country_iso=query.country_iso,
                term_id=query.term_id,
            )
            ids = [prompt.id for prompt in prompts]
            window: dict[str, Any] = {
                "since": since,
                "until": until,
                "engine_codes": query.engine_codes,
            }
            tracked = await repository.tracked_entities(db, ws, project_id)
            by_prompt = await repository.counts_by_prompt(
                db,
                ws,
                project_id,
                ids,
                **window,
                lost_to=lost_to_competitor(query.opportunity, tracked),
                # The small cells' counts are columns of this same statement (C-9).
                detail="cells" in query.include,
            )
            # The window compared with is read over the same prompts, so the branded exclusion,
            # the term subtree and the country scope hold for it as they do for the window.
            before_window: dict[str, Any] = (
                {}
                if before is None
                else {"since": before[0], "until": before[1], "engine_codes": query.engine_codes}
            )
            previous = (
                None
                if before is None
                else await repository.counts_by_prompt(db, ws, project_id, ids, **before_window)
            )
            # `rows=none` reads no topic: the rollup, the term subtree and the names are skipped.
            held: dict[UUID, set[UUID]] = {}
            if query.rows != "none":
                held = await repository.topic_rollup(db, ws, ids)
                if query.term_id is not None:
                    # Under a term filter the topic rows are the term's and those below it.
                    subtree = await repository.term_subtree(db, ws, query.term_id)
                    held = {term: members for term, members in held.items() if term in subtree}
            weeks = summary_weeks(first, last) if "series" in query.include else None
            weekly: Mapping[tuple[UUID, str, date], Counts] = (
                {}
                if weeks is None
                else await repository.weekly_counts(
                    db, ws, project_id, ids, **window, timezone=zone_row.timezone
                )
            )
            versions = await repository.entity_config_versions(db, ws, project_id, ids, **window)
            enabled = await repository.enabled_engine_codes(db, ws, project_id)
            # The own entities first, so the cut keeps them; then the competitors by name.
            tracked_ids = entity_cell_ids(tracked)
            cell_ids = tracked_ids if "entities" in query.include else None
            # With the series, ONE statement reads the entity counts by week, and the window's
            # are their sum; without it the window's are read alone.
            weekly_named: Mapping[tuple[UUID, str, date, UUID], EntityCounts] = {}
            named: Mapping[tuple[UUID, str, UUID], EntityCounts] = {}
            if cell_ids is not None and weeks is not None:
                weekly_named = await repository.weekly_entity_counts(
                    db, ws, project_id, ids, cell_ids, **window, timezone=zone_row.timezone
                )
                named = _window_named(weekly_named)
            elif cell_ids is not None:
                named = await repository.entity_counts(db, ws, project_id, ids, cell_ids, **window)
            previous_named: Mapping[tuple[UUID, str, UUID], EntityCounts] = (
                {}
                if before is None or cell_ids is None
                else await repository.entity_counts(
                    db, ws, project_id, ids, cell_ids, **before_window
                )
            )
            # One self join over the mentions, for the same prompts as every other read.
            pairs = (
                await repository.comention_pairs(db, ws, project_id, ids, tracked_ids, **window)
                if "co_mentions" in query.include
                else {}
            )
            names = await repository.topic_names(db, ws, held.keys())
        seen = {engine for _, engine in by_prompt}
        shown = sorted(
            code
            for code in set(enabled) | seen
            if query.engine_codes is None or code in query.engine_codes
        )
        read = _Read(
            counts=by_prompt,
            entity_ids=cell_ids,
            named=named,
            weeks=weeks,
            weekly=weekly,
            weekly_named=weekly_named,
            first=first,
            last=last,
            timezone=zone_row.timezone,
            previous=previous,
            previous_named=previous_named,
            detail="cells" in query.include,
        )
        # The filters choose prompt rows and nothing else: every other block reads every prompt
        # in scope (C-5, C-6).
        prompt_rows = (
            [
                _prompt_row(prompt, shown, read)
                for prompt in narrowed_prompts(
                    prompts,
                    shown,
                    by_prompt,
                    outcome=query.outcome,
                    opportunity=query.opportunity,
                )
            ]
            if query.rows is None
            else []
        )
        # Topic rows are sums of the prompts' counts. Each topic row holds the prompts given the
        # term or a term below it, each once; the last row holds the prompts given no topic,
        # except under a term filter.
        topic_rows = [
            _topic_row(term_id, names.get(term_id), held[term_id], shown, read)
            for term_id in sorted(held, key=lambda term: (names.get(term, ""), str(term)))
        ]
        untopiced = [prompt.id for prompt in prompts if not prompt.topic_term_ids]
        if untopiced and query.term_id is None and query.rows != "none":
            topic_rows.append(_topic_row(None, None, untopiced, shown, read))
        total = None
        if "total" in query.include:
            # Every prompt in scope, built as a topic row is (C-4); Python over the counts read.
            last_observed, last_valid = _last_answers(ids, shown, by_prompt)
            total = SummaryTotal(
                prompt_count=len(ids),
                last_observed_at=last_observed,
                last_valid_at=last_valid,
                engines=[_engine_row(code, ids, read, topic=True) for code in shown],
            )
        return PromptsSummary(
            window=MetricWindow(
                from_=first.isoformat(), to=last.isoformat(), timezone=zone_row.timezone
            ),
            compare_window=None
            if compared is None
            else MetricWindow(
                from_=compared[0].isoformat(),
                to=compared[1].isoformat(),
                timezone=zone_row.timezone,
            ),
            # The valid answers of the engines shown, as the cells of `previous` read them.
            previous_answers=None
            if previous is None
            else sum(c.n_valid for (_, engine), c in previous.items() if engine in shown),
            include_branded=query.include_branded or query.branded_only,
            branded_only=query.branded_only,
            engine_codes=shown,
            metric_context=_context(detail="cells" in query.include),
            entities=[
                SummaryEntity(
                    entity_id=entity.id,
                    name=entity.name,
                    role=cast(Literal["own", "competitor"], entity.role),
                )
                for entity in tracked
            ],
            entity_config_versions=versions,
            prompts=prompt_rows,
            topics=topic_rows,
            total=total,
            co_mentions=(
                _co_mentions(shown, by_prompt, pairs) if "co_mentions" in query.include else None
            ),
            by_country=_countries(prompts, shown, read) if query.group_by == "country" else None,
        )
