"""The prompts summary (spec section 4.5; docs/16-metrics-methodology.md sections 3 to 5): per
prompt and engine, and per topic and engine, over a window of project-local days."""

from __future__ import annotations

from collections.abc import Callable, Collection, Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from datetime import date, datetime, timedelta
from typing import Any, Final, Literal, cast
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi.exceptions import RequestValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.ai import summary_repository as repository
from idraft.api.ai.summary_repository import Counts
from idraft.api.problems import NotFoundError, WindowTooLargeError
from idraft.api.ranks.repository import project_zone
from idraft.api.ranks.service import instants
from idraft.api.schemas.ai import (
    EngineSummary,
    MetricCell,
    MetricContext,
    OutcomeCells,
    Pooled,
    PromptsSummary,
    PromptSummaryRow,
    SummaryEntity,
    SummaryMetricContext,
    TopicSummaryRow,
)
from idraft.api.schemas.metrics import MetricWindow
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction

# The default window, and the longest one, in project-local days.
SUMMARY_DAYS: Final = 28
SUMMARY_MAX_DAYS: Final = 92
_NONE: Final = Counts()


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


def _weighted(members: Sequence[Counts], pick: Callable[[Counts], int]) -> MetricCell:
    """The prompt weighted rate of a topic (docs/16 section 3, docs/17 section 4.1): each prompt
    with a valid answer counts once, as `pick(counts) / n_valid`. The numerator is the sum of
    those rates, the denominator the number of such prompts, and `pooled` the answers."""
    rated = [counts for counts in members if counts.n_valid > 0]
    numerator = sum(pick(counts) / counts.n_valid for counts in rated)
    cell = _cell(numerator, len(rated), sum(counts.n_observations for counts in members))
    return cell.model_copy(
        update={
            "pooled": Pooled(
                successes=sum(pick(counts) for counts in rated),
                trials=sum(counts.n_valid for counts in rated),
            )
        }
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


def _topic_engines(
    engine_codes: Sequence[str],
    prompt_ids: Collection[UUID],
    by_prompt: Mapping[tuple[UUID, str], Counts],
) -> list[EngineSummary]:
    return [
        _topic_engine(
            code,
            [by_prompt[(prompt, code)] for prompt in prompt_ids if (prompt, code) in by_prompt],
        )
        for code in engine_codes
    ]


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
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        start: date | None,
        end: date | None,
        engine_codes: Sequence[str] | None,
        include_branded: bool,
    ) -> PromptsSummary:
        ws = access.workspace_id
        async with self._transaction(access) as db:
            zone_row = await project_zone(db, ws, project_id)
            if zone_row is None:
                raise NotFoundError
            zone = ZoneInfo(zone_row.timezone)
            first, last = summary_dates(start, end, datetime.now(zone).date())
            try:
                since, until = instants(first, last, zone)
            except (OverflowError, ValueError):
                raise _out_of_range("to") from None
            prompts = await repository.summary_prompts(
                db, ws, project_id, include_branded=include_branded
            )
            ids = [prompt.id for prompt in prompts]
            window: dict[str, Any] = {"since": since, "until": until, "engine_codes": engine_codes}
            by_prompt = await repository.counts_by_prompt(db, ws, project_id, ids, **window)
            held = await repository.topic_rollup(db, ws, ids)
            versions = await repository.entity_config_versions(db, ws, project_id, ids, **window)
            enabled = await repository.enabled_engine_codes(db, ws, project_id)
            tracked = await repository.tracked_entities(db, ws, project_id)
            names = await repository.topic_names(db, ws, held.keys())
        seen = {engine for _, engine in by_prompt}
        shown = sorted(
            code for code in set(enabled) | seen if engine_codes is None or code in engine_codes
        )
        prompt_rows = [
            PromptSummaryRow(
                prompt_id=prompt.id,
                text=prompt.text,
                is_branded=prompt.is_branded,
                topic_term_ids=list(prompt.topic_term_ids),
                engines=[_engine(code, by_prompt.get((prompt.id, code), _NONE)) for code in shown],
            )
            for prompt in prompts
        ]
        # Topic rows are sums of the prompts' counts. Each topic row holds the prompts given the
        # term or a term below it, each once; the last row holds the prompts given no topic.
        topic_rows = [
            TopicSummaryRow(
                term_id=term_id,
                name=names.get(term_id),
                prompt_count=len(held[term_id]),
                engines=_topic_engines(shown, held[term_id], by_prompt),
            )
            for term_id in sorted(held, key=lambda term: (names.get(term, ""), str(term)))
        ]
        untopiced = [prompt.id for prompt in prompts if not prompt.topic_term_ids]
        if untopiced:
            topic_rows.append(
                TopicSummaryRow(
                    term_id=None,
                    name=None,
                    prompt_count=len(untopiced),
                    engines=_topic_engines(shown, untopiced, by_prompt),
                )
            )
        return PromptsSummary(
            window=MetricWindow(
                from_=first.isoformat(), to=last.isoformat(), timezone=zone_row.timezone
            ),
            include_branded=include_branded,
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
