"""Schedules (docs/19 section 3.11.3; plan decision D10)."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import pytest

from sightline.api.resources import Resources
from tests.api.auth.support import Workspace, execute, fetch, fetchrow, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.keywords.support import (
    errors,
    group,
    keyword_project,
    project_url,
    term,
    tracked_id,
    vocabulary,
)
from tests.conftest import PostgresServer


async def _owner(resources: Resources, pg: PostgresServer) -> tuple[Workspace, uuid.UUID, Caller]:
    workspace = await make_workspace(pg)
    owner = await member(resources, pg, workspace, "owner")
    return workspace, await keyword_project(pg, workspace), owner


def _body(**changes: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "workload": "keyword_metrics",
        "name": "Metrics",
        "cadence": "daily",
        "timezone": "Europe/Berlin",
        "window_start_local": "03:30",
        "window_hours": 2,
        "provider_mode": "live",
        "selector": {"stale_days": 25},
    }
    body.update(changes)
    return body


async def _create(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: uuid.UUID,
    caller: Caller,
    body: dict[str, Any],
) -> httpx.Response:
    return await api.post(
        project_url(workspace, project, "schedules"), json=body, headers=caller.headers
    )


async def _created(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: uuid.UUID,
    caller: Caller,
    **changes: Any,
) -> dict[str, Any]:
    response = await _create(api, workspace, project, caller, _body(**changes))
    assert response.status_code == 201, response.text
    data: dict[str, Any] = response.json()["data"]
    return data


def _given(selector: dict[str, Any]) -> dict[str, Any]:
    """The selector members a schedule names (the others are null)."""
    return {name: value for name, value in selector.items() if value is not None}


def _local(instant: str, zone: str) -> datetime:
    return datetime.fromisoformat(instant).astimezone(ZoneInfo(zone))


async def _audit(pg: PostgresServer, workspace: Workspace, action: str) -> list[dict[str, Any]]:
    rows = await fetch(
        pg,
        "SELECT target_id, before, after FROM ops.audit_logs WHERE workspace_id = $1 "
        "AND action = $2 ORDER BY occurred_at",
        workspace.id,
        action,
    )
    return [dict(row) for row in rows]


async def test_a_daily_schedule_runs_next_at_its_local_time(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)

    data = await _created(api, workspace, project, owner)

    assert (data["workload"], data["cadence"], data["is_active"]) == (
        "keyword_metrics",
        "daily",
        True,
    )
    assert _given(data["selector"]) == {"stale_days": 25}
    assert data["last_run_id"] is None
    upcoming = _local(data["next_run_at"], "Europe/Berlin")
    assert (upcoming.hour, upcoming.minute) == (3, 30)
    now = datetime.now(UTC)
    assert now < upcoming <= now + timedelta(days=1)
    (entry,) = await _audit(migrated, workspace, "schedule.created")
    assert entry["target_id"] == data["schedule_id"]


async def test_weekly_and_monthly_schedules_run_on_their_day(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)

    weekly = await _created(api, workspace, project, owner, cadence="weekly", weekday=0)
    monthly = await _created(api, workspace, project, owner, cadence="monthly", month_day=20)

    # 0 is Sunday.
    assert _local(weekly["next_run_at"], "Europe/Berlin").isoweekday() == 7
    assert _local(monthly["next_run_at"], "Europe/Berlin").day == 20
    assert (weekly["weekday"], monthly["month_day"]) == (0, 20)


@pytest.mark.parametrize(
    ("changes", "path", "code"),
    [
        ({"cadence": "cron", "cron_expr": "0 3 * * *"}, "cadence", "cadence_not_supported"),
        ({"workload": "ai_prompt"}, "workload", "workload_not_available"),
        ({"timezone": "Mars/Olympus_Mons"}, "timezone", "timezone_unknown"),
        ({"provider_mode": "standard_queue"}, "provider_mode", "provider_mode_not_supported"),
        ({"selector": {"priority_lte": 2}}, "selector.priority_lte", "selector_not_supported"),
        (
            {"workload": "seo_rank", "provider_mode": "standard_queue", "selector": {}},
            "selector",
            "selector_empty",
        ),
        (
            {
                "workload": "seo_rank",
                "provider_mode": "standard_queue",
                "selector": {"all": True, "stale_days": 3},
            },
            "selector.stale_days",
            "selector_not_supported",
        ),
        ({"selector": {"all": True, "stale_days": 3}}, "selector.stale_days", "selector_conflict"),
        ({"cron_expr": "0 3 * * *"}, "cron_expr", "not_applicable"),
        ({"window_start_local": "03:30:15"}, "window_start_local", "value_error"),
        ({"window_start_local": "03:30Z"}, "window_start_local", "value_error"),
        ({"selector": {"groups": [str(uuid.uuid4())]}}, "selector.groups", "group_unknown"),
        ({"selector": {"terms": [str(uuid.uuid4())]}}, "selector.terms", "term_unknown"),
    ],
)
async def test_a_schedule_the_planner_cannot_run_is_refused(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    changes: dict[str, Any],
    path: str,
    code: str,
) -> None:
    workspace, project, owner = await _owner(resources, migrated)

    response = await _create(api, workspace, project, owner, _body(**changes))

    assert problem(response) == (422, "validation_failed")
    assert errors(response) == [(path, code)]
    assert (
        await fetch(migrated, "SELECT id FROM ops.schedules WHERE project_id = $1", project) == []
    )


async def test_a_selector_names_the_projects_groups_and_usable_terms(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    other = await keyword_project(migrated, workspace)
    services = await group(migrated, workspace, project, "Services")
    elsewhere = await group(migrated, workspace, other, "Services")
    topic = await term(migrated, workspace, await vocabulary(migrated, workspace), "crm")

    data = await _created(
        api,
        workspace,
        project,
        owner,
        workload="seo_rank",
        provider_mode="standard_queue",
        selector={"groups": [services], "terms": [topic], "priority_lte": 2},
    )
    refused = await _create(
        api, workspace, project, owner, _body(selector={"groups": [services, elsewhere]})
    )

    assert _given(data["selector"]) == {"groups": [services], "terms": [topic], "priority_lte": 2}
    assert errors(refused) == [("selector.groups", "group_unknown")]


async def test_the_list_holds_the_projects_live_schedules(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    other = await keyword_project(migrated, workspace)
    metrics = await _created(api, workspace, project, owner)
    ranks = await _created(
        api,
        workspace,
        project,
        owner,
        workload="seo_rank",
        name="Ranks",
        provider_mode="standard_queue",
        selector={"all": True},
    )
    gone = await _created(api, workspace, project, owner, name="Gone")
    await api.delete(
        project_url(workspace, project, "schedules", gone["schedule_id"]), headers=owner.headers
    )
    await _created(api, workspace, other, owner)
    url = project_url(workspace, project, "schedules")

    everything = await api.get(url, headers=owner.headers)
    only_ranks = await api.get(url, params={"filter[workload]": "seo_rank"}, headers=owner.headers)
    paused = await api.get(url, params={"filter[is_active]": "false"}, headers=owner.headers)

    assert everything.status_code == 200, everything.text
    assert [row["schedule_id"] for row in everything.json()["data"]] == [
        metrics["schedule_id"],
        ranks["schedule_id"],
    ]
    assert everything.json()["page"] == {"offset": 0, "limit": 50, "total": 2}
    assert [row["schedule_id"] for row in only_ranks.json()["data"]] == [ranks["schedule_id"]]
    assert paused.json()["data"] == []


async def test_one_schedule_and_another_projects_is_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    other = await keyword_project(migrated, workspace)
    data = await _created(api, workspace, project, owner)

    found = await api.get(
        project_url(workspace, project, "schedules", data["schedule_id"]), headers=owner.headers
    )
    elsewhere = await api.get(
        project_url(workspace, other, "schedules", data["schedule_id"]), headers=owner.headers
    )

    assert found.json()["data"] == data
    assert problem(elsewhere) == (404, "not_found")


async def _patch(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: uuid.UUID,
    caller: Caller,
    schedule_id: str,
    body: dict[str, Any],
) -> httpx.Response:
    return await api.patch(
        project_url(workspace, project, "schedules", schedule_id), json=body, headers=caller.headers
    )


async def test_a_change_recomputes_when_it_runs_next(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await _created(api, workspace, project, owner, cadence="weekly", weekday=3)

    moved = await _patch(
        api,
        workspace,
        project,
        owner,
        data["schedule_id"],
        {"cadence": "daily", "window_start_local": "22:15", "timezone": "Asia/Tokyo"},
    )

    assert moved.status_code == 200, moved.text
    changed = moved.json()["data"]
    # A daily rule names no weekday.
    assert (changed["cadence"], changed["weekday"]) == ("daily", None)
    upcoming = _local(changed["next_run_at"], "Asia/Tokyo")
    assert (upcoming.hour, upcoming.minute) == (22, 15)
    (entry,) = await _audit(migrated, workspace, "schedule.updated")
    assert json.loads(entry["before"])["cadence"] == "weekly"
    assert json.loads(entry["after"])["cadence"] == "daily"


async def test_a_change_that_leaves_the_rule_keeps_a_due_window_for_the_planner(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await _created(api, workspace, project, owner)
    # Due an hour ago; the worker has not planned it yet.
    await execute(
        migrated,
        "UPDATE ops.schedules SET next_run_at = now() - interval '1 hour' WHERE id = $1",
        uuid.UUID(data["schedule_id"]),
    )
    due = (
        await fetchrow(
            migrated,
            "SELECT next_run_at FROM ops.schedules WHERE id = $1",
            uuid.UUID(data["schedule_id"]),
        )
    )["next_run_at"]

    renamed = await _patch(
        api, workspace, project, owner, data["schedule_id"], {"name": "Monthly metrics"}
    )

    assert datetime.fromisoformat(renamed.json()["data"]["next_run_at"]) == due


async def test_a_window_moved_later_the_same_day_does_not_collect_that_day_twice(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    now = datetime.now(UTC)
    data = await _created(api, workspace, project, owner, timezone="UTC")
    # Today's window ran a minute ago.
    await execute(
        migrated,
        "INSERT INTO ops.collection_runs (workspace_id, project_id, schedule_id, workload, "
        "window_start, window_end, trigger, status, config_snapshot) VALUES ($1, $2, $3, "
        "'keyword_metrics', now() - interval '1 minute', now() + interval '1 hour', 'schedule', "
        "'running', '{}')",
        workspace.id,
        project,
        uuid.UUID(data["schedule_id"]),
    )
    later = (now + timedelta(minutes=30)).strftime("%H:%M")

    moved = await _patch(
        api, workspace, project, owner, data["schedule_id"], {"window_start_local": later}
    )

    upcoming = datetime.fromisoformat(moved.json()["data"]["next_run_at"])
    # Not today's later time: tomorrow's (a run near midnight may move it two days).
    assert upcoming.date() > (now - timedelta(minutes=1)).date()


async def test_a_change_the_rule_cannot_hold_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await _created(api, workspace, project, owner)
    schedule_id = data["schedule_id"]

    weekly = await _patch(api, workspace, project, owner, schedule_id, {"cadence": "weekly"})
    cron = await _patch(api, workspace, project, owner, schedule_id, {"cadence": "cron"})
    selector = await _patch(
        api, workspace, project, owner, schedule_id, {"selector": {"priority_lte": 1}}
    )
    zone = await _patch(api, workspace, project, owner, schedule_id, {"timezone": "Nowhere/Land"})

    assert errors(weekly) == [("weekday", "required")]
    assert errors(cron) == [("cadence", "cadence_not_supported")]
    assert errors(selector) == [("selector.priority_lte", "selector_not_supported")]
    assert errors(zone) == [("timezone", "timezone_unknown")]


async def test_a_paused_schedule_resumes_without_catching_up(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await _created(api, workspace, project, owner)
    url = project_url(workspace, project, "schedules", data["schedule_id"])

    paused = await api.post(f"{url}/pause", json={"reason": "budget"}, headers=owner.headers)
    # Paused for a while: windows passed.
    await execute(
        migrated,
        "UPDATE ops.schedules SET next_run_at = now() - interval '3 days' WHERE id = $1",
        uuid.UUID(data["schedule_id"]),
    )
    resumed = await api.post(f"{url}/resume", headers=owner.headers)

    assert paused.status_code == 200, paused.text
    assert paused.json()["data"]["is_active"] is False
    assert resumed.json()["data"]["is_active"] is True
    assert datetime.fromisoformat(resumed.json()["data"]["next_run_at"]) > datetime.now(UTC)
    (entry,) = await _audit(migrated, workspace, "schedule.paused")
    assert json.loads(entry["after"])["reason"] == "budget"
    assert len(await _audit(migrated, workspace, "schedule.resumed")) == 1


async def test_a_deleted_schedule_is_gone_and_its_runs_keep_naming_it(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await _created(api, workspace, project, owner)
    schedule_id = uuid.UUID(data["schedule_id"])
    await execute(
        migrated,
        "INSERT INTO ops.collection_runs (workspace_id, project_id, schedule_id, workload, "
        "window_start, window_end, trigger, status, config_snapshot) VALUES ($1, $2, $3, "
        "'keyword_metrics', now(), now(), 'schedule', 'completed', '{}')",
        workspace.id,
        project,
        schedule_id,
    )
    url = project_url(workspace, project, "schedules", data["schedule_id"])

    deleted = await api.delete(url, headers=owner.headers)
    again = await api.get(url, headers=owner.headers)

    assert deleted.status_code == 204
    assert problem(again) == (404, "not_found")
    row = await fetchrow(
        migrated, "SELECT deleted_at, is_active FROM ops.schedules WHERE id = $1", schedule_id
    )
    assert row["deleted_at"] is not None
    assert row["is_active"] is False
    (run,) = await fetch(
        migrated, "SELECT schedule_id FROM ops.collection_runs WHERE project_id = $1", project
    )
    assert run["schedule_id"] == schedule_id
    assert len(await _audit(migrated, workspace, "schedule.deleted")) == 1


async def test_a_schedule_tracked_keywords_name_cannot_be_deleted(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await _created(
        api,
        workspace,
        project,
        owner,
        workload="seo_rank",
        provider_mode="standard_queue",
        selector={"all": True},
    )
    await tracked_id(api, workspace, project, owner, "crm", schedule_id=data["schedule_id"])

    response = await api.delete(
        project_url(workspace, project, "schedules", data["schedule_id"]), headers=owner.headers
    )

    assert problem(response) == (409, "schedule_in_use")


async def test_a_keyword_brought_back_after_its_schedule_was_deleted_has_no_schedule(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await _created(
        api,
        workspace,
        project,
        owner,
        workload="seo_rank",
        provider_mode="standard_queue",
        selector={"all": True},
    )
    tracked = await tracked_id(
        api, workspace, project, owner, "crm", schedule_id=data["schedule_id"]
    )
    url = project_url(workspace, project, "tracked-keywords", tracked)
    await api.delete(url, headers=owner.headers)
    gone = await api.delete(
        project_url(workspace, project, "schedules", data["schedule_id"]), headers=owner.headers
    )

    back = await tracked_id(api, workspace, project, owner, "crm")
    detail = await api.get(url, headers=owner.headers)

    assert gone.status_code == 204
    assert back == tracked
    assert detail.json()["data"]["schedule"] is None


async def test_the_schedules_of_a_deleted_project_are_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await _created(api, workspace, project, owner)
    await execute(migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", project)
    url = project_url(workspace, project, "schedules", data["schedule_id"])

    found = await api.get(url, headers=owner.headers)
    resumed = await api.post(f"{url}/resume", headers=owner.headers)

    assert problem(found) == (404, "not_found")
    assert problem(resumed) == (404, "not_found")


async def test_a_viewer_reads_schedules_and_an_analyst_cannot_write_them(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await _created(api, workspace, project, owner)
    viewer = await member(resources, migrated, workspace, "viewer")
    analyst = await member(resources, migrated, workspace, "analyst")
    url = project_url(workspace, project, "schedules")

    listed = await api.get(url, headers=viewer.headers)
    created = await _create(api, workspace, project, analyst, _body())
    paused = await api.post(f"{url}/{data['schedule_id']}/pause", json={}, headers=analyst.headers)

    assert listed.status_code == 200
    assert problem(created) == (403, "forbidden")
    assert problem(paused) == (403, "forbidden")
