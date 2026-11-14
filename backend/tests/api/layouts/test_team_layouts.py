"""PUT and DELETE {W}/layouts/{screen}/default: the team default, `layouts:manage`, If-Match, the
lock and the audit entries with the documents before and after (WP-11 T4; BE-LAYOUTS-04).

The team default is the row of the screen whose owner is null. Personal rows are never touched by
these routes (owner decision D-09)."""

from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any

import httpx
import pytest

from idraft.api.layouts import repository
from idraft.api.resources import Resources
from tests.api.auth.support import execute, fetch, fetchrow, make_workspace
from tests.api.entities.support import member, problem
from tests.api.layouts.support import (
    DOCUMENT,
    FORBIDDEN,
    INVALID,
    NOT_FOUND,
    OTHER,
    STALE,
    insert_layout,
    layout_url,
)
from tests.api.layouts.test_personal_layouts import (
    OLD_ETAG,
    STORED,
    personal_url,
    rows,
    screen_lock_held,
    wait_until_queued,
)
from tests.conftest import PostgresServer

AGENT = "layouts-audit-test/1.0"
# The address httpx's ASGI transport gives every request.
TEST_CLIENT_IP = "127.0.0.1"


def team_url(workspace_id: object, screen: str = "overview") -> str:
    return layout_url(workspace_id, "layouts", screen, "default")


def read_url(workspace_id: object, screen: str = "overview") -> str:
    return layout_url(workspace_id, "layouts", screen)


async def team_rows(pg: PostgresServer, workspace_id: uuid.UUID) -> list[Any]:
    return [row for row in await rows(pg, workspace_id) if row["owner_user_id"] is None]


async def team_id(pg: PostgresServer, workspace_id: uuid.UUID) -> str:
    row = await fetchrow(
        pg,
        "SELECT id FROM core.layouts WHERE workspace_id = $1 AND owner_user_id IS NULL",
        workspace_id,
    )
    return str(row["id"])


async def audit_rows(pg: PostgresServer, workspace_id: uuid.UUID) -> list[Any]:
    return await fetch(
        pg,
        "SELECT action, actor_id, target_type, target_id, before, after, ip, user_agent, "
        "request_id FROM ops.audit_logs "
        "WHERE workspace_id = $1 AND action LIKE 'layout.%' ORDER BY id",
        workspace_id,
    )


def stored(value: str | None) -> Any:
    return None if value is None else json.loads(value)


def assert_request_context(entry: Any, response: httpx.Response) -> None:
    """The entry names the request it came from: the client address and user agent the server
    saw, and the id the API answered with."""
    assert str(entry["ip"]) == TEST_CLIENT_IP
    assert entry["user_agent"] == AGENT
    assert response.headers["x-request-id"].startswith("req_")
    assert entry["request_id"] == response.headers["x-request-id"]


@pytest.mark.parametrize("role", ["viewer", "billing", "analyst", "editor"])
async def test_the_team_default_needs_layouts_manage(
    role: str, api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    caller = await member(resources, migrated, workspace, role)
    await insert_layout(migrated, workspace.id, None, "overview", DOCUMENT, admin.user_id)
    before = await team_rows(migrated, workspace.id)

    put = await api.put(team_url(workspace.id), json=OTHER, headers=caller.headers)
    delete = await api.delete(team_url(workspace.id), headers=caller.headers)

    assert [problem(put), problem(delete)] == [FORBIDDEN, FORBIDDEN]
    after = await team_rows(migrated, workspace.id)
    assert [(row["document"], row["updated_at"]) for row in after] == [
        (row["document"], row["updated_at"]) for row in before
    ]
    assert await audit_rows(migrated, workspace.id) == []


@pytest.mark.parametrize("role", ["viewer", "billing", "analyst", "editor"])
async def test_the_role_is_checked_before_the_body(
    role: str, api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    caller = await member(resources, migrated, workspace, role)

    response = await api.put(team_url(workspace.id), json={"schema": 2}, headers=caller.headers)

    assert problem(response) == FORBIDDEN


async def test_an_admin_is_told_about_a_body_out_of_bounds(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")

    response = await api.put(team_url(workspace.id), json={"schema": 2}, headers=admin.headers)

    assert problem(response) == INVALID
    assert await rows(migrated, workspace.id) == []


@pytest.mark.parametrize("role", ["owner", "admin"])
async def test_owner_and_admin_set_the_team_default(
    role: str, api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    caller = await member(resources, migrated, workspace, role)

    response = await api.put(team_url(workspace.id), json=DOCUMENT, headers=caller.headers)

    data = response.json()["data"]
    assert response.status_code == 200
    assert data["source"] == "team"
    assert data["team_default_exists"] is True
    assert data["updated_by"]["user_id"] == str(caller.user_id)
    found = await rows(migrated, workspace.id)
    assert len(found) == 1
    assert found[0]["owner_user_id"] is None
    assert found[0]["updated_by"] == caller.user_id
    assert json.loads(found[0]["document"]) == STORED


async def test_setting_the_team_default_is_audited_with_before_and_after(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    headers = {**admin.headers, "User-Agent": AGENT}

    saved = await api.put(team_url(workspace.id), json=DOCUMENT, headers=headers)
    read = await api.get(read_url(workspace.id), headers=headers)
    changed = await api.put(
        team_url(workspace.id), json=OTHER, headers={**headers, "If-Match": read.headers["etag"]}
    )

    layout_id = await team_id(migrated, workspace.id)
    first, second = await audit_rows(migrated, workspace.id)
    for entry, response in ((first, saved), (second, changed)):
        assert entry["action"] == "layout.default.set"
        assert entry["actor_id"] == str(admin.user_id)
        assert entry["target_type"] == "layout"
        assert entry["target_id"] == layout_id
        assert_request_context(entry, response)
    assert first["request_id"] != second["request_id"]
    assert stored(first["before"]) is None
    assert stored(first["after"]) == {"screen": "overview", "document": STORED}
    assert stored(second["before"]) == {"screen": "overview", "document": STORED}
    assert stored(second["after"]) == {"screen": "overview", "document": OTHER}


async def test_the_same_document_again_writes_no_audit_entry(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    first = await api.put(team_url(workspace.id), json=DOCUMENT, headers=admin.headers)
    before = (await team_rows(migrated, workspace.id))[0]

    again = await api.put(
        team_url(workspace.id),
        json=DOCUMENT,
        headers={**admin.headers, "If-Match": first.headers["etag"]},
    )

    assert again.status_code == 200
    assert again.headers["etag"] == first.headers["etag"]
    assert len(await audit_rows(migrated, workspace.id)) == 1
    after = (await team_rows(migrated, workspace.id))[0]
    assert after["updated_at"] == before["updated_at"]


async def test_removing_the_team_default_is_audited(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    headers = {**admin.headers, "User-Agent": AGENT}
    await api.put(team_url(workspace.id), json=DOCUMENT, headers=headers)
    layout_id = await team_id(migrated, workspace.id)

    first = await api.delete(team_url(workspace.id), headers=headers)
    second = await api.delete(team_url(workspace.id), headers=headers)

    assert (first.status_code, second.status_code) == (204, 204)
    assert await team_rows(migrated, workspace.id) == []
    entries = await audit_rows(migrated, workspace.id)
    assert [row["action"] for row in entries] == ["layout.default.set", "layout.default.remove"]
    entry = entries[1]
    assert entry["actor_id"] == str(admin.user_id)
    assert entry["target_type"] == "layout"
    assert entry["target_id"] == layout_id
    assert_request_context(entry, first)
    assert stored(entry["before"]) == {"screen": "overview", "document": STORED}
    assert stored(entry["after"]) is None


async def test_removing_nothing_writes_no_audit_entry(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    await api.put(personal_url(workspace.id), json=DOCUMENT, headers=admin.headers)

    response = await api.delete(team_url(workspace.id), headers=admin.headers)

    assert response.status_code == 204
    assert await audit_rows(migrated, workspace.id) == []
    assert len(await rows(migrated, workspace.id)) == 1


async def test_a_stale_if_match_on_the_team_default_is_412(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    await api.put(team_url(workspace.id), json=DOCUMENT, headers=admin.headers)

    response = await api.put(
        team_url(workspace.id), json=OTHER, headers={**admin.headers, "If-Match": OLD_ETAG}
    )

    assert problem(response) == STALE
    assert json.loads((await team_rows(migrated, workspace.id))[0]["document"]) == STORED
    assert len(await audit_rows(migrated, workspace.id)) == 1


async def test_saving_over_the_team_default_without_if_match_is_412(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    await api.put(team_url(workspace.id), json=DOCUMENT, headers=admin.headers)

    response = await api.put(team_url(workspace.id), json=OTHER, headers=admin.headers)

    assert problem(response) == STALE
    assert json.loads((await team_rows(migrated, workspace.id))[0]["document"]) == STORED
    assert len(await audit_rows(migrated, workspace.id)) == 1


async def test_a_personal_change_meanwhile_makes_the_etag_stale_for_the_team_save(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The ETag covers the caller's personal row too (plan decision L6)."""
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    read = await api.get(read_url(workspace.id), headers=admin.headers)
    await api.put(personal_url(workspace.id), json=DOCUMENT, headers=admin.headers)

    response = await api.put(
        team_url(workspace.id),
        json=OTHER,
        headers={**admin.headers, "If-Match": read.headers["etag"]},
    )

    assert problem(response) == STALE
    assert await team_rows(migrated, workspace.id) == []
    assert await audit_rows(migrated, workspace.id) == []


@pytest.mark.parametrize("if_match", [None, OLD_ETAG])
async def test_an_invalid_team_document_is_422_before_the_precondition(
    if_match: str | None,
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    await insert_layout(
        migrated, workspace.id, None, "inspector.keyword", {"schema": 1}, admin.user_id
    )
    headers = admin.headers if if_match is None else {**admin.headers, "If-Match": if_match}

    response = await api.put(
        team_url(workspace.id, "inspector.keyword"),
        json={"schema": 1, "cards": [{"id": "c1", "type": "ai.by_engine"}]},
        headers=headers,
    )

    assert problem(response) == INVALID
    assert [(item["path"], item["code"]) for item in response.json()["errors"]] == [
        ("cards.0.type", "not_in_catalog")
    ]
    assert await audit_rows(migrated, workspace.id) == []


async def test_a_second_admin_replacing_the_team_default_is_the_editor_of_record(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    first = await member(resources, migrated, workspace, "admin")
    second = await member(resources, migrated, workspace, "admin")
    saved = await api.put(team_url(workspace.id), json=DOCUMENT, headers=first.headers)

    response = await api.put(
        team_url(workspace.id),
        json=OTHER,
        headers={**second.headers, "If-Match": saved.headers["etag"]},
    )

    assert response.status_code == 200
    assert response.json()["data"]["updated_by"]["user_id"] == str(second.user_id)
    found = await rows(migrated, workspace.id)
    assert [(row["owner_user_id"], row["updated_by"]) for row in found] == [(None, second.user_id)]
    entries = await audit_rows(migrated, workspace.id)
    assert [row["actor_id"] for row in entries] == [str(first.user_id), str(second.user_id)]
    assert stored(entries[1]["before"]) == {"screen": "overview", "document": STORED}
    assert stored(entries[1]["after"]) == {"screen": "overview", "document": OTHER}


async def test_the_team_default_leaves_personal_layouts_alone(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    viewer = await member(resources, migrated, workspace, "viewer")
    await insert_layout(
        migrated, workspace.id, viewer.user_id, "overview", DOCUMENT, viewer.user_id
    )
    await insert_layout(migrated, workspace.id, admin.user_id, "overview", DOCUMENT, admin.user_id)
    before = await rows(migrated, workspace.id)

    saved = await api.put(team_url(workspace.id), json=OTHER, headers=admin.headers)
    etag = saved.headers["etag"]
    changed = await api.put(
        team_url(workspace.id), json=DOCUMENT, headers={**admin.headers, "If-Match": etag}
    )
    removed = await api.delete(team_url(workspace.id), headers=admin.headers)

    assert [saved.status_code, changed.status_code, removed.status_code] == [200, 200, 204]
    after = await rows(migrated, workspace.id)
    assert [
        (row["owner_user_id"], row["document"], row["updated_by"], row["updated_at"])
        for row in after
    ] == [
        (row["owner_user_id"], row["document"], row["updated_by"], row["updated_at"])
        for row in before
    ]


async def test_members_see_the_new_team_default(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    viewer = await member(resources, migrated, workspace, "viewer")
    await api.put(team_url(workspace.id), json=DOCUMENT, headers=admin.headers)

    read = await api.get(read_url(workspace.id), headers=viewer.headers)

    data = read.json()["data"]
    assert data["source"] == "team"
    assert data["updated_by"]["user_id"] == str(admin.user_id)


async def test_the_put_answers_the_layout_as_it_now_resolves(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    await insert_layout(migrated, workspace.id, admin.user_id, "overview", DOCUMENT, admin.user_id)
    before = await rows(migrated, workspace.id)

    response = await api.put(team_url(workspace.id), json=OTHER, headers=admin.headers)

    data = response.json()["data"]
    assert response.status_code == 200
    assert data["source"] == "personal"
    assert data["team_default_exists"] is True
    after = await rows(migrated, workspace.id)
    assert [row["owner_user_id"] for row in after] == [admin.user_id, None]
    assert after[0]["document"] == before[0]["document"]
    assert json.loads(after[1]["document"]) == OTHER


async def test_an_unknown_screen_is_404_on_the_team_routes(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    url = team_url(workspace.id, "dashboard")

    put = await api.put(url, json=DOCUMENT, headers=admin.headers)
    delete = await api.delete(url, headers=admin.headers)

    assert [problem(put), problem(delete)] == [NOT_FOUND, NOT_FOUND]
    assert await audit_rows(migrated, workspace.id) == []


@pytest.mark.parametrize("method", ["PUT", "DELETE"])
async def test_a_team_write_in_a_suspended_workspace_is_403(
    method: str, api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    await insert_layout(migrated, workspace.id, None, "overview", DOCUMENT, admin.user_id)
    await execute(
        migrated, "UPDATE auth.workspaces SET status = 'suspended' WHERE id = $1", workspace.id
    )

    response = await api.request(
        method,
        team_url(workspace.id),
        json=OTHER if method == "PUT" else None,
        headers=admin.headers,
    )

    assert problem(response) == (403, "workspace_suspended")
    assert len(await team_rows(migrated, workspace.id)) == 1
    assert await audit_rows(migrated, workspace.id) == []


async def test_a_failing_team_save_leaves_no_audit_entry_and_no_row(
    monkeypatch: pytest.MonkeyPatch,
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    """The entry is written in the transaction of the change: when the request fails after the
    entry is written, the change and the entry both go."""
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    fail_after_audit(monkeypatch)

    response = await api.put(team_url(workspace.id), json=DOCUMENT, headers=admin.headers)

    assert response.status_code == 500
    assert await rows(migrated, workspace.id) == []
    assert await audit_rows(migrated, workspace.id) == []


async def test_a_failing_team_remove_leaves_the_row_and_no_audit_entry(
    monkeypatch: pytest.MonkeyPatch,
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    await insert_layout(migrated, workspace.id, None, "overview", DOCUMENT, admin.user_id)
    fail_after_audit(monkeypatch)

    response = await api.delete(team_url(workspace.id), headers=admin.headers)

    assert response.status_code == 500
    assert len(await team_rows(migrated, workspace.id)) == 1
    assert await audit_rows(migrated, workspace.id) == []


def fail_after_audit(monkeypatch: pytest.MonkeyPatch) -> None:
    original = repository.record_team_change

    async def record_then_fail(*args: Any, **kwargs: Any) -> None:
        await original(*args, **kwargs)
        raise RuntimeError("the request fails after its audit entry")

    monkeypatch.setattr(repository, "record_team_change", record_then_fail)


async def test_two_team_saves_with_the_same_etag_at_the_same_moment_one_wins(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    other_admin = await member(resources, migrated, workspace, "admin")
    third = {"schema": 1, "cards": [{"id": "c1", "type": "seo.top_movers"}]}
    saved = await api.put(team_url(workspace.id), json=DOCUMENT, headers=admin.headers)
    etag = {"If-Match": saved.headers["etag"]}

    async with screen_lock_held(migrated, workspace.id, "overview"):
        one = asyncio.create_task(
            api.put(team_url(workspace.id), json=OTHER, headers={**admin.headers, **etag})
        )
        two = asyncio.create_task(
            api.put(team_url(workspace.id), json=third, headers={**other_admin.headers, **etag})
        )
        await wait_until_queued(migrated, workspace.id, 2)
    responses = await asyncio.gather(one, two)

    assert sorted(response.status_code for response in responses) == [200, 412]
    winner = OTHER if responses[0].status_code == 200 else third
    assert json.loads((await team_rows(migrated, workspace.id))[0]["document"]) == winner
    entries = await audit_rows(migrated, workspace.id)
    assert len(entries) == 2
    assert stored(entries[1]["before"]) == {"screen": "overview", "document": STORED}
    assert stored(entries[1]["after"]) == {"screen": "overview", "document": winner}


async def test_a_team_delete_and_a_team_save_at_the_same_moment_agree_with_the_audit(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    saved = await api.put(team_url(workspace.id), json=DOCUMENT, headers=admin.headers)
    headers = {**admin.headers, "If-Match": saved.headers["etag"]}

    async with screen_lock_held(migrated, workspace.id, "overview"):
        save = asyncio.create_task(api.put(team_url(workspace.id), json=OTHER, headers=headers))
        delete = asyncio.create_task(api.delete(team_url(workspace.id), headers=admin.headers))
        await wait_until_queued(migrated, workspace.id, 2)
    saved_again, deleted = await asyncio.gather(save, delete)

    assert deleted.status_code == 204
    assert saved_again.status_code in (200, 412)
    assert await team_rows(migrated, workspace.id) == []
    actions = [row["action"] for row in await audit_rows(migrated, workspace.id)]
    expected = ["layout.default.set", "layout.default.remove"]
    if saved_again.status_code == 200:
        expected.insert(1, "layout.default.set")
    assert actions == expected
