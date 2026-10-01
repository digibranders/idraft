"""Refreshing keyword metrics now: a manual run the worker plans (docs/19 section 3.6.1, plan
decision D9)."""

from __future__ import annotations

import json
import uuid
from typing import Any

import httpx

from sightline.api.operations.runs import MANUAL_RUNS_PER_DAY
from sightline.api.resources import Resources
from tests.api.auth.support import Workspace, execute, fetch, fetchrow, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.keywords.support import errors, keyword_project, project_url, tracked_id
from tests.conftest import PostgresServer


async def _owner(resources: Resources, pg: PostgresServer) -> tuple[Workspace, uuid.UUID, Caller]:
    workspace = await make_workspace(pg)
    owner = await member(resources, pg, workspace, "owner")
    return workspace, await keyword_project(pg, workspace), owner


async def _refresh(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: uuid.UUID,
    caller: Caller,
    body: dict[str, Any],
) -> httpx.Response:
    return await api.post(
        project_url(workspace, project, "keyword-metrics", "refresh"),
        json=body,
        headers=caller.headers,
    )


async def _keyword_id(pg: PostgresServer, tracked: str) -> str:
    row = await fetchrow(
        pg, "SELECT keyword_id FROM seo.tracked_keywords WHERE id = $1", uuid.UUID(tracked)
    )
    return str(row["keyword_id"])


async def _runs(pg: PostgresServer, project: uuid.UUID) -> list[dict[str, Any]]:
    rows = await fetch(
        pg,
        "SELECT * FROM ops.collection_runs WHERE project_id = $1 ORDER BY created_at",
        project,
    )
    return [dict(row) for row in rows]


async def test_a_refresh_records_a_planned_run_for_the_worker(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    crm = await _keyword_id(migrated, await tracked_id(api, workspace, project, owner, "crm"))
    # The same keyword at a second location is one keyword to ask about.
    await tracked_id(api, workspace, project, owner, "crm", location_id=2826)

    response = await _refresh(
        api, workspace, project, owner, {"keyword_ids": [crm, crm], "stale_days": 0}
    )

    assert response.status_code == 202, response.text
    data = response.json()["data"]
    assert (data["workload"], data["trigger"], data["status"]) == (
        "keyword_metrics",
        "manual",
        "planned",
    )
    assert data["operation"]["status"] == "queued"
    assert data["operation"]["progress"] == {"done": 0, "total": None, "unit": "tasks"}
    assert data["operation"]["links"]["cancel"].endswith(f"/runs/{data['run_id']}/cancel")
    assert data["created_by"]["actor_id"] == str(owner.user_id)
    (run,) = await _runs(migrated, project)
    # The API writes no tasks: the worker's planner plans the run.
    assert json.loads(run["config_snapshot"]) == {
        "selector": {"keyword_ids": [crm], "stale_days": 0}
    }
    assert run["origin_request_id"] == response.headers["x-request-id"]
    (entry,) = await fetch(
        migrated,
        "SELECT action, target_id FROM ops.audit_logs WHERE workspace_id = $1 "
        "AND action = 'collection_run.requested'",
        workspace.id,
    )
    assert entry["target_id"] == data["run_id"]


async def test_without_keywords_the_stale_ones_are_refreshed(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)

    response = await _refresh(api, workspace, project, owner, {})

    assert response.status_code == 202, response.text
    (run,) = await _runs(migrated, project)
    assert json.loads(run["config_snapshot"]) == {"selector": {}}


async def test_a_keyword_the_project_does_not_track_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    other = await keyword_project(migrated, workspace)
    elsewhere = await _keyword_id(migrated, await tracked_id(api, workspace, other, owner, "crm"))
    deleted = await tracked_id(api, workspace, project, owner, "erp")
    await execute(
        migrated,
        "UPDATE seo.tracked_keywords SET deleted_at = now() WHERE id = $1",
        uuid.UUID(deleted),
    )
    # An archived keyword is not collected, so a run for it would do nothing.
    archived = await tracked_id(api, workspace, project, owner, "hr")
    await execute(
        migrated,
        "UPDATE seo.tracked_keywords SET is_active = false WHERE id = $1",
        uuid.UUID(archived),
    )

    for keyword_id in (
        elsewhere,
        await _keyword_id(migrated, deleted),
        await _keyword_id(migrated, archived),
        str(uuid.uuid4()),
    ):
        response = await _refresh(api, workspace, project, owner, {"keyword_ids": [keyword_id]})
        assert problem(response) == (422, "validation_failed")
        assert errors(response) == [("keyword_ids", "keyword_unknown")]
    assert await _runs(migrated, project) == []


async def test_people_have_twenty_manual_runs_a_day_and_the_systems_do_not_count(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    await execute(
        migrated,
        "INSERT INTO ops.collection_runs (workspace_id, project_id, workload, window_start, "
        "window_end, trigger, status, created_by_type, created_at, config_snapshot) "
        "SELECT $1, $2, 'keyword_metrics', now(), now() + interval '1 hour', 'manual', "
        "'completed', kind, now() - interval '1 minute', '{}' "
        "FROM unnest($3::text[]) AS kind",
        workspace.id,
        project,
        ["user"] * (MANUAL_RUNS_PER_DAY - 1) + ["system"] * 5,
    )
    # Yesterday's runs (UTC) do not count either.
    await execute(
        migrated,
        "INSERT INTO ops.collection_runs (workspace_id, project_id, workload, window_start, "
        "window_end, trigger, status, created_by_type, created_at, config_snapshot) "
        "VALUES ($1, $2, 'keyword_metrics', now(), now(), 'manual', 'completed', 'user', "
        "date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - interval '1 second', "
        "'{}')",
        workspace.id,
        project,
    )

    last = await _refresh(api, workspace, project, owner, {})
    over = await _refresh(api, workspace, project, owner, {})

    assert last.status_code == 202, last.text
    assert problem(over) == (429, "manual_run_limit")
    assert over.json()["limit"] == MANUAL_RUNS_PER_DAY


async def test_a_viewer_cannot_ask_for_a_run(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, _owner_caller = await _owner(resources, migrated)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await _refresh(api, workspace, project, viewer, {})

    assert problem(response) == (403, "forbidden")
    assert await _runs(migrated, project) == []


async def test_a_project_of_another_workspace_is_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, _project, owner = await _owner(resources, migrated)
    elsewhere = await keyword_project(migrated, await make_workspace(migrated))

    response = await _refresh(api, workspace, elsewhere, owner, {})

    assert problem(response)[0] == 404
