"""The contract of budgets, the forecast and unit costs (WP-30 task 0; doc 19 section 3.11.2,
docs/ai-visibility/contracts/budgets-costs.md): the access checks answer first, the path, query
and body are validated next, then `501 not_implemented` until WP-30 builds the bodies. The owner
deletes this file when it writes the real tests."""

from __future__ import annotations

import uuid
from typing import Any

import httpx
import pytest

from idraft.api.openapi import build_openapi
from idraft.api.resources import Resources
from tests.api.auth.support import Workspace, make_workspace
from tests.api.entities.support import member, problem
from tests.conftest import PostgresServer

NOT_BUILT = (501, "not_implemented")
FORBIDDEN = (403, "forbidden")
NOT_FOUND = (404, "not_found")
UNAUTHENTICATED = (401, "unauthenticated")
INVALID = (422, "validation_failed")

# Fixed ids: the test names carry them, and every xdist worker must collect the same names.
PROJECT = uuid.UUID(int=30)
BUDGET = uuid.UUID(int=31)
CREATE = {"project_id": str(PROJECT), "workload": "ai_prompt", "limit_usd": "250.00"}
UPDATE = {"limit_usd": "300.00", "soft_limit_pct": 90, "action_on_hard": "alert_only"}

# Method, path after the workspace, and the body the route takes.
READS: list[tuple[str, str, dict[str, Any] | None]] = [
    ("GET", "budgets", None),
    ("GET", f"budgets?filter[project_id]={PROJECT}", None),
    ("GET", "costs/forecast?month=2026-11", None),
    ("GET", "costs/unit-costs?month=2026-11", None),
]
WRITES: list[tuple[str, str, dict[str, Any] | None]] = [
    ("POST", "budgets", CREATE),
    ("PATCH", f"budgets/{BUDGET}", UPDATE),
    ("DELETE", f"budgets/{BUDGET}", None),
]


def _url(workspace: Workspace, path: str) -> str:
    return f"/api/v1/workspaces/{workspace.id}/{path}"


@pytest.mark.parametrize(("method", "path", "body"), READS, ids=[row[1] for row in READS])
async def test_each_new_route_checks_access_first_for_a_read(
    method: str,
    path: str,
    body: dict[str, Any] | None,
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    analyst = await member(resources, migrated, workspace, "analyst")
    outsider = await member(resources, migrated, await make_workspace(migrated), "owner")
    url = _url(workspace, path)

    anonymous = await api.request(method, url, json=body)
    unseen = await api.request(method, url, json=body, headers=outsider.headers)
    refused = await api.request(method, url, json=body, headers=viewer.headers)
    allowed = await api.request(method, url, json=body, headers=analyst.headers)

    assert problem(anonymous) == UNAUTHENTICATED
    assert problem(unseen) == NOT_FOUND
    assert problem(refused) == FORBIDDEN
    assert problem(allowed) == NOT_BUILT


@pytest.mark.parametrize(("method", "path", "body"), WRITES, ids=[row[0] for row in WRITES])
async def test_each_new_route_checks_access_first_for_a_write(
    method: str,
    path: str,
    body: dict[str, Any] | None,
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    workspace = await make_workspace(migrated)
    analyst = await member(resources, migrated, workspace, "analyst")
    billing = await member(resources, migrated, workspace, "billing")
    outsider = await member(resources, migrated, await make_workspace(migrated), "owner")
    url = _url(workspace, path)

    anonymous = await api.request(method, url, json=body)
    unseen = await api.request(method, url, json=body, headers=outsider.headers)
    # An analyst reads costs, and still may not change a budget.
    refused = await api.request(method, url, json=body, headers=analyst.headers)
    allowed = await api.request(method, url, json=body, headers=billing.headers)

    assert problem(anonymous) == UNAUTHENTICATED
    assert problem(unseen) == NOT_FOUND
    assert problem(refused) == FORBIDDEN
    assert problem(allowed) == NOT_BUILT


BAD_REQUESTS: list[tuple[str, str, dict[str, Any] | None]] = [
    ("GET", "costs/forecast?month=2026-13", None),
    ("GET", "costs/forecast?month=1999-12", None),
    ("GET", "costs/forecast?month=nope", None),
    ("GET", "costs/unit-costs?month=2026-13", None),
    ("GET", "costs/unit-costs?month=2101-01", None),
    ("GET", "costs/forecast?filter[project_id]=nope", None),
    ("GET", "costs/unit-costs?filter[project_id]=nope", None),
    ("GET", "budgets?filter[project_id]=nope", None),
    ("PATCH", "budgets/nope", UPDATE),
    ("DELETE", "budgets/nope", None),
    ("PATCH", f"budgets/{BUDGET}", {}),
    ("PATCH", f"budgets/{BUDGET}", {"limit_usd": None}),
    ("PATCH", f"budgets/{BUDGET}", {"limit_usd": "-1.00"}),
    ("PATCH", f"budgets/{BUDGET}", {"workload": "ai_prompt"}),
    ("POST", "budgets", {**CREATE, "workload": "keyword_metrics"}),
    ("POST", "budgets", {**CREATE, "limit_usd": "-0.01"}),
    ("POST", "budgets", {**CREATE, "limit_usd": "1.234"}),
    ("POST", "budgets", {**CREATE, "limit_usd": "100000000000.00"}),
    ("POST", "budgets", {**CREATE, "soft_limit_pct": 0}),
    ("POST", "budgets", {**CREATE, "soft_limit_pct": 101}),
    ("POST", "budgets", {**CREATE, "action_on_hard": "stop"}),
    ("POST", "budgets", {"workload": "ai_prompt"}),
    ("POST", "budgets", {**CREATE, "period": "week"}),
]


@pytest.mark.parametrize(
    ("method", "path", "body"), BAD_REQUESTS, ids=[f"{row[0]} {row[1]}" for row in BAD_REQUESTS]
)
async def test_a_bad_month_or_budget_id_is_422(
    method: str,
    path: str,
    body: dict[str, Any] | None,
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    """Only a caller who may use the route learns that its parameter is wrong."""
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")

    response = await api.request(method, _url(workspace, path), json=body, headers=owner.headers)

    assert problem(response) == INVALID


async def test_a_good_month_and_body_reach_the_stub(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The limits are inclusive: 0 blocks every run, and the group `all` is a group."""
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    edge = {"workload": "all", "limit_usd": "0.00", "soft_limit_pct": 100}

    for month in ("2000-01", "2100-12"):
        response = await api.get(
            _url(workspace, f"costs/forecast?month={month}"), headers=owner.headers
        )
        assert problem(response) == NOT_BUILT
    created = await api.post(_url(workspace, "budgets"), json=edge, headers=owner.headers)
    updated = await api.patch(
        _url(workspace, f"budgets/{BUDGET}"),
        json={"soft_limit_pct": 1},
        headers=owner.headers,
    )

    assert problem(created) == NOT_BUILT
    assert problem(updated) == NOT_BUILT


def test_the_api_document_has_the_budget_and_cost_routes() -> None:
    document = build_openapi()
    paths = document["paths"]
    schemas = document["components"]["schemas"]
    prefix = "/api/v1/workspaces/{workspace_id}"

    assert set(paths[f"{prefix}/budgets"]) == {"get", "post"}
    assert set(paths[f"{prefix}/budgets/{{budget_id}}"]) == {"patch", "delete"}
    assert set(paths[f"{prefix}/budgets/status"]) == {"get"}
    assert set(paths[f"{prefix}/costs/forecast"]) == {"get"}
    assert set(paths[f"{prefix}/costs/unit-costs"]) == {"get"}
    assert "201" in paths[f"{prefix}/budgets"]["post"]["responses"]
    assert "204" in paths[f"{prefix}/budgets/{{budget_id}}"]["delete"]["responses"]
    for name in (
        "BudgetCreate",
        "BudgetUpdate",
        "BudgetResponse",
        "BudgetPage",
        "ForecastRow",
        "ForecastResponse",
        "UnitCostRow",
        "UnitCostResponse",
    ):
        assert name in schemas, name

    for route in ("costs/forecast", "costs/unit-costs"):
        queries = paths[f"{prefix}/{route}"]["get"]["parameters"]
        parameters = {p["name"]: p for p in queries if p["in"] == "query"}
        assert set(parameters) == {"month", "filter[project_id]"}, route
        assert parameters["month"]["schema"]["anyOf"][0]["pattern"] == (
            r"^(20\d{2}|2100)-(0[1-9]|1[0-2])$"
        ), route
    listing = {
        p["name"] for p in paths[f"{prefix}/budgets"]["get"]["parameters"] if p["in"] == "query"
    }
    assert listing == {"offset", "limit", "filter[project_id]"}

    forecast = schemas["ForecastRow"]["properties"]
    assert set(forecast) == {
        "project_id",
        "workload",
        "estimated_cost_usd",
        "method",
        "is_estimate",
    }
    assert forecast["workload"]["const"] == "ai_prompt"
    assert forecast["method"]["const"] == "price_book_x_schedules"
    assert forecast["is_estimate"]["const"] is True
    unit = schemas["UnitCostRow"]["properties"]
    assert set(unit) == {
        "project_id",
        "per_tracked_keyword_month",
        "per_serp_check",
        "per_active_prompt_month",
        "per_ai_observation",
        "extraction_llm_usd",
        "per_engine",
        "ai_answers_by_engine",
    }
    assert set(schemas["BudgetCreate"]["required"]) == {"workload", "limit_usd"}
    assert set(schemas["BudgetUpdate"]["properties"]) == {
        "limit_usd",
        "soft_limit_pct",
        "action_on_hard",
    }
