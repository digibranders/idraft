"""Alert rules and alerts as people use them (docs/19 section 3.11.5, version 1)."""

from __future__ import annotations

import uuid
from typing import Any

import asyncpg
import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.auth.support import Workspace, execute, fetchrow, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer


async def _setup(
    resources: Resources, migrated: PostgresServer, role: str = "editor"
) -> tuple[Workspace, uuid.UUID, Caller]:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    return workspace, project, await member(resources, migrated, workspace, role)


async def _event(
    pg: PostgresServer,
    workspace: Workspace,
    project: uuid.UUID,
    rule: str,
    *,
    key: str,
    minutes_ago: int = 0,
    kind: str = "ai_mention_lost",
) -> int:
    row = await fetchrow(
        pg,
        "INSERT INTO ops.alert_events (rule_id, workspace_id, project_id, subject_type, "
        "subject_id, subject_label, dedupe_key, event_kind, severity, evidence, occurred_at) "
        "VALUES ($1::uuid, $2, $3, 'prompt', 'p', 'A prompt', $4, $5, 'warning', '{\"a\": 1}', "
        "now() - make_interval(mins => $6)) RETURNING id",
        rule,
        workspace.id,
        project,
        f"{rule}|{key}",
        kind,
        minutes_ago,
    )
    event_id: int = row["id"]
    return event_id


async def _rule(api: httpx.AsyncClient, base: str, caller: Caller, **body: Any) -> dict[str, Any]:
    made = await api.post(
        f"{base}/alert-rules",
        json={"name": "Lost mentions", "rule_type": "ai_mention_lost", **body},
        headers=caller.headers,
    )
    assert made.status_code == 201, made.text
    data: dict[str, Any] = made.json()["data"]
    return data


async def test_the_rule_types_are_listed_with_the_schema_of_their_params(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    _, _, editor = await _setup(resources, migrated)

    response = await api.get("/api/v1/alert-rule-types", headers=editor.headers)

    assert response.status_code == 200
    types = {row["rule_type"]: row for row in response.json()["data"]}
    assert set(types) == {
        "ai_mention_gained",
        "ai_mention_lost",
        "ai_competitor_appeared",
        "rank_drop",
    }
    assert (types["rank_drop"]["channel"], types["ai_mention_lost"]["channel"]) == ("seo", "ai")
    assert types["rank_drop"]["params_schema"]["properties"]["positions"]["maximum"] == 50


async def test_a_rule_is_made_read_changed_and_deleted_with_version_1_defaults(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, editor = await _setup(resources, migrated)
    base = project_url(workspace, project)

    rule = await _rule(api, base, editor, rule_type="rank_drop")

    assert rule["params"] == {"positions": 5}
    assert (rule["channels"], rule["digest_mode"], rule["is_active"]) == (
        ["in_app"],
        "immediate",
        True,
    )
    assert rule["scope"] == {"group_ids": [], "engine_codes": []}
    url = f"{base}/alert-rules/{rule['id']}"
    assert (await api.get(url, headers=editor.headers)).json()["data"] == rule

    changed = await api.patch(
        url,
        json={"name": "Big drops", "params": {"positions": 8}, "is_active": False},
        headers=editor.headers,
    )
    assert changed.status_code == 200
    assert changed.json()["data"]["params"] == {"positions": 8}
    assert (changed.json()["data"]["name"], changed.json()["data"]["is_active"]) == (
        "Big drops",
        False,
    )

    listed = await api.get(f"{base}/alert-rules", headers=editor.headers)
    assert [row["id"] for row in listed.json()["data"]] == [rule["id"]]
    assert listed.json()["page"]["total"] == 1
    inactive = await api.get(
        f"{base}/alert-rules", params={"filter[is_active]": "true"}, headers=editor.headers
    )
    assert inactive.json()["data"] == []

    assert (await api.delete(url, headers=editor.headers)).status_code == 204
    assert (await api.get(url, headers=editor.headers)).status_code == 404


async def test_params_that_do_not_fit_the_rule_type_are_invalid_params(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, editor = await _setup(resources, migrated)
    base = project_url(workspace, project)

    for rule_type, params in [
        ("rank_drop", {"positions": 0}),
        ("rank_drop", {"positions": 51}),
        ("rank_drop", {"positions": "five"}),
        ("rank_drop", {"positions": 5.5}),
        ("rank_drop", {"places": 5}),
        ("ai_mention_lost", {"positions": 5}),
    ]:
        response = await api.post(
            f"{base}/alert-rules",
            json={"name": "x", "rule_type": rule_type, "params": params},
            headers=editor.headers,
        )
        assert problem(response) == (422, "invalid_params"), (rule_type, params)
        assert response.json()["rule_type"] == rule_type

    for params in ({"positions": 50}, {"positions": 1}):
        ok = await api.post(
            f"{base}/alert-rules",
            json={"name": "x", "rule_type": "rank_drop", "params": params},
            headers=editor.headers,
        )
        assert ok.status_code == 201


async def test_a_patch_checks_params_against_the_stored_rule_type(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, editor = await _setup(resources, migrated)
    base = project_url(workspace, project)
    rule = await _rule(api, base, editor)

    response = await api.patch(
        f"{base}/alert-rules/{rule['id']}",
        json={"params": {"positions": 5}},
        headers=editor.headers,
    )
    assert problem(response) == (422, "invalid_params")
    changed_type = await api.patch(
        f"{base}/alert-rules/{rule['id']}", json={"rule_type": "rank_drop"}, headers=editor.headers
    )
    assert changed_type.status_code == 422


async def test_a_scope_names_groups_that_exist_and_platforms_only_for_ai_rules(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, editor = await _setup(resources, migrated)
    base = project_url(workspace, project)
    group = await fetchrow(
        migrated,
        "INSERT INTO seo.keyword_groups (workspace_id, project_id, name, path) "
        "VALUES ($1, $2, 'Event', 'event') RETURNING id",
        workspace.id,
        project,
    )

    ok = await _rule(
        api, base, editor, rule_type="rank_drop", scope={"group_ids": [str(group["id"])]}
    )
    assert ok["scope"]["group_ids"] == [str(group["id"])]
    ai = await _rule(api, base, editor, scope={"engine_codes": ["chatgpt_web"]})
    assert ai["scope"]["engine_codes"] == ["chatgpt_web"]

    for body in (
        {"rule_type": "rank_drop", "scope": {"engine_codes": ["chatgpt_web"]}},
        {"rule_type": "rank_drop", "scope": {"group_ids": [str(uuid.uuid4())]}},
        {"rule_type": "ai_mention_lost", "scope": {"group_ids": [str(group["id"])]}},
        {"rule_type": "ai_mention_lost", "scope": {"groups": []}},
    ):
        response = await api.post(
            f"{base}/alert-rules", json={"name": "x", **body}, headers=editor.headers
        )
        assert response.status_code == 422, body


async def test_a_viewer_reads_but_cannot_write_and_other_projects_and_workspaces_see_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, editor = await _setup(resources, migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    base = project_url(workspace, project)
    rule = await _rule(api, base, editor)
    event = await _event(migrated, workspace, project, rule["id"], key="a")

    assert (await api.get(f"{base}/alert-rules", headers=viewer.headers)).status_code == 200
    assert (await api.get(f"{base}/alert-events", headers=viewer.headers)).status_code == 200
    assert (
        await api.post(
            f"{base}/alert-rules",
            json={"name": "x", "rule_type": "rank_drop"},
            headers=viewer.headers,
        )
    ).status_code == 403
    assert (
        await api.delete(f"{base}/alert-rules/{rule['id']}", headers=viewer.headers)
    ).status_code == 403
    assert (
        await api.post(
            f"{base}/alert-events/acknowledge", json={"ids": [str(event)]}, headers=viewer.headers
        )
    ).status_code == 403

    other_project = await keyword_project(migrated, workspace)
    elsewhere = project_url(workspace, other_project)
    assert problem(
        await api.get(f"{elsewhere}/alert-rules/{rule['id']}", headers=editor.headers)
    ) == (404, "not_found")
    assert (
        await api.delete(f"{elsewhere}/alert-rules/{rule['id']}", headers=editor.headers)
    ).status_code == 404
    assert (await api.get(f"{elsewhere}/alert-rules", headers=editor.headers)).json()["data"] == []
    done = await api.post(
        f"{elsewhere}/alert-events/acknowledge", json={"ids": [str(event)]}, headers=editor.headers
    )
    assert done.json()["data"] == {"acknowledged": 0}

    stranger_workspace, stranger_project, stranger = await _setup(resources, migrated, "owner")
    assert (
        await api.get(
            f"{project_url(stranger_workspace, stranger_project)}/alert-rules/{rule['id']}",
            headers=stranger.headers,
        )
    ).status_code == 404


async def test_alerts_come_newest_first_in_pages_and_filter_by_rule_and_acknowledgement(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, editor = await _setup(resources, migrated)
    base = project_url(workspace, project)
    first = await _rule(api, base, editor)
    second = await _rule(api, base, editor, name="Second")
    ids = [
        await _event(migrated, workspace, project, first["id"], key="1", minutes_ago=30),
        await _event(migrated, workspace, project, first["id"], key="2", minutes_ago=20),
        await _event(migrated, workspace, project, second["id"], key="3", minutes_ago=10),
    ]

    page_one = await api.get(f"{base}/alert-events", params={"limit": 2}, headers=editor.headers)
    body = page_one.json()
    assert [row["id"] for row in body["data"]] == [str(ids[2]), str(ids[1])]
    assert body["page"]["has_more"] is True
    page_two = await api.get(
        f"{base}/alert-events",
        params={"limit": 2, "cursor": body["page"]["next_cursor"]},
        headers=editor.headers,
    )
    assert [row["id"] for row in page_two.json()["data"]] == [str(ids[0])]
    assert page_two.json()["page"] == {"limit": 2, "next_cursor": None, "has_more": False}

    by_rule = await api.get(
        f"{base}/alert-events", params={"filter[rule_id]": first["id"]}, headers=editor.headers
    )
    assert [row["id"] for row in by_rule.json()["data"]] == [str(ids[1]), str(ids[0])]
    shape = by_rule.json()["data"][0]
    assert set(shape) == {
        "id",
        "rule_id",
        "subject_type",
        "subject_id",
        "subject_label",
        "event_kind",
        "severity",
        "evidence",
        "occurred_at",
        "acknowledged_by",
        "acknowledged_at",
    }

    # A cursor made under other filters is refused.
    refused = await api.get(
        f"{base}/alert-events",
        params={"filter[rule_id]": second["id"], "cursor": body["page"]["next_cursor"]},
        headers=editor.headers,
    )
    assert problem(refused) == (400, "invalid_cursor")


async def test_acknowledging_marks_open_alerts_once_and_counts_only_those(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, editor = await _setup(resources, migrated)
    base = project_url(workspace, project)
    rule = await _rule(api, base, editor)
    one = await _event(migrated, workspace, project, rule["id"], key="1", minutes_ago=2)
    two = await _event(migrated, workspace, project, rule["id"], key="2", minutes_ago=1)

    done = await api.post(
        f"{base}/alert-events/acknowledge",
        json={"ids": [str(one), "9223372036854775000", str(one)]},
        headers=editor.headers,
    )
    again = await api.post(
        f"{base}/alert-events/acknowledge", json={"ids": [str(one)]}, headers=editor.headers
    )

    assert done.json()["data"] == {"acknowledged": 1}
    assert again.json()["data"] == {"acknowledged": 0}
    open_ones = await api.get(
        f"{base}/alert-events", params={"filter[acknowledged]": "false"}, headers=editor.headers
    )
    assert [row["id"] for row in open_ones.json()["data"]] == [str(two)]
    seen = await api.get(
        f"{base}/alert-events", params={"filter[acknowledged]": "true"}, headers=editor.headers
    )
    [row] = seen.json()["data"]
    assert row["id"] == str(one)
    assert row["acknowledged_by"] == str(editor.user_id)
    assert row["acknowledged_at"] is not None


async def test_acknowledge_takes_one_to_500_numeric_ids_only(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, editor = await _setup(resources, migrated)
    base = project_url(workspace, project)

    for ids in ([], [str(n) for n in range(501)], ["abc"], ["99999999999999999999"], [1.5]):
        response = await api.post(
            f"{base}/alert-events/acknowledge", json={"ids": ids}, headers=editor.headers
        )
        assert response.status_code == 422, ids
    ok = await api.post(
        f"{base}/alert-events/acknowledge",
        json={"ids": [str(n) for n in range(500)]},
        headers=editor.headers,
    )
    assert ok.status_code == 200


async def test_deleting_a_rule_deletes_its_alerts_and_the_database_keeps_version_1_values(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, editor = await _setup(resources, migrated)
    base = project_url(workspace, project)
    rule = await _rule(api, base, editor)
    await _event(migrated, workspace, project, rule["id"], key="1")

    await api.delete(f"{base}/alert-rules/{rule['id']}", headers=editor.headers)

    left = await fetchrow(
        migrated, "SELECT count(*) AS n FROM ops.alert_events WHERE project_id = $1", project
    )
    assert left["n"] == 0
    for column, value in (("channels", "'{email}'"), ("digest_mode", "'daily_digest'")):
        with pytest.raises(asyncpg.CheckViolationError):
            await execute(
                migrated,
                "INSERT INTO ops.alert_rules (workspace_id, project_id, name, rule_type, "
                f"{column}) VALUES ($1, $2, 'x', 'rank_drop', {value})",
                workspace.id,
                project,
            )
