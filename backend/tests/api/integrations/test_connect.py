"""Starting a connection and the return from Google (docs/18 section 4.8, docs/24 section 6)."""

from __future__ import annotations

import asyncio
import hashlib
import io
import json
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from pydantic import SecretStr

from idraft.config.logging import configure_logging
from idraft.providers.google.client import REVOKE_URL
from tests.api.auth.support import cookie, fetch, make_user, open_session
from tests.api.integrations.support import (
    CALLBACK,
    REDIRECT_URI,
    Caller,
    Harness,
    callback,
    connect,
    connected,
    integrations_page,
    location,
    make_caller,
    make_world,
    parts_of,
    project_url,
    running,
    start,
)
from tests.conftest import BASE_URL, PostgresServer
from tests.providers.google.fake_google import CLIENT_ID, CLIENT_SECRET, FakeGoogle

ACCOUNT_SITES = [("sc-domain:acme.example", "siteOwner")]


def _text(value: bytes | str) -> str:
    return value if isinstance(value, str) else value.decode()


def _state_key(state: str) -> str:
    return "oauth:state:" + hashlib.sha256(state.encode()).hexdigest()


async def _actions(h: Harness, workspace_id: uuid.UUID) -> list[str]:
    rows = await fetch(
        h.pg,
        "SELECT action FROM ops.audit_logs WHERE workspace_id = $1 AND action LIKE 'connection.%' "
        "ORDER BY id",
        workspace_id,
    )
    return [row["action"] for row in rows]


async def test_the_owner_and_an_admin_are_given_googles_consent_address(google: Harness) -> None:
    world = await make_world(google)

    for caller in (world.owner, world.admin):
        response = await start(google, world, caller)

        assert response.status_code == 200
        data = response.json()["data"]
        query = parts_of(data["authorization_url"])
        assert data["authorization_url"].startswith("https://accounts.google.com/o/oauth2/v2/auth?")
        assert query["client_id"] == CLIENT_ID
        assert query["redirect_uri"] == REDIRECT_URI == BASE_URL + CALLBACK
        assert query["scope"] == (
            "openid email https://www.googleapis.com/auth/webmasters.readonly "
            "https://www.googleapis.com/auth/analytics.readonly"
        )
        assert (query["access_type"], query["prompt"]) == ("offline", "consent")
        assert query["include_granted_scopes"] == "false"
        assert query["code_challenge_method"] == "S256"
        assert CLIENT_SECRET not in data["authorization_url"]


async def test_the_state_lives_ten_minutes_bound_to_the_user_workspace_and_project(
    google: Harness,
) -> None:
    world = await make_world(google)

    response = await start(google, world, world.admin)

    state = parts_of(response.json()["data"]["authorization_url"])["state"]
    redis = google.resources.redis
    raw = await redis.get(_state_key(state))
    assert raw is not None
    stored = json.loads(_text(raw))
    assert (stored["user_id"], stored["workspace_id"], stored["project_id"]) == (
        str(world.admin.user_id),
        str(world.workspace.id),
        str(world.project_id),
    )
    assert 590 < await redis.ttl(_state_key(state)) <= 600
    # Only its hash is a key, so a copy of Redis completes no flow
    assert [_text(key) for key in await redis.keys("oauth:*")] == [_state_key(state)]
    expires_at = datetime.fromisoformat(response.json()["data"]["state_expires_at"])
    assert timedelta(minutes=9) < expires_at - datetime.now(UTC) <= timedelta(minutes=10)


@pytest.mark.parametrize("role", ["editor", "analyst", "viewer", "billing"])
async def test_only_an_owner_or_an_admin_can_start(google: Harness, role: str) -> None:
    world = await make_world(google)
    caller = await make_caller(google, world.workspace, role)

    response = await start(google, world, caller)

    assert response.status_code == 403
    assert await google.resources.redis.keys("oauth:*") == []


async def test_starting_needs_a_recent_sign_in(google: Harness) -> None:
    world = await make_world(google)
    stale = await make_caller(google, world.workspace, "owner", fresh=False)

    response = await start(google, world, stale)

    assert (response.status_code, response.json()["code"]) == (403, "fresh_session_required")


async def test_starting_needs_a_session_a_membership_and_a_project_of_the_workspace(
    google: Harness,
) -> None:
    world = await make_world(google)
    other = await make_world(google)

    assert (await start(google, world, Caller(uuid.uuid4(), {}))).status_code == 401
    assert (await start(google, world, other.owner)).status_code == 404
    stranger_project = await google.api.post(
        f"/api/v1/workspaces/{world.workspace.id}/projects/{other.project_id}"
        "/integrations/google/authorize",
        headers=world.owner.headers,
    )
    assert stranger_project.status_code == 404


async def test_an_installation_without_a_google_client_answers_a_clear_problem(
    api: httpx.AsyncClient, resources: object, migrated: PostgresServer
) -> None:
    h = Harness(api, resources, FakeGoogle(REDIRECT_URI), migrated)  # type: ignore[arg-type]
    world = await make_world(h)

    response = await start(h, world, world.owner)

    assert response.status_code == 503
    assert response.json()["code"] == "integration_not_configured"
    # The rest of the application is unaffected
    me = await api.get("/api/v1/me", headers=world.owner.headers)
    assert me.status_code == 200


async def test_a_connection_is_made_and_the_person_lands_on_the_property_picker(
    google: Harness,
) -> None:
    world = await make_world(google)
    account = google.fake.account("person@example.com", ACCOUNT_SITES)

    response = await connect(google, world, world.admin, account)

    base, query = location(response)
    assert base == integrations_page(world)
    assert response.headers["cache-control"] == "no-store"
    (row,) = await fetch(
        google.pg,
        "SELECT * FROM fp.connections WHERE id = $1",
        uuid.UUID(query["connection_id"]),
    )
    assert (row["workspace_id"], row["product"], row["auth_method"]) == (
        world.workspace.id,
        "google",
        "oauth",
    )
    assert (row["subject_id"], row["subject_label"], row["status"]) == (
        account.sub,
        "person@example.com",
        "active",
    )
    assert row["connected_by"] == world.admin.user_id
    assert set(row["scopes"]) == {
        "openid",
        "email",
        "https://www.googleapis.com/auth/webmasters.readonly",
        "https://www.googleapis.com/auth/analytics.readonly",
    }
    assert row["credential_ref"] is not None
    assert await _actions(google, world.workspace.id) == ["connection.created"]


async def test_the_refresh_token_is_stored_encrypted_and_nowhere_else(google: Harness) -> None:
    world = await make_world(google)
    account = google.fake.account("person@example.com", ACCOUNT_SITES)

    await connected(google, world, account)

    (secret,) = await fetch(
        google.pg, "SELECT * FROM ops.secrets WHERE workspace_id = $1", world.workspace.id
    )
    assert (secret["kind"], secret["kek_version"]) == ("oauth_refresh_token", 1)
    everything = ""
    for table in ("ops.secrets", "fp.connections", "ops.audit_logs", "core.projects"):
        rows = await fetch(google.pg, f"SELECT t::text FROM {table} t")
        everything += " ".join(row[0] for row in rows)
    assert account.refresh_token not in everything
    assert "ya29" not in everything
    redis = google.resources.redis
    redis_dump = " ".join([str(await redis.get(key)) for key in await redis.keys("*")])
    assert account.refresh_token not in redis_dump
    assert "ya29" not in redis_dump


async def test_no_log_line_holds_a_token_a_code_a_state_or_the_client_secret(
    app_settings: object, migrated: PostgresServer
) -> None:
    async with running(app_settings, migrated) as h:  # type: ignore[arg-type]
        stream = io.StringIO()
        configure_logging(service="api", version="test", level="debug", stream=stream)
        world = await make_world(h)
        account = h.fake.account("person@example.com", ACCOUNT_SITES)
        started = await start(h, world, world.owner)
        query = parts_of(started.json()["data"]["authorization_url"])
        code = h.fake.issue_code(account, challenge=query["code_challenge"])
        await callback(h, world.owner, code=code, state=query["state"])
        connection_id = (
            await fetch(
                h.pg, "SELECT id FROM fp.connections WHERE workspace_id = $1", world.workspace.id
            )
        )[0]["id"]
        await h.api.get(
            f"/api/v1/workspaces/{world.workspace.id}/connections/{connection_id}/properties",
            headers=world.owner.headers,
        )
        await h.api.delete(
            f"/api/v1/workspaces/{world.workspace.id}/connections/{connection_id}",
            headers=world.owner.headers,
        )

    logged = stream.getvalue()
    assert logged, "the flow must have logged something for this check to mean anything"
    for secret in (account.refresh_token, "ya29", CLIENT_SECRET, code, query["state"], "4/fake"):
        assert secret not in logged


async def test_a_second_connection_of_the_same_account_renews_the_first(google: Harness) -> None:
    world = await make_world(google)
    account = google.fake.account("person@example.com", ACCOUNT_SITES)
    first = await connected(google, world, account)
    (old_secret,) = await fetch(
        google.pg, "SELECT id FROM ops.secrets WHERE workspace_id = $1", world.workspace.id
    )
    project_id = world.project_id
    await _link(google, world, first)
    await fetch(
        google.pg,
        "UPDATE fp.connections SET status = 'reauth_required' WHERE id = $1 RETURNING 1",
        uuid.UUID(first),
    )
    await fetch(
        google.pg,
        "UPDATE fp.integrations SET status = 'reauth_required' WHERE project_id = $1 RETURNING 1",
        project_id,
    )

    second = await connected(google, world, account, world.admin)

    assert second == first
    (connection,) = await fetch(
        google.pg, "SELECT * FROM fp.connections WHERE id = $1", uuid.UUID(first)
    )
    assert (connection["status"], connection["connected_by"]) == ("active", world.admin.user_id)
    secrets = await fetch(
        google.pg, "SELECT id FROM ops.secrets WHERE workspace_id = $1", world.workspace.id
    )
    assert [s["id"] for s in secrets] == [connection["credential_ref"]]
    assert secrets[0]["id"] != old_secret["id"]
    (integration,) = await fetch(
        google.pg, "SELECT status FROM fp.integrations WHERE project_id = $1", project_id
    )
    assert integration["status"] == "active"
    assert await _actions(google, world.workspace.id) == [
        "connection.created",
        "connection.reconnected",
    ]


async def _link(h: Harness, world: object, connection_id: str) -> None:
    response = await h.api.post(
        project_url(world, "integrations"),  # type: ignore[arg-type]
        json={
            "connection_id": connection_id,
            "kind": "gsc",
            "external_property": "sc-domain:acme.example",
        },
        headers=world.owner.headers,  # type: ignore[attr-defined]
    )
    assert response.status_code == 201, response.text


async def test_another_account_is_another_connection(google: Harness) -> None:
    world = await make_world(google)
    first = await connected(google, world, google.fake.account("one@example.com"))
    second = await connected(google, world, google.fake.account("two@example.com"))

    assert first != second
    count = await fetch(
        google.pg, "SELECT count(*) FROM fp.connections WHERE workspace_id = $1", world.workspace.id
    )
    assert count[0][0] == 2


async def test_a_state_works_once(google: Harness) -> None:
    world = await make_world(google)
    account = google.fake.account("person@example.com", ACCOUNT_SITES)
    started = await start(google, world, world.owner)
    query = parts_of(started.json()["data"]["authorization_url"])
    code = google.fake.issue_code(account, challenge=query["code_challenge"])

    first = await callback(google, world.owner, code=code, state=query["state"])
    again = await callback(google, world.owner, code=code, state=query["state"])

    assert location(first)[0].endswith("/integrations/google")
    assert location(again) == (BASE_URL + "/", {"integration_error": "invalid_state"})
    assert len(google.fake.called("https://oauth2.googleapis.com/token")) == 1


async def test_a_state_that_expired_is_refused(google: Harness) -> None:
    world = await make_world(google)
    account = google.fake.account("person@example.com")
    started = await start(google, world, world.owner)
    query = parts_of(started.json()["data"]["authorization_url"])
    code = google.fake.issue_code(account, challenge=query["code_challenge"])
    await google.resources.redis.pexpire(_state_key(query["state"]), 1)
    await asyncio.sleep(0.05)

    response = await callback(google, world.owner, code=code, state=query["state"])

    assert location(response) == (BASE_URL + "/", {"integration_error": "invalid_state"})
    assert google.fake.calls == []


@pytest.mark.parametrize("state", ["", "unknown", "x" * 300])
async def test_a_state_nobody_made_is_refused(google: Harness, state: str) -> None:
    world = await make_world(google)

    response = await callback(google, world.owner, code="4/whatever", state=state)

    assert response.status_code == 302 or response.status_code == 422
    if response.status_code == 302:
        assert location(response)[1] == {"integration_error": "invalid_state"}
    assert google.fake.calls == []


async def test_a_callback_without_a_state_is_refused(google: Harness) -> None:
    world = await make_world(google)

    response = await callback(google, world.owner, code="4/whatever")

    assert location(response) == (BASE_URL + "/", {"integration_error": "invalid_state"})


async def test_the_state_must_belong_to_the_callers_session(google: Harness) -> None:
    """Someone who is handed another person's link cannot finish that person's connection, and
    cannot finish theirs on the victim's account either."""
    world = await make_world(google)
    account = google.fake.account("person@example.com")
    started = await start(google, world, world.owner)
    query = parts_of(started.json()["data"]["authorization_url"])
    code = google.fake.issue_code(account, challenge=query["code_challenge"])

    by_admin = await callback(google, world.admin, code=code, state=query["state"])
    by_owner_afterwards = await callback(google, world.owner, code=code, state=query["state"])

    assert location(by_admin)[1] == {"integration_error": "invalid_state"}
    # The state was used up by the wrong session, so the right one cannot reuse it either
    assert location(by_owner_afterwards)[1] == {"integration_error": "invalid_state"}
    assert google.fake.calls == []
    assert await _actions(google, world.workspace.id) == []


async def test_a_callback_without_a_session_or_with_an_unfinished_one_is_refused(
    google: Harness,
) -> None:
    world = await make_world(google)
    account = google.fake.account("person@example.com")
    pending_user = await make_user(google.pg)
    token, _ = await open_session(google.resources, pending_user, state="pending_totp")

    for caller in (None, Caller(pending_user.id, cookie(token))):
        started = await start(google, world, world.owner)
        query = parts_of(started.json()["data"]["authorization_url"])
        code = google.fake.issue_code(account, challenge=query["code_challenge"])
        response = await callback(google, caller, code=code, state=query["state"])
        assert location(response)[1] == {"integration_error": "invalid_state"}
    assert google.fake.calls == []


async def test_someone_who_lost_the_right_in_the_meantime_cannot_finish(google: Harness) -> None:
    world = await make_world(google)
    account = google.fake.account("person@example.com")
    started = await start(google, world, world.admin)
    query = parts_of(started.json()["data"]["authorization_url"])
    code = google.fake.issue_code(account, challenge=query["code_challenge"])
    await fetch(
        google.pg,
        "UPDATE auth.memberships SET role = 'viewer' WHERE user_id = $1 RETURNING 1",
        world.admin.user_id,
    )

    response = await callback(google, world.admin, code=code, state=query["state"])

    assert location(response)[1] == {"integration_error": "invalid_state"}
    assert google.fake.calls == []


async def test_google_adds_parameters_of_its_own_and_they_are_ignored(google: Harness) -> None:
    world = await make_world(google)
    account = google.fake.account("person@example.com")
    started = await start(google, world, world.owner)
    query = parts_of(started.json()["data"]["authorization_url"])
    code = google.fake.issue_code(account, challenge=query["code_challenge"])

    response = await callback(
        google,
        world.owner,
        code=code,
        state=query["state"],
        scope=(
            "email openid https://www.googleapis.com/auth/webmasters.readonly "
            "https://www.googleapis.com/auth/analytics.readonly"
        ),
        authuser="0",
        prompt="consent",
        hd="example.com",
    )

    assert location(response)[0].endswith("/integrations/google")


async def test_a_person_who_declines_consent_is_sent_back_with_scope_denied(
    google: Harness,
) -> None:
    world = await make_world(google)
    started = await start(google, world, world.owner)
    state = parts_of(started.json()["data"]["authorization_url"])["state"]

    response = await callback(google, world.owner, error="access_denied", state=state)

    assert location(response) == (integrations_page(world), {"error": "scope_denied"})
    assert google.fake.calls == []
    assert await _actions(google, world.workspace.id) == []


async def test_a_grant_without_any_product_scope_is_refused_and_given_back(
    google: Harness,
) -> None:
    world = await make_world(google)
    account = google.fake.account("person@example.com")

    response = await connect(google, world, world.owner, account, scopes=("openid", "email"))

    assert location(response) == (integrations_page(world), {"error": "scope_denied"})
    assert not google.fake.alive(account)
    assert len(google.fake.called(REVOKE_URL)) == 1
    count = await fetch(
        google.pg, "SELECT count(*) FROM fp.connections WHERE workspace_id = $1", world.workspace.id
    )
    assert count[0][0] == 0


async def test_a_grant_without_a_refresh_token_is_refused(google: Harness) -> None:
    world = await make_world(google)
    account = google.fake.account("person@example.com")

    response = await connect(google, world, world.owner, account, with_refresh=False)

    assert location(response) == (integrations_page(world), {"error": "no_refresh_token"})
    assert await _actions(google, world.workspace.id) == []


async def test_a_code_google_does_not_accept_is_an_exchange_failure(google: Harness) -> None:
    world = await make_world(google)
    started = await start(google, world, world.owner)
    state = parts_of(started.json()["data"]["authorization_url"])["state"]

    response = await callback(google, world.owner, code="4/never-issued", state=state)

    assert location(response) == (integrations_page(world), {"error": "exchange_failed"})


async def test_a_code_issued_for_another_challenge_cannot_be_exchanged(google: Harness) -> None:
    """The PKCE verifier is the one that went with this state, so a code won on another
    request's challenge is worthless here."""
    world = await make_world(google)
    account = google.fake.account("person@example.com")
    started = await start(google, world, world.owner)
    state = parts_of(started.json()["data"]["authorization_url"])["state"]
    other = parts_of((await start(google, world, world.owner)).json()["data"]["authorization_url"])
    code = google.fake.issue_code(account, challenge=other["code_challenge"])

    response = await callback(google, world.owner, code=code, state=state)

    assert location(response)[1] == {"error": "exchange_failed"}


async def test_an_outage_at_google_is_reported_not_raised(google: Harness) -> None:
    world = await make_world(google)
    started = await start(google, world, world.owner)
    state = parts_of(started.json()["data"]["authorization_url"])["state"]
    google.fake.token_outage = 99

    response = await callback(google, world.owner, code="4/whatever", state=state)

    assert location(response) == (integrations_page(world), {"error": "google_unavailable"})


async def test_a_client_google_rejects_is_reported_as_not_configured(
    app_settings: object, migrated: PostgresServer
) -> None:
    async with running(
        app_settings,  # type: ignore[arg-type]
        migrated,
        google_oauth_client_secret=SecretStr("not-the-secret"),
    ) as h:
        world = await make_world(h)
        account = h.fake.account("person@example.com")

        response = await connect(h, world, world.owner, account)

        assert location(response) == (
            integrations_page(world),
            {"error": "integration_not_configured"},
        )


async def test_the_callback_of_an_installation_without_google_is_refused(
    api: httpx.AsyncClient, resources: object, migrated: PostgresServer
) -> None:
    h = Harness(api, resources, FakeGoogle(REDIRECT_URI), migrated)  # type: ignore[arg-type]
    world = await make_world(h)

    response = await callback(h, world.owner, code="4/x", state="y")

    assert location(response) == (BASE_URL + "/", {"integration_error": "invalid_state"})


async def test_a_workspace_cannot_see_another_workspaces_connection(google: Harness) -> None:
    world = await make_world(google)
    other = await make_world(google)
    connection_id = await connected(google, world, google.fake.account("person@example.com"))

    seen = await google.api.get(
        f"/api/v1/workspaces/{other.workspace.id}/connections", headers=other.owner.headers
    )
    probed = await google.api.get(
        f"/api/v1/workspaces/{other.workspace.id}/connections/{connection_id}/properties",
        headers=other.owner.headers,
    )

    assert seen.json()["data"] == []
    assert probed.status_code == 404
