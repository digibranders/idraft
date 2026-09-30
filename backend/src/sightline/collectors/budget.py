"""Is there budget for this work? (docs/27-cost-model.md section 10.3)

A budget is a monthly limit in US dollars for a workspace or one of its projects, for one budget
group or for everything. Work is checked against every budget that applies to it. Spend is the
sum of this month's cost events, read from the events and not from the hourly rollup, which can
be an hour behind what was just spent.

The check is made twice, and the two are different questions. When a run is planned: would
this run, on top of what is spent and what the runs already under way are still going to spend,
pass the limit? When tasks are about to be sent: is the limit already reached?
"""

from __future__ import annotations

from collections.abc import MutableMapping
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import ColumnElement, Table, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from sightline.db.tables import budgets, collection_runs, provider_cost_events
from sightline.domain.workloads import BudgetGroup, TaskWorkload, budget_group, cost_workloads

_events = provider_cost_events
_runs = collection_runs

# Spend already read in this tick: workspace, project (None for the whole workspace), group and
# month. A dispatcher tick asks about many projects under the same budgets.
SpendMemo = MutableMapping[tuple[UUID, UUID | None, BudgetGroup, date], Decimal]


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


def _month(now: datetime) -> datetime:
    """The first instant of the billing month `now` is in. Billing months are UTC months."""
    if now.tzinfo is None:
        # A naive time would be read in the zone of whatever machine runs this.
        raise ValueError("`now` must be an aware datetime")
    at = now.astimezone(UTC)
    return datetime(at.year, at.month, 1, tzinfo=UTC)


def _in_scope(
    table: Table, workspace_id: UUID, project_id: UUID | None
) -> list[ColumnElement[bool]]:
    """The rows of `table` a budget covers: the workspace's, or one project's."""
    conditions = [table.c.workspace_id == workspace_id]
    if project_id is not None:
        conditions.append(table.c.project_id == project_id)
    return conditions


async def _spent(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    project_id: UUID | None,
    group: BudgetGroup,
    month: datetime,
) -> Decimal:
    """This month's cost in the budget's scope: the whole workspace, or one project."""
    total: Decimal = (
        await db.execute(
            select(func.coalesce(func.sum(_events.c.cost_usd), 0)).where(
                *_in_scope(_events, workspace_id, project_id),
                _events.c.billing_period == month.date(),
                # The same month again, on the column the table is partitioned by.
                _events.c.occurred_at >= month,
                _events.c.workload.in_(sorted(cost_workloads(group))),
            )
        )
    ).scalar_one()
    return Decimal(total)


async def _committed(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    project_id: UUID | None,
    group: BudgetGroup,
    month: datetime,
) -> Decimal:
    """What the runs under way in the budget's scope are still expected to spend: for each,
    its estimate less what it has cost so far.

    Without this a second run planned a minute after the first would see the budget almost
    unspent, because the first has sent nothing yet, and both would be let through.
    """
    spent_by_run = (
        select(_events.c.run_id, func.sum(_events.c.cost_usd).label("cost"))
        .where(
            _events.c.workspace_id == workspace_id,
            _events.c.billing_period == month.date(),
            _events.c.occurred_at >= month,
            _events.c.run_id.is_not(None),
        )
        .group_by(_events.c.run_id)
        .subquery("spent_by_run")
    )
    unspent = func.greatest(
        func.coalesce(_runs.c.estimated_cost_usd, 0) - func.coalesce(spent_by_run.c.cost, 0), 0
    )
    total: Decimal = (
        await db.execute(
            select(func.coalesce(func.sum(unspent), 0))
            .select_from(_runs.outerjoin(spent_by_run, spent_by_run.c.run_id == _runs.c.id))
            .where(
                *_in_scope(_runs, workspace_id, project_id),
                _runs.c.status == "running",
                _runs.c.window_start >= month,
                _runs.c.workload.in_(sorted(cost_workloads(group))),
            )
        )
    ).scalar_one()
    return Decimal(total)


async def check(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    project_id: UUID,
    workload: TaskWorkload,
    now: datetime,
    estimate: Decimal | None = None,
    memo: SpendMemo | None = None,
) -> BudgetVerdict:
    """Judge work of `workload` for a project.

    With an `estimate`, a run is being planned: a budget blocks when the month's spend, plus
    what the runs under way are still expected to spend, plus the estimate would pass its
    limit. Planning in one workspace is made to wait its turn here, so two planners cannot
    both see room for the same money. The run being planned is not yet `running` and is not
    counted.

    With no estimate, tasks are about to be sent: a budget blocks when its limit is reached.
    `memo` keeps the spend read so far in a tick, which asks about many projects under the
    same budgets.

    A budget whose action is `alert_only` never blocks.
    """
    month = _month(now)
    planning = estimate is not None
    if planning:
        await db.execute(
            select(func.pg_advisory_xact_lock(func.hashtextextended(f"budget:{workspace_id}", 0)))
        )
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
        scope = {"workspace_id": workspace_id, "project_id": row.project_id, "group": covered}
        key = (workspace_id, row.project_id, covered, month.date())
        if memo is not None and key in memo:
            spent = memo[key]
        else:
            spent = await _spent(db, month=month, **scope)
            if memo is not None:
                memo[key] = spent
        limit = Decimal(row.limit_usd)
        if estimate is None:
            expected = spent
            over = spent >= limit
        else:
            expected = spent + await _committed(db, month=month, **scope) + estimate
            over = spent >= limit or expected > limit
        if expected >= limit * Decimal(row.soft_limit_pct) / 100:
            past_soft.append(row.id)
        if over and row.action_on_hard == "pause" and blocked_by is None:
            blocked_by = row.id
    return BudgetVerdict(blocked_by=blocked_by, past_soft_limit=tuple(past_soft))
