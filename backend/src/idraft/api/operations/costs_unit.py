"""Unit costs: what one answer, one provider request, one active prompt or one tracked keyword cost
in a month (docs/19-api-specification.md section 3.11.2; WP-30 plan decision D11).

Money is a `Decimal` end to end. Every figure is a total divided by a count through `per_unit`
and rounded once, to the micro-dollar, as the ledger keeps it; a figure with nothing to divide by
is None and never 0. A member limited to some projects sees those projects' rows only.
"""

from __future__ import annotations

from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Final
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.operations import costs_repository as repository
from idraft.api.operations.costs import money
from idraft.api.problems import NotFoundError
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.domain.ai_engines import EngineCode
from idraft.domain.workloads import CostWorkload

_SPENT_ON: Final = (CostWorkload.AI_PROMPT, CostWorkload.SEO_RANK, CostWorkload.EXTRACTION_LLM)


def per_unit(total: Decimal, count: int) -> Decimal | None:
    """`total` over `count`, to the micro-dollar; None with nothing to divide by."""
    if count == 0:
        return None
    return money(total / count)


@dataclass(frozen=True, slots=True)
class UnitCostLine:
    project_id: UUID
    per_tracked_keyword_month: Decimal | None
    per_serp_check: Decimal | None
    per_active_prompt_month: Decimal | None
    per_ai_observation: Decimal | None
    extraction_llm_usd: Decimal | None
    per_engine: dict[str, Decimal | None]
    ai_answers_by_engine: dict[str, int]


def _month_bounds(first: date) -> tuple[datetime, datetime]:
    start = datetime.combine(first, time(), tzinfo=UTC)
    return start, datetime.combine((first + timedelta(days=32)).replace(day=1), time(), tzinfo=UTC)


class UnitCostService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    async def unit_costs(
        self, access: WorkspaceAccess, month: date | None, project_id: UUID | None
    ) -> list[UnitCostLine]:
        """A line per project the caller reaches, for the month (UTC; this month when none is
        given). A project the caller does not reach, or the workspace does not have, is not
        found. The reads are grouped by project, so their number does not depend on how many
        answers, prompts or projects there are."""
        if project_id is not None and not access.sees(project_id):
            raise NotFoundError
        async with self._transaction(access) as db:
            now: datetime = (await db.execute(select(func.now()))).scalar_one()
            first = (now.astimezone(UTC).date() if month is None else month).replace(day=1)
            since, until = _month_bounds(first)
            ids = await repository.visible_projects(
                db, access.workspace_id, access.project_ids, only=project_id
            )
            if project_id is not None and not ids:
                raise NotFoundError
            if not ids:
                return []
            answers = await repository.answer_costs(
                db, access.workspace_id, ids, since=since, until=until
            )
            spent = await repository.spend_by_workload(
                db,
                access.workspace_id,
                ids,
                first=first,
                last=until.date() - timedelta(days=1),
                workloads=[workload.value for workload in _SPENT_ON],
            )
            counts = await repository.active_counts(db, access.workspace_id, ids)
        return [
            self._line(id_, answers, spent, counts.prompts.get(id_, 0), counts.keywords.get(id_, 0))
            for id_ in ids
        ]

    @staticmethod
    def _line(
        project_id: UUID,
        answers: list[repository.AnswerCost],
        spent: dict[tuple[UUID, str], repository.Spend],
        prompts: int,
        keywords: int,
    ) -> UnitCostLine:
        mine = {row.engine_code: row for row in answers if row.project_id == project_id}
        per_engine: dict[str, Decimal | None] = {}
        counted: dict[str, int] = {}
        for engine in EngineCode:
            row = mine.get(engine.value)
            counted[engine.value] = 0 if row is None else row.answers
            per_engine[engine.value] = None if row is None else per_unit(row.total_usd, row.answers)
        total = sum((row.total_usd for row in mine.values()), Decimal(0))
        ai = spent.get((project_id, CostWorkload.AI_PROMPT.value))
        rank = spent.get((project_id, CostWorkload.SEO_RANK.value))
        extraction = spent.get((project_id, CostWorkload.EXTRACTION_LLM.value))
        return UnitCostLine(
            project_id=project_id,
            # Nothing recorded is unknown, not a spend of 0.
            per_tracked_keyword_month=None if rank is None else per_unit(rank.total_usd, keywords),
            per_serp_check=None if rank is None else per_unit(rank.total_usd, rank.requests),
            per_active_prompt_month=None if ai is None else per_unit(ai.total_usd, prompts),
            per_ai_observation=per_unit(total, sum(counted.values())),
            extraction_llm_usd=None if extraction is None else money(extraction.total_usd),
            per_engine=per_engine,
            ai_answers_by_engine=counted,
        )
