"""Is there budget for this work? (docs/27-cost-model.md section 10.3)

A budget is a monthly limit in US dollars for a workspace or one of its projects, for one budget
group or for everything. Work is checked against every budget that applies to it. Spend is the
sum of this month's cost events, read from the events and not from the hourly rollup, which can
be an hour behind what was just spent.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from sightline.db.tables import budgets, provider_cost_events
from sightline.domain.workloads import BudgetGroup, TaskWorkload, budget_group, cost_workloads

_events = provider_cost_events


@dataclass(frozen=True, slots=True)
class BudgetVerdict:
    # The budget that stops the work, or None when it may go ahead.
    blocked_by: UUID | None
    # Budgets that are past their soft limit, the blocking one included. Nothing stops for
    # these; they are for whoever notifies people.
    past_soft_limit: tuple[UUID, ...] = ()

    @property
    def allowed(self) -> bool:
        return self.blocked_by is None


async def _spent(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    project_id: UUID | None,
    group: BudgetGroup,
    now: datetime,
) -> Decimal:
    """This month's cost in the budget's scope: the whole workspace, or one project."""
    conditions = [
        _events.c.workspace_id == workspace_id,
        _events.c.billing_period == now.astimezone(UTC).date().replace(day=1),
        _events.c.workload.in_(sorted(cost_workloads(group))),
    ]
    if project_id is not None:
        conditions.append(_events.c.project_id == project_id)
    total: Decimal = (
        await db.execute(select(func.coalesce(func.sum(_events.c.cost_usd), 0)).where(*conditions))
    ).scalar_one()
    return Decimal(total)


async def check(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    project_id: UUID,
    workload: TaskWorkload,
    estimate: Decimal,
    now: datetime,
) -> BudgetVerdict:
    """Judge work of `workload` for a project that is estimated to cost `estimate`.

    With an estimate (a run being planned), a budget blocks when the month's spend plus the
    estimate would pass its limit. With no estimate (a batch about to be sent), it blocks when
    the limit is already reached. A budget whose action is `alert_only` never blocks.
    """
    group = budget_group(workload)
    applicable = await db.execute(
        select(
            budgets.c.id,
            budgets.c.project_id,
            budgets.c.workload,
            budgets.c.limit_usd,
            budgets.c.soft_limit_pct,
            budgets.c.action_on_hard,
        )
        .where(
            budgets.c.workspace_id == workspace_id,
            or_(budgets.c.project_id.is_(None), budgets.c.project_id == project_id),
            or_(budgets.c.workload.is_(None), budgets.c.workload.in_((group, BudgetGroup.ALL))),
        )
        # The narrowest budget first, so the one named as the reason is the most specific.
        .order_by(
            budgets.c.project_id.is_(None), budgets.c.workload == BudgetGroup.ALL, budgets.c.id
        )
    )
    blocked_by: UUID | None = None
    past_soft: list[UUID] = []
    # Read them all first: the loop runs more statements on the same connection.
    for row in applicable.all():
        # A budget with no group covers everything, like `all`.
        covered = BudgetGroup.ALL if row.workload is None else BudgetGroup(row.workload)
        spent = await _spent(
            db, workspace_id=workspace_id, project_id=row.project_id, group=covered, now=now
        )
        limit = Decimal(row.limit_usd)
        after = spent + estimate
        if after >= limit * Decimal(row.soft_limit_pct) / 100:
            past_soft.append(row.id)
        exhausted = spent >= limit or after > limit
        if exhausted and row.action_on_hard == "pause" and blocked_by is None:
            blocked_by = row.id
    return BudgetVerdict(blocked_by=blocked_by, past_soft_limit=tuple(past_soft))
