"""Rows and calls for the budget, forecast and unit cost tests (WP-30 T2). Rows are written
straight into the tables so every expected figure can be worked out by hand. Nothing here calls a
provider."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import httpx

from tests.api.auth.support import Workspace, execute, fetch
from tests.api.operations.collection_support import Scene, add_answer
from tests.collectors.ai_support import Prompt
from tests.collectors.support import Project
from tests.conftest import PostgresServer


def url(workspace: Workspace, *parts: object) -> str:
    return "/".join([f"/api/v1/workspaces/{workspace.id}", *map(str, parts)])


def this_month() -> str:
    """The billing month the API reads by default, as `YYYY-MM` (UTC)."""
    return datetime.now(UTC).strftime("%Y-%m")


async def post_budget(
    api: httpx.AsyncClient, workspace: Workspace, headers: dict[str, str], **body: Any
) -> httpx.Response:
    return await api.post(
        url(workspace, "budgets"),
        json={"workload": "ai_prompt", "limit_usd": "100.00", **body},
        headers=headers,
    )


async def created(
    api: httpx.AsyncClient, workspace: Workspace, headers: dict[str, str], **body: Any
) -> dict[str, Any]:
    response = await post_budget(api, workspace, headers, **body)
    assert response.status_code == 201, response.text
    data: dict[str, Any] = response.json()["data"]
    return data


async def stored(pg: PostgresServer, workspace: Workspace) -> list[dict[str, Any]]:
    """The workspace's budget rows as the table holds them, oldest first."""
    rows = await fetch(
        pg,
        "SELECT id, project_id, workload, limit_usd, soft_limit_pct, action_on_hard "
        "FROM ops.budgets WHERE workspace_id = $1 ORDER BY created_at, id",
        workspace.id,
    )
    return [dict(row) for row in rows]


async def audit(pg: PostgresServer, workspace: Workspace, action: str) -> list[dict[str, Any]]:
    """The audit entries of one action, oldest first, with `before` and `after` decoded."""
    rows = await fetch(
        pg,
        "SELECT target_id, actor_id, before, after FROM ops.audit_logs "
        "WHERE workspace_id = $1 AND action = $2 ORDER BY occurred_at, id",
        workspace.id,
        action,
    )
    return [
        {
            **dict(row),
            "before": None if row["before"] is None else json.loads(row["before"]),
            "after": None if row["after"] is None else json.loads(row["after"]),
        }
        for row in rows
    ]


async def spend_event(
    pg: PostgresServer, project: Project, amount: str, *, workload: str = "ai_prompt"
) -> None:
    """A cost event of `amount` dollars for the project, now."""
    at = datetime.now(UTC)
    await execute(
        pg,
        "INSERT INTO ops.provider_cost_events (occurred_at, workspace_id, project_id, "
        "provider_code, endpoint, workload, channel, cost_usd, cost_source, billing_period) "
        "VALUES ($1, $2, $3, 'dataforseo', 'ai_optimization/chat_gpt/llm_scraper', $4, "
        "'research', $5, 'provider_reported', $6)",
        at,
        project.workspace_id,
        project.id,
        workload,
        Decimal(amount),
        at.date().replace(day=1),
    )


async def blocked_run(pg: PostgresServer, scene: Scene, budget_id: uuid.UUID | str) -> uuid.UUID:
    """An AI run a budget blocked when it was planned."""
    rows = await fetch(
        pg,
        "INSERT INTO ops.collection_runs (workspace_id, project_id, workload, window_start, "
        "window_end, trigger, status, config_snapshot, completed_at, blocked_by_budget_id) "
        "VALUES ($1, $2, 'ai_prompt', now(), now() + interval '1 hour', 'manual', "
        "'budget_blocked', '{}', now(), $3) RETURNING id",
        scene.workspace.id,
        scene.project.id,
        uuid.UUID(str(budget_id)),
    )
    run_id: uuid.UUID = rows[0]["id"]
    return run_id


async def costed_answer(
    pg: PostgresServer,
    scene: Scene,
    prompt: Prompt,
    cost: str | None,
    *,
    engine: str = "chatgpt_web",
    status: str = "complete",
    superseded: bool = False,
) -> None:
    """A current answer of the month that cost `cost` (None: the provider reported no cost)."""
    answer_id = await add_answer(
        pg, scene, prompt, engine=engine, status=status, superseded=superseded
    )
    if cost is not None:
        await execute(
            pg,
            "UPDATE ai.observations SET cost_usd = $2 WHERE id = $1",
            answer_id,
            Decimal(cost),
        )


async def daily_cost(
    pg: PostgresServer,
    project: Project,
    workload: str,
    cost: str,
    *,
    requests: int = 1,
    endpoint: str = "serp/google/organic/task_post",
) -> None:
    """A rollup row of today for the project and workload."""
    await execute(
        pg,
        "INSERT INTO ops.cost_daily (cost_date, workspace_id, project_id, provider_code, "
        "endpoint, workload, request_count, cost_usd, subjects) "
        "VALUES (current_date, $1, $2, 'dataforseo', $3, $4, $5, $6, 1)",
        project.workspace_id,
        project.id,
        endpoint,
        workload,
        requests,
        Decimal(cost),
    )
