"""Checking keywords now: a manual rank run the worker plans and asks the provider for live
(docs/19 section 3.6.4, rank collection plan Task 9)."""

from __future__ import annotations

import json
import uuid
from typing import Any

import httpx

from sightline.api.operations.runs import MANUAL_RUNS_PER_DAY
from sightline.api.resources import Resources
from sightline.providers.dataforseo.provider import CODE as DATAFORSEO
from tests.api.auth.support import Workspace, execute, fetch, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.keywords.support import errors, keyword_project, project_url, tracked_id
from tests.conftest import PostgresServer

LIVE = "serp/google/organic/live"
ASYNC = "serp/google/organic"


async def _owner(resources: Resources, pg: PostgresServer) -> tuple[Workspace, uuid.UUID, Caller]:
    workspace = await make_workspace(pg)
    owner = await member(resources, pg, workspace, "owner")
    return workspace, await keyword_project(pg, workspace), owner


async def _check(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: uuid.UUID,
    caller: Caller,
    body: dict[str, Any],
) -> httpx.Response:
    return await api.post(
        project_url(workspace, project, "seo", "check-now"), json=body, headers=caller.headers
    )


async def _runs(pg: PostgresServer, project: uuid.UUID) -> list[dict[str, Any]]:
    rows = await fetch(
        pg, "SELECT * FROM ops.collection_runs WHERE project_id = $1 ORDER BY created_at", project
    )
    return [dict(row) for row in rows]


async def _limit(pg: PostgresServer, workspace: Workspace, checks: int) -> None:
    await execute(
        pg,
        "INSERT INTO core.workspace_quotas (workspace_id, max_serp_checks_per_month) "
        "VALUES ($1, $2) ON CONFLICT (workspace_id) DO UPDATE "
        "SET max_serp_checks_per_month = EXCLUDED.max_serp_checks_per_month",
        workspace.id,
        checks,
    )


async def _tasks(
    pg: PostgresServer,
    workspace: Workspace,
    project: uuid.UUID,
    *,
    endpoint: str,
    statuses: tuple[str, ...],
) -> None:
    """A finished seo_rank run with a task in each of `statuses`."""
    run = await fetch(
        pg,
        "INSERT INTO ops.collection_runs (workspace_id, project_id, workload, window_start, "
        "window_end, trigger, status, created_by_type, config_snapshot) VALUES "
        "($1, $2, 'seo_rank', now(), now(), 'manual', 'completed', 'user', '{}') RETURNING id",
        workspace.id,
        project,
    )
    for status in statuses:
        await execute(
            pg,
            "INSERT INTO ops.collection_tasks (run_id, workspace_id, project_id, workload, "
            "subject_type, subject_id, location_id, idempotency_key, request_fingerprint, "
            "provider_code, provider_endpoint, scheduled_for, status) VALUES ($1, $2, $3, "
            "'seo_rank', 'tracked_keyword', $4, 2840, $5, $5, 'dataforseo', $6, now(), $7)",
            run[0]["id"],
            workspace.id,
            project,
            f"{uuid.uuid4()}:10",
            uuid.uuid4().bytes,
            endpoint,
            status,
        )


async def test_a_check_records_a_planned_live_run_for_the_worker(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    crm = await tracked_id(api, workspace, project, owner, "crm")
    erp = await tracked_id(api, workspace, project, owner, "erp")

    response = await _check(
        api, workspace, project, owner, {"tracked_keyword_ids": [erp, crm, crm], "depth": 50}
    )

    assert response.status_code == 202, response.text
    data = response.json()["data"]
    assert (data["workload"], data["trigger"], data["status"]) == ("seo_rank", "manual", "planned")
    assert data["created_by"]["actor_id"] == str(owner.user_id)
    (run,) = await _runs(migrated, project)
    # The API writes no tasks: the worker's planner plans the run, live.
    assert json.loads(run["config_snapshot"]) == {
        "selector": {"tracked_keyword_ids": sorted([crm, erp]), "live": True, "depth": 50}
    }
    assert run["origin_request_id"] == response.headers["x-request-id"]
    (entry,) = await fetch(
        migrated,
        "SELECT action, target_id, after FROM ops.audit_logs WHERE workspace_id = $1 "
        "AND action = 'collection_run.requested'",
        workspace.id,
    )
    assert entry["target_id"] == data["run_id"]
    assert json.loads(entry["after"])["keyword_count"] == 2


async def test_without_a_depth_each_keyword_is_checked_at_its_daily_depth(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    crm = await tracked_id(api, workspace, project, owner, "crm")

    response = await _check(api, workspace, project, owner, {"tracked_keyword_ids": [crm]})

    assert response.status_code == 202, response.text
    (run,) = await _runs(migrated, project)
    assert json.loads(run["config_snapshot"]) == {
        "selector": {"tracked_keyword_ids": [crm], "live": True}
    }


async def test_a_keyword_the_project_does_not_collect_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    other = await keyword_project(migrated, workspace)
    elsewhere = await tracked_id(api, workspace, other, owner, "crm")
    deleted = await tracked_id(api, workspace, project, owner, "erp")
    await execute(
        migrated,
        "UPDATE seo.tracked_keywords SET deleted_at = now() WHERE id = $1",
        uuid.UUID(deleted),
    )
    archived = await tracked_id(api, workspace, project, owner, "hr")
    await execute(
        migrated,
        "UPDATE seo.tracked_keywords SET is_active = false WHERE id = $1",
        uuid.UUID(archived),
    )
    fine = await tracked_id(api, workspace, project, owner, "payroll")

    for refused in (elsewhere, deleted, archived, str(uuid.uuid4())):
        # One keyword the project does not collect fails the whole request.
        response = await _check(
            api, workspace, project, owner, {"tracked_keyword_ids": [fine, refused]}
        )
        assert problem(response) == (422, "validation_failed")
        assert errors(response) == [("tracked_keyword_ids", "keyword_unknown")]
    assert await _runs(migrated, project) == []


async def test_the_body_is_bounded(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    crm = await tracked_id(api, workspace, project, owner, "crm")

    bodies: list[dict[str, Any]] = [
        {"tracked_keyword_ids": []},
        {"tracked_keyword_ids": [str(uuid.uuid4()) for _ in range(101)]},
        {"tracked_keyword_ids": [crm], "depth": 30},
        {"tracked_keyword_ids": [crm], "extra": 1},
        {},
    ]
    for body in bodies:
        response = await _check(api, workspace, project, owner, body)
        assert problem(response) == (422, "validation_failed"), body
    assert await _runs(migrated, project) == []


async def test_a_check_counts_as_one_of_the_days_manual_runs(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    crm = await tracked_id(api, workspace, project, owner, "crm")
    await execute(
        migrated,
        "INSERT INTO ops.collection_runs (workspace_id, project_id, workload, window_start, "
        "window_end, trigger, status, created_by_type, created_at, config_snapshot) "
        "SELECT $1, $2, 'keyword_metrics', now(), now() + interval '1 hour', 'manual', "
        "'completed', 'user', now() - interval '1 minute', '{}' FROM generate_series(1, $3)",
        workspace.id,
        project,
        MANUAL_RUNS_PER_DAY - 1,
    )

    last = await _check(api, workspace, project, owner, {"tracked_keyword_ids": [crm]})
    over = await _check(api, workspace, project, owner, {"tracked_keyword_ids": [crm]})

    assert last.status_code == 202, last.text
    assert problem(over) == (429, "manual_run_limit")
    assert over.json()["limit"] == MANUAL_RUNS_PER_DAY


async def test_the_months_live_checks_are_limited_by_the_workspace_quota(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    crm = await tracked_id(api, workspace, project, owner, "crm")
    erp = await tracked_id(api, workspace, project, owner, "erp")
    await _limit(migrated, workspace, 4)
    # Two live checks made this month count; a cancelled one never reached the provider, and a
    # scheduled check is not a live one.
    await _tasks(migrated, workspace, project, endpoint=LIVE, statuses=("ingested", "failed"))
    await _tasks(migrated, workspace, project, endpoint=LIVE, statuses=("cancelled",))
    await _tasks(migrated, workspace, project, endpoint=ASYNC, statuses=("ingested",) * 5)

    fits = await _check(api, workspace, project, owner, {"tracked_keyword_ids": [crm, erp]})
    # The run above is not planned yet; its two keywords count while it waits.
    over = await _check(api, workspace, project, owner, {"tracked_keyword_ids": [crm]})

    assert fits.status_code == 202, fits.text
    assert problem(over) == (422, "quota_exceeded")
    body = over.json()
    assert (body["limit"], body["used"], body["requested"]) == (4, 4, 1)
    assert body["quota"] == "max_serp_checks_per_month"
    assert [run["status"] for run in await _runs(migrated, project)].count("planned") == 1


async def test_a_workspace_without_a_quota_row_has_the_default_limit(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    crm = await tracked_id(api, workspace, project, owner, "crm")

    response = await _check(api, workspace, project, owner, {"tracked_keyword_ids": [crm]})

    assert response.status_code == 202, response.text
    (row,) = await fetch(
        migrated,
        "SELECT max_serp_checks_per_month FROM core.workspace_quotas WHERE workspace_id = $1",
        workspace.id,
    )
    assert row["max_serp_checks_per_month"] == 200000


async def test_a_paused_provider_is_not_asked_for_a_check(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    crm = await tracked_id(api, workspace, project, owner, "crm")
    await resources.redis.set(f"rl:paused:{DATAFORSEO}", "no_balance", px=60_000)

    paused = await _check(api, workspace, project, owner, {"tracked_keyword_ids": [crm]})

    assert problem(paused) == (503, "provider_paused")
    assert paused.headers["retry-after"].isdigit()
    assert await _runs(migrated, project) == []
    await resources.redis.delete(f"rl:paused:{DATAFORSEO}")
    resumed = await _check(api, workspace, project, owner, {"tracked_keyword_ids": [crm]})
    assert resumed.status_code == 202, resumed.text


async def test_a_viewer_cannot_check_keywords(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    crm = await tracked_id(api, workspace, project, owner, "crm")
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await _check(api, workspace, project, viewer, {"tracked_keyword_ids": [crm]})

    assert problem(response) == (403, "forbidden")
    assert await _runs(migrated, project) == []


async def test_a_project_of_another_workspace_is_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, _project, owner = await _owner(resources, migrated)
    elsewhere = await keyword_project(migrated, await make_workspace(migrated))

    response = await _check(
        api, workspace, elsewhere, owner, {"tracked_keyword_ids": [str(uuid.uuid4())]}
    )

    assert problem(response)[0] == 404
