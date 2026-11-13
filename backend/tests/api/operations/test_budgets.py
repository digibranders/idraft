"""Budgets: create, list, change and delete (WP-30 T2; docs/19 section 3.11.2, plan decision D9).
A budget is a limit that is stored and judged later; nothing here starts a run or spends."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal

import httpx

from idraft.api.resources import Resources
from idraft.collectors import budget
from idraft.db.engine import workspace_transaction
from idraft.domain.workloads import TaskWorkload
from tests.api.auth.support import Workspace, execute, fetch, make_workspace
from tests.api.entities.support import member, problem
from tests.api.keywords.support import errors, keyword_project
from tests.api.operations.collection_support import make_scene
from tests.api.operations.cost_support import (
    audit,
    blocked_run,
    created,
    post_budget,
    spend_event,
    stored,
    url,
)
from tests.conftest import PostgresServer

INVALID = (422, "validation_failed")
DUPLICATE = (409, "duplicate")


async def _workspace(
    resources: Resources, pg: PostgresServer, *roles: str
) -> tuple[Workspace, uuid.UUID, dict[str, dict[str, str]]]:
    """A workspace with a project and a member of each role (their request headers)."""
    workspace = await make_workspace(pg)
    callers = {role: (await member(resources, pg, workspace, role)).headers for role in roles}
    return workspace, await keyword_project(pg, workspace), callers


async def test_a_budget_manager_creates_lists_changes_and_deletes_a_budget(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, who = await _workspace(resources, migrated, "billing")
    headers = who["billing"]

    made = await post_budget(
        api, workspace, headers, project_id=str(project), limit_usd="250.00", soft_limit_pct=90
    )
    data = made.json()["data"]
    listed = await api.get(url(workspace, "budgets"), headers=headers)
    changed = await api.patch(
        url(workspace, "budgets", data["budget_id"]),
        json={"limit_usd": "300.00", "action_on_hard": "alert_only"},
        headers=headers,
    )
    gone = await api.delete(url(workspace, "budgets", data["budget_id"]), headers=headers)
    after = await api.get(url(workspace, "budgets"), headers=headers)

    assert made.status_code == 201
    assert (data["project_id"], data["workload"], data["period"]) == (
        str(project),
        "ai_prompt",
        "month",
    )
    assert (data["limit_usd"], data["soft_limit_pct"], data["action_on_hard"]) == (
        "250.00",
        90,
        "pause",
    )
    assert listed.json()["data"] == [data]
    assert listed.json()["page"] == {"offset": 0, "limit": 50, "total": 1}
    assert changed.status_code == 200
    # The limit and the action change; the soft share, the scope and the group do not.
    assert changed.json()["data"] == {
        **data,
        "limit_usd": "300.00",
        "action_on_hard": "alert_only",
    }
    assert gone.status_code == 204
    assert gone.content == b""
    assert after.json()["data"] == []
    assert await stored(migrated, workspace) == []


async def test_budgets_are_listed_oldest_first_in_pages(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, who = await _workspace(resources, migrated, "owner")
    headers = who["owner"]
    first = await created(api, workspace, headers, workload="seo_rank")
    second = await created(api, workspace, headers, workload="ai_prompt", project_id=str(project))
    third = await created(api, workspace, headers, workload="all")

    page = await api.get(url(workspace, "budgets"), params={"limit": 2}, headers=headers)
    rest = await api.get(
        url(workspace, "budgets"), params={"offset": 2, "limit": 2}, headers=headers
    )
    beyond = await api.get(url(workspace, "budgets"), params={"offset": 9}, headers=headers)
    one = await api.get(
        url(workspace, "budgets"), params={"filter[project_id]": str(project)}, headers=headers
    )

    assert [row["budget_id"] for row in page.json()["data"]] == [
        first["budget_id"],
        second["budget_id"],
    ]
    assert page.json()["page"] == {"offset": 0, "limit": 2, "total": 3}
    assert [row["budget_id"] for row in rest.json()["data"]] == [third["budget_id"]]
    assert beyond.json()["data"] == []
    # The total survives a page past the end.
    assert beyond.json()["page"]["total"] == 3
    assert [row["budget_id"] for row in one.json()["data"]] == [second["budget_id"]]


async def test_group_all_is_stored_as_null_and_read_as_all(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, _, who = await _workspace(resources, migrated, "owner")

    data = await created(api, workspace, who["owner"], workload="all")
    listed = await api.get(url(workspace, "budgets"), headers=who["owner"])

    assert (data["workload"], data["project_id"]) == ("all", None)
    assert listed.json()["data"][0]["workload"] == "all"
    (row,) = await stored(migrated, workspace)
    assert (row["workload"], row["project_id"]) == (None, None)


async def test_the_defaults_are_80_percent_and_pause(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, _, who = await _workspace(resources, migrated, "admin")

    data = await created(api, workspace, who["admin"])

    assert (data["soft_limit_pct"], data["action_on_hard"]) == (80, "pause")
    (row,) = await stored(migrated, workspace)
    assert (row["soft_limit_pct"], row["action_on_hard"]) == (80, "pause")


async def test_only_budget_managers_write(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    roles = ("owner", "admin", "billing", "editor", "analyst", "viewer")
    workspace, _, who = await _workspace(resources, migrated, *roles)
    existing = await created(api, workspace, who["owner"], workload="seo_rank", limit_usd="10.00")
    before = await stored(migrated, workspace)

    for role in ("editor", "analyst", "viewer"):
        headers = who[role]
        posted = await post_budget(api, workspace, headers, workload="first_party")
        patched = await api.patch(
            url(workspace, "budgets", existing["budget_id"]),
            json={"limit_usd": "99999.00"},
            headers=headers,
        )
        deleted = await api.delete(
            url(workspace, "budgets", existing["budget_id"]), headers=headers
        )
        assert [problem(posted), problem(patched), problem(deleted)] == [(403, "forbidden")] * 3, (
            role
        )

    # A refused write leaves the budget as it was, and writes no audit entry.
    assert await stored(migrated, workspace) == before
    assert [
        len(await audit(migrated, workspace, name)) for name in ("budget.updated", "budget.deleted")
    ] == [0, 0]

    for role, group in (
        ("owner", "ai_prompt"),
        ("admin", "keyword_research"),
        ("billing", "ai_benchmark"),
    ):
        headers = who[role]
        made = await post_budget(api, workspace, headers, workload=group)
        budget_id = made.json()["data"]["budget_id"]
        patched = await api.patch(
            url(workspace, "budgets", budget_id), json={"limit_usd": "5.00"}, headers=headers
        )
        deleted = await api.delete(url(workspace, "budgets", budget_id), headers=headers)
        assert (made.status_code, patched.status_code, deleted.status_code) == (201, 200, 204), role
    assert await stored(migrated, workspace) == before


async def test_costs_read_lists_budgets_and_a_viewer_cannot(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, _, who = await _workspace(
        resources, migrated, "owner", "analyst", "editor", "viewer"
    )
    data = await created(api, workspace, who["owner"])

    for role in ("analyst", "editor", "owner"):
        listed = await api.get(url(workspace, "budgets"), headers=who[role])
        assert [row["budget_id"] for row in listed.json()["data"]] == [data["budget_id"]], role
    refused = await api.get(url(workspace, "budgets"), headers=who["viewer"])

    assert problem(refused) == (403, "forbidden")


async def test_a_second_budget_for_the_same_scope_and_group_is_a_duplicate(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, who = await _workspace(resources, migrated, "owner")
    headers = who["owner"]
    await created(api, workspace, headers, project_id=str(project), workload="ai_prompt")
    await created(api, workspace, headers, workload="ai_prompt")
    await created(api, workspace, headers, workload="all")

    same_project = await post_budget(api, workspace, headers, project_id=str(project))
    # The workspace has no project in the key: two nulls are the same scope.
    same_workspace = await post_budget(api, workspace, headers)
    same_everything = await post_budget(api, workspace, headers, workload="all")
    other_group = await post_budget(
        api, workspace, headers, project_id=str(project), workload="seo_rank"
    )

    assert problem(same_project) == problem(same_workspace) == problem(same_everything) == DUPLICATE
    assert other_group.status_code == 201
    assert len(await stored(migrated, workspace)) == 4


async def test_the_same_group_in_two_projects_is_allowed(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, first, who = await _workspace(resources, migrated, "owner")
    second = await keyword_project(migrated, workspace)

    one = await post_budget(api, workspace, who["owner"], project_id=str(first))
    two = await post_budget(api, workspace, who["owner"], project_id=str(second))

    assert (one.status_code, two.status_code) == (201, 201)


async def test_a_limit_below_zero_or_over_the_column_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, _, who = await _workspace(resources, migrated, "owner")
    headers = who["owner"]
    for limit in ("-0.01", "100000000000.00", "1.234", "abc"):
        response = await post_budget(api, workspace, headers, limit_usd=limit)
        assert problem(response) == INVALID, limit
    assert await stored(migrated, workspace) == []

    # The edges are limits too: 0 blocks every run, and the column holds the top.
    zero = await post_budget(api, workspace, headers, workload="seo_rank", limit_usd="0.00")
    top = await post_budget(
        api, workspace, headers, workload="ai_prompt", limit_usd="99999999999.99"
    )

    assert (zero.status_code, top.status_code) == (201, 201)
    assert [row["limit_usd"] for row in await stored(migrated, workspace)] == [
        Decimal("0.00"),
        Decimal("99999999999.99"),
    ]
    patched = await api.patch(
        url(workspace, "budgets", zero.json()["data"]["budget_id"]),
        json={"limit_usd": "-1.00"},
        headers=headers,
    )
    assert problem(patched) == INVALID


async def test_a_soft_limit_outside_1_to_100_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, _, who = await _workspace(resources, migrated, "owner")
    headers = who["owner"]
    for share in (0, 101, -5):
        response = await post_budget(api, workspace, headers, soft_limit_pct=share)
        assert problem(response) == INVALID, share
    assert await stored(migrated, workspace) == []

    low = await post_budget(api, workspace, headers, workload="seo_rank", soft_limit_pct=1)
    high = await post_budget(api, workspace, headers, workload="ai_prompt", soft_limit_pct=100)

    assert (low.status_code, high.status_code) == (201, 201)


async def test_an_empty_patch_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, _, who = await _workspace(resources, migrated, "owner")
    data = await created(api, workspace, who["owner"])
    before = await stored(migrated, workspace)

    empty = await api.patch(
        url(workspace, "budgets", data["budget_id"]), json={}, headers=who["owner"]
    )
    moved = await api.patch(
        url(workspace, "budgets", data["budget_id"]),
        json={"workload": "seo_rank"},
        headers=who["owner"],
    )

    assert problem(empty) == problem(moved) == INVALID
    assert await stored(migrated, workspace) == before


async def test_a_project_of_another_workspace_is_project_unknown(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, _, who = await _workspace(resources, migrated, "owner")
    foreign = await keyword_project(migrated, await make_workspace(migrated))
    deleted = await keyword_project(migrated, workspace)
    await execute(migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", deleted)

    for project in (foreign, deleted, uuid.uuid4()):
        response = await post_budget(api, workspace, who["owner"], project_id=str(project))
        assert problem(response) == INVALID, project
        assert errors(response) == [("project_id", "project_unknown")], project
    assert await stored(migrated, workspace) == []


async def test_each_write_is_audited_with_before_and_after(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, who = await _workspace(resources, migrated, "billing")
    headers = who["billing"]
    data = await created(
        api, workspace, headers, project_id=str(project), limit_usd="250.00", soft_limit_pct=90
    )
    await api.patch(
        url(workspace, "budgets", data["budget_id"]), json={"limit_usd": "300.00"}, headers=headers
    )
    await api.delete(url(workspace, "budgets", data["budget_id"]), headers=headers)

    (made,) = await audit(migrated, workspace, "budget.created")
    (changed,) = await audit(migrated, workspace, "budget.updated")
    (removed,) = await audit(migrated, workspace, "budget.deleted")

    assert {made["target_id"], changed["target_id"], removed["target_id"]} == {data["budget_id"]}
    assert made["before"] is None
    assert made["after"] == {
        "project_id": str(project),
        "workload": "ai_prompt",
        "limit_usd": "250.00",
        "soft_limit_pct": 90,
        "action_on_hard": "pause",
    }
    assert changed["before"]["limit_usd"] == "250.00"
    assert changed["after"]["limit_usd"] == "300.00"
    assert changed["after"]["soft_limit_pct"] == 90
    assert removed["before"]["limit_usd"] == "300.00"
    assert removed["after"] is None


async def test_a_new_budget_shows_in_status_and_blocks_planning_at_its_limit(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await make_scene(resources, migrated, role="billing")
    data = await created(
        api,
        scene.workspace,
        scene.caller.headers,
        project_id=str(scene.project.id),
        workload="ai_prompt",
        limit_usd="10.00",
    )

    async def verdict() -> budget.BudgetVerdict:
        # What the planner asks for one answer's estimate; nothing is sent to a provider.
        async with workspace_transaction(resources.sessions, scene.workspace.id) as db:
            return await budget.check(
                db,
                workspace_id=scene.workspace.id,
                project_id=scene.project.id,
                workload=TaskWorkload.AI_PROMPT,
                now=datetime.now(UTC),
                estimate=Decimal("0.0012"),
            )

    open_before = await verdict()
    await spend_event(migrated, scene.project, "10")
    status = await api.get(url(scene.workspace, "budgets/status"), headers=scene.caller.headers)
    blocked = await verdict()

    assert open_before.allowed
    (line,) = status.json()["data"]
    assert (line["budget"]["budget_id"], line["state"], line["spent_usd"]) == (
        data["budget_id"],
        "hard_exceeded",
        "10.000000",
    )
    assert str(blocked.blocked_by) == data["budget_id"]


async def test_deleting_a_budget_keeps_the_runs_it_blocked(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await make_scene(resources, migrated, role="owner")
    data = await created(
        api,
        scene.workspace,
        scene.caller.headers,
        project_id=str(scene.project.id),
        limit_usd="0.00",
    )
    run_id = await blocked_run(migrated, scene, data["budget_id"])

    gone = await api.delete(
        url(scene.workspace, "budgets", data["budget_id"]), headers=scene.caller.headers
    )

    assert gone.status_code == 204
    (run,) = await fetch(
        migrated,
        "SELECT status, blocked_by_budget_id FROM ops.collection_runs WHERE id = $1",
        run_id,
    )
    assert (run["status"], run["blocked_by_budget_id"]) == ("budget_blocked", None)
