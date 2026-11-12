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
    EngineSummary,
    EntityCells,
    MetricCell,
    MetricContext,
    OutcomeCells,
    Pooled,
    PromptsSummary,
    PromptSummaryRow,
    SummaryEntity,
    SummaryInclude,
    SummaryMetricContext,
    TopicSummaryRow,
    WeekCells,
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


def _out_of_range(field: str) -> RequestValidationError:
    return RequestValidationError(
        [{"loc": ("query", field), "type": "out_of_range", "msg": f"`{field}` is out of range."}]
    )


def summary_dates(start: date | None, end: date | None, today: date) -> tuple[date, date]:
    """The local days a summary covers, both included."""
    last = end or today
    try:
        first = start or last - timedelta(days=SUMMARY_DAYS - 1)
        days = (last - first).days + 1
    except OverflowError:
        raise _out_of_range("to") from None
    if first > last:
        raise RequestValidationError(
            [{"loc": ("query", "from"), "type": "range_invalid", "msg": "`from` is after `to`."}]
        )
    if days > SUMMARY_MAX_DAYS:
        raise WindowTooLargeError(
            f"A window is at most {SUMMARY_MAX_DAYS} days.", limit_days=SUMMARY_MAX_DAYS
        )
    return first, last


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


def _engine(engine_code: str, counts: Counts) -> EngineSummary:
    valid, total = counts.n_valid, counts.n_observations
    return EngineSummary(
        engine_code=engine_code,
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


def _topic_engine(engine_code: str, members: Sequence[Counts]) -> EngineSummary:
    """The cells of a topic and engine from the counts of the topic's prompts. Share of voice
    stays one answer one weight (docs/16 section 5), so it is the sum over the answers."""
    return EngineSummary(
        engine_code=engine_code,
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


def _week(week: date, cells: EngineSummary) -> WeekCells:
    return WeekCells(
        week_start=week,
        mentioned=cells.mentioned,
        cited=cells.cited,
        share_of_voice=cells.share_of_voice,
    )


@dataclass(frozen=True, slots=True)
class _Read:
    """What the queries read, by prompt and engine. `entity_ids` is None unless the entity cells
    were asked for, and `weeks` None unless the series was."""

    counts: Mapping[tuple[UUID, str], Counts]
    entity_ids: Sequence[UUID] | None = None
    named: Mapping[tuple[UUID, str, UUID], EntityCounts] = field(default_factory=dict)
    weeks: Sequence[date] | None = None
    weekly: Mapping[tuple[UUID, str, date], Counts] = field(default_factory=dict)


def _entity_cells(
    code: str, entity_id: UUID, prompt_ids: Collection[UUID], read: _Read, *, topic: bool
) -> EntityCells:
    parts = [
        (
            read.counts.get((prompt, code), _NONE),
            read.named.get((prompt, code, entity_id), _NOT_NAMED),
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
    return EntityCells(
        entity_id=entity_id,
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

    def cells(source: Mapping[tuple[UUID, str], Counts]) -> EngineSummary:
        members = [source[(prompt, code)] for prompt in prompt_ids if (prompt, code) in source]
        if topic:
            return _topic_engine(code, members)
        return _engine(code, members[0] if members else _NONE)

    row = cells(read.counts)
    update: dict[str, Any] = {}
    if read.entity_ids is not None:
        update["entities"] = [
            _entity_cells(code, entity_id, prompt_ids, read, topic=topic)
            for entity_id in read.entity_ids
        ]
    if read.weeks is not None:
        update["series"] = [
            _week(
                week,
                cells(
                    {
                        (prompt, code): read.weekly[(prompt, code, week)]
                        for prompt in prompt_ids
                        if (prompt, code, week) in read.weekly
                    }
                ),
            )
            for week in read.weeks
        ]
    return row.model_copy(update=update) if update else row


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
            first, last = summary_dates(query.start, query.end, datetime.now(zone).date())
            try:
                since, until = instants(first, last, zone)
            except (OverflowError, ValueError):
                raise _out_of_range("to") from None
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
            names = await repository.topic_names(db, ws, held.keys())
        seen = {engine for _, engine in by_prompt}
        shown = sorted(
            code
            for code in set(enabled) | seen
            if query.engine_codes is None or code in query.engine_codes
        )
        read = _Read(counts=by_prompt, entity_ids=cell_ids, named=named, weeks=weeks, weekly=weekly)
        prompt_rows = [_prompt_row(prompt, shown, read) for prompt in prompts]
        # Topic rows are sums of the prompts' counts. Each topic row holds the prompts given the
        # term or a term below it, each once; the last row holds the prompts given no topic,
        # except under a term filter.
        topic_rows = [
            _topic_row(term_id, names.get(term_id), held[term_id], shown, read)
            for term_id in sorted(held, key=lambda term: (names.get(term, ""), str(term)))
        ]
        untopiced = [prompt.id for prompt in prompts if not prompt.topic_term_ids]
        if untopiced and query.term_id is None:
            topic_rows.append(_topic_row(None, None, untopiced, shown, read))
        return PromptsSummary(
            window=MetricWindow(
                from_=first.isoformat(), to=last.isoformat(), timezone=zone_row.timezone
            ),
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
        )
