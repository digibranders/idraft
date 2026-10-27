"""Project routes (docs/19 section 3.3)."""

import asyncio
import uuid

import asyncpg
import httpx
import pytest

from idraft.api.resources import Resources
from idraft.db import engine
from tests.api.auth.support import (
    User,
    Workspace,
    add_member,
    cookie,
    execute,
    fetch,
    fetchrow,
    make_user,
    make_workspace,
    open_session,
)
from tests.api.conftest import AppFactory
from tests.api.workspaces.support import make_project
from tests.conftest import PostgresServer


def _projects(workspace: Workspace) -> str:
    return f"/api/v1/workspaces/{workspace.id}/projects"


def _problem(response: httpx.Response) -> tuple[int, str]:
    return response.status_code, response.json()["code"]


def _slug() -> str:
    return f"site-{uuid.uuid4().hex[:10]}"


async def _member(
    resources: Resources,
    pg: PostgresServer,
    workspace: Workspace,
    role: str,
    *,
    project_ids: list[uuid.UUID] | None = None,
) -> tuple[User, dict[str, str]]:
    user = await make_user(pg)
    await add_member(pg, workspace, user, role, project_ids)
    token, _ = await open_session(resources, user)
    return user, cookie(token)


async def _audit(
    pg: PostgresServer, workspace: Workspace
) -> list[tuple[str, str | None, str | None]]:
    rows = await fetch(
        pg,
        "SELECT action, before::text, after::text FROM ops.audit_logs "
        "WHERE workspace_id = $1 ORDER BY id",
        workspace.id,
    )
    return [(row["action"], row["before"], row["after"]) for row in rows]


# -------------------------------------------------------------------------------------------------
# Create


async def test_an_editor_creates_a_project(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    await execute(
        migrated, "UPDATE auth.workspaces SET timezone = 'Asia/Kolkata' WHERE id = $1", workspace.id
    )
    editor, headers = await _member(resources, migrated, workspace, "editor")
    slug = _slug()

    response = await api.post(
        _projects(workspace), json={"name": "  fynix.digital ", "slug": slug}, headers=headers
    )

    assert response.status_code == 201
    data = response.json()["data"]
    assert data == {
        "project_id": data["project_id"],
        "workspace_id": str(workspace.id),
        "name": "fynix.digital",
        "slug": slug,
        "primary_domain": None,
        "default_location_id": None,
        "default_location": None,
        "default_language_code": None,
        # The workspace's zone, when none is given.
        "timezone": "Asia/Kolkata",
        "deep_check_weekday": 1,
        "status": "active",
        "data_version": 0,
        "entity_config_version": 1,
        "created_by": {"user_id": str(editor.id), "name": editor.name, "email": editor.email},
        "created_at": data["created_at"],
        "updated_at": data["updated_at"],
    }
    assert (await api.get(f"{_projects(workspace)}/{data['project_id']}", headers=headers)).json()[
        "data"
    ] == data
    ((action, before, after),) = await _audit(migrated, workspace)
    assert (action, before) == ("project.created", None)
    assert after is not None
    assert f'"slug": "{slug}"' in after
    assert '"timezone": "Asia/Kolkata"' in after


async def test_a_project_takes_its_own_zone_weekday_and_language(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    _, headers = await _member(resources, migrated, workspace, "owner")

    response = await api.post(
        _projects(workspace),
        json={
            "name": "Site",
            "slug": _slug(),
            # What a browser in India reports.
            "timezone": "Asia/Calcutta",
            "deep_check_weekday": 0,
            "default_language_code": "en",
        },
        headers=headers,
    )

    data = response.json()["data"]
    assert (data["timezone"], data["deep_check_weekday"], data["default_language_code"]) == (
        "Asia/Kolkata",
        0,
        "en",
    )


async def test_creating_needs_the_permission_and_every_project(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, other = await make_workspace(migrated), await make_workspace(migrated)
    existing = await make_project(migrated, workspace.id)
    _, analyst = await _member(resources, migrated, workspace, "analyst")
    _, limited = await _member(resources, migrated, workspace, "editor", project_ids=[existing])
    _, stranger = await _member(resources, migrated, other, "owner")
    body = {"name": "Site", "slug": _slug()}

    assert _problem(await api.post(_projects(workspace), json=body, headers=analyst)) == (
        403,
        "forbidden",
    )
    # They could not see what they had just made. Said before the body is looked at.
    assert _problem(await api.post(_projects(workspace), json=body, headers=limited)) == (
        403,
        "forbidden",
    )
    assert _problem(await api.post(_projects(workspace), json={"name": ""}, headers=limited)) == (
        403,
        "forbidden",
    )
    assert _problem(await api.post(_projects(workspace), json=body, headers=stranger)) == (
        404,
        "not_found",
    )
    rows = await fetch(migrated, "SELECT 1 FROM core.projects WHERE slug = $1", body["slug"])
    assert rows == []


async def test_a_slug_is_unique_in_its_workspace_only(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, other = await make_workspace(migrated), await make_workspace(migrated)
    _, headers = await _member(resources, migrated, workspace, "owner")
    _, other_headers = await _member(resources, migrated, other, "owner")
    slug = _slug()
    first = await api.post(
        _projects(workspace), json={"name": "One", "slug": slug}, headers=headers
    )

    again = await api.post(
        _projects(workspace), json={"name": "Two", "slug": slug}, headers=headers
    )
    elsewhere = await api.post(
        _projects(other), json={"name": "Three", "slug": slug}, headers=other_headers
    )

    assert first.status_code == 201
    assert _problem(again) == (409, "duplicate")
    assert elsewhere.status_code == 201
    assert [action for action, _, _ in await _audit(migrated, workspace)] == ["project.created"]


async def test_the_project_limit_holds_when_projects_are_created_at_once(
    client_for: AppFactory, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    await make_project(migrated, workspace.id)
    gone = await make_project(migrated, workspace.id)
    # A deleted project does not count.
    await execute(migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", gone)
    await execute(
        migrated,
        "INSERT INTO core.workspace_quotas (workspace_id, max_projects) VALUES ($1, 3)",
        workspace.id,
    )
    async with client_for(db_pool_size=6) as api:
        resources = api._transport.app.state.resources  # type: ignore[attr-defined]
        _, headers = await _member(resources, migrated, workspace, "owner")
        responses = await asyncio.gather(
            *(
                api.post(
                    _projects(workspace), json={"name": "Site", "slug": _slug()}, headers=headers
                )
                for _ in range(5)
            )
        )

    assert sorted(response.status_code for response in responses) == [201, 201, 422, 422, 422]
    refused = next(response for response in responses if response.status_code == 422)
    assert refused.json()["code"] == "quota_exceeded"
    assert (refused.json()["limit"], refused.json()["used"], refused.json()["requested"]) == (
        3,
        3,
        1,
    )
    live = await fetch(
        migrated,
        "SELECT 1 FROM core.projects WHERE workspace_id = $1 AND deleted_at IS NULL",
        workspace.id,
    )
    assert len(live) == 3


async def test_a_workspace_without_a_quota_row_gets_the_default_limit(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    _, headers = await _member(resources, migrated, workspace, "owner")

    response = await api.post(
        _projects(workspace), json={"name": "Site", "slug": _slug()}, headers=headers
    )

    assert response.status_code == 201
    row = await fetchrow(
        migrated,
        "SELECT max_projects FROM core.workspace_quotas WHERE workspace_id = $1",
        workspace.id,
    )
    assert row["max_projects"] == 10


@pytest.mark.parametrize(
    "changes",
    [
        {"slug": "settings"},
        {"slug": "projects"},
        {"slug": "Ab"},
        {"slug": "0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11"},
        {"name": ""},
        {"timezone": "localtime"},
        {"deep_check_weekday": 7},
        {"deep_check_weekday": -1},
        {"deep_check_weekday": "3"},
        {"deep_check_weekday": True},
        {"default_language_code": "eng"},
        {"default_language_code": "EN"},
        {"primary_domain": "not a host"},
        {"default_location_id": 0},
        {"default_location_id": "2356"},
        # Taken by a later phase, not accepted yet.
        {"settings": {}},
        {"status": "paused"},
    ],
)
async def test_a_malformed_project_is_refused(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    changes: dict[str, object],
) -> None:
    workspace = await make_workspace(migrated)
    _, headers = await _member(resources, migrated, workspace, "owner")
    body = {"name": "Site", "slug": _slug(), **changes}
    response = await api.post(_projects(workspace), json=body, headers=headers)
    assert _problem(response) == (422, "validation_failed")
    assert [error["path"] for error in response.json()["errors"]] == list(changes)


async def test_an_unknown_time_zone_is_refused_on_its_field(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    _, headers = await _member(resources, migrated, workspace, "owner")
    response = await api.post(
        _projects(workspace),
        json={"name": "Site", "slug": _slug(), "timezone": "Mars/Olympus"},
        headers=headers,
    )
    assert [(error["path"], error["code"]) for error in response.json()["errors"]] == [
        ("timezone", "timezone_unknown")
    ]


# -------------------------------------------------------------------------------------------------
# List and read


async def test_the_list_shows_live_projects_the_member_can_see(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, other = await make_workspace(migrated), await make_workspace(migrated)
    zebra = await make_project(migrated, workspace.id, name="zebra")
    alpha = await make_project(migrated, workspace.id, name="Alpha")
    paused = await make_project(migrated, workspace.id, name="Paused")
    archived = await make_project(migrated, workspace.id, name="Archived")
    deleted = await make_project(migrated, workspace.id, name="Deleted")
    foreign = await make_project(migrated, other.id, name="Foreign")
    await execute(migrated, "UPDATE core.projects SET status = 'paused' WHERE id = $1", paused)
    await execute(migrated, "UPDATE core.projects SET status = 'archived' WHERE id = $1", archived)
    await execute(migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", deleted)
    _, everything = await _member(resources, migrated, workspace, "billing")
    _, limited = await _member(
        resources, migrated, workspace, "viewer", project_ids=[zebra, archived, deleted, foreign]
    )
    url = _projects(workspace)

    full = await api.get(url, headers=everything)
    scoped = await api.get(url, headers=limited)
    with_archived = await api.get(
        url, params={"filter[status_in]": "archived,active"}, headers=limited
    )
    paged = await api.get(url, params={"offset": 1, "limit": 1}, headers=everything)

    assert full.status_code == 200
    assert [item["name"] for item in full.json()["data"]] == ["Alpha", "Paused", "zebra"]
    assert full.json()["page"] == {"offset": 0, "limit": 50, "total": 3}
    assert full.json()["data"][0]["project_id"] == str(alpha)
    # Made by the test helper, so by nobody.
    assert full.json()["data"][0]["created_by"] is None
    assert [item["name"] for item in scoped.json()["data"]] == ["zebra"]
    assert scoped.json()["page"]["total"] == 1
    assert [item["name"] for item in with_archived.json()["data"]] == ["Archived", "zebra"]
    assert [item["name"] for item in paged.json()["data"]] == ["Paused"]
    assert paged.json()["page"] == {"offset": 1, "limit": 1, "total": 3}
    for response in (full, scoped, with_archived):
        assert str(foreign) not in response.text
        assert str(deleted) not in response.text


@pytest.mark.parametrize("value", ["deleted", "active,bogus", "", "ACTIVE", "active, paused"])
async def test_an_unknown_status_in_the_filter_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, value: str
) -> None:
    workspace = await make_workspace(migrated)
    _, headers = await _member(resources, migrated, workspace, "viewer")
    response = await api.get(
        _projects(workspace), params={"filter[status_in]": value}, headers=headers
    )
    assert _problem(response) == (422, "validation_failed")
    assert [(error["location"], error["path"]) for error in response.json()["errors"]] == [
        ("query", "filter[status_in]")
    ]


async def test_a_project_is_read_by_those_who_can_see_it(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, other = await make_workspace(migrated), await make_workspace(migrated)
    mine = await make_project(migrated, workspace.id, name="Mine")
    second = await make_project(migrated, workspace.id)
    deleted = await make_project(migrated, workspace.id)
    foreign = await make_project(migrated, other.id)
    await execute(migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", deleted)
    _, member = await _member(resources, migrated, workspace, "billing")
    _, limited = await _member(resources, migrated, workspace, "editor", project_ids=[mine])
    base = _projects(workspace)

    assert (await api.get(f"{base}/{mine}", headers=member)).json()["data"]["name"] == "Mine"
    assert (await api.get(f"{base}/{mine}", headers=limited)).status_code == 200
    for project_id, headers in (
        (second, limited),
        (deleted, member),
        (foreign, member),
        (uuid.uuid4(), member),
    ):
        response = await api.get(f"{base}/{project_id}", headers=headers)
        assert _problem(response) == (404, "not_found"), project_id


# -------------------------------------------------------------------------------------------------
# Change


async def test_an_editor_changes_a_project_and_only_what_differs_is_recorded(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project_id = await make_project(migrated, workspace.id, name="Site")
    before = await fetchrow(migrated, "SELECT * FROM core.projects WHERE id = $1", project_id)
    _, headers = await _member(resources, migrated, workspace, "editor", project_ids=[project_id])
    url = f"{_projects(workspace)}/{project_id}"

    response = await api.patch(
        url,
        json={
            "name": "Site",
            "status": "paused",
            "deep_check_weekday": 3,
            "default_language_code": "de",
        },
        headers=headers,
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert (data["status"], data["deep_check_weekday"], data["default_language_code"]) == (
        "paused",
        3,
        "de",
    )
    assert response.json()["meta"] == {"warnings": []}
    after = await fetchrow(migrated, "SELECT * FROM core.projects WHERE id = $1", project_id)
    assert after["updated_at"] > before["updated_at"]
    assert (after["data_version"], after["created_at"]) == (
        before["data_version"],
        before["created_at"],
    )
    ((action, old, new),) = await _audit(migrated, workspace)
    assert action == "project.updated"
    assert old == '{"status": "active", "deep_check_weekday": 1, "default_language_code": null}'
    assert new == '{"status": "paused", "deep_check_weekday": 3, "default_language_code": "de"}'

    cleared = await api.patch(url, json={"default_language_code": None}, headers=headers)
    assert cleared.json()["data"]["default_language_code"] is None
    archived = await api.patch(url, json={"status": "archived"}, headers=headers)
    assert archived.json()["data"]["status"] == "archived"
    # An archived project is still there for those who ask for it by id.
    assert (await api.get(url, headers=headers)).json()["data"]["status"] == "archived"


async def test_a_new_time_zone_comes_with_a_warning(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project_id = await make_project(migrated, workspace.id)
    _, headers = await _member(resources, migrated, workspace, "owner")
    url = f"{_projects(workspace)}/{project_id}"

    changed = await api.patch(url, json={"timezone": "Asia/Calcutta"}, headers=headers)
    same = await api.patch(url, json={"timezone": "Asia/Kolkata"}, headers=headers)
    unknown = await api.patch(url, json={"timezone": "Mars/Olympus"}, headers=headers)

    assert changed.json()["data"]["timezone"] == "Asia/Kolkata"
    assert changed.json()["meta"] == {"warnings": ["timezone_change_applies_forward"]}
    assert same.json()["meta"] == {"warnings": []}
    assert [(error["path"], error["code"]) for error in unknown.json()["errors"]] == [
        ("timezone", "timezone_unknown")
    ]
    assert len(await _audit(migrated, workspace)) == 1


async def test_a_change_that_changes_nothing_writes_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project_id = await make_project(migrated, workspace.id, name="Site")
    before = await fetchrow(
        migrated, "SELECT updated_at FROM core.projects WHERE id = $1", project_id
    )
    _, headers = await _member(resources, migrated, workspace, "owner")

    response = await api.patch(
        f"{_projects(workspace)}/{project_id}",
        json={"name": "Site", "status": "active"},
        headers=headers,
    )

    assert response.status_code == 200
    after = await fetchrow(
        migrated, "SELECT updated_at FROM core.projects WHERE id = $1", project_id
    )
    assert after["updated_at"] == before["updated_at"]
    assert await _audit(migrated, workspace) == []


async def test_changing_needs_the_permission_and_the_project_in_scope(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, other = await make_workspace(migrated), await make_workspace(migrated)
    inside = await make_project(migrated, workspace.id, name="Inside")
    outside = await make_project(migrated, workspace.id, name="Outside")
    foreign = await make_project(migrated, other.id, name="Foreign")
    _, viewer = await _member(resources, migrated, workspace, "viewer")
    _, limited = await _member(resources, migrated, workspace, "editor", project_ids=[inside])
    _, owner = await _member(resources, migrated, workspace, "owner")
    base = _projects(workspace)
    body = {"name": "Renamed"}

    assert _problem(await api.patch(f"{base}/{inside}", json=body, headers=viewer)) == (
        403,
        "forbidden",
    )
    assert _problem(await api.patch(f"{base}/{outside}", json=body, headers=limited)) == (
        404,
        "not_found",
    )
    assert _problem(await api.patch(f"{base}/{foreign}", json=body, headers=owner)) == (
        404,
        "not_found",
    )
    assert (await api.patch(f"{base}/{inside}", json=body, headers=limited)).status_code == 200
    names = await fetch(
        migrated,
        "SELECT name FROM core.projects WHERE id = ANY($1::uuid[]) ORDER BY name",
        [inside, outside, foreign],
    )
    assert [row["name"] for row in names] == ["Foreign", "Outside", "Renamed"]


async def test_a_slug_cannot_be_changed_to_one_in_use(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    first = await make_project(migrated, workspace.id, slug=_slug())
    taken = _slug()
    await make_project(migrated, workspace.id, slug=taken)
    _, headers = await _member(resources, migrated, workspace, "owner")

    response = await api.patch(
        f"{_projects(workspace)}/{first}", json={"name": "New", "slug": taken}, headers=headers
    )

    assert _problem(response) == (409, "duplicate")
    row = await fetchrow(migrated, "SELECT name FROM core.projects WHERE id = $1", first)
    assert row["name"] == "Site"
    assert await _audit(migrated, workspace) == []


@pytest.mark.parametrize(
    ("body", "path"),
    [
        ({}, ""),
        ({"name": None}, "name"),
        ({"slug": None}, "slug"),
        ({"timezone": None}, "timezone"),
        ({"status": None}, "status"),
        ({"deep_check_weekday": None}, "deep_check_weekday"),
        ({"status": "deleted"}, "status"),
        ({"slug": "ops"}, "slug"),
        ({"data_version": 99}, "data_version"),
        ({"workspace_id": "0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11"}, "workspace_id"),
        ({"deleted_at": "2026-01-01T00:00:00Z"}, "deleted_at"),
    ],
)
async def test_a_change_that_is_not_allowed_is_refused(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    body: dict[str, object],
    path: str,
) -> None:
    workspace = await make_workspace(migrated)
    project_id = await make_project(migrated, workspace.id)
    _, headers = await _member(resources, migrated, workspace, "owner")
    response = await api.patch(f"{_projects(workspace)}/{project_id}", json=body, headers=headers)
    assert _problem(response) == (422, "validation_failed")
    assert [error["path"] for error in response.json()["errors"]] == [path]


# -------------------------------------------------------------------------------------------------
# What the review of these routes asked for


async def test_an_archived_project_frees_its_slot_and_needs_one_to_come_back(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    first = await make_project(migrated, workspace.id)
    await execute(
        migrated,
        "INSERT INTO core.workspace_quotas (workspace_id, max_projects) VALUES ($1, 1)",
        workspace.id,
    )
    _, headers = await _member(resources, migrated, workspace, "owner")
    base = _projects(workspace)

    full = await api.post(base, json={"name": "Two", "slug": _slug()}, headers=headers)
    await api.patch(f"{base}/{first}", json={"status": "archived"}, headers=headers)
    second = await api.post(base, json={"name": "Two", "slug": _slug()}, headers=headers)
    back = await api.patch(f"{base}/{first}", json={"status": "active"}, headers=headers)
    # Pausing the live one frees nothing: a paused project still holds its slot.
    second_url = f"{base}/{second.json()['data']['project_id']}"
    await api.patch(second_url, json={"status": "paused"}, headers=headers)
    still = await api.patch(f"{base}/{first}", json={"status": "paused"}, headers=headers)

    assert _problem(full) == (422, "quota_exceeded")
    assert second.status_code == 201
    assert _problem(back) == _problem(still) == (422, "quota_exceeded")
    assert (back.json()["limit"], back.json()["used"], back.json()["requested"]) == (1, 1, 1)
    row = await fetchrow(migrated, "SELECT status FROM core.projects WHERE id = $1", first)
    assert row["status"] == "archived"
    # Other changes to an archived project need no slot.
    renamed = await api.patch(f"{base}/{first}", json={"name": "Old site"}, headers=headers)
    assert renamed.status_code == 200


async def test_the_warning_is_about_a_zone_that_really_changed(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project_id = await make_project(migrated, workspace.id)
    _, headers = await _member(resources, migrated, workspace, "owner")

    response = await api.patch(
        f"{_projects(workspace)}/{project_id}",
        json={"name": "Renamed", "timezone": "UTC"},
        headers=headers,
    )

    assert response.json()["data"]["name"] == "Renamed"
    assert response.json()["meta"] == {"warnings": []}


async def test_projects_with_one_name_keep_one_order(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    ids = [
        await make_project(migrated, workspace.id, name=name)
        for name in ("same", "Same", "SAME", "same", "Alpha")
    ]
    _, headers = await _member(resources, migrated, workspace, "viewer")

    pages = [
        await api.get(_projects(workspace), params={"offset": offset, "limit": 1}, headers=headers)
        for offset in range(5)
    ]

    listed = [page.json()["data"][0]["project_id"] for page in pages]
    # By name without regard to case, then by id.
    assert listed == [str(ids[4]), *sorted(str(project_id) for project_id in ids[:4])]


async def test_a_deleted_project_cannot_be_changed(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project_id = await make_project(migrated, workspace.id, name="Gone")
    await execute(migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", project_id)
    _, headers = await _member(resources, migrated, workspace, "owner")

    response = await api.patch(
        f"{_projects(workspace)}/{project_id}", json={"name": "Back"}, headers=headers
    )

    assert _problem(response) == (404, "not_found")
    row = await fetchrow(migrated, "SELECT name FROM core.projects WHERE id = $1", project_id)
    assert row["name"] == "Gone"


async def test_one_slug_created_many_times_at_once_makes_one_project(
    client_for: AppFactory, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    slug = _slug()
    async with client_for(db_pool_size=6) as api:
        resources = api._transport.app.state.resources  # type: ignore[attr-defined]
        _, headers = await _member(resources, migrated, workspace, "owner")
        responses = await asyncio.gather(
            *(
                api.post(_projects(workspace), json={"name": "Site", "slug": slug}, headers=headers)
                for _ in range(5)
            )
        )

    assert sorted(response.status_code for response in responses) == [201, 409, 409, 409, 409]
    assert len(await _audit(migrated, workspace)) == 1


async def test_every_value_of_a_repeated_status_filter_counts(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    archived = await make_project(migrated, workspace.id, name="Archived")
    await make_project(migrated, workspace.id, name="Live")
    await execute(migrated, "UPDATE core.projects SET status = 'archived' WHERE id = $1", archived)
    _, headers = await _member(resources, migrated, workspace, "viewer")
    url = _projects(workspace)

    both = await api.get(
        url,
        params=[("filter[status_in]", "archived"), ("filter[status_in]", "active")],
        headers=headers,
    )
    bogus = await api.get(
        url,
        params=[("filter[status_in]", "bogus"), ("filter[status_in]", "active")],
        headers=headers,
    )

    assert [item["name"] for item in both.json()["data"]] == ["Archived", "Live"]
    assert _problem(bogus) == (422, "validation_failed")


async def test_a_change_that_waits_too_long_for_a_lock_is_a_conflict_not_a_fault(
    client_for: AppFactory, migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(engine, "LOCK_TIMEOUT", "200ms")
    workspace = await make_workspace(migrated)
    project_id = await make_project(migrated, workspace.id, name="Site")
    holder = await asyncpg.connect(migrated.url())
    try:
        async with client_for() as api, holder.transaction():
            resources = api._transport.app.state.resources  # type: ignore[attr-defined]
            _, headers = await _member(resources, migrated, workspace, "owner")
            await holder.execute("SELECT 1 FROM core.projects WHERE id = $1 FOR UPDATE", project_id)

            changed = await api.patch(
                f"{_projects(workspace)}/{project_id}", json={"name": "Renamed"}, headers=headers
            )
            read = await api.get(f"{_projects(workspace)}/{project_id}", headers=headers)
    finally:
        await holder.close()

    assert _problem(changed) == (409, "conflict")
    assert changed.json()["detail"] == "Another request is changing this. Try again."
    # Reading does not wait for the lock.
    assert read.json()["data"]["name"] == "Site"


async def test_a_statement_that_runs_into_its_timeout_is_answered_as_busy(
    client_for: AppFactory, migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(engine, "LOCK_TIMEOUT", "30s")
    workspace = await make_workspace(migrated)
    project_id = await make_project(migrated, workspace.id)
    holder = await asyncpg.connect(migrated.url())
    try:
        async with client_for(db_statement_timeout="200ms") as api, holder.transaction():
            resources = api._transport.app.state.resources  # type: ignore[attr-defined]
            _, headers = await _member(resources, migrated, workspace, "owner")
            await holder.execute("SELECT 1 FROM core.projects WHERE id = $1 FOR UPDATE", project_id)

            response = await api.patch(
                f"{_projects(workspace)}/{project_id}", json={"name": "Renamed"}, headers=headers
            )
    finally:
        await holder.close()

    assert _problem(response) == (503, "query_timeout")
