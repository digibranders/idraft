"""Invitation routes (docs/19 section 3.2.2)."""

import asyncio
import io
import json
import re
import unicodedata
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from sightline.api.auth.throttle import LoginThrottle, ThrottleUnavailableError
from sightline.api.auth.tokens import hash_token
from sightline.api.permissions import Role
from sightline.api.problems import ForbiddenError, NotFoundError
from sightline.api.request_info import RequestInfo
from sightline.api.resources import Resources
from sightline.api.workspaces import invitations as invitation_rules
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.config.logging import configure_logging
from sightline.providers.email import EmailMessage
from tests.api.auth.support import (
    PASSWORD,
    RecordingEmailSender,
    User,
    Workspace,
    add_member,
    cookie,
    execute,
    fetch,
    fetchrow,
    make_user,
    make_workspace,
    new_email,
    open_session,
)
from tests.api.workspaces.support import make_project
from tests.conftest import BASE_URL, PostgresServer

ACCEPT = "/api/v1/invitations/accept"
LINK = re.compile(re.escape(BASE_URL) + r"/invite#token=([A-Za-z0-9_-]{43})\n")


def _invitations(workspace: Workspace) -> str:
    return f"/api/v1/workspaces/{workspace.id}/invitations"


def _problem(response: httpx.Response) -> tuple[int, str]:
    return response.status_code, response.json()["code"]


async def _member(
    resources: Resources,
    pg: PostgresServer,
    workspace: Workspace,
    role: str,
    *,
    name: str = "Ann",
    fresh: bool = True,
) -> tuple[User, dict[str, str]]:
    user = await make_user(pg, name=name)
    await add_member(pg, workspace, user, role)
    token, _ = await open_session(resources, user, fresh=fresh)
    return user, cookie(token)


async def _signed_in(resources: Resources, user: User) -> dict[str, str]:
    token, _ = await open_session(resources, user)
    return cookie(token)


async def _invite(
    api: httpx.AsyncClient,
    mailbox: RecordingEmailSender,
    workspace: Workspace,
    headers: dict[str, str],
    email: str,
    **body: object,
) -> tuple[str, str]:
    """Send an invitation. Returns its id and the token from the emailed link."""
    response = await api.post(
        _invitations(workspace), json={"email": email, "role": "viewer", **body}, headers=headers
    )
    assert response.status_code == 201, response.text
    match = LINK.search(mailbox.messages[-1].text)
    assert match is not None
    return response.json()["data"]["invitation_id"], match.group(1)


async def _status(pg: PostgresServer, invitation_id: str) -> str:
    row = await fetchrow(
        pg, "SELECT status FROM auth.invitations WHERE id = $1", uuid.UUID(invitation_id)
    )
    status: str = row["status"]
    return status


# -------------------------------------------------------------------------------------------------
# Create


async def test_an_invitation_is_emailed_as_a_link_and_stored_as_a_hash(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
) -> None:
    workspace = await make_workspace(migrated, name="Acme https://evil.example/x")
    inviter, headers = await _member(resources, migrated, workspace, "admin", name="Ann <b>")
    email = new_email()

    response = await api.post(
        _invitations(workspace), json={"email": email, "role": "analyst"}, headers=headers
    )

    assert response.status_code == 201
    data = response.json()["data"]
    assert data == {
        "invitation_id": data["invitation_id"],
        "email": email,
        "role": "analyst",
        "project_ids": None,
        "status": "pending",
        "invited_by": {"user_id": str(inviter.id), "name": "Ann <b>", "email": inviter.email},
        "expires_at": data["expires_at"],
        "created_at": data["created_at"],
    }
    lifetime = datetime.fromisoformat(data["expires_at"]) - datetime.now(UTC)
    assert timedelta(days=6, hours=23) < lifetime <= timedelta(days=7)

    (message,) = mailbox.messages
    assert message.to == email
    match = LINK.search(message.text)
    assert match is not None
    token = match.group(1)
    # The first sentence is ours. What the inviter typed is reduced to plain words, quoted and
    # labelled, so it cannot put a link in the message or make it say something of its own.
    assert message.text.startswith(
        "Hello,\n\nYou have been invited to a workspace on Sightline.\n\n"
        'Workspace: "Acme https evil example x"\n'
        f'Invited by: "Ann b" ({inviter.email})\n'
        f"Invited address: {email}\n"
        "Role: analyst\n\n"
        "Accept the invitation:\n\n"
    )
    assert "evil.example" not in message.text
    assert "The link works for 7 days, and only for an account with the invited address." in (
        message.text
    )
    # The token is in the email and nowhere else: not in the response, not in the database.
    assert token not in response.text
    row = await fetchrow(
        migrated,
        "SELECT token_hash, status FROM auth.invitations WHERE id = $1",
        uuid.UUID(data["invitation_id"]),
    )
    assert bytes(row["token_hash"]) == hash_token(token)
    (entry,) = await fetch(
        migrated, "SELECT * FROM ops.audit_logs WHERE workspace_id = $1", workspace.id
    )
    assert (entry["action"], entry["actor_id"], entry["target_id"]) == (
        "invitation.created",
        str(inviter.id),
        data["invitation_id"],
    )
    assert entry["after"] == f'{{"role": "analyst", "email": "{email}", "project_ids": null}}'
    assert token not in str(dict(entry))


async def test_inviting_needs_the_permission(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
) -> None:
    workspace, other = await make_workspace(migrated), await make_workspace(migrated)
    _, editor = await _member(resources, migrated, workspace, "editor")
    _, stranger = await _member(resources, migrated, other, "owner")
    body = {"email": new_email(), "role": "viewer"}

    assert _problem(await api.post(_invitations(workspace), json=body, headers=editor)) == (
        403,
        "forbidden",
    )
    assert _problem(await api.get(_invitations(workspace), headers=editor)) == (403, "forbidden")
    assert _problem(await api.post(_invitations(workspace), json=body, headers=stranger)) == (
        404,
        "not_found",
    )
    assert mailbox.messages == []


async def test_only_an_owner_invites_an_owner(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
) -> None:
    workspace = await make_workspace(migrated)
    _, admin = await _member(resources, migrated, workspace, "admin")
    _, owner = await _member(resources, migrated, workspace, "owner")
    url = _invitations(workspace)

    refused = await api.post(url, json={"email": new_email(), "role": "owner"}, headers=admin)
    allowed = await api.post(url, json={"email": new_email(), "role": "owner"}, headers=owner)

    assert _problem(refused) == (403, "forbidden")
    assert allowed.status_code == 201
    assert len(mailbox.messages) == 1


async def test_an_address_is_invited_once_and_a_member_not_at_all(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
) -> None:
    workspace, other = await make_workspace(migrated), await make_workspace(migrated)
    member, headers = await _member(resources, migrated, workspace, "owner")
    _, other_headers = await _member(resources, migrated, other, "owner")
    email = new_email()
    await _invite(api, mailbox, workspace, headers, email)

    again = await api.post(
        _invitations(workspace), json={"email": email.upper(), "role": "viewer"}, headers=headers
    )
    existing = await api.post(
        _invitations(workspace),
        json={"email": member.email.upper(), "role": "viewer"},
        headers=headers,
    )

    assert _problem(again) == _problem(existing) == (409, "duplicate")
    assert len(mailbox.messages) == 1
    # The same address can be invited to another workspace.
    await _invite(api, mailbox, other, other_headers, email)


async def test_an_invitation_past_its_date_can_be_replaced(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
) -> None:
    workspace = await make_workspace(migrated)
    _, headers = await _member(resources, migrated, workspace, "owner")
    email = new_email()
    first, _ = await _invite(api, mailbox, workspace, headers, email)
    await execute(
        migrated,
        "UPDATE auth.invitations SET expires_at = now() - interval '1 minute' WHERE id = $1",
        uuid.UUID(first),
    )

    second, _ = await _invite(api, mailbox, workspace, headers, email)

    assert second != first
    assert (await _status(migrated, first), await _status(migrated, second)) == (
        "expired",
        "pending",
    )


async def test_a_scope_suits_the_role_and_names_projects_of_the_workspace(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
) -> None:
    workspace, other = await make_workspace(migrated), await make_workspace(migrated)
    mine, theirs = (
        await make_project(migrated, workspace.id),
        await make_project(migrated, other.id),
    )
    _, headers = await _member(resources, migrated, workspace, "owner")
    url = _invitations(workspace)

    foreign = await api.post(
        url,
        json={"email": new_email(), "role": "viewer", "project_ids": [str(theirs)]},
        headers=headers,
    )
    managing = await api.post(
        url,
        json={"email": new_email(), "role": "admin", "project_ids": [str(mine)]},
        headers=headers,
    )
    scoped = await api.post(
        url,
        json={"email": new_email(), "role": "viewer", "project_ids": [str(mine)]},
        headers=headers,
    )

    assert [error["code"] for error in foreign.json()["errors"]] == ["project_unknown"]
    assert [error["code"] for error in managing.json()["errors"]] == ["scope_not_allowed"]
    assert scoped.status_code == 201
    assert scoped.json()["data"]["project_ids"] == [str(mine)]
    assert len(mailbox.messages) == 1


@pytest.mark.parametrize(
    "body",
    [
        {"email": "not-an-address", "role": "viewer"},
        {"email": "a@client.example", "role": "superuser"},
        {"email": "a@client.example"},
        {"role": "viewer"},
        {"email": "a@client.example", "role": "viewer", "token": "x"},
    ],
)
async def test_a_malformed_invitation_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, body: dict[str, object]
) -> None:
    workspace = await make_workspace(migrated)
    _, headers = await _member(resources, migrated, workspace, "owner")
    response = await api.post(_invitations(workspace), json=body, headers=headers)
    assert _problem(response) == (422, "validation_failed")


async def test_invitations_are_limited_per_inviter_and_per_workspace(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(invitation_rules, "INVITATIONS_PER_HOUR_PER_INVITER", 2)
    monkeypatch.setattr(invitation_rules, "INVITATIONS_PER_HOUR_PER_WORKSPACE", 3)
    workspace = await make_workspace(migrated)
    _, first = await _member(resources, migrated, workspace, "owner")
    _, second = await _member(resources, migrated, workspace, "admin")

    async def invite(headers: dict[str, str]) -> httpx.Response:
        return await api.post(
            _invitations(workspace), json={"email": new_email(), "role": "viewer"}, headers=headers
        )

    assert [(await invite(first)).status_code for _ in range(3)] == [201, 201, 429]
    # The second inviter has their own allowance, and the workspace has one left.
    responses = [await invite(second) for _ in range(2)]
    assert [response.status_code for response in responses] == [201, 429]
    limited = responses[-1]
    assert limited.json()["code"] == "rate_limited"
    assert (limited.headers["Retry-After"], limited.json()["retry_after_seconds"]) == ("3600", 3600)
    assert len(mailbox.messages) == 3


async def test_no_invitation_is_sent_when_attempts_cannot_be_counted(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def unavailable(self: object, *args: object, **kwargs: object) -> bool:
        raise ThrottleUnavailableError

    workspace = await make_workspace(migrated)
    _, headers = await _member(resources, migrated, workspace, "owner")
    monkeypatch.setattr(LoginThrottle, "allow", unavailable)

    response = await api.post(
        _invitations(workspace), json={"email": new_email(), "role": "viewer"}, headers=headers
    )

    assert _problem(response) == (503, "service_unavailable")
    assert mailbox.messages == []
    assert (
        await fetch(
            migrated, "SELECT 1 FROM auth.invitations WHERE workspace_id = $1", workspace.id
        )
        == []
    )


async def test_an_email_that_cannot_be_sent_is_logged_and_the_invitation_stays(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    class Broken:
        async def send(self, message: EmailMessage) -> None:
            raise RuntimeError("provider is down")

    workspace = await make_workspace(migrated)
    _, headers = await _member(resources, migrated, workspace, "owner")
    resources.invitations._email = Broken()
    stream = io.StringIO()
    configure_logging(service="api", version="test", level="info", stream=stream)

    response = await api.post(
        _invitations(workspace), json={"email": new_email(), "role": "viewer"}, headers=headers
    )

    assert response.status_code == 201
    (line,) = [
        json.loads(line) for line in stream.getvalue().splitlines() if "email was not sent" in line
    ]
    assert (line["error_kind"], line["level"]) == ("RuntimeError", "error")
    # The invitation exists, so the inviter can withdraw it and send another.
    assert await _status(migrated, response.json()["data"]["invitation_id"]) == "pending"


# -------------------------------------------------------------------------------------------------
# List and cancel


async def test_the_list_shows_this_workspaces_invitations_newest_first(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
) -> None:
    workspace, other = await make_workspace(migrated), await make_workspace(migrated)
    _, headers = await _member(resources, migrated, workspace, "admin")
    _, other_headers = await _member(resources, migrated, other, "owner")
    stale, _ = await _invite(api, mailbox, workspace, headers, new_email())
    withdrawn, _ = await _invite(api, mailbox, workspace, headers, new_email())
    open_one, _ = await _invite(api, mailbox, workspace, headers, new_email())
    elsewhere, _ = await _invite(api, mailbox, other, other_headers, new_email())
    await execute(
        migrated,
        "UPDATE auth.invitations SET expires_at = now() - interval '1 minute' WHERE id = $1",
        uuid.UUID(stale),
    )
    assert (await api.delete(f"{_invitations(workspace)}/{withdrawn}", headers=headers)).is_success

    response = await api.get(_invitations(workspace), headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["page"] == {"offset": 0, "limit": 50, "total": 3}
    assert [(item["invitation_id"], item["status"]) for item in body["data"]] == [
        (open_one, "pending"),
        (withdrawn, "cancelled"),
        # Past its date, though no row says so yet.
        (stale, "expired"),
    ]
    assert elsewhere not in response.text
    assert "token" not in response.text
    paged = await api.get(
        _invitations(workspace), params={"offset": 2, "limit": 5}, headers=headers
    )
    assert [item["invitation_id"] for item in paged.json()["data"]] == [stale]


async def test_a_withdrawn_invitation_stops_working(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
) -> None:
    workspace, other = await make_workspace(migrated), await make_workspace(migrated)
    actor, headers = await _member(resources, migrated, workspace, "admin")
    _, other_headers = await _member(resources, migrated, other, "owner")
    invitee = await make_user(migrated)
    invitation_id, token = await _invite(api, mailbox, workspace, headers, invitee.email)
    url = f"{_invitations(workspace)}/{invitation_id}"

    # From another workspace the invitation does not exist.
    assert _problem(
        await api.delete(f"{_invitations(other)}/{invitation_id}", headers=other_headers)
    ) == (
        404,
        "not_found",
    )
    first = await api.delete(url, headers=headers)
    second = await api.delete(url, headers=headers)

    assert (first.status_code, second.status_code) == (204, 204)
    assert await _status(migrated, invitation_id) == "cancelled"
    accept = await api.post(
        ACCEPT, json={"token": token}, headers=await _signed_in(resources, invitee)
    )
    assert _problem(accept) == (400, "invalid_token")
    actions = await fetch(
        migrated,
        "SELECT action, actor_id, target_id FROM ops.audit_logs WHERE workspace_id = $1 "
        "ORDER BY id",
        workspace.id,
    )
    assert [(row["action"], row["actor_id"], row["target_id"]) for row in actions] == [
        ("invitation.created", str(actor.id), invitation_id),
        ("invitation.cancelled", str(actor.id), invitation_id),
    ]
    missing = await api.delete(f"{_invitations(workspace)}/{uuid.uuid4()}", headers=headers)
    assert _problem(missing) == (404, "not_found")


async def test_an_accepted_invitation_cannot_be_withdrawn(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
) -> None:
    workspace = await make_workspace(migrated)
    _, headers = await _member(resources, migrated, workspace, "owner")
    invitee = await make_user(migrated)
    invitation_id, token = await _invite(api, mailbox, workspace, headers, invitee.email)
    accepted = await api.post(
        ACCEPT, json={"token": token}, headers=await _signed_in(resources, invitee)
    )
    assert accepted.status_code == 200

    response = await api.delete(f"{_invitations(workspace)}/{invitation_id}", headers=headers)

    assert _problem(response) == (409, "invalid_state_transition")
    assert await _status(migrated, invitation_id) == "accepted"


# -------------------------------------------------------------------------------------------------
# Accept


async def test_accepting_joins_the_workspace_with_the_invited_role_and_scope(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
) -> None:
    workspace = await make_workspace(migrated)
    kept, deleted = (
        await make_project(migrated, workspace.id),
        await make_project(migrated, workspace.id),
    )
    _, headers = await _member(resources, migrated, workspace, "owner")
    invitee = await make_user(migrated, name="Bo")
    invitee_headers = await _signed_in(resources, invitee)
    invitation_id, token = await _invite(
        api,
        mailbox,
        workspace,
        headers,
        # Addresses compare the way the database compares them, not byte for byte.
        invitee.email.upper(),
        role="analyst",
        project_ids=[str(kept), str(deleted)],
    )
    await execute(migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", deleted)
    assert _problem(
        await api.get(f"/api/v1/workspaces/{workspace.id}", headers=invitee_headers)
    ) == (
        404,
        "not_found",
    )

    response = await api.post(ACCEPT, json={"token": token}, headers=invitee_headers)

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["workspace"] == {
        "workspace_id": str(workspace.id),
        "name": workspace.name,
        "slug": workspace.slug,
    }
    member = data["member"]
    assert (member["user"]["user_id"], member["role"], member["project_ids"]) == (
        str(invitee.id),
        "analyst",
        # The project deleted since the invitation was sent is left out.
        [str(kept)],
    )
    assert await _status(migrated, invitation_id) == "accepted"
    assert (await api.get(f"/api/v1/workspaces/{workspace.id}", headers=invitee_headers)).is_success
    entry = await fetchrow(
        migrated,
        "SELECT actor_id, target_id, after::text FROM ops.audit_logs "
        "WHERE workspace_id = $1 AND action = 'invitation.accepted'",
        workspace.id,
    )
    assert (entry["actor_id"], entry["target_id"]) == (str(invitee.id), invitation_id)
    assert entry["after"] == (
        f'{{"role": "analyst", "project_ids": ["{kept}"], "already_member": false}}'
    )

    # Accepting again is answered with the same membership and changes nothing.
    again = await api.post(ACCEPT, json={"token": token}, headers=invitee_headers)
    assert again.status_code == 200
    assert again.json()["data"] == data
    rows = await fetch(migrated, "SELECT 1 FROM auth.memberships WHERE user_id = $1", invitee.id)
    assert len(rows) == 1


async def test_two_accepts_at_once_make_one_membership(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
) -> None:
    workspace = await make_workspace(migrated)
    _, headers = await _member(resources, migrated, workspace, "owner")
    invitee = await make_user(migrated)
    invitee_headers = await _signed_in(resources, invitee)
    _, token = await _invite(api, mailbox, workspace, headers, invitee.email)

    responses = await asyncio.gather(
        *(api.post(ACCEPT, json={"token": token}, headers=invitee_headers) for _ in range(4))
    )

    assert [response.status_code for response in responses] == [200, 200, 200, 200]
    rows = await fetch(migrated, "SELECT role FROM auth.memberships WHERE user_id = $1", invitee.id)
    assert [row["role"] for row in rows] == ["viewer"]
    accepted = await fetch(
        migrated,
        "SELECT 1 FROM ops.audit_logs WHERE workspace_id = $1 AND action = 'invitation.accepted'",
        workspace.id,
    )
    assert len(accepted) == 1


async def test_a_token_works_only_for_the_address_it_was_sent_to(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
) -> None:
    workspace = await make_workspace(migrated)
    _, headers = await _member(resources, migrated, workspace, "owner")
    invitee, thief = await make_user(migrated), await make_user(migrated)
    invitation_id, token = await _invite(api, mailbox, workspace, headers, invitee.email)
    thief_headers = await _signed_in(resources, thief)

    stolen = await api.post(ACCEPT, json={"token": token}, headers=thief_headers)
    unknown = await api.post(ACCEPT, json={"token": "x" * 43}, headers=thief_headers)
    anonymous = await api.post(ACCEPT, json={"token": token})

    # The same answer for a real token and an invented one: a token tells a stranger nothing.
    assert _problem(stolen) == _problem(unknown) == (400, "invalid_token")
    assert _problem(anonymous) == (401, "unauthenticated")
    assert await _status(migrated, invitation_id) == "pending"
    assert (
        await fetch(migrated, "SELECT 1 FROM auth.memberships WHERE user_id = $1", thief.id) == []
    )


async def test_an_invitation_past_its_date_says_so_to_its_addressee(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
) -> None:
    workspace = await make_workspace(migrated)
    _, headers = await _member(resources, migrated, workspace, "owner")
    invitee, other = await make_user(migrated), await make_user(migrated)
    invitation_id, token = await _invite(api, mailbox, workspace, headers, invitee.email)
    await execute(
        migrated,
        "UPDATE auth.invitations SET expires_at = now() - interval '1 second' WHERE id = $1",
        uuid.UUID(invitation_id),
    )

    expired = await api.post(
        ACCEPT, json={"token": token}, headers=await _signed_in(resources, invitee)
    )
    stranger = await api.post(
        ACCEPT, json={"token": token}, headers=await _signed_in(resources, other)
    )

    assert _problem(expired) == (410, "invitation_expired")
    assert _problem(stranger) == (400, "invalid_token")
    assert (
        await fetch(migrated, "SELECT 1 FROM auth.memberships WHERE user_id = $1", invitee.id) == []
    )


async def test_accepting_needs_a_verified_address_and_a_usable_account(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
) -> None:
    workspace = await make_workspace(migrated)
    _, headers = await _member(resources, migrated, workspace, "owner")
    unverified = await make_user(migrated, verified=False)
    disabled = await make_user(migrated)
    _, unverified_token = await _invite(api, mailbox, workspace, headers, unverified.email)
    _, disabled_token = await _invite(api, mailbox, workspace, headers, disabled.email)
    disabled_headers = await _signed_in(resources, disabled)
    assert (await api.get("/api/v1/me", headers=disabled_headers)).is_success  # now cached
    await execute(migrated, "UPDATE auth.users SET disabled_at = now() WHERE id = $1", disabled.id)

    first = await api.post(
        ACCEPT, json={"token": unverified_token}, headers=await _signed_in(resources, unverified)
    )
    second = await api.post(ACCEPT, json={"token": disabled_token}, headers=disabled_headers)

    assert _problem(first) == (403, "email_not_verified")
    assert _problem(second) == (401, "unauthenticated")
    members = await fetch(
        migrated,
        "SELECT 1 FROM auth.memberships WHERE user_id = ANY($1::uuid[])",
        [unverified.id, disabled.id],
    )
    assert members == []


async def test_an_invitation_to_a_workspace_that_is_going_or_suspended_cannot_be_accepted(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
) -> None:
    going, suspended = await make_workspace(migrated), await make_workspace(migrated)
    invitee = await make_user(migrated)
    invitee_headers = await _signed_in(resources, invitee)
    tokens = {}
    for workspace, status in ((going, "deleting"), (suspended, "suspended")):
        _, headers = await _member(resources, migrated, workspace, "owner")
        _, tokens[status] = await _invite(api, mailbox, workspace, headers, invitee.email)
        await execute(
            migrated, "UPDATE auth.workspaces SET status = $2 WHERE id = $1", workspace.id, status
        )

    gone = await api.post(ACCEPT, json={"token": tokens["deleting"]}, headers=invitee_headers)
    held = await api.post(ACCEPT, json={"token": tokens["suspended"]}, headers=invitee_headers)

    assert _problem(gone) == (400, "invalid_token")
    assert _problem(held) == (403, "workspace_suspended")
    assert (
        await fetch(migrated, "SELECT 1 FROM auth.memberships WHERE user_id = $1", invitee.id) == []
    )


async def test_a_new_person_registers_with_the_link_signs_in_and_joins(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
) -> None:
    workspace = await make_workspace(migrated, name="Acme")
    _, headers = await _member(resources, migrated, workspace, "owner")
    email = new_email()
    _, token = await _invite(api, mailbox, workspace, headers, email, role="editor")

    registered = await api.post(
        "/api/v1/auth/register",
        json={
            "name": "New Person",
            "email": email,
            "password": PASSWORD,
            "invitation_token": token,
        },
    )
    signed_in = await api.post("/api/v1/auth/sign-in", json={"email": email, "password": PASSWORD})
    session = {"Cookie": signed_in.headers["set-cookie"].split(";")[0]}
    joined = await api.post(ACCEPT, json={"token": token}, headers=session)
    me = await api.get("/api/v1/me", headers=session)

    assert (registered.status_code, registered.json()["email_verified"]) == (201, True)
    assert signed_in.status_code == 200
    assert (joined.status_code, joined.json()["data"]["member"]["role"]) == (200, "editor")
    (membership,) = me.json()["data"]["memberships"]
    assert (membership["workspace"]["workspace_id"], membership["role"]) == (
        str(workspace.id),
        "editor",
    )


async def test_someone_who_already_belongs_keeps_the_membership_they_have(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
) -> None:
    workspace = await make_workspace(migrated)
    _, headers = await _member(resources, migrated, workspace, "owner")
    invitee = await make_user(migrated)
    invitation_id, token = await _invite(
        api, mailbox, workspace, headers, invitee.email, role="admin"
    )
    # Added by another route between the invitation and its acceptance.
    await add_member(migrated, workspace, invitee, "viewer")

    response = await api.post(
        ACCEPT, json={"token": token}, headers=await _signed_in(resources, invitee)
    )

    assert (response.status_code, response.json()["data"]["member"]["role"]) == (200, "viewer")
    assert await _status(migrated, invitation_id) == "accepted"
    # The record says what the member holds, not what the invitation offered.
    entry = await fetchrow(
        migrated,
        "SELECT after::text FROM ops.audit_logs "
        "WHERE workspace_id = $1 AND action = 'invitation.accepted'",
        workspace.id,
    )
    assert entry["after"] == '{"role": "viewer", "project_ids": null, "already_member": true}'


# -------------------------------------------------------------------------------------------------
# What the review of these routes asked for


async def test_inviting_someone_to_manage_the_workspace_needs_a_fresh_session(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
) -> None:
    workspace = await make_workspace(migrated)
    _, stale = await _member(resources, migrated, workspace, "owner", fresh=False)
    url = _invitations(workspace)

    for role in ("owner", "admin"):
        refused = await api.post(url, json={"email": new_email(), "role": role}, headers=stale)
        assert _problem(refused) == (403, "fresh_session_required")
        assert refused.json()["reauth_url"] == "/api/v1/me/reauthenticate"
    allowed = await api.post(url, json={"email": new_email(), "role": "editor"}, headers=stale)

    assert allowed.status_code == 201
    assert len(mailbox.messages) == 1


@pytest.mark.parametrize(
    ("invited", "change"),
    [
        ("viewer", "DELETE FROM auth.memberships WHERE user_id = $1"),
        ("viewer", "UPDATE auth.memberships SET role = 'editor' WHERE user_id = $1"),
        ("viewer", "UPDATE auth.users SET disabled_at = now() WHERE id = $1"),
        # Still manages members, and can no longer grant what the invitation offers.
        ("owner", "UPDATE auth.memberships SET role = 'admin' WHERE user_id = $1"),
    ],
)
async def test_an_invitation_is_void_once_its_sender_could_no_longer_send_it(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
    invited: str,
    change: str,
) -> None:
    """The grant happens when the invitation is accepted, so that is when it is judged. The
    change is made behind the API's back: through the API it withdraws the invitation."""
    workspace = await make_workspace(migrated)
    inviter, headers = await _member(resources, migrated, workspace, "owner")
    await _member(resources, migrated, workspace, "owner")
    invitee = await make_user(migrated)
    invitation_id, token = await _invite(
        api, mailbox, workspace, headers, invitee.email, role=invited
    )
    await execute(migrated, change, inviter.id)

    response = await api.post(
        ACCEPT, json={"token": token}, headers=await _signed_in(resources, invitee)
    )

    assert _problem(response) == (400, "invalid_token")
    assert (
        await fetch(migrated, "SELECT 1 FROM auth.memberships WHERE user_id = $1", invitee.id) == []
    )
    assert await _status(migrated, invitation_id) == "pending"


async def test_the_inviters_role_is_read_again_when_the_invitation_is_made(
    resources: Resources, migrated: PostgresServer, mailbox: RecordingEmailSender
) -> None:
    """The dependency read the role in an earlier transaction; it may be out of date by now."""
    workspace = await make_workspace(migrated)
    inviter = await make_user(migrated)
    await add_member(migrated, workspace, inviter, "owner")
    await add_member(migrated, workspace, await make_user(migrated), "owner")
    _, session = await open_session(resources, inviter, fresh=True)
    stale = WorkspaceAccess(
        session=session, workspace_id=workspace.id, role=Role.OWNER, project_ids=None
    )
    info = RequestInfo(ip=None, user_agent=None, request_id=None)

    async def invite(role: Role) -> None:
        await resources.invitations.create(
            access=stale, email=new_email(), role=role, project_ids=None, info=info
        )

    await execute(
        migrated, "UPDATE auth.memberships SET role = 'admin' WHERE user_id = $1", inviter.id
    )
    with pytest.raises(ForbiddenError, match="Only an owner"):
        await invite(Role.OWNER)
    await execute(
        migrated, "UPDATE auth.memberships SET role = 'editor' WHERE user_id = $1", inviter.id
    )
    with pytest.raises(ForbiddenError):
        await invite(Role.VIEWER)
    await execute(migrated, "DELETE FROM auth.memberships WHERE user_id = $1", inviter.id)
    with pytest.raises(NotFoundError):
        await invite(Role.VIEWER)
    assert mailbox.messages == []
    assert (
        await fetch(
            migrated, "SELECT 1 FROM auth.invitations WHERE workspace_id = $1", workspace.id
        )
        == []
    )


async def test_one_address_gets_only_so_many_invitations_an_hour(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
) -> None:
    """From any number of workspaces, and however often an invitation is withdrawn and sent
    again."""
    email = new_email()
    statuses = []
    for _ in range(2):
        workspace = await make_workspace(migrated)
        _, headers = await _member(resources, migrated, workspace, "owner")
        for _ in range(2):
            response = await api.post(
                _invitations(workspace),
                json={"email": email.upper(), "role": "viewer"},
                headers=headers,
            )
            statuses.append(response.status_code)
            if response.status_code == 201:
                invitation_id = response.json()["data"]["invitation_id"]
                await api.delete(f"{_invitations(workspace)}/{invitation_id}", headers=headers)

    assert statuses == [201, 201, 201, 429]
    assert len(mailbox.messages) == 3
    # The refused invitation was not kept.
    rows = await fetch(migrated, "SELECT status FROM auth.invitations WHERE email = $1", email)
    assert [row["status"] for row in rows] == ["cancelled", "cancelled", "cancelled"]


async def test_an_attempt_that_is_refused_costs_no_allowance(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(invitation_rules, "INVITATIONS_PER_HOUR_PER_INVITER", 2)
    workspace = await make_workspace(migrated)
    member, headers = await _member(resources, migrated, workspace, "owner")
    url = _invitations(workspace)
    first = new_email()
    await _invite(api, mailbox, workspace, headers, first)

    refused = [
        await api.post(url, json={"email": first, "role": "viewer"}, headers=headers),
        await api.post(url, json={"email": member.email, "role": "viewer"}, headers=headers),
        await api.post(
            url,
            json={"email": new_email(), "role": "viewer", "project_ids": [str(uuid.uuid4())]},
            headers=headers,
        ),
    ]
    second = await api.post(url, json={"email": new_email(), "role": "viewer"}, headers=headers)
    third = await api.post(url, json={"email": new_email(), "role": "viewer"}, headers=headers)

    assert [response.status_code for response in refused] == [409, 409, 422]
    assert (second.status_code, third.status_code) == (201, 429)


async def test_an_empty_scope_stays_empty_when_the_invitation_is_accepted(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
) -> None:
    workspace = await make_workspace(migrated)
    only = await make_project(migrated, workspace.id)
    _, headers = await _member(resources, migrated, workspace, "owner")
    invitee = await make_user(migrated)
    _, token = await _invite(
        api, mailbox, workspace, headers, invitee.email, project_ids=[str(only)]
    )
    await execute(migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", only)

    response = await api.post(
        ACCEPT, json={"token": token}, headers=await _signed_in(resources, invitee)
    )

    # Losing its only project must not turn a limited membership into an unlimited one.
    assert response.json()["data"]["member"]["project_ids"] == []
    row = await fetchrow(
        migrated, "SELECT project_ids FROM auth.memberships WHERE user_id = $1", invitee.id
    )
    assert row["project_ids"] == []


async def test_an_accepted_token_is_spent_once_the_member_has_left(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
) -> None:
    workspace = await make_workspace(migrated)
    _, headers = await _member(resources, migrated, workspace, "owner")
    invitee = await make_user(migrated)
    invitee_headers = await _signed_in(resources, invitee)
    _, token = await _invite(api, mailbox, workspace, headers, invitee.email)
    assert (await api.post(ACCEPT, json={"token": token}, headers=invitee_headers)).is_success
    await execute(migrated, "DELETE FROM auth.memberships WHERE user_id = $1", invitee.id)

    again = await api.post(ACCEPT, json={"token": token}, headers=invitee_headers)

    assert _problem(again) == (400, "invalid_token")
    assert (
        await fetch(migrated, "SELECT 1 FROM auth.memberships WHERE user_id = $1", invitee.id) == []
    )


async def test_an_invitation_past_its_date_cannot_be_withdrawn_either(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
) -> None:
    """It shows as expired in the list, so it is treated as expired everywhere."""
    workspace = await make_workspace(migrated)
    _, headers = await _member(resources, migrated, workspace, "owner")
    invitation_id, _ = await _invite(api, mailbox, workspace, headers, new_email())
    await execute(
        migrated,
        "UPDATE auth.invitations SET expires_at = now() - interval '1 minute' WHERE id = $1",
        uuid.UUID(invitation_id),
    )

    response = await api.delete(f"{_invitations(workspace)}/{invitation_id}", headers=headers)

    assert _problem(response) == (409, "invalid_state_transition")
    assert "expired" in response.json()["detail"]


async def test_an_address_has_one_spelling(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
) -> None:
    """A composed and a decomposed accent are the same address."""
    workspace = await make_workspace(migrated)
    _, headers = await _member(resources, migrated, workspace, "owner")
    local = f"jos\u00e9-{uuid.uuid4().hex[:8]}"
    composed = f"{local}@client.example"
    decomposed = unicodedata.normalize("NFD", composed)
    assert composed != decomposed

    first = await api.post(
        _invitations(workspace), json={"email": decomposed, "role": "viewer"}, headers=headers
    )
    second = await api.post(
        _invitations(workspace), json={"email": composed, "role": "viewer"}, headers=headers
    )

    assert (first.status_code, first.json()["data"]["email"]) == (201, composed)
    assert _problem(second) == (409, "duplicate")


async def test_an_address_is_measured_in_the_spelling_that_is_stored(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
) -> None:
    """Composing can make a string longer: U+0958 becomes two characters. The length limit is
    checked on the result, or an address too long for the sender would be stored."""
    workspace = await make_workspace(migrated)
    _, headers = await _member(resources, migrated, workspace, "owner")
    address = "\u0958" * 200 + "@client.example"
    assert len(address) < 254 < len(unicodedata.normalize("NFC", address))

    response = await api.post(
        _invitations(workspace), json={"email": address, "role": "viewer"}, headers=headers
    )
    registered = await api.post(
        "/api/v1/auth/register",
        json={"name": "N", "email": address, "password": PASSWORD, "invitation_token": "x" * 43},
    )

    assert _problem(response) == _problem(registered) == (422, "validation_failed")
    assert [error["path"] for error in response.json()["errors"]] == ["email"]
    assert mailbox.messages == []
    assert (
        await fetch(
            migrated, "SELECT 1 FROM auth.invitations WHERE workspace_id = $1", workspace.id
        )
        == []
    )
