"""Statements for costs, budgets and the price book, as the API reads them. Every function runs
inside `workspace_transaction`, and every statement names the workspace as well. Costs are read
from the hourly rollup (`ops.cost_daily`, plan decision D14); how they were measured is read
from the cost events, which the rollup does not keep."""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Final
from uuid import UUID

from sqlalchemy import ColumnElement, Text, case, cast, exists, func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.db.tables import (
    budgets,
    collection_runs,
    cost_daily,
    projects,
    provider_cost_events,
    provider_price_book,
)
from idraft.domain.workloads import CostWorkload, cost_channel


@dataclass(frozen=True, slots=True)
class CostFilter:
    """What the costs are narrowed to. `project_ids` None: every project of the workspace."""

    start: date
    end: date  # included
    project_ids: frozenset[UUID] | None
    workloads: frozenset[str]
    provider_code: str | None


@dataclass(frozen=True, slots=True)
class CostRecord:
    keys: dict[str, str]
    cost_usd: Decimal
    request_count: int
    subjects: int


def _channel() -> ColumnElement[str]:
    """The channel of a rollup row, from its workload: the rollup keeps no channel."""
    return case(
        *[
            (cost_daily.c.workload == workload.value, literal(cost_channel(workload).value))
            for workload in CostWorkload
        ],
        else_=literal(""),
    )


_GROUPS: Final[Mapping[str, ColumnElement[Any]]] = {
    "project": cast(cost_daily.c.project_id, Text),
    "workload": cost_daily.c.workload,
    "provider": cost_daily.c.provider_code,
    "endpoint": cost_daily.c.endpoint,
    "engine": cost_daily.c.engine_code,
    "day": cast(cost_daily.c.cost_date, Text),
    "channel": _channel(),
}


def _daily_scope(workspace_id: UUID, given: CostFilter) -> list[ColumnElement[bool]]:
    c = cost_daily.c
    found = [c.workspace_id == workspace_id, c.cost_date >= given.start, c.cost_date <= given.end]
    if given.project_ids is not None:
        found.append(c.project_id.in_(sorted(given.project_ids)))
    if given.workloads:
        found.append(c.workload.in_(sorted(given.workloads)))
    if given.provider_code is not None:
        found.append(c.provider_code == given.provider_code)
    return found


async def cost_rows(
    db: AsyncSession, workspace_id: UUID, given: CostFilter, group_by: Sequence[str]
) -> list[CostRecord]:
    """The period's cost by the given keys, most expensive first; one row without keys. A
    subject is counted once a day, so `subjects` adds the days up."""
    c = cost_daily.c
    keys = [_GROUPS[name].label(name) for name in group_by]
    rows = await db.execute(
        select(
            *keys,
            func.sum(c.cost_usd).label("cost_usd"),
            func.sum(c.request_count).label("request_count"),
            func.sum(c.subjects).label("subjects"),
        )
        .where(*_daily_scope(workspace_id, given))
        .group_by(*keys)
        .having(func.count() > 0)
        .order_by(func.sum(c.cost_usd).desc(), *keys)
    )
    return [
        CostRecord(
            keys={name: str(row._mapping[name]) for name in group_by},
            cost_usd=Decimal(row.cost_usd),
            request_count=int(row.request_count),
            subjects=int(row.subjects),
        )
        for row in rows
    ]


async def cost_sources(
    db: AsyncSession,
    workspace_id: UUID,
    given: CostFilter,
    *,
    since: datetime,
    until: datetime,
) -> dict[str, Decimal]:
    """The period's cost by how it was measured, from the events."""
    e = provider_cost_events.c
    conditions = [
        e.workspace_id == workspace_id,
        e.project_id.is_not(None),
        e.occurred_at >= since,
        e.occurred_at < until,
    ]
    if given.project_ids is not None:
        conditions.append(e.project_id.in_(sorted(given.project_ids)))
    if given.workloads:
        conditions.append(e.workload.in_(sorted(given.workloads)))
    if given.provider_code is not None:
        conditions.append(e.provider_code == given.provider_code)
    rows = await db.execute(
        select(e.cost_source, func.sum(e.cost_usd).label("cost_usd"))
        .where(*conditions)
        .group_by(e.cost_source)
    )
    return {row.cost_source: Decimal(row.cost_usd) for row in rows}


async def project_exists(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> bool:
    """Whether the workspace has the project, deleted or not: a deleted project's costs are
    still its history."""
    found: bool = (
        await db.execute(
            select(
                exists().where(projects.c.workspace_id == workspace_id, projects.c.id == project_id)
            )
        )
    ).scalar_one()
    return found


@dataclass(frozen=True, slots=True)
class BudgetRecord:
    id: UUID
    project_id: UUID | None
    workload: str | None
    period: str
    limit_usd: Decimal
    soft_limit_pct: int
    action_on_hard: str
    created_at: datetime


async def list_budgets(
    db: AsyncSession, workspace_id: UUID, project_ids: frozenset[UUID] | None
) -> list[BudgetRecord]:
    """The workspace's budgets, oldest first. Limited to some projects: their budgets only,
    since a workspace budget's spend is every project's."""
    b = budgets.c
    statement = select(budgets).where(b.workspace_id == workspace_id)
    if project_ids is not None:
        statement = statement.where(b.project_id.in_(sorted(project_ids)))
    rows = await db.execute(statement.order_by(b.created_at, b.id))
    return [
        BudgetRecord(
            id=row.id,
            project_id=row.project_id,
            workload=row.workload,
            period=row.period,
            limit_usd=Decimal(row.limit_usd),
            soft_limit_pct=row.soft_limit_pct,
            action_on_hard=row.action_on_hard,
            created_at=row.created_at,
        )
        for row in rows
    ]


async def blocked_runs(
    db: AsyncSession,
    workspace_id: UUID,
    budget_ids: Collection[UUID],
    *,
    since: datetime,
    until: datetime,
) -> dict[UUID, int]:
    """How many runs each budget blocked when they were planned, by when they were blocked.
    A run under way that a budget holds back names the budget too, but only until the hold
    lifts; it is not counted."""
    if not budget_ids:
        return {}
    r = collection_runs.c
    rows = await db.execute(
        select(r.blocked_by_budget_id, func.count().label("runs"))
        .where(
            r.workspace_id == workspace_id,
            r.status == "budget_blocked",
            r.blocked_by_budget_id.in_(sorted(budget_ids)),
            r.completed_at >= since,
            r.completed_at < until,
        )
        .group_by(r.blocked_by_budget_id)
    )
    return {row.blocked_by_budget_id: row.runs for row in rows}


@dataclass(frozen=True, slots=True)
class PriceRecord:
    id: UUID
    provider_code: str
    endpoint: str
    price_unit: str
    unit_price_usd: Decimal
    conditions: Mapping[str, object]
    valid_from: date
    valid_to: date | None
    source_url: str
    verified_at: date


async def list_prices(
    db: AsyncSession,
    *,
    provider_code: str | None,
    endpoint: str | None,
    valid_at: date,
    offset: int,
    limit: int,
) -> tuple[list[PriceRecord], int]:
    """The prices valid on `valid_at`, by provider, endpoint and unit. The price book is the
    platform's, the same for every workspace."""
    p = provider_price_book.c
    statement = select(provider_price_book).where(
        p.valid_from <= valid_at, (p.valid_to.is_(None)) | (p.valid_to > valid_at)
    )
    if provider_code is not None:
        statement = statement.where(p.provider_code == provider_code)
    if endpoint is not None:
        statement = statement.where(p.endpoint == endpoint)
    total: int = (
        await db.execute(select(func.count()).select_from(statement.subquery()))
    ).scalar_one()
    rows = await db.execute(
        statement.order_by(p.provider_code, p.endpoint, p.price_unit, p.id)
        .offset(offset)
        .limit(limit)
    )
    found = [
        PriceRecord(
            id=row.id,
            provider_code=row.provider_code,
            endpoint=row.endpoint,
            price_unit=row.price_unit,
            unit_price_usd=Decimal(row.unit_price_usd),
            conditions=row.conditions or {},
            valid_from=row.valid_from,
            valid_to=row.valid_to,
            source_url=row.source_url,
            verified_at=row.verified_at,
        )
        for row in rows
    ]
    return found, total
