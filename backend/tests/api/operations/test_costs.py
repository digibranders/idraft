"""Costs, budget status and the price book (docs/19 sections 3.11.1 and 3.11.2; plan decision
D14). Costs are read from the hourly rollup, written here directly."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import httpx
import pytest

from sightline.api.resources import Resources
from tests.api.auth.support import Workspace, execute, fetchrow, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.keywords.support import keyword_project
from tests.conftest import PostgresServer

TODAY = datetime.now(UTC).date()
LABS = "dataforseo_labs/google/keyword_overview"
SERP = "serp/google/organic/task_post"


def _last_month() -> datetime:
    """Noon on the 15th of last month: cost events are kept by month, and the ledger holds
    this month's partition and the one before."""
    return (datetime.now(UTC).replace(day=1) - timedelta(days=1)).replace(
        day=15, hour=12, minute=0, second=0, microsecond=0
    )


def _url(workspace: Workspace, *parts: str) -> str:
    return "/".join([f"/api/v1/workspaces/{workspace.id}", *parts])


async def _daily(
    pg: PostgresServer,
    workspace: Workspace,
    project: uuid.UUID,
    cost: str,
    *,
    day: date = TODAY,
    workload: str = "keyword_metrics",
    endpoint: str = LABS,
    engine: str = "",
    requests: int = 1,
    subjects: int = 1,
) -> None:
    await execute(
        pg,
        "INSERT INTO ops.cost_daily (cost_date, workspace_id, project_id, provider_code, "
        "endpoint, workload, engine_code, request_count, cost_usd, subjects) "
        "VALUES ($1, $2, $3, 'dataforseo', $4, $5, $6, $7, $8, $9)",
        day,
        workspace.id,
        project,
        endpoint,
        workload,
        engine,
        requests,
        Decimal(cost),
        subjects,
    )


async def _event(
    pg: PostgresServer,
    workspace: Workspace,
    project: uuid.UUID | None,
    cost: str,
    *,
    source: str = "provider_reported",
    workload: str = "keyword_metrics",
    when: datetime | None = None,
) -> None:
    at = when or datetime.now(UTC)
    await execute(
        pg,
        "INSERT INTO ops.provider_cost_events (occurred_at, workspace_id, project_id, "
        "provider_code, endpoint, workload, channel, cost_usd, cost_source, billing_period) "
        "VALUES ($1, $2, $3, 'dataforseo', $4, $5, 'research', $6, $7, $8)",
        at,
        workspace.id,
        project,
        LABS,
        workload,
        Decimal(cost),
        source,
        at.date().replace(day=1),
    )


async def _setup(
    resources: Resources, pg: PostgresServer
) -> tuple[Workspace, uuid.UUID, uuid.UUID, Caller]:
    workspace = await make_workspace(pg)
    owner = await member(resources, pg, workspace, "owner")
    first, second = await keyword_project(pg, workspace), await keyword_project(pg, workspace)
    await _daily(pg, workspace, first, "0.012240", requests=3, subjects=2)
    await _daily(pg, workspace, first, "0.002000", day=TODAY - timedelta(days=1))
    await _daily(
        pg, workspace, second, "0.000600", workload="seo_rank", endpoint=SERP, engine="google"
    )
    # Outside the period.
    await _daily(pg, workspace, first, "9.000000", day=TODAY - timedelta(days=40))
    await _event(pg, workspace, first, "0.012000")
    await _event(pg, workspace, first, "0.000240", source="price_book_estimate")
    await _event(pg, workspace, second, "0.000600", workload="seo_rank")
    return workspace, first, second, owner


def _period(**params: str) -> dict[str, str]:
    return {
        "from": (TODAY - timedelta(days=7)).isoformat(),
        "to": TODAY.isoformat(),
        **params,
    }


def _rows(response: httpx.Response) -> list[tuple[dict[str, str], str, int, int]]:
    assert response.status_code == 200, response.text
    return [
        (row["keys"], row["cost_usd"], row["request_count"], row["subjects"])
        for row in response.json()["data"]
    ]


async def test_costs_are_grouped_by_project_and_workload_most_expensive_first(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, first, second, owner = await _setup(resources, migrated)

    response = await api.get(
        _url(workspace, "costs"),
        params=_period(group_by="project,workload"),
        headers=owner.headers,
    )

    assert _rows(response) == [
        ({"project": str(first), "workload": "keyword_metrics"}, "0.014240", 4, 3),
        ({"project": str(second), "workload": "seo_rank"}, "0.000600", 1, 1),
    ]
    meta = response.json()["meta"]
    assert meta["total_cost_usd"] == "0.014840"
    # From the events of the period.
    assert meta["cost_sources"] == {
        "provider_reported": "0.012600",
        "computed_from_tokens": "0.000000",
        "price_book_estimate": "0.000240",
    }


@pytest.mark.parametrize(
    ("group_by", "keys"),
    [
        ("day", [{"day": TODAY.isoformat()}, {"day": (TODAY - timedelta(days=1)).isoformat()}]),
        ("provider", [{"provider": "dataforseo"}]),
        ("endpoint", [{"endpoint": LABS}, {"endpoint": SERP}]),
        ("engine", [{"engine": ""}, {"engine": "google"}]),
        ("channel", [{"channel": "research"}, {"channel": "seo"}]),
    ],
)
async def test_every_grouping(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    group_by: str,
    keys: list[dict[str, str]],
) -> None:
    workspace, _first, _second, owner = await _setup(resources, migrated)

    response = await api.get(
        _url(workspace, "costs"), params=_period(group_by=group_by), headers=owner.headers
    )

    assert [row[0] for row in _rows(response)] == keys


async def test_without_a_grouping_there_is_one_total_row(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, _first, _second, owner = await _setup(resources, migrated)

    response = await api.get(_url(workspace, "costs"), params=_period(), headers=owner.headers)

    assert _rows(response) == [({}, "0.014840", 5, 4)]


async def test_the_filters_narrow_the_rows_and_the_sources(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, _first, second, owner = await _setup(resources, migrated)
    url = _url(workspace, "costs")

    by_project = await api.get(
        url, params=_period(**{"filter[project_id]": str(second)}), headers=owner.headers
    )
    by_workload = await api.get(
        url, params=_period(**{"filter[workload_in]": "keyword_metrics"}), headers=owner.headers
    )
    by_provider = await api.get(
        url, params=_period(**{"filter[provider_code]": "openai"}), headers=owner.headers
    )

    assert _rows(by_project) == [({}, "0.000600", 1, 1)]
    assert by_project.json()["meta"]["cost_sources"]["provider_reported"] == "0.000600"
    assert _rows(by_workload) == [({}, "0.014240", 4, 3)]
    assert _rows(by_provider) == []
    assert by_provider.json()["meta"]["total_cost_usd"] == "0.000000"


@pytest.mark.parametrize(
    "params",
    [
        {"from": "2026-09-30", "to": "2026-09-01"},
        {"from": "2025-01-01", "to": "2026-09-01"},
        {"from": "2026-09-01", "to": "2026-09-30", "group_by": "colour"},
    ],
)
async def test_a_period_the_rollup_cannot_answer_is_refused(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    params: dict[str, str],
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")

    response = await api.get(_url(workspace, "costs"), params=params, headers=owner.headers)

    assert problem(response) == (422, "validation_failed")


async def test_a_member_limited_to_a_project_sees_its_costs_only(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, first, second, _owner = await _setup(resources, migrated)
    scoped = await member(resources, migrated, workspace, "analyst", project_ids=[first])
    url = _url(workspace, "costs")

    everything = await api.get(url, params=_period(group_by="project"), headers=scoped.headers)
    elsewhere = await api.get(
        url, params=_period(**{"filter[project_id]": str(second)}), headers=scoped.headers
    )

    assert [row[0] for row in _rows(everything)] == [{"project": str(first)}]
    assert everything.json()["meta"]["cost_sources"]["price_book_estimate"] == "0.000240"
    assert problem(elsewhere) == (404, "not_found")


async def test_costs_need_costs_read(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await api.get(_url(workspace, "costs"), params=_period(), headers=viewer.headers)

    assert problem(response) == (403, "forbidden")


# Budget status.


async def _budget(
    pg: PostgresServer,
    workspace: Workspace,
    limit: str,
    *,
    project: uuid.UUID | None = None,
    workload: str | None = "keyword_research",
    soft: int = 80,
) -> str:
    row = await fetchrow(
        pg,
        "INSERT INTO ops.budgets (workspace_id, project_id, workload, limit_usd, soft_limit_pct) "
        "VALUES ($1, $2, $3, $4, $5) RETURNING id",
        workspace.id,
        project,
        workload,
        Decimal(limit),
        soft,
    )
    return str(row["id"])


async def test_each_budget_says_what_is_spent_committed_and_its_state(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)
    roomy = await _budget(migrated, workspace, "10.00")
    tight = await _budget(migrated, workspace, "1.00", project=project, soft=50)
    used_up = await _budget(migrated, workspace, "0.50", workload=None)
    await _event(migrated, workspace, project, "0.60")
    # Last month's spend counts for last month only.
    await _event(migrated, workspace, project, "5.00", when=_last_month())
    # A run under way that is still expected to spend 0.30.
    await execute(
        migrated,
        "INSERT INTO ops.collection_runs (workspace_id, project_id, workload, window_start, "
        "window_end, trigger, status, estimated_cost_usd, config_snapshot) VALUES ($1, $2, "
        "'keyword_metrics', now(), now() + interval '1 hour', 'manual', 'running', 0.30, '{}')",
        workspace.id,
        project,
    )
    # And one the full budget blocked.
    await execute(
        migrated,
        "INSERT INTO ops.collection_runs (workspace_id, project_id, workload, window_start, "
        "window_end, trigger, status, blocked_by_budget_id, config_snapshot, completed_at) "
        "VALUES ($1, $2, 'keyword_metrics', now(), now(), 'manual', 'budget_blocked', $3, '{}', "
        "now())",
        workspace.id,
        project,
        uuid.UUID(used_up),
    )

    response = await api.get(_url(workspace, "budgets", "status"), headers=owner.headers)

    assert response.status_code == 200, response.text
    found: dict[str, Any] = {row["budget"]["budget_id"]: row for row in response.json()["data"]}
    assert {
        budget_id: (
            row["spent_usd"],
            row["committed_estimate_usd"],
            row["pct_used"],
            row["state"],
            row["blocked_runs"],
        )
        for budget_id, row in found.items()
    } == {
        roomy: ("0.600000", "0.300000", 6.0, "ok", 0),
        tight: ("0.600000", "0.300000", 60.0, "soft_exceeded", 0),
        used_up: ("0.600000", "0.300000", 120.0, "hard_exceeded", 1),
    }
    assert found[used_up]["budget"]["workload"] == "all"


async def test_a_past_month_has_no_committed_spend(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)
    budget = await _budget(migrated, workspace, "10.00")
    last_month = _last_month()
    await _event(migrated, workspace, project, "2.50", when=last_month)

    response = await api.get(
        _url(workspace, "budgets", "status"),
        params={"month": last_month.strftime("%Y-%m")},
        headers=owner.headers,
    )

    (row,) = response.json()["data"]
    assert (row["budget"]["budget_id"], row["spent_usd"], row["committed_estimate_usd"]) == (
        budget,
        "2.500000",
        "0.000000",
    )


async def test_a_member_limited_to_a_project_sees_that_projects_budgets_only(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    mine, theirs = (
        await keyword_project(migrated, workspace),
        await keyword_project(migrated, workspace),
    )
    await _budget(migrated, workspace, "10.00")
    own = await _budget(migrated, workspace, "1.00", project=mine)
    await _budget(migrated, workspace, "1.00", project=theirs)
    scoped = await member(resources, migrated, workspace, "analyst", project_ids=[mine])

    response = await api.get(_url(workspace, "budgets", "status"), headers=scoped.headers)

    # A workspace budget would show other projects' spend.
    assert [row["budget"]["budget_id"] for row in response.json()["data"]] == [own]


# Price book.


async def test_the_price_book_lists_the_prices_valid_on_a_day(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    analyst = await member(resources, migrated, workspace, "analyst")
    url = _url(workspace, "price-book")

    labs = await api.get(
        url, params={"filter[endpoint]": LABS, "limit": 1}, headers=analyst.headers
    )
    before = await api.get(
        url,
        params={"filter[provider_code]": "dataforseo", "valid_at": "2020-01-01"},
        headers=analyst.headers,
    )

    assert labs.status_code == 200, labs.text
    page = labs.json()
    # The Labs call and its keywords (docs/27 section 1), seeded by migration 0011.
    assert page["page"] == {"offset": 0, "limit": 1, "total": 2}
    (price,) = page["data"]
    assert (price["provider_code"], price["endpoint"]) == ("dataforseo", LABS)
    assert price["source_url"].startswith("https://")
    assert before.json()["data"] == []
