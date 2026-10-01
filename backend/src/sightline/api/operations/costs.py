"""Costs, budget status and the price book (docs/19-api-specification.md sections 3.11.1 and
3.11.2; plan decision D14), all needing `costs:read`.

Costs come from the hourly rollup, so they can be an hour behind; how they were measured, and
what budgets have spent, come from the cost events. A member limited to some projects sees
those projects' costs and budgets only: a workspace budget's spend is every project's. Money is
given to the micro-dollar (six places), as the ledger keeps it.
"""

from __future__ import annotations

from collections.abc import Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Final, Literal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.api.keywords import repository as keywords
from sightline.api.operations import costs_repository as repository
from sightline.api.operations.costs_repository import (
    BudgetRecord,
    CostFilter,
    CostRecord,
    PriceRecord,
)
from sightline.api.problems import NotFoundError
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.collectors.budget import committed, spent_in_month
from sightline.db.engine import workspace_transaction
from sightline.domain.workloads import BudgetGroup

MICRO: Final = Decimal("0.000001")
COST_SOURCES: Final = ("provider_reported", "computed_from_tokens", "price_book_estimate")
BudgetState = Literal["ok", "soft_exceeded", "hard_exceeded"]


def money(value: Decimal) -> Decimal:
    return value.quantize(MICRO)


@dataclass(frozen=True, slots=True)
class CostReport:
    rows: list[CostRecord]
    total: Decimal
    sources: dict[str, Decimal]


@dataclass(frozen=True, slots=True)
class BudgetLine:
    budget: BudgetRecord
    spent: Decimal
    committed: Decimal
    pct_used: float
    state: BudgetState
    blocked_runs: int


@dataclass(frozen=True, slots=True)
class PricePage:
    prices: list[PriceRecord]
    total: int


def _state(spent: Decimal, budget: BudgetRecord) -> BudgetState:
    """As the planner judges it: the hard limit is reached at the limit, the soft one at its
    share of it."""
    if spent >= budget.limit_usd:
        return "hard_exceeded"
    if spent >= budget.limit_usd * budget.soft_limit_pct / 100:
        return "soft_exceeded"
    return "ok"


def _pct(spent: Decimal, limit: Decimal) -> float:
    if limit <= 0:
        return 100.0 if spent > 0 else 0.0
    return round(float(spent / limit * 100), 1)


def _start_of(day: date) -> datetime:
    return datetime.combine(day, time(), tzinfo=UTC)


class CostService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    async def costs(
        self,
        access: WorkspaceAccess,
        *,
        start: date,
        end: date,
        group_by: Sequence[str],
        project_id: UUID | None,
        workloads: frozenset[str],
        provider_code: str | None,
    ) -> CostReport:
        """The period from `start` to `end`, both included (UTC days)."""
        projects = access.project_ids
        async with self._transaction(access) as db:
            if project_id is not None:
                if not access.sees(project_id) or (
                    await keywords.project_defaults(db, access.workspace_id, project_id) is None
                ):
                    raise NotFoundError
                projects = frozenset({project_id})
            given = CostFilter(
                start=start,
                end=end,
                project_ids=projects,
                workloads=workloads,
                provider_code=provider_code,
            )
            rows = await repository.cost_rows(db, access.workspace_id, given, group_by)
            measured = await repository.cost_sources(
                db,
                access.workspace_id,
                given,
                since=_start_of(start),
                until=_start_of(end + timedelta(days=1)),
            )
        return CostReport(
            rows=[
                CostRecord(row.keys, money(row.cost_usd), row.request_count, row.subjects)
                for row in rows
            ],
            total=money(sum((row.cost_usd for row in rows), Decimal(0))),
            sources={source: money(measured.get(source, Decimal(0))) for source in COST_SOURCES},
        )

    async def budget_status(self, access: WorkspaceAccess, month: date | None) -> list[BudgetLine]:
        """Each budget's spend in the month (UTC; this month when none is given). What runs
        under way are still expected to spend counts for this month only."""
        async with self._transaction(access) as db:
            now: datetime = (await db.execute(select(func.now()))).scalar_one()
            this_month = now.astimezone(UTC).date().replace(day=1)
            first = this_month if month is None else month.replace(day=1)
            since = _start_of(first)
            until = _start_of((first + timedelta(days=32)).replace(day=1))
            found = await repository.list_budgets(db, access.workspace_id, access.project_ids)
            blocked = await repository.blocked_runs(
                db, access.workspace_id, [budget.id for budget in found], since=since, until=until
            )
            lines: list[BudgetLine] = []
            for budget in found:
                group = BudgetGroup.ALL if budget.workload is None else BudgetGroup(budget.workload)
                spent = await spent_in_month(
                    db,
                    workspace_id=access.workspace_id,
                    project_id=budget.project_id,
                    group=group,
                    month=since,
                )
                expected = (
                    await committed(
                        db,
                        workspace_id=access.workspace_id,
                        project_id=budget.project_id,
                        group=group,
                    )
                    if first == this_month
                    else Decimal(0)
                )
                lines.append(
                    BudgetLine(
                        budget=budget,
                        spent=money(spent),
                        committed=money(expected),
                        pct_used=_pct(spent, budget.limit_usd),
                        state=_state(spent, budget),
                        blocked_runs=blocked.get(budget.id, 0),
                    )
                )
        return lines

    async def prices(
        self,
        access: WorkspaceAccess,
        *,
        provider_code: str | None,
        endpoint: str | None,
        valid_at: date | None,
        offset: int,
        limit: int,
    ) -> PricePage:
        """The prices valid on `valid_at` (today, UTC, when none is given): what estimates use,
        never what is charged."""
        async with self._transaction(access) as db:
            if valid_at is None:
                now: datetime = (await db.execute(select(func.now()))).scalar_one()
                valid_at = now.astimezone(UTC).date()
            found, total = await repository.list_prices(
                db,
                provider_code=provider_code,
                endpoint=endpoint,
                valid_at=valid_at,
                offset=offset,
                limit=limit,
            )
        return PricePage(found, total)
