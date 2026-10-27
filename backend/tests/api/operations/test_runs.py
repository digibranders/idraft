"""Collection runs: the list, one run with its task counts, and cancelling (docs/19 section
3.11.4)."""

from __future__ import annotations

import json
import uuid
from typing import Any

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import Workspace, execute, fetch, fetchrow, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer


async def _owner(resources: Resources, pg: PostgresServer) -> tuple[Workspace, uuid.UUID, Caller]:
    workspace = await make_workspace(pg)
    owner = await member(resources, pg, workspace, "owner")
    return workspace, await keyword_project(pg, workspace), owner


async def _schedule(pg: PostgresServer, workspace: Workspace, project: uuid.UUID) -> uuid.UUID:
    row = await fetchrow(
        pg,
        "INSERT INTO ops.schedules (workspace_id, project_id, workload, name, cadence, timezone, "
        "next_run_at, provider_mode) VALUES ($1, $2, 'keyword_metrics', 'Metrics', 'daily', "
        "'UTC', now() + interval '1 day', 'live') RETURNING id",
        workspace.id,
        project,
    )
    schedule_id: uuid.UUID = row["id"]
    return schedule_id


async def _run(
    pg: PostgresServer,
    workspace: Workspace,
    project: uuid.UUID,
    *,
    status: str = "running",
    trigger: str = "schedule",
    schedule_id: uuid.UUID | None = None,
    created_by: Caller | None = None,
    age_minutes: int = 0,
    tasks: tuple[str, ...] = (),
) -> str:
    """A run created `age_minutes` ago, with a task in each of `tasks`' statuses. A scheduled
    run names a schedule."""
    if trigger == "schedule" and schedule_id is None:
        schedule_id = await _schedule(pg, workspace, project)
    row = await fetchrow(
        pg,
        "INSERT INTO ops.collection_runs (workspace_id, project_id, schedule_id, workload, "
        "window_start, window_end, trigger, status, created_by_type, created_by_id, "
        "config_snapshot, tasks_total, created_at) VALUES ($1, $2, $3, 'keyword_metrics', now(), "
        "now() + interval '1 hour', $4, $5, $6, $7, $8::jsonb, $9, "
        "now() - make_interval(mins => $10)) RETURNING id",
        workspace.id,
        project,
        schedule_id,
        trigger,
        status,
        None if created_by is None else "user",
        None if created_by is None else str(created_by.user_id),
        json.dumps({"selector": {"stale_days": 25}}),
        len(tasks),
        age_minutes,
    )
    for task_status in tasks:
        await execute(
            pg,
            "INSERT INTO ops.collection_tasks (run_id, workspace_id, project_id, workload, "
            "subject_type, subject_id, location_id, idempotency_key, request_fingerprint, "
            "provider_code, provider_endpoint, scheduled_for, status) VALUES ($1, $2, $3, "
            "'keyword_metrics', 'keyword', $4, 2840, $5, $5, 'dataforseo', "
            "'dataforseo_labs/google/keyword_overview', now(), $6)",
            row["id"],
            workspace.id,
            project,
            f"{uuid.uuid4()}:en",
            uuid.uuid4().bytes,
            task_status,
        )
    return str(row["id"])


def _ids(response: httpx.Response) -> list[str]:
    assert response.status_code == 200, response.text
    return [row["run_id"] for row in response.json()["data"]]


async def test_the_list_is_newest_first_in_pages(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    other = await keyword_project(migrated, workspace)
    oldest = await _run(migrated, workspace, project, age_minutes=30, status="completed")
    middle = await _run(migrated, workspace, project, age_minutes=20)
    newest = await _run(migrated, workspace, project, age_minutes=10)
    await _run(migrated, workspace, other)
    url = project_url(workspace, project, "runs")

    first = await api.get(url, params={"limit": 2}, headers=owner.headers)
    cursor = first.json()["page"]["next_cursor"]
    second = await api.get(url, params={"limit": 2, "cursor": cursor}, headers=owner.headers)

    assert _ids(first) == [newest, middle]
    assert first.json()["page"]["has_more"] is True
    assert _ids(second) == [oldest]
    assert second.json()["page"] == {"limit": 2, "next_cursor": None, "has_more": False}


async def test_runs_made_at_the_same_moment_are_paged_by_id(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    made = [await _run(migrated, workspace, project, age_minutes=5) for _ in range(3)]
    await execute(
        migrated,
        "UPDATE ops.collection_runs SET created_at = date_trunc('second', now()) "
        "WHERE project_id = $1",
        project,
    )
    url = project_url(workspace, project, "runs")

    seen: list[str] = []
    cursor = None
    for _ in range(4):
        params: dict[str, Any] = {"limit": 1} if cursor is None else {"limit": 1, "cursor": cursor}
        response = await api.get(url, params=params, headers=owner.headers)
        seen += _ids(response)
        cursor = response.json()["page"]["next_cursor"]
        if cursor is None:
            break

    # Each once, newest id first.
    assert seen == sorted(made, reverse=True)


async def test_the_runs_of_a_deleted_project_are_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    run_id = await _run(migrated, workspace, project)
    await execute(migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", project)

    found = await api.get(project_url(workspace, project, "runs", run_id), headers=owner.headers)
    cancelled = await _cancel(api, workspace, project, owner, run_id)

    assert problem(found) == (404, "not_found")
    assert problem(cancelled) == (404, "not_found")


async def test_the_list_filters_by_schedule_status_workload_and_trigger(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    schedule = await _schedule(migrated, workspace, project)
    scheduled = await _run(migrated, workspace, project, schedule_id=schedule, age_minutes=5)
    manual = await _run(migrated, workspace, project, trigger="manual", status="completed")
    url = project_url(workspace, project, "runs")

    async def listed(params: dict[str, str]) -> list[str]:
        return _ids(await api.get(url, params=params, headers=owner.headers))

    assert await listed({"filter[schedule_id]": str(schedule)}) == [scheduled]
    assert await listed({"filter[status_in]": "completed,failed"}) == [manual]
    assert await listed({"filter[trigger_in]": "schedule"}) == [scheduled]
    assert await listed({"filter[workload_in]": "seo_rank"}) == []
    bad = await api.get(url, params={"filter[status_in]": "lost"}, headers=owner.headers)
    assert problem(bad) == (422, "validation_failed")


async def test_one_run_counts_its_tasks_by_status(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    other = await keyword_project(migrated, workspace)
    run_id = await _run(
        migrated, workspace, project, tasks=("pending", "pending", "fetched", "ingested")
    )

    found = await api.get(project_url(workspace, project, "runs", run_id), headers=owner.headers)
    elsewhere = await api.get(project_url(workspace, other, "runs", run_id), headers=owner.headers)

    assert found.status_code == 200, found.text
    data = found.json()["data"]
    assert data["tasks_by_status"] == {"pending": 2, "fetched": 1, "ingested": 1}
    assert data["config_snapshot"] == {"selector": {"stale_days": 25}}
    assert data["operation"]["status"] == "running"
    assert problem(elsewhere) == (404, "not_found")


async def _cancel(
    api: httpx.AsyncClient, workspace: Workspace, project: uuid.UUID, caller: Caller, run_id: str
) -> httpx.Response:
    return await api.post(
        project_url(workspace, project, "runs", run_id, "cancel"),
        json={"reason": "wrong keywords"},
        headers=caller.headers,
    )


async def test_cancelling_a_run_ends_it_once(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    run_id = await _run(migrated, workspace, project, tasks=("pending", "submitted"))

    response = await _cancel(api, workspace, project, owner, run_id)
    again = await _cancel(api, workspace, project, owner, run_id)

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert (data["status"], data["status_reason"]) == ("cancelled", "cancelled_by_user")
    assert data["operation"]["links"]["cancel"] is None
    assert problem(again) == (409, "invalid_state_transition")
    entries = await fetch(
        migrated,
        "SELECT target_id, after FROM ops.audit_logs WHERE workspace_id = $1 "
        "AND action = 'collection_run.cancelled'",
        workspace.id,
    )
    assert [str(entry["target_id"]) for entry in entries] == [run_id]
    assert json.loads(entries[0]["after"])["reason"] == "wrong keywords"


async def test_an_analyst_cancels_only_the_manual_runs_they_asked_for(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    analyst = await member(resources, migrated, workspace, "analyst")
    viewer = await member(resources, migrated, workspace, "viewer")
    theirs = await _run(migrated, workspace, project, trigger="manual", created_by=analyst)
    someone_elses = await _run(migrated, workspace, project, trigger="manual", created_by=owner)
    scheduled = await _run(migrated, workspace, project)

    assert (await _cancel(api, workspace, project, analyst, theirs)).status_code == 200
    assert problem(await _cancel(api, workspace, project, analyst, someone_elses)) == (
        403,
        "forbidden",
    )
    assert problem(await _cancel(api, workspace, project, analyst, scheduled)) == (
        403,
        "forbidden",
    )
    assert problem(await _cancel(api, workspace, project, viewer, scheduled)) == (
        403,
        "forbidden",
    )
    statuses: dict[str, Any] = {
        str(row["id"]): row["status"]
        for row in await fetch(
            migrated, "SELECT id, status FROM ops.collection_runs WHERE project_id = $1", project
        )
    }
    assert statuses == {theirs: "cancelled", someone_elses: "running", scheduled: "running"}
