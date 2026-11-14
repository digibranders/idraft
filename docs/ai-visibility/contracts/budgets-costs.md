# Budgets, forecast and unit costs

## Status

Published by WP-30 on 2026-11-14 (task 0, contract first) and built by the same package on the same
day: the six routes are the rest of doc 19 section 3.11.2. Owner package:
[WP-30 runs-costs-health](../work-packages/WP-30-runs-costs-health.md) (rows
BE-BILLING-PLAN-LINKS-11 and BE-BILLING-PLAN-LINKS-15). The schemas are in
`backend/src/idraft/api/schemas/budgets.py`, the routes in `backend/src/idraft/api/operations/cost_routes.py`,
the services in `budgets.py`, `costs_forecast.py` and `costs_unit.py` of the same package. No migration.
`GET {W}/budgets/status` was built before and is not changed.

## Routes and parameters

`{W}` is `/api/v1/workspaces/{workspace_id}`. All are workspace routes: a member limited to some
projects sees and changes the budgets of those projects only.

| Method | Path | Permission | Success |
|---|---|---|---|
| GET | `{W}/budgets` | `costs:read` | `200 BudgetPage` |
| POST | `{W}/budgets` | `budgets:manage` | `201 BudgetResponse` |
| PATCH | `{W}/budgets/{budget_id}` | `budgets:manage` | `200 BudgetResponse` |
| DELETE | `{W}/budgets/{budget_id}` | `budgets:manage` | `204` |
| GET | `{W}/costs/forecast` | `costs:read` | `200 ForecastResponse` |
| GET | `{W}/costs/unit-costs` | `costs:read` | `200 UnitCostResponse` |

`budgets:manage` is held by owner, admin and billing; `costs:read` by owner, admin, editor, analyst and
billing. A viewer cannot read costs.

### GET {W}/budgets

| Parameter | Type | Bounds | Meaning |
|---|---|---|---|
| `offset` | integer | 0 to 100,000 | Default 0. |
| `limit` | integer | 1 to 200 | Default 50. |
| `filter[project_id]` | uuid | | Only the budgets of that project. |

Response: `{ data: Budget[], page: { offset, limit, total } }`, oldest first. `Budget` is the shape
`budgets/status` returns: `budget_id`, `project_id` (null for the workspace), `workload` (a budget group
or `all`), `period` (`month`), `limit_usd`, `soft_limit_pct`, `action_on_hard`, `created_at`.

### POST {W}/budgets

Body `BudgetCreate` (unknown members are refused):

| Field | Type | Bounds | Meaning |
|---|---|---|---|
| `project_id` | uuid or left out | | Left out, the budget covers the whole workspace. |
| `workload` | `seo_rank`, `ai_prompt`, `keyword_research`, `ai_benchmark`, `extraction_llm`, `first_party`, `all` | required | A budget group (doc 04 section 11.4.1); `all` is stored as no group. |
| `limit_usd` | decimal string | required, 0 to 99999999999.99, two decimal places | Per month (UTC). 0 blocks every run of the group. |
| `soft_limit_pct` | integer | 1 to 100 | Default 80. |
| `action_on_hard` | `pause`, `alert_only` | | Default `pause`. |

`201` with `{ data: Budget }`.

### PATCH {W}/budgets/{budget_id}

Body `BudgetUpdate`: `limit_usd`, `soft_limit_pct`, `action_on_hard`, each as above, none null, at least one
given (an empty body is `422`). The scope (`project_id`) and the group (`workload`) cannot change: delete
the budget and add another. `200` with `{ data: Budget }`.

### DELETE {W}/budgets/{budget_id}

No body. `204`. Runs the budget blocked stay blocked (`blocked_by_budget_id` is cleared by the database).

### GET {W}/costs/forecast

| Parameter | Type | Bounds | Meaning |
|---|---|---|---|
| `month` | string `YYYY-MM` | pattern `^(20\d{2}\|2100)-(0[1-9]\|1[0-2])$` (2000 to 2100) | UTC month; this month when left out (as `budgets/status`). |
| `filter[project_id]` | uuid | | Only that project. |

`data[]` is a `ForecastRow`:

| Field | Type | Meaning |
|---|---|---|
| `project_id` | uuid | |
| `workload` | `ai_prompt` | Always `ai_prompt` for now: no other workload is forecast. |
| `estimated_cost_usd` | `Usd` | The windows the project's live `ai_prompt` schedules open in the month, times the price book's price of one full run. |
| `method` | `price_book_x_schedules` | |
| `is_estimate` | `true` | An estimate, never what is charged. |

One row per visible project with live `ai_prompt` schedules. A project whose run has no price in the
price book is left out: its forecast is unknown, not 0.

### GET {W}/costs/unit-costs

Same `month` and `filter[project_id]`. `data[]` is a `UnitCostRow`, one per visible project:

| Field | Type | Meaning |
|---|---|---|
| `project_id` | uuid | |
| `per_tracked_keyword_month` | `Usd` or null | `seo_rank` spend of the month over active tracked keywords. |
| `per_serp_check` | `Usd` or null | `seo_rank` spend of the month over its provider requests. |
| `per_active_prompt_month` | `Usd` or null | `ai_prompt` spend of the month over active prompts. |
| `per_ai_observation` | `Usd` or null | Mean cost of the month's current AI answers that have a cost. |
| `extraction_llm_usd` | `Usd` or null | `extraction_llm` spend of the month. |
| `per_engine` | object, `EngineCode` to `Usd` or null | `per_ai_observation` by engine. |
| `ai_answers_by_engine` | object, `EngineCode` to integer | The costed answers behind `per_engine`, so the web can say "from 148 answers". Added to the doc 19 shape. |

Every figure is null when its divisor is 0, never 0.

## Error codes

| Status | Code | When |
|---|---|---|
| 401 | `unauthenticated` | No session. |
| 404 | `not_found` | Not a member of the workspace; a budget that is not in the workspace or not in the caller's projects (`PATCH`, `DELETE`); a `filter[project_id]` outside the caller's projects or naming no live project (budgets, forecast, unit costs); a member limited to some projects who creates a budget with no project (a workspace-level budget) or for a project outside their scope. |
| 403 | `forbidden` | The role lacks `costs:read` (reads) or `budgets:manage` (writes). |
| 422 | `validation_failed` | A bad `budget_id` or `project_id` (not a uuid), a `month` outside the pattern, a body outside the bounds above, an unknown member, an empty `PATCH`. |
| 422 | `validation_failed` with field code `project_unknown` at `project_id` | The project is not in the workspace or is deleted (`POST`). |
| 409 | `duplicate` | A budget for the same project (or workspace), group and month exists (`POST`). |

## Defaults and rules

| # | Rule |
|---|---|
| D9 | Budgets CRUD: `201` on create, `204` on delete, the defaults come from the column defaults (80, `pause`). A duplicate is caught from the table's unique constraint (`UNIQUE NULLS NOT DISTINCT (workspace_id, project_id, workload, period)`) inside a savepoint and answered `409 duplicate`, so two workspace-level budgets of one group collide as well. A member limited to some projects creates, changes and deletes budgets of those projects only; any other budget is `404`. `GET {W}/budgets` has the same visibility as `budgets/status`, oldest first, in one statement. Audit actions `budget.created` (after), `budget.updated` (before and after) and `budget.deleted` (before), written in the transaction of the change, each with the snapshot `{ project_id, workload, limit_usd, soft_limit_pct, action_on_hard }`: `project_id` a string or null, `workload` as the API shows it (`all` when the budget has no group), `limit_usd` a string with two places. Deleting a budget keeps the runs it blocked (`blocked_by_budget_id` becomes null). No migration. |
| D10 | Forecast: windows the live `ai_prompt` schedules open in the month (UTC), from the schedule planner's own occurrences (`occurrences_until`), times the price of one full run computed by the AI collector's own estimate (`select_subjects`, then `estimate` on the schedule's queue) with an all-prompts selector, so a forecast and a planned run never disagree. The selector of each schedule is ignored, so a forecast can be above what is planned; schedules with overlapping windows are each priced in full, so they over-forecast too; a cron schedule is skipped; a paused or deleted schedule adds nothing. A project with live schedules but no active prompts or no enabled engine has an empty run, which costs nothing, so its row shows `0.000000` as a known cost. A project whose run has an engine with no price in the price book is left out (unknown, not 0). `method` is `price_book_x_schedules` and `is_estimate` is `true`. Other workloads are not forecast. |
| D11 | Unit costs: `per_ai_observation` is the sum of `ai.observations.cost_usd` over current answers with a cost in the month, divided by their count; the other figures divide the month's `ops.cost_daily` spend by the counts above (active prompts and active tracked keywords that are not deleted, and the provider requests of `seo_rank`). One helper, `per_unit(total, count)`, divides `Decimal`s, rounds once to the micro-dollar (half-even, the `Decimal` default) and returns null when the count is 0; a figure whose workload has no `ops.cost_daily` row in the month is null too. `per_engine` has all three engine codes (null for an engine with no costed answer) and `ai_answers_by_engine` the count behind each figure. Four tenant reads, whatever the number of answers, prompts or projects. Money is `Decimal` end to end and rounded once, to six places. |

## Examples

`POST {W}/budgets`:

```json
{"project_id": "0000001e-7c1e-4a52-9b3d-00000000001e", "workload": "ai_prompt", "limit_usd": "250.00", "soft_limit_pct": 90}
```

`201`:

```json
{
  "data": {
    "budget_id": "0000001f-7c1e-4a52-9b3d-00000000001f",
    "project_id": "0000001e-7c1e-4a52-9b3d-00000000001e",
    "workload": "ai_prompt",
    "period": "month",
    "limit_usd": "250.00",
    "soft_limit_pct": 90,
    "action_on_hard": "pause",
    "created_at": "2026-11-14T09:30:00Z"
  }
}
```

`PATCH {W}/budgets/{budget_id}`: `{"limit_usd": "300.00", "action_on_hard": "alert_only"}`; the answer is the
same shape with the new values.

`GET {W}/costs/forecast?month=2026-11`, `200`:

```json
{
  "data": [
    {
      "project_id": "0000001e-7c1e-4a52-9b3d-00000000001e",
      "workload": "ai_prompt",
      "estimated_cost_usd": "2.250000",
      "method": "price_book_x_schedules",
      "is_estimate": true
    }
  ]
}
```

`GET {W}/costs/unit-costs?month=2026-11`, `200` (an engine with no costed answer is null, and the project has
no tracked keyword with a cost):

```json
{
  "data": [
    {
      "project_id": "0000001e-7c1e-4a52-9b3d-00000000001e",
      "per_tracked_keyword_month": null,
      "per_serp_check": null,
      "per_active_prompt_month": "0.030000",
      "per_ai_observation": "0.001200",
      "extraction_llm_usd": "0.410000",
      "per_engine": {"chatgpt_web": "0.001500", "gemini_web": "0.000900", "google_ai_mode": null},
      "ai_answers_by_engine": {"chatgpt_web": 148, "gemini_web": 140, "google_ai_mode": 0}
    }
  ]
}
```

## Open choices

Each row can be tightened by WP-30 through the change log.

| Q | Question | Choice | Why |
|---|---|---|---|
| Q1 | Where the new models live | `schemas/budgets.py`, importing `Budget` and `Usd` | `operations.py` is touched by other packages. |
| Q2 | `workload` of a budget request | The seven budget groups of `Budget`, not the run workloads | Doc 04 section 11.4.1: a budget is by group. |
| Q3 | Response of the writes | `{ data: Budget }` (doc 19 `One<Budget>`) | The same envelope as every single-resource answer. |
| Q4 | Upper bound of `limit_usd` | 99999999999.99 | The column holds `numeric(14,2)`; the bound leaves room and keeps sums of limits inside it. |
| Q5 | `ai_answers_by_engine` | Added to `UnitCostRow` | Honest numbers: an average shows how many answers it is of. |
| Q6 | Default of `month` | The current UTC month | As `budgets/status`. |

## How it was filled

WP-30 built the six routes; none answers `501` any more.

1. `api/operations/cost_routes.py` builds `BudgetService`, `ForecastService` and `UnitCostService`
   through dependencies (`get_budget_service`, `get_forecast_service`, `get_unit_cost_service`) and the
   route functions call them. The services live in `budgets.py` (statements in
   `budgets_repository.py`), `costs_forecast.py` and `costs_unit.py` (both reading through
   `costs_repository.py`).
2. `tests/api/operations/test_contract_budgets.py` no longer expects `501`: it checks the order of the
   access answers, then the validation of the path, query and body. The behaviour is covered by
   `test_budgets.py`, `test_budgets_tenant.py`, `test_cost_forecast.py` and `test_unit_costs.py`, and
   the statement counts by `test_budget_statements.py`.
3. The `Not built yet` sentence is gone from each route description, and `backend/openapi/v1.json` and
   `apps/web/src/lib/api/schema.ts` were regenerated (`pnpm gen:api`).

## Change log

Newest last; one line per change, in the form `date package: change`.

2026-11-14 WP-30: contract published
2026-11-14 WP-30: routes built, so no route answers `501` any more; `404` cases named (a budget outside the member's projects, a `filter[project_id]` outside them or naming no live project, a limited member creating a workspace-level budget or one for a project outside their scope); audit snapshot fields recorded in D9; forecast limits (selector ignored, overlapping schedules over-forecast, cron skipped, `0.000000` for live schedules with no prompts or engines, unpriced projects left out) in D10; `per_unit`, half-even rounding and null rules in D11
