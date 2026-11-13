"""The prompts summary (spec section 4.5; docs/16-metrics-methodology.md sections 3 to 5): per
prompt and engine, and per topic and engine, over a window of project-local days."""

from __future__ import annotations

from collections.abc import Callable, Collection, Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Final, Literal, cast
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi.exceptions import RequestValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.ai import summary_repository as repository
from idraft.api.ai.summary_repository import Counts, EntityCounts, SummaryPrompt
from idraft.api.problems import NotFoundError, WindowTooLargeError
from idraft.api.ranks.repository import project_zone
from idraft.api.ranks.service import instants
from idraft.api.schemas.ai import (
    NOT_ASKED,
    EngineCells,
    EngineSummary,
    EntityCells,
    EntityPreviousCells,
    MetricCell,
    MetricContext,
    OutcomeCells,
    Pooled,
    PromptsSummary,
    PromptSummaryRow,
    SummaryCompare,
    SummaryEntity,
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

# The default window, and the longest one, in project-local days.
SUMMARY_DAYS: Final = 28
SUMMARY_MAX_DAYS: Final = 92
_NONE: Final = Counts()
_NOT_NAMED: Final = EntityCounts()
# Entity cells are given for at most this many tracked entities, the own ones first.
ENTITY_CELLS_MAX: Final = 20


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


def _week(week: date, cells: EngineCells) -> WeekCells:
    """One point of a series. The first and last weeks are cut at the window bounds. On a prompt
    row the weeks add up to the window cell (numerators, denominators, n_observations). On a
    topic row `mentioned` and `cited` are prompt weighted per week, so their numerators and
    denominators (sums of per-week prompt rates and prompt counts) do not add up to the window
    cell; `pooled`, share of voice and n_observations do."""
    return WeekCells(
        week_start=week,
        mentioned=cells.mentioned,
        cited=cells.cited,
        share_of_voice=cells.share_of_voice,
    )


@dataclass(frozen=True, slots=True)
class _Read:
    """What the queries read, by prompt and engine. `entity_ids` is None unless the entity cells
    were asked for, `weeks` None unless the series was, and `previous` None unless a window was
    compared with (`previous_named` is then its entity counts, when the entity cells were asked
    for)."""

    counts: Mapping[tuple[UUID, str], Counts]
    entity_ids: Sequence[UUID] | None = None
    named: Mapping[tuple[UUID, str, UUID], EntityCounts] = field(default_factory=dict)
    weeks: Sequence[date] | None = None
    weekly: Mapping[tuple[UUID, str, date], Counts] = field(default_factory=dict)
    previous: Mapping[tuple[UUID, str], Counts] | None = None
    previous_named: Mapping[tuple[UUID, str, UUID], EntityCounts] = field(default_factory=dict)


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

    row = cells(found(read.counts))
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

    return EngineSummary(
        engine_code=code,
        mentioned=row.mentioned,
        cited=row.cited,
        outcomes=row.outcomes,
        share_of_voice=row.share_of_voice,
        previous=previous,
        series=None
        if read.weeks is None
        else [
            _week(
                week,
                cells(
                    [
                        read.weekly[(prompt, code, week)]
                        for prompt in prompt_ids
                        if (prompt, code, week) in read.weekly
                    ]
                ),
            )
            for week in read.weeks
        ],
        entities=None if read.entity_ids is None else [entity(e) for e in read.entity_ids],
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


def _context() -> SummaryMetricContext:
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
            by_prompt = await repository.counts_by_prompt(db, ws, project_id, ids, **window)
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
            tracked = await repository.tracked_entities(db, ws, project_id)
            # The own entities first, so the cut keeps them; then the competitors by name.
            cell_ids = (
                [entity.id for entity in sorted(tracked, key=lambda e: e.role != "own")][
                    :ENTITY_CELLS_MAX
                ]
                if "entities" in query.include
                else None
            )
            named: Mapping[tuple[UUID, str, UUID], EntityCounts] = (
                {}
                if cell_ids is None
                else await repository.entity_counts(db, ws, project_id, ids, cell_ids, **window)
            )
            previous_named: Mapping[tuple[UUID, str, UUID], EntityCounts] = (
                {}
                if before is None or cell_ids is None
                else await repository.entity_counts(
                    db, ws, project_id, ids, cell_ids, **before_window
                )
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
            previous=previous,
            previous_named=previous_named,
        )
        prompt_rows = (
            [_prompt_row(prompt, shown, read) for prompt in prompts] if query.rows is None else []
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
            metric_context=_context(),
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
        )
