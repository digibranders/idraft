"""Statements for writing and paging budgets, as the API runs them. Every function runs inside
`workspace_transaction`, and every statement names the workspace as well. `project_ids` None is
a member of every project; otherwise it is the projects the member may reach, and a budget of the
whole workspace is out of reach (its spend is every project's)."""

from __future__ import annotations

from collections.abc import Mapping
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import Row, Select, delete, exists, func, insert, literal, select, true, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.api.operations.costs_repository import BudgetRecord
from idraft.api.problems import DuplicateError
from idraft.db.errors import violated_unique_constraint
from idraft.db.tables import budgets, projects

_UNIQUE = "budgets_workspace_id_project_id_workload_period_key"


def _record(row: Row[Any]) -> BudgetRecord:
    return BudgetRecord(
        id=row.id,
        project_id=row.project_id,
        workload=row.workload,
        period=row.period,
        limit_usd=Decimal(row.limit_usd),
        soft_limit_pct=row.soft_limit_pct,
        action_on_hard=row.action_on_hard,
        created_at=row.created_at,
    )


def _reachable(
    statement: Select[Any], workspace_id: UUID, project_ids: frozenset[UUID] | None
) -> Select[Any]:
    statement = statement.where(budgets.c.workspace_id == workspace_id)
    if project_ids is not None:
        statement = statement.where(budgets.c.project_id.in_(sorted(project_ids)))
    return statement


async def live_project_exists(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> bool:
    """Whether the workspace has the project and it is not deleted."""
    found: bool = (
        await db.execute(
            select(
                exists().where(
                    projects.c.workspace_id == workspace_id,
                    projects.c.id == project_id,
                    projects.c.deleted_at.is_(None),
                )
            )
        )
    ).scalar_one()
    return found


async def list_page(
    db: AsyncSession,
    workspace_id: UUID,
    project_ids: frozenset[UUID] | None,
    *,
    project_id: UUID | None,
    offset: int,
    limit: int,
) -> tuple[list[BudgetRecord], int]:
    """A page of the budgets, oldest first, and how many there are, in one statement: the count
    is joined to the page, so a page past the end still carries it."""
    scope = _reachable(select(budgets), workspace_id, project_ids)
    if project_id is not None:
        scope = scope.where(budgets.c.project_id == project_id)
    total = select(func.count()).select_from(scope.subquery()).scalar_subquery()
    page = scope.order_by(budgets.c.created_at, budgets.c.id).offset(offset).limit(limit).subquery()
    rows = (
        await db.execute(
            select(total.label("total"), *page.c).select_from(
                select(literal(1)).subquery().outerjoin(page, true())
            )
        )
    ).all()
    # The one row an empty page leaves holds the total and nothing else.
    return [_record(row) for row in rows if row.id is not None], int(rows[0].total)


async def get_budget(
    db: AsyncSession,
    workspace_id: UUID,
    project_ids: frozenset[UUID] | None,
    budget_id: UUID,
    *,
    lock: bool,
) -> BudgetRecord | None:
    """A budget the caller may reach. With `lock`, held until the transaction ends."""
    statement = _reachable(select(budgets), workspace_id, project_ids).where(
        budgets.c.id == budget_id
    )
    if lock:
        statement = statement.with_for_update()
    row = (await db.execute(statement)).one_or_none()
    return None if row is None else _record(row)


async def insert_budget(
    db: AsyncSession, workspace_id: UUID, values: Mapping[str, object]
) -> BudgetRecord:
    """The budget, or `DuplicateError` when the scope, group and month have one already: the
    table's unique constraint judges it (the workspace is a null project, and two nulls are the
    same here), inside a savepoint so the transaction stays usable."""
    try:
        async with db.begin_nested():
            row = (
                await db.execute(
                    insert(budgets).values(workspace_id=workspace_id, **values).returning(budgets)
                )
            ).one()
    except IntegrityError as error:
        if violated_unique_constraint(error) == _UNIQUE:
            raise DuplicateError(
                "A budget for this scope and group already exists. Change it instead."
            ) from None
        raise
    return _record(row)


async def update_budget(
    db: AsyncSession, workspace_id: UUID, budget_id: UUID, values: Mapping[str, object]
) -> BudgetRecord:
    row = (
        await db.execute(
            update(budgets)
            .where(budgets.c.workspace_id == workspace_id, budgets.c.id == budget_id)
            .values(**values)
            .returning(budgets)
        )
    ).one()
    return _record(row)


async def delete_budget(db: AsyncSession, workspace_id: UUID, budget_id: UUID) -> None:
    """Runs the budget blocked keep their row; the database clears their `blocked_by_budget_id`."""
    await db.execute(
        delete(budgets).where(budgets.c.workspace_id == workspace_id, budgets.c.id == budget_id)
    )
