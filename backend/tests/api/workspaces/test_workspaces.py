"""Workspace routes (docs/19 section 3.2.1)."""

import uuid

import httpx
import pytest

from idraft.api import timezones
from idraft.api.auth.throttle import LoginThrottle, ThrottleUnavailableError
from idraft.api.openapi import build_openapi
from idraft.api.resources import Resources
from idraft.api.slugs import ReservedProjectSlug, ReservedWorkspaceSlug
from idraft.api.workspaces import service as workspace_rules
from tests.api.auth.support import (
    User,
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
from tests.conftest import PostgresServer

WORKSPACES = "/api/v1/workspaces"


def _problem(response: httpx.Response) -> tuple[int, str]:
    return response.status_code, response.json()["code"]


def _slug() -> str:
    return f"acme-{uuid.uuid4().hex[:10]}"


async def _session(resources: Resources, user: User, *, fresh: bool = False) -> dict[str, str]:
    token, _ = await open_session(resources, user, fresh=fresh)
    return cookie(token)


async def _operator(resources: Resources, pg: PostgresServer) -> tuple[User, dict[str, str]]:
    user = await make_user(pg, operator=True)
    return user, await _session(resources, user)


# -------------------------------------------------------------------------------------------------
# List


async def test_the_list_needs_a_session(api: httpx.AsyncClient) -> None:
    assert _problem(await api.get(WORKSPACES)) == (401, "unauthenticated")


async def test_the_list_shows_the_callers_workspaces_and_no_others(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    beta = await make_workspace(migrated, name="beta")
    alpha = await make_workspace(migrated, name="Alpha")
    going = await make_workspace(migrated, name="Going")
    other = await make_workspace(migrated, name="Other")
    for workspace in (beta, alpha, going):
        await add_member(migrated, workspace, user, "viewer")
    await add_member(migrated, other, await make_user(migrated), "owner")
    await execute(
        migrated, "UPDATE auth.workspaces SET status = 'deleting' WHERE id = $1", going.id
    )

    response = await api.get(WORKSPACES, headers=await _session(resources, user))

    assert response.status_code == 200
    data = response.json()["data"]
    assert [item["name"] for item in data] == ["Alpha", "beta"]
    assert data[0] == {
        "workspace_id": str(alpha.id),
        "name": "Alpha",
        "slug": alpha.slug,
        "logo": None,
        "plan_code": "internal",
        "timezone": "UTC",
        "status": "active",
        "created_at": data[0]["created_at"],
        "purge_after": None,
    }
    assert str(other.id) not in response.text


# -------------------------------------------------------------------------------------------------
# Create


async def test_an_operator_creates_a_workspace_and_owns_it(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user, headers = await _operator(resources, migrated)
    slug = _slug()

    response = await api.post(
        WORKSPACES,
        json={"name": "  Acme Corp  ", "slug": slug, "timezone": "Asia/Kolkata"},
        headers=headers,
    )

    assert response.status_code == 201
    created = response.json()["data"]
    assert (created["name"], created["slug"], created["timezone"]) == (
        "Acme Corp",
        slug,
        "Asia/Kolkata",
    )
    assert (created["status"], created["plan_code"]) == ("active", "internal")
    workspace_id = uuid.UUID(created["workspace_id"])
    membership = await fetchrow(
        migrated, "SELECT * FROM auth.memberships WHERE workspace_id = $1", workspace_id
    )
    assert (membership["user_id"], membership["role"], membership["project_ids"]) == (
        user.id,
        "owner",
        None,
    )
    quotas = await fetchrow(
        migrated, "SELECT * FROM core.workspace_quotas WHERE workspace_id = $1", workspace_id
    )
    assert (quotas["max_projects"], quotas["max_tracked_keywords"]) == (10, 5000)
    (entry,) = await fetch(
        migrated, "SELECT * FROM ops.audit_logs WHERE workspace_id = $1", workspace_id
    )
    assert (entry["action"], entry["actor_id"], entry["target_id"]) == (
        "workspace.created",
        str(user.id),
        str(workspace_id),
    )
    assert (
        entry["after"] == f'{{"name": "Acme Corp", "slug": "{slug}", "timezone": "Asia/Kolkata"}}'
    )
    # The new owner can use it at once.
    assert (await api.get(f"{WORKSPACES}/{workspace_id}", headers=headers)).json()[
        "data"
    ] == created
    assert [
        item["workspace_id"] for item in (await api.get(WORKSPACES, headers=headers)).json()["data"]
    ] == [str(workspace_id)]


async def test_the_time_zone_defaults_to_utc(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    _, headers = await _operator(resources, migrated)
    response = await api.post(WORKSPACES, json={"name": "Acme", "slug": _slug()}, headers=headers)
    assert response.json()["data"]["timezone"] == "UTC"


async def test_while_registration_is_by_invitation_only_an_operator_creates_workspaces(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    slug = _slug()

    response = await api.post(
        WORKSPACES, json={"name": "Acme", "slug": slug}, headers=await _session(resources, user)
    )

    assert _problem(response) == (403, "forbidden")
    assert await fetch(migrated, "SELECT 1 FROM auth.workspaces WHERE slug = $1", slug) == []


async def test_with_open_registration_any_verified_user_creates_a_workspace(
    client_for: AppFactory, migrated: PostgresServer
) -> None:
    verified, unverified = await make_user(migrated), await make_user(migrated, verified=False)
    async with client_for(registration="open") as api:
        resources = api._transport.app.state.resources  # type: ignore[attr-defined]
        created = await api.post(
            WORKSPACES,
            json={"name": "Acme", "slug": _slug()},
            headers=await _session(resources, verified),
        )
        refused = await api.post(
            WORKSPACES,
            json={"name": "Acme", "slug": _slug()},
            headers=await _session(resources, unverified),
        )

    assert created.status_code == 201
    assert _problem(refused) == (403, "email_not_verified")


async def test_an_operator_with_an_unverified_address_is_refused_too(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated, operator=True, verified=False)
    response = await api.post(
        WORKSPACES, json={"name": "Acme", "slug": _slug()}, headers=await _session(resources, user)
    )
    assert _problem(response) == (403, "email_not_verified")


async def test_a_disabled_account_with_a_cached_session_creates_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user, headers = await _operator(resources, migrated)
    assert (await api.get(WORKSPACES, headers=headers)).status_code == 200  # now cached
    await execute(migrated, "UPDATE auth.users SET disabled_at = now() WHERE id = $1", user.id)
    slug = _slug()

    response = await api.post(WORKSPACES, json={"name": "Acme", "slug": slug}, headers=headers)

    assert _problem(response) == (401, "unauthenticated")
    assert await fetch(migrated, "SELECT 1 FROM auth.workspaces WHERE slug = $1", slug) == []


async def test_a_taken_slug_is_a_duplicate_and_names_no_other_workspace(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    theirs = await make_workspace(migrated)
    _, headers = await _operator(resources, migrated)

    response = await api.post(
        WORKSPACES, json={"name": "Mine", "slug": theirs.slug}, headers=headers
    )

    assert _problem(response) == (409, "duplicate")
    assert str(theirs.id) not in response.text
    assert "existing_id" not in response.json()
    rows = await fetch(migrated, "SELECT name FROM auth.workspaces WHERE slug = $1", theirs.slug)
    assert [row["name"] for row in rows] == [theirs.name]
    # Nothing of the refused workspace was kept: no membership, no quotas, no audit entry.
    assert (await api.get(WORKSPACES, headers=headers)).json()["data"] == []


@pytest.mark.parametrize(
    "slug",
    [
        "ab",
        "-abc",
        "abc-",
        "Abc",
        "a b",
        "a_b",
        "a.b",
        "a" * 41,
        "api",
        "design-system",
        "invite",
        "static",
        "undefined",
        # A path segment is a slug or an id, never something that could be both.
        "0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11",
        "",
    ],
)
async def test_a_slug_is_a_url_segment_and_not_a_route_of_the_web_app(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, slug: str
) -> None:
    _, headers = await _operator(resources, migrated)
    response = await api.post(WORKSPACES, json={"name": "Acme", "slug": slug}, headers=headers)
    assert _problem(response) == (422, "validation_failed")
    assert [error["path"] for error in response.json()["errors"]] == ["slug"]


@pytest.mark.parametrize("slug", ["abc", "a-b", "a1-b2-c3", "9lives", "a" * 40, "apis", "new-york"])
async def test_an_ordinary_slug_is_accepted(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, slug: str
) -> None:
    await execute(migrated, "DELETE FROM auth.workspaces WHERE slug = $1", slug)
    _, headers = await _operator(resources, migrated)
    response = await api.post(WORKSPACES, json={"name": "Acme", "slug": slug}, headers=headers)
    assert response.status_code == 201
    await execute(migrated, "DELETE FROM auth.workspaces WHERE slug = $1", slug)


@pytest.mark.parametrize("timezone", ["Mars/Olympus", "Asia/Calcuta", "Etc/Nowhere"])
async def test_a_time_zone_postgresql_does_not_know_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, timezone: str
) -> None:
    _, headers = await _operator(resources, migrated)
    slug = _slug()
    response = await api.post(
        WORKSPACES, json={"name": "Acme", "slug": slug, "timezone": timezone}, headers=headers
    )
    assert _problem(response) == (422, "validation_failed")
    assert response.json()["errors"] == [
        {
            "location": "body",
            "path": "timezone",
            "code": "timezone_unknown",
            "message": "Unknown time zone.",
        }
    ]
    assert await fetch(migrated, "SELECT 1 FROM auth.workspaces WHERE slug = $1", slug) == []


@pytest.mark.parametrize(
    "timezone",
    ["localtime", "posixrules", "Factory", "utc", "EST5EDT4", "GMT", "/Asia/Kolkata", ""],
)
async def test_a_time_zone_is_utc_or_an_area_and_a_location(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, timezone: str
) -> None:
    """PostgreSQL knows `localtime` and `posixrules`, and they are files, not zones: the first
    means whatever the database host is set to."""
    _, headers = await _operator(resources, migrated)
    response = await api.post(
        WORKSPACES, json={"name": "Acme", "slug": _slug(), "timezone": timezone}, headers=headers
    )
    assert _problem(response) == (422, "validation_failed")
    assert [error["path"] for error in response.json()["errors"]] == ["timezone"]


@pytest.mark.parametrize(
    ("sent", "stored"),
    [
        # What a browser in India reports as its zone.
        ("Asia/Calcutta", "Asia/Kolkata"),
        ("Europe/Kiev", "Europe/Kyiv"),
        ("America/Buenos_Aires", "America/Argentina/Buenos_Aires"),
        ("Asia/Kolkata", "Asia/Kolkata"),
        ("Etc/UTC", "Etc/UTC"),
    ],
)
async def test_a_zone_a_browser_reports_by_its_old_name_is_stored_by_its_current_one(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, sent: str, stored: str
) -> None:
    _, headers = await _operator(resources, migrated)
    created = await api.post(
        WORKSPACES, json={"name": "Acme", "slug": _slug(), "timezone": sent}, headers=headers
    )
    assert created.status_code == 201
    assert created.json()["data"]["timezone"] == stored
    url = f"{WORKSPACES}/{created.json()['data']['workspace_id']}"
    changed = await api.patch(url, json={"timezone": "UTC"}, headers=headers)
    back = await api.patch(url, json={"timezone": sent}, headers=headers)
    assert (changed.json()["data"]["timezone"], back.json()["data"]["timezone"]) == ("UTC", stored)


async def test_every_renamed_zone_exists_in_postgresql_under_its_current_name(
    migrated: PostgresServer,
) -> None:
    rows = await fetch(migrated, "SELECT name FROM pg_timezone_names")
    known = {row["name"] for row in rows}
    assert set(timezones._RENAMED.values()) - known == set()
    assert timezones.current_name("Asia/Calcutta") == "Asia/Kolkata"
    assert timezones.current_name("Asia/Tokyo") == "Asia/Tokyo"


async def test_workspace_creation_is_limited_per_user(
    client_for: AppFactory, migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(workspace_rules, "WORKSPACES_PER_DAY", 2)
    user, other = await make_user(migrated), await make_user(migrated)
    async with client_for(registration="open") as api:
        resources = api._transport.app.state.resources  # type: ignore[attr-defined]
        headers = await _session(resources, user)
        responses = [
            await api.post(WORKSPACES, json={"name": "Acme", "slug": _slug()}, headers=headers)
            for _ in range(3)
        ]
        someone_else = await api.post(
            WORKSPACES,
            json={"name": "Acme", "slug": _slug()},
            headers=await _session(resources, other),
        )

    assert [response.status_code for response in responses] == [201, 201, 429]
    assert responses[-1].json()["code"] == "rate_limited"
    assert responses[-1].headers["Retry-After"] == "86400"
    assert someone_else.status_code == 201
    owned = await fetch(migrated, "SELECT 1 FROM auth.memberships WHERE user_id = $1", user.id)
    assert len(owned) == 2


async def test_a_body_with_an_unknown_member_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    _, headers = await _operator(resources, migrated)
    response = await api.post(
        WORKSPACES,
        json={"name": "Acme", "slug": _slug(), "plan_code": "enterprise"},
        headers=headers,
    )
    assert _problem(response) == (422, "validation_failed")


# -------------------------------------------------------------------------------------------------
# Read and change


async def test_a_member_reads_the_workspace_and_a_stranger_cannot(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated, name="Acme")
    member, stranger = await make_user(migrated), await make_user(migrated)
    await add_member(migrated, workspace, member, "billing")
    url = f"{WORKSPACES}/{workspace.id}"

    seen = await api.get(url, headers=await _session(resources, member))
    hidden = await api.get(url, headers=await _session(resources, stranger))

    assert seen.status_code == 200
    assert seen.json()["data"]["name"] == "Acme"
    assert _problem(hidden) == (404, "not_found")


async def test_changing_a_workspace_needs_the_permission(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await make_user(migrated)
    await add_member(migrated, workspace, editor, "editor")

    response = await api.patch(
        f"{WORKSPACES}/{workspace.id}",
        json={"name": "Renamed"},
        headers=await _session(resources, editor),
    )

    assert _problem(response) == (403, "forbidden")
    row = await fetchrow(migrated, "SELECT name FROM auth.workspaces WHERE id = $1", workspace.id)
    assert row["name"] == workspace.name


async def test_an_admin_changes_the_workspace_and_the_change_is_recorded(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated, name="Acme")
    admin = await make_user(migrated)
    await add_member(migrated, workspace, admin, "admin")
    headers = await _session(resources, admin)
    url = f"{WORKSPACES}/{workspace.id}"
    slug = _slug()

    response = await api.patch(
        url,
        json={
            "name": "Acme Two",
            "slug": slug,
            "timezone": "Europe/Berlin",
            "logo": "https://cdn.example.com/logo.png",
        },
        headers=headers,
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert (data["name"], data["slug"], data["timezone"], data["logo"]) == (
        "Acme Two",
        slug,
        "Europe/Berlin",
        "https://cdn.example.com/logo.png",
    )
    (entry,) = await fetch(
        migrated, "SELECT * FROM ops.audit_logs WHERE workspace_id = $1", workspace.id
    )
    assert (entry["action"], entry["actor_id"]) == ("workspace.updated", str(admin.id))
    assert '"name": "Acme"' in entry["before"]
    assert f'"slug": "{workspace.slug}"' in entry["before"]
    assert '"timezone": "UTC"' in entry["before"]
    assert '"logo": null' in entry["before"]
    assert '"name": "Acme Two"' in entry["after"]

    cleared = await api.patch(url, json={"logo": None}, headers=headers)
    assert cleared.json()["data"]["logo"] is None


async def test_a_change_that_changes_nothing_is_not_recorded(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated, name="Acme")
    owner = await make_user(migrated)
    await add_member(migrated, workspace, owner, "owner")

    response = await api.patch(
        f"{WORKSPACES}/{workspace.id}",
        json={"name": "Acme", "slug": workspace.slug, "timezone": "UTC", "logo": None},
        headers=await _session(resources, owner),
    )

    assert response.status_code == 200
    assert response.json()["data"]["name"] == "Acme"
    entries = await fetch(
        migrated, "SELECT 1 FROM ops.audit_logs WHERE workspace_id = $1", workspace.id
    )
    assert entries == []


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"name": None},
        {"slug": None},
        {"timezone": None},
        {"name": ""},
        {"slug": "settings"},
        {"logo": "http://cdn.example.com/logo.png"},
        {"status": "suspended"},
        {"plan_code": "enterprise"},
    ],
)
async def test_a_change_that_is_not_allowed_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, body: dict[str, object]
) -> None:
    workspace = await make_workspace(migrated)
    owner = await make_user(migrated)
    await add_member(migrated, workspace, owner, "owner")
    response = await api.patch(
        f"{WORKSPACES}/{workspace.id}", json=body, headers=await _session(resources, owner)
    )
    assert _problem(response) == (422, "validation_failed")


async def test_a_change_to_a_taken_slug_or_an_unknown_time_zone_changes_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, other = await make_workspace(migrated, name="Acme"), await make_workspace(migrated)
    owner = await make_user(migrated)
    await add_member(migrated, workspace, owner, "owner")
    headers = await _session(resources, owner)
    url = f"{WORKSPACES}/{workspace.id}"

    taken = await api.patch(url, json={"name": "New", "slug": other.slug}, headers=headers)
    unknown = await api.patch(
        url, json={"name": "New", "timezone": "Mars/Olympus"}, headers=headers
    )

    assert _problem(taken) == (409, "duplicate")
    assert str(other.id) not in taken.text
    assert _problem(unknown) == (422, "validation_failed")
    row = await fetchrow(
        migrated, "SELECT name, slug FROM auth.workspaces WHERE id = $1", workspace.id
    )
    assert (row["name"], str(row["slug"])) == ("Acme", workspace.slug)
    entries = await fetch(
        migrated, "SELECT 1 FROM ops.audit_logs WHERE workspace_id = $1", workspace.id
    )
    assert entries == []


# -------------------------------------------------------------------------------------------------
# The profile


async def test_the_profile_says_whether_the_user_is_an_operator(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    _, operator = await _operator(resources, migrated)
    ordinary = await _session(resources, await make_user(migrated))

    assert (await api.get("/api/v1/me", headers=operator)).json()["data"]["user"][
        "is_platform_operator"
    ] is True
    assert (await api.get("/api/v1/me", headers=ordinary)).json()["data"]["user"][
        "is_platform_operator"
    ] is False


async def test_a_disabled_account_with_a_cached_session_lists_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, user = await make_workspace(migrated), await make_user(migrated)
    await add_member(migrated, workspace, user, "owner")
    headers = await _session(resources, user)
    assert (await api.get(WORKSPACES, headers=headers)).status_code == 200  # now cached
    await execute(migrated, "UPDATE auth.users SET disabled_at = now() WHERE id = $1", user.id)

    assert _problem(await api.get(WORKSPACES, headers=headers)) == (401, "unauthenticated")


async def test_only_what_differs_is_written_and_recorded(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated, name="Acme")
    owner = await make_user(migrated)
    await add_member(migrated, workspace, owner, "owner")

    response = await api.patch(
        f"{WORKSPACES}/{workspace.id}",
        json={"name": "Acme", "slug": workspace.slug, "timezone": "Asia/Tokyo"},
        headers=await _session(resources, owner),
    )

    assert response.json()["data"]["timezone"] == "Asia/Tokyo"
    (entry,) = await fetch(
        migrated,
        "SELECT before::text, after::text FROM ops.audit_logs WHERE workspace_id = $1",
        workspace.id,
    )
    assert (entry["before"], entry["after"]) == (
        '{"timezone": "UTC"}',
        '{"timezone": "Asia/Tokyo"}',
    )


async def test_a_null_where_none_is_allowed_names_the_field(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await make_user(migrated)
    await add_member(migrated, workspace, owner, "owner")

    response = await api.patch(
        f"{WORKSPACES}/{workspace.id}",
        json={"name": None, "slug": None, "timezone": None, "logo": None},
        headers=await _session(resources, owner),
    )

    assert _problem(response) == (422, "validation_failed")
    assert sorted(error["path"] for error in response.json()["errors"]) == [
        "name",
        "slug",
        "timezone",
    ]


def test_the_reserved_words_are_in_the_api_document() -> None:
    schemas = build_openapi()["components"]["schemas"]
    assert schemas["ReservedWorkspaceSlug"]["enum"] == [
        word.value for word in ReservedWorkspaceSlug
    ]
    assert schemas["ReservedProjectSlug"]["enum"] == [word.value for word in ReservedProjectSlug]
    assert {"api", "login", "invite", "design-system"} <= set(ReservedWorkspaceSlug)
    assert {"onboarding", "costs", "ops", "settings", "projects"} <= set(ReservedProjectSlug)


async def test_an_attempt_refused_for_a_taken_slug_costs_no_allowance(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(workspace_rules, "WORKSPACES_PER_DAY", 1)
    taken = await make_workspace(migrated)
    _, headers = await _operator(resources, migrated)

    refused = [
        await api.post(WORKSPACES, json={"name": "Mine", "slug": taken.slug}, headers=headers)
        for _ in range(3)
    ]
    created = await api.post(WORKSPACES, json={"name": "Mine", "slug": _slug()}, headers=headers)
    over = _slug()
    limited = await api.post(WORKSPACES, json={"name": "Mine", "slug": over}, headers=headers)

    assert [response.status_code for response in refused] == [409, 409, 409]
    assert created.status_code == 201
    assert _problem(limited) == (429, "rate_limited")
    # The workspace over the allowance was not kept.
    assert await fetch(migrated, "SELECT 1 FROM auth.workspaces WHERE slug = $1", over) == []


def test_a_field_that_refuses_null_is_not_nullable_in_the_api_document() -> None:
    schemas = build_openapi()["components"]["schemas"]
    for model, fields in (
        ("WorkspaceUpdate", ("name", "slug", "timezone")),
        ("MemberUpdate", ("role",)),
        ("ProfileUpdate", ("name",)),
        ("ProjectUpdate", ("name", "slug", "timezone", "deep_check_weekday", "status")),
    ):
        for field in fields:
            assert "anyOf" not in schemas[model]["properties"][field], (model, field)
            assert field not in schemas[model].get("required", []), (model, field)
    # The ones that do take null say so.
    assert {"type": "null"} in schemas["WorkspaceUpdate"]["properties"]["logo"]["anyOf"]
    assert {"type": "null"} in schemas["ProjectUpdate"]["properties"]["default_language_code"][
        "anyOf"
    ]
    # An error body leaves these out when it has none; it never sends null. So they are
    # optional, with no default: a generated client must not type them as always present.
    for member in ("detail", "errors"):
        described = schemas["Problem"]["properties"][member]
        assert "anyOf" not in described
        assert "default" not in described
        assert member not in schemas["Problem"]["required"]


async def test_a_refused_slug_or_null_has_a_code_of_its_own(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    _, headers = await _operator(resources, migrated)
    workspace = await make_workspace(migrated)
    owner = await make_user(migrated)
    await add_member(migrated, workspace, owner, "owner")

    reserved = await api.post(WORKSPACES, json={"name": "A", "slug": "settings"}, headers=headers)
    like_an_id = await api.post(
        WORKSPACES,
        json={"name": "A", "slug": "0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11"},
        headers=headers,
    )
    null = await api.patch(
        f"{WORKSPACES}/{workspace.id}",
        json={"name": None},
        headers=await _session(resources, owner),
    )

    assert [error["code"] for error in reserved.json()["errors"]] == ["slug_reserved"]
    assert [error["code"] for error in like_an_id.json()["errors"]] == ["slug_is_id"]
    assert [error["code"] for error in null.json()["errors"]] == ["null_not_allowed"]
    profile = await api.patch(
        "/api/v1/me", json={"name": None}, headers=await _session(resources, owner)
    )
    assert [(error["path"], error["code"]) for error in profile.json()["errors"]] == [
        ("name", "null_not_allowed")
    ]


async def test_no_workspace_is_created_when_the_allowance_cannot_be_counted(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def unavailable(self: object, *args: object, **kwargs: object) -> bool:
        raise ThrottleUnavailableError

    _, headers = await _operator(resources, migrated)
    monkeypatch.setattr(LoginThrottle, "allow", unavailable)
    slug = _slug()

    response = await api.post(WORKSPACES, json={"name": "Acme", "slug": slug}, headers=headers)

    # An allowance that cannot be counted is not waved through.
    assert _problem(response) == (503, "service_unavailable")
    assert await fetch(migrated, "SELECT 1 FROM auth.workspaces WHERE slug = $1", slug) == []


async def test_padding_around_an_address_is_not_part_of_it(api: httpx.AsyncClient) -> None:
    padded = " " * 2000 + "nobody@client.example" + "\n"
    response = await api.post(
        "/api/v1/auth/sign-in", json={"email": padded, "password": "a password of some length"}
    )
    # Read as the address it is: there is no such account.
    assert _problem(response) == (401, "invalid_credentials")
    wrong_type = await api.post(
        "/api/v1/auth/sign-in", json={"email": 5, "password": "a password of some length"}
    )
    assert [error["code"] for error in wrong_type.json()["errors"]] == ["string_type"]
