"""Cost routes (docs/19-api-specification.md sections 3.11.1 and 3.11.2): costs, budget status
and the price book, each needing `costs:read`. They are workspace routes; the service limits a
member scoped to some projects to those projects.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated, Final
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from fastapi.exceptions import RequestValidationError
from pydantic import AfterValidator

from idraft.api.operations.budgets import BudgetService
from idraft.api.operations.costs import BudgetLine, CostService
from idraft.api.operations.costs_forecast import ForecastService
from idraft.api.operations.costs_repository import BudgetRecord, PriceRecord
from idraft.api.operations.costs_unit import UnitCostService
from idraft.api.pagination import Commas, Offset, OffsetPageInfo
from idraft.api.permissions import Permission
from idraft.api.request_info import Info
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.budgets import (
    BudgetCreate,
    BudgetPage,
    BudgetResponse,
    BudgetUpdate,
    ForecastResponse,
    ForecastRow,
    UnitCostResponse,
    UnitCostRow,
)
from idraft.api.schemas.operations import (
    Budget,
    BudgetStatus,
    BudgetStatusList,
    CostGroup,
    CostList,
    CostMeta,
    CostRow,
    CostSources,
    Price,
    PricePage,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission
from idraft.domain.workloads import CostWorkload

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}", tags=["operations"])

ReadCosts = Annotated[WorkspaceAccess, Depends(require_permission(Permission.COSTS_READ))]
ManageBudgets = Annotated[WorkspaceAccess, Depends(require_permission(Permission.BUDGETS_MANAGE))]

# A leap year's whole period.
PERIOD_DAYS_MAX: Final = 366
YEAR_MIN: Final = 2000
YEAR_MAX: Final = 2100
_MONTH_PATTERN: Final = r"^(20\d{2}|2100)-(0[1-9]|1[0-2])$"


def _in_years(value: date) -> date:
    """A day the ledger can hold: no cost is older, and none is from the far future."""
    if not YEAR_MIN <= value.year <= YEAR_MAX:
        raise ValueError(f"a day from {YEAR_MIN} to {YEAR_MAX}")
    return value


Day = Annotated[date, AfterValidator(_in_years)]


def get_cost_service(resources: Annotated[Resources, Depends(get_resources)]) -> CostService:
    return resources.costs


Costs = Annotated[CostService, Depends(get_cost_service)]


def get_budget_service(resources: Annotated[Resources, Depends(get_resources)]) -> BudgetService:
    return BudgetService(sessions=resources.sessions)


def get_forecast_service(
    resources: Annotated[Resources, Depends(get_resources)],
) -> ForecastService:
    return ForecastService(sessions=resources.sessions)


def get_unit_cost_service(
    resources: Annotated[Resources, Depends(get_resources)],
) -> UnitCostService:
    return UnitCostService(sessions=resources.sessions)


Budgets = Annotated[BudgetService, Depends(get_budget_service)]
Forecasts = Annotated[ForecastService, Depends(get_forecast_service)]
UnitCosts = Annotated[UnitCostService, Depends(get_unit_cost_service)]


def _query_error(name: str, code: str, message: str) -> RequestValidationError:
    return RequestValidationError([{"loc": ("query", name), "type": code, "msg": message}])


@router.get(
    "/costs",
    summary="Costs grouped by the given keys",
    description="From `from` to `to`, both included (UTC days, at most 366). `group_by` is a "
    "comma list of `project`, `workload`, `provider`, `endpoint`, `engine`, `day`, `channel`; "
    "without it there is one total row. Rows are most expensive first. Read from the hourly "
    "rollup, so up to an hour behind; `meta.cost_sources` is read from the cost events. "
    "Money has six decimal places.",
)
async def list_costs(
    access: ReadCosts,
    costs: Costs,
    start: Annotated[Day, Query(alias="from")],
    end: Annotated[Day, Query(alias="to")],
    group_by: Annotated[list[CostGroup] | None, Commas, Query(max_length=7)] = None,
    project_id: Annotated[UUID | None, Query(alias="filter[project_id]")] = None,
    workloads: Annotated[
        list[CostWorkload] | None, Commas, Query(alias="filter[workload_in]", max_length=20)
    ] = None,
    provider_code: Annotated[
        str | None, Query(alias="filter[provider_code]", min_length=1, max_length=64)
    ] = None,
) -> CostList:
    if end < start:
        raise _query_error("to", "range_invalid", "`to` is on or after `from`.")
    if (end - start).days >= PERIOD_DAYS_MAX:
        raise _query_error("to", "range_too_long", f"A period of at most {PERIOD_DAYS_MAX} days.")
    report = await costs.costs(
        access,
        start=start,
        end=end,
        group_by=list(dict.fromkeys(group_by or ())),
        project_id=project_id,
        workloads=frozenset(workload.value for workload in workloads or ()),
        provider_code=provider_code,
    )
    return CostList(
        data=[
            CostRow(
                keys=row.keys,
                cost_usd=row.cost_usd,
                request_count=row.request_count,
                subjects=row.subjects,
            )
            for row in report.rows
        ],
        meta=CostMeta(total_cost_usd=report.total, cost_sources=CostSources(**report.sources)),
    )


def _budget(record: BudgetRecord) -> Budget:
    return Budget.model_validate(
        {
            "budget_id": record.id,
            "project_id": record.project_id,
            # A budget with no group covers everything.
            "workload": record.workload or "all",
            "period": record.period,
            "limit_usd": record.limit_usd,
            "soft_limit_pct": record.soft_limit_pct,
            "action_on_hard": record.action_on_hard,
            "created_at": record.created_at,
        }
    )


def _status(line: BudgetLine) -> BudgetStatus:
    return BudgetStatus(
        budget=_budget(line.budget),
        spent_usd=line.spent,
        committed_estimate_usd=line.committed,
        pct_used=line.pct_used,
        state=line.state,
        blocked_runs=line.blocked_runs,
    )


@router.get(
    "/budgets/status",
    summary="Each budget's spend in a month",
    description="`month` is `YYYY-MM` (UTC; this month when left out). `spent_usd` is read "
    "from the cost events; `committed_estimate_usd` is what runs under way are still expected "
    "to spend, this month only. `state` is `hard_exceeded` from the limit and `soft_exceeded` "
    "from its soft share. A member limited to some projects sees their budgets only.",
)
async def budget_status(
    access: ReadCosts,
    costs: Costs,
    month: Annotated[
        str | None, Query(pattern=_MONTH_PATTERN, description="`YYYY-MM`, 2000 to 2100.")
    ] = None,
) -> BudgetStatusList:
    first = None if month is None else date.fromisoformat(f"{month}-01")
    lines = await costs.budget_status(access, first)
    return BudgetStatusList(data=[_status(line) for line in lines])


@router.get(
    "/budgets",
    summary="The workspace's budgets",
    description="Oldest first, in pages. A member limited to some projects sees those "
    "projects' budgets only, not the workspace's; `404` for a `filter[project_id]` outside "
    "them.",
)
async def list_budgets(
    access: ReadCosts,
    budgets: Budgets,
    page: Offset,
    project_id: Annotated[UUID | None, Query(alias="filter[project_id]")] = None,
) -> BudgetPage:
    found = await budgets.page(access, project_id=project_id, offset=page.offset, limit=page.limit)
    return BudgetPage(
        data=[_budget(record) for record in found.budgets],
        page=OffsetPageInfo(offset=page.offset, limit=page.limit, total=found.total),
    )


@router.post(
    "/budgets",
    status_code=201,
    summary="Add a budget",
    description="One per project (or the workspace), group and month. `limit_usd` is from 0 to "
    "99999999999.99 with two places; a limit of 0 blocks every run of the group. "
    "`soft_limit_pct` is 1 to 100 (80 when left out) and `action_on_hard` `pause` when left "
    "out. Only stores a limit; it starts no run and spends nothing. `409 duplicate` when the "
    "budget exists; `422 validation_failed` with field code `project_unknown` at `project_id` "
    "for a project the workspace does not have. A member limited to some projects can add "
    "budgets for those projects only (`404` otherwise).",
)
async def create_budget(
    body: BudgetCreate, access: ManageBudgets, budgets: Budgets, info: Info
) -> BudgetResponse:
    return BudgetResponse(data=_budget(await budgets.create(access, body, info)))


@router.patch(
    "/budgets/{budget_id}",
    summary="Change a budget's limit",
    description="The limit, its soft share and the action at the hard limit. The scope and the "
    "group cannot change: delete the budget and add another. `404` for a budget that is not "
    "the workspace's, or not in the member's projects.",
)
async def update_budget(
    budget_id: UUID, body: BudgetUpdate, access: ManageBudgets, budgets: Budgets, info: Info
) -> BudgetResponse:
    return BudgetResponse(data=_budget(await budgets.update(access, budget_id, body, info)))


@router.delete(
    "/budgets/{budget_id}",
    status_code=204,
    summary="Delete a budget",
    description="Runs it blocked stay blocked; nothing else changes. `404` for a budget that is "
    "not the workspace's, or not in the member's projects.",
)
async def delete_budget(
    budget_id: UUID, access: ManageBudgets, budgets: Budgets, info: Info
) -> Response:
    await budgets.delete(access, budget_id, info)
    return Response(status_code=204)


def _first_of(month: str | None) -> date | None:
    return None if month is None else date.fromisoformat(f"{month}-01")


@router.get(
    "/costs/forecast",
    summary="What the live schedules are expected to cost in a month",
    description="`month` is `YYYY-MM` (UTC; this month when left out). A row per visible "
    "project with live AI schedules: the windows its schedules open in the month times the "
    "price book's price of one full run. An estimate, never what is charged; nothing is "
    "planned or started. A project whose run has no price is left out. `404` for a "
    "`filter[project_id]` the caller does not reach.",
)
async def cost_forecast(
    access: ReadCosts,
    forecasts: Forecasts,
    month: Annotated[
        str | None, Query(pattern=_MONTH_PATTERN, description="`YYYY-MM`, 2000 to 2100.")
    ] = None,
    project_id: Annotated[UUID | None, Query(alias="filter[project_id]")] = None,
) -> ForecastResponse:
    lines = await forecasts.forecast(access, _first_of(month), project_id)
    return ForecastResponse(
        data=[
            ForecastRow(
                project_id=line.project_id,
                workload="ai_prompt",
                estimated_cost_usd=line.estimated_cost_usd,
                method="price_book_x_schedules",
                is_estimate=True,
            )
            for line in lines
        ]
    )


@router.get(
    "/costs/unit-costs",
    summary="What one unit of work cost in a month",
    description="`month` is `YYYY-MM` (UTC; this month when left out). A row per visible "
    "project: the cost of a tracked keyword, a provider request, an active prompt and an AI "
    "answer, the last by engine with the answers counted. A figure with nothing to divide by "
    "is `null`, never 0. `404` for a `filter[project_id]` the caller does not reach.",
)
async def unit_costs(
    access: ReadCosts,
    units: UnitCosts,
    month: Annotated[
        str | None, Query(pattern=_MONTH_PATTERN, description="`YYYY-MM`, 2000 to 2100.")
    ] = None,
    project_id: Annotated[UUID | None, Query(alias="filter[project_id]")] = None,
) -> UnitCostResponse:
    lines = await units.unit_costs(access, _first_of(month), project_id)
    return UnitCostResponse(
        data=[
            UnitCostRow.model_validate(
                {
                    "project_id": line.project_id,
                    "per_tracked_keyword_month": line.per_tracked_keyword_month,
                    "per_serp_check": line.per_serp_check,
                    "per_active_prompt_month": line.per_active_prompt_month,
                    "per_ai_observation": line.per_ai_observation,
                    "extraction_llm_usd": line.extraction_llm_usd,
                    "per_engine": line.per_engine,
                    "ai_answers_by_engine": line.ai_answers_by_engine,
                }
            )
            for line in lines
        ]
    )


def _price(record: PriceRecord) -> Price:
    return Price(
        price_id=record.id,
        provider_code=record.provider_code,
        endpoint=record.endpoint,
        price_unit=record.price_unit,
        unit_price_usd=record.unit_price_usd,
        conditions=dict(record.conditions),
        valid_from=record.valid_from,
        valid_to=record.valid_to,
        source_url=record.source_url,
        verified_at=record.verified_at,
    )


@router.get(
    "/price-book",
    summary="Verified provider prices",
    description="The prices valid on `valid_at` (today when left out). They give the "
    "estimates budgets are judged by; what is charged is what the provider reports.",
)
async def price_book(
    access: ReadCosts,
    costs: Costs,
    page: Offset,
    provider_code: Annotated[
        str | None, Query(alias="filter[provider_code]", min_length=1, max_length=64)
    ] = None,
    endpoint: Annotated[
        str | None, Query(alias="filter[endpoint]", min_length=1, max_length=200)
    ] = None,
    valid_at: Day | None = None,
) -> PricePage:
    found = await costs.prices(
        access,
        provider_code=provider_code,
        endpoint=endpoint,
        valid_at=valid_at,
        offset=page.offset,
        limit=page.limit,
    )
    return PricePage(
        data=[_price(record) for record in found.prices],
        page=OffsetPageInfo(offset=page.offset, limit=page.limit, total=found.total),
    )
