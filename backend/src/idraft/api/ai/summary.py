"""The prompts summary (spec section 4.5; docs/16-metrics-methodology.md sections 3 to 5): per
prompt and engine, and per topic and engine, over a window of project-local days."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
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
    OutcomeCells,
    PromptsSummary,
    PromptSummaryRow,
    SummaryEntity,
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


def _engines(engine_codes: Sequence[str], counts: Mapping[str, Counts]) -> list[EngineSummary]:
    return [_engine(code, counts.get(code, _NONE)) for code in engine_codes]


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
            by_topic = await repository.counts_by_topic(db, ws, project_id, ids, **window)
            untopiced = [prompt.id for prompt in prompts if not prompt.topic_term_ids]
            no_topic = await repository.counts_of_prompts(db, ws, project_id, untopiced, **window)
            versions = await repository.entity_config_versions(db, ws, project_id, ids, **window)
            enabled = await repository.enabled_engine_codes(db, ws, project_id)
            tracked = await repository.tracked_entities(db, ws, project_id)
            term_ids = {term for prompt in prompts for term in prompt.topic_term_ids}
            names = await repository.topic_names(db, ws, term_ids)
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
                engines=_engines(
                    shown,
                    {
                        code: by_prompt[(prompt.id, code)]
                        for code in shown
                        if (prompt.id, code) in by_prompt
                    },
                ),
            )
            for prompt in prompts
        ]
        topic_rows = [
            TopicSummaryRow(
                term_id=term_id,
                name=names.get(term_id),
                prompt_count=sum(term_id in prompt.topic_term_ids for prompt in prompts),
                engines=_engines(
                    shown,
                    {
                        code: by_topic[(term_id, code)]
                        for code in shown
                        if (term_id, code) in by_topic
                    },
                ),
            )
            for term_id in sorted(term_ids, key=lambda term: (names.get(term, ""), str(term)))
        ]
        if untopiced:
            topic_rows.append(
                TopicSummaryRow(
                    term_id=None,
                    name=None,
                    prompt_count=len(untopiced),
                    engines=_engines(shown, no_topic),
                )
            )
        return PromptsSummary(
            window=MetricWindow(
                from_=first.isoformat(), to=last.isoformat(), timezone=zone_row.timezone
            ),
            include_branded=include_branded,
            engine_codes=shown,
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
