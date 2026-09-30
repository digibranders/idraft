"""GET /api/v1/me (docs/19 section 3.1)."""

import uuid

import httpx

from sightline.api.resources import Resources
from tests.api.auth.support import (
    add_member,
    cookie,
    execute,
    make_user,
    make_workspace,
    open_session,
)
from tests.conftest import PostgresServer

ME = "/api/v1/me"


async def test_me_needs_a_session(api: httpx.AsyncClient) -> None:
    response = await api.get(ME)
    assert (response.status_code, response.json()["code"]) == (401, "unauthenticated")


async def test_me_describes_the_user_and_the_session(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated, name="Jane Doe")
    token, session = await open_session(resources, user, fresh=True)

    response = await api.get(ME, headers=cookie(token))

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["user"] == {
        "user_id": str(user.id),
        "name": "Jane Doe",
        "email": user.email,
        "email_verified": True,
        "image": None,
        "two_factor_enabled": False,
        "is_platform_operator": False,
        "created_at": data["user"]["created_at"],
    }
    assert set(data["session"]) == {"fresh_until", "expires_at", "auth_method"}
    assert data["session"]["auth_method"] == "session"
    assert data["session"]["fresh_until"] is not None
    assert data["session"]["expires_at"].startswith(session.idle_expires_at.isoformat()[:19])
    assert data["memberships"] == []
    assert "password" not in response.text


async def test_me_lists_only_the_callers_memberships_with_their_permissions(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user, stranger = await make_user(migrated), await make_user(migrated)
    beta, alpha = (
        await make_workspace(migrated, name="beta"),
        await make_workspace(migrated, name="Alpha"),
    )
    other = await make_workspace(migrated, name="Other")
    project = uuid.uuid4()
    await add_member(migrated, alpha, user, "billing")
    await add_member(migrated, beta, user, "viewer", [project])
    await add_member(migrated, other, stranger, "owner")
    await add_member(migrated, alpha, stranger, "owner")
    token, _ = await open_session(resources, user)

    memberships = (await api.get(ME, headers=cookie(token))).json()["data"]["memberships"]

    assert memberships == [
        {
            "workspace": {
                "workspace_id": str(alpha.id),
                "name": "Alpha",
                "slug": alpha.slug,
                "status": "active",
            },
            "role": "billing",
            "project_ids": None,
            "permissions": ["budgets:manage", "costs:read"],
        },
        {
            "workspace": {
                "workspace_id": str(beta.id),
                "name": "beta",
                "slug": beta.slug,
                "status": "active",
            },
            "role": "viewer",
            "project_ids": [str(project)],
            "permissions": ["data:read"],
        },
    ]


async def test_two_factor_is_reported_only_once_confirmed(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, _ = await open_session(resources, user)
    await execute(
        migrated,
        "INSERT INTO auth.totp_secrets (user_id, secret_encrypted) VALUES ($1, '\\x01')",
        user.id,
    )
    before = (await api.get(ME, headers=cookie(token))).json()["data"]["user"]
    await execute(
        migrated, "UPDATE auth.totp_secrets SET confirmed_at = now() WHERE user_id = $1", user.id
    )
    after = (await api.get(ME, headers=cookie(token))).json()["data"]["user"]
    assert (before["two_factor_enabled"], after["two_factor_enabled"]) == (False, True)


async def test_me_is_refused_when_the_account_is_gone(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, _ = await open_session(resources, user)
    assert (await api.get(ME, headers=cookie(token))).status_code == 200
    await execute(migrated, "DELETE FROM auth.users WHERE id = $1", user.id)
    assert (await api.get(ME, headers=cookie(token))).status_code == 401
