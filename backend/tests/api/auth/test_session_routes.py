"""The session list and revocation routes, and the profile update (docs/19 section 3.1)."""

import uuid

import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.auth.support import (
    audit_actions,
    cookie,
    execute,
    fetchrow,
    make_user,
    open_session,
)
from tests.conftest import PostgresServer

SESSIONS = "/api/v1/auth/sessions"
OTHERS = "/api/v1/auth/sessions/revoke-others"
CURRENT = "/api/v1/_probe/current"
ME = "/api/v1/me"


async def test_the_list_shows_only_the_callers_live_sessions(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user, stranger = await make_user(migrated), await make_user(migrated)
    mine, current = await open_session(resources, user)
    _, second = await open_session(resources, user)
    _, revoked = await open_session(resources, user)
    _, expired = await open_session(resources, user)
    _, pending = await open_session(resources, user, state="pending_totp")
    await open_session(resources, stranger)
    await execute(
        migrated, "UPDATE auth.sessions SET revoked_at = now() WHERE id = $1", revoked.session_id
    )
    await execute(
        migrated,
        "UPDATE auth.sessions SET idle_expires_at = now() - interval '1 second' WHERE id = $1",
        expired.session_id,
    )

    response = await api.get(SESSIONS, headers=cookie(mine))

    assert response.status_code == 200
    data = response.json()["data"]
    assert {item["session_id"] for item in data} == {
        str(current.session_id),
        str(second.session_id),
    }
    assert {item["session_id"]: item["is_current"] for item in data} == {
        str(current.session_id): True,
        str(second.session_id): False,
    }
    assert set(data[0]) == {
        "session_id",
        "created_at",
        "last_seen_at",
        "ip",
        "user_agent",
        "is_current",
    }
    assert (data[0]["ip"], data[0]["user_agent"]) == ("203.0.113.7", "pytest")
    assert str(pending.session_id) not in response.text
    assert "token" not in response.text


async def test_the_list_needs_a_session(api: httpx.AsyncClient) -> None:
    assert (await api.get(SESSIONS)).status_code == 401


async def test_revoking_one_of_my_sessions_ends_it_at_once(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    mine, _ = await open_session(resources, user)
    other_token, other = await open_session(resources, user)
    assert (await api.get(CURRENT, headers=cookie(other_token))).status_code == 200

    response = await api.delete(f"{SESSIONS}/{other.session_id}", headers=cookie(mine))

    assert response.status_code == 204
    assert "set-cookie" not in response.headers
    assert (await api.get(CURRENT, headers=cookie(other_token))).status_code == 401
    assert (await api.get(CURRENT, headers=cookie(mine))).status_code == 200
    assert await audit_actions(migrated, response.headers["x-request-id"]) == [
        "auth.session.revoked"
    ]


async def test_revoking_the_current_session_also_clears_the_cookie(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    mine, session = await open_session(resources, user)
    response = await api.delete(f"{SESSIONS}/{session.session_id}", headers=cookie(mine))
    assert response.status_code == 204
    assert "max-age=0" in response.headers["set-cookie"].lower()
    assert (await api.get(CURRENT, headers=cookie(mine))).status_code == 401


async def test_another_users_session_is_not_found_and_not_touched(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user, stranger = await make_user(migrated), await make_user(migrated)
    mine, _ = await open_session(resources, user)
    theirs_token, theirs = await open_session(resources, stranger)

    answers = [
        await api.delete(f"{SESSIONS}/{theirs.session_id}", headers=cookie(mine)),
        await api.delete(f"{SESSIONS}/{uuid.uuid4()}", headers=cookie(mine)),
    ]

    bodies = []
    for answer in answers:
        assert answer.status_code == 404
        body = answer.json()
        body.pop("request_id")
        body.pop("instance")
        bodies.append(body)
    assert bodies[0] == bodies[1]
    assert (await api.get(CURRENT, headers=cookie(theirs_token))).status_code == 200


async def test_a_session_id_that_is_not_a_uuid_is_a_validation_error(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    mine, _ = await open_session(resources, user)
    response = await api.delete(f"{SESSIONS}/not-a-uuid", headers=cookie(mine))
    assert response.status_code == 422


async def test_revoke_others_leaves_only_this_session(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user, stranger = await make_user(migrated), await make_user(migrated)
    mine, _ = await open_session(resources, user)
    others = [(await open_session(resources, user))[0] for _ in range(3)]
    theirs, _ = await open_session(resources, stranger)
    for token in others:
        assert (await api.get(CURRENT, headers=cookie(token))).status_code == 200

    response = await api.post(OTHERS, headers=cookie(mine))

    assert response.status_code == 204
    assert (await api.get(CURRENT, headers=cookie(mine))).status_code == 200
    assert (await api.get(CURRENT, headers=cookie(theirs))).status_code == 200
    for token in others:
        assert (await api.get(CURRENT, headers=cookie(token))).status_code == 401
    row = await fetchrow(
        migrated,
        "SELECT after FROM ops.audit_logs WHERE request_id = $1",
        response.headers["x-request-id"],
    )
    assert row["after"] == '{"count": 3}'


async def test_the_profile_can_be_renamed_and_given_a_picture(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated, name="Jane Doe")
    token, _ = await open_session(resources, user)

    renamed = await api.patch(ME, json={"name": "  Jane Q. Doe "}, headers=cookie(token))
    pictured = await api.patch(
        ME, json={"image": "https://cdn.example.com/jane.png"}, headers=cookie(token)
    )
    cleared = await api.patch(ME, json={"image": None}, headers=cookie(token))

    assert renamed.json()["data"]["user"]["name"] == "Jane Q. Doe"
    assert pictured.json()["data"]["user"] == renamed.json()["data"]["user"] | {
        "image": "https://cdn.example.com/jane.png"
    }
    assert cleared.json()["data"]["user"]["image"] is None
    row = await fetchrow(
        migrated,
        "SELECT name, image, updated_at > created_at AS touched FROM auth.users WHERE id = $1",
        user.id,
    )
    assert (row["name"], row["image"], row["touched"]) == ("Jane Q. Doe", None, True)


@pytest.mark.parametrize(
    "body",
    [
        {"name": ""},
        {"name": "x" * 121},
        {"name": None},
        {"image": "http://cdn.example.com/jane.png"},
        {"image": "javascript:alert(1)"},
        {"image": "https://" + "a" * 2050},
        {"image": "https://cdn.example.com/a b.png"},
        {"image": "https://cdn.example.com/\u0000"},
        {"image": "https://cdn.example.com/\u0001x"},
        {"image": "https://cdn.example.com/\u200bx"},
        {"image": "https://cdn.example.com/x\n"},
        {"email": "new@client.example"},
        {"is_platform_operator": True},
        {},
    ],
)
async def test_a_profile_update_that_is_not_allowed_is_a_validation_error(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, body: dict[str, object]
) -> None:
    user = await make_user(migrated, name="Jane Doe")
    token, _ = await open_session(resources, user)
    response = await api.patch(ME, json=body, headers=cookie(token))
    assert response.status_code == 422, body
    row = await fetchrow(migrated, "SELECT name, image FROM auth.users WHERE id = $1", user.id)
    assert (row["name"], row["image"]) == ("Jane Doe", None)


async def test_a_profile_update_needs_a_session(api: httpx.AsyncClient) -> None:
    assert (await api.patch(ME, json={"name": "Mallory"})).status_code == 401


async def test_a_pending_sign_in_is_not_listed_but_can_be_ended(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """A pending session means someone entered the right password. "End the others" ends it too."""
    user = await make_user(migrated)
    mine, _ = await open_session(resources, user)
    pending_token, pending = await open_session(resources, user, state="pending_totp")

    listed = (await api.get(SESSIONS, headers=cookie(mine))).json()["data"]
    ended = await api.delete(f"{SESSIONS}/{pending.session_id}", headers=cookie(mine))

    assert str(pending.session_id) not in {item["session_id"] for item in listed}
    assert ended.status_code == 204
    assert (
        await api.get("/api/v1/_probe/pending", headers=cookie(pending_token))
    ).status_code == 401
