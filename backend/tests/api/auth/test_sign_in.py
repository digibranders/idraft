"""Sign-in, throttling and sign-out (docs/19 section 3.1, docs/24 section 2; SEC-AUTH-01)."""

import asyncio
import hashlib
import io
import re
import uuid

import asyncpg
import httpx
import pytest
from argon2 import PasswordHasher
from asgi_lifespan import LifespanManager
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession

from sightline.api.auth import passwords, repository
from sightline.api.auth.passwords import hash_password
from sightline.api.auth.service import request_info
from sightline.api.main import create_app
from sightline.api.resources import Resources
from sightline.config.logging import configure_logging
from sightline.config.settings import Settings
from tests.api.auth.support import (
    COOKIE,
    PASSWORD,
    audit_actions,
    cookie,
    execute,
    fetch,
    fetchrow,
    make_user,
    new_email,
    open_session,
)
from tests.conftest import BASE_URL, PostgresServer

SIGN_IN = "/api/v1/auth/sign-in"
SIGN_OUT = "/api/v1/auth/sign-out"
ME = "/api/v1/me"


def _credentials(email: str, password: str = PASSWORD) -> dict[str, str]:
    return {"email": email, "password": password}


def _session_cookie(response: httpx.Response) -> str:
    header = response.headers["set-cookie"]
    assert header.startswith(f"{COOKIE}=")
    return header.split(";")[0].split("=", 1)[1]


async def test_the_right_password_signs_in_and_sets_the_cookie(
    api: httpx.AsyncClient, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)

    response = await api.post(SIGN_IN, json=_credentials(user.email.upper()))

    assert response.status_code == 200
    assert response.json() == {"status": "signed_in"}
    header = response.headers["set-cookie"].lower()
    for attribute in ("httponly", "secure", "samesite=lax", "path=/", "max-age=259"):
        assert attribute in header
    assert "domain" not in header
    token = _session_cookie(response)
    me = await api.get(ME, headers=cookie(token))
    assert me.status_code == 200
    assert me.json()["data"]["user"]["user_id"] == str(user.id)
    assert me.json()["data"]["session"]["fresh_until"] is not None
    assert await audit_actions(migrated, response.headers["x-request-id"]) == ["auth.sign_in"]
    row = await fetchrow(
        migrated,
        "SELECT * FROM auth.sessions WHERE token_hash = $1",
        hashlib.sha256(token.encode()).digest(),
    )
    assert (row["state"], str(row["ip"]), row["user_agent"]) == (
        "active",
        "127.0.0.1",
        "python-httpx/" + httpx.__version__,
    )


async def test_every_failure_looks_the_same_from_outside(
    api: httpx.AsyncClient, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    disabled = await make_user(migrated, disabled=True)
    attempts = [
        _credentials(user.email, "the wrong password"),
        _credentials(new_email()),
        _credentials(disabled.email),
    ]
    bodies = []
    for attempt in attempts:
        response = await api.post(SIGN_IN, json=attempt)
        assert response.status_code == 401
        assert "set-cookie" not in response.headers
        body = response.json()
        body.pop("request_id")
        bodies.append(body)
    assert all(body == bodies[0] for body in bodies)
    assert bodies[0]["code"] == "invalid_credentials"


async def test_an_unknown_email_costs_a_password_verification(
    api: httpx.AsyncClient, migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[str] = []
    real = passwords.dummy_verify

    def counted() -> None:
        calls.append("dummy")
        real()

    monkeypatch.setattr("sightline.api.auth.service.dummy_verify", counted)
    disabled = await make_user(migrated, disabled=True)

    await api.post(SIGN_IN, json=_credentials(new_email()))
    await api.post(SIGN_IN, json=_credentials(disabled.email))

    assert calls == ["dummy", "dummy"]


async def test_a_failure_is_in_the_audit_log_although_the_request_failed(
    api: httpx.AsyncClient, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    unknown = new_email()

    wrong = await api.post(SIGN_IN, json=_credentials(user.email, "the wrong password"))
    nobody = await api.post(SIGN_IN, json=_credentials(unknown))

    rows = await fetch(
        migrated,
        "SELECT * FROM ops.audit_logs WHERE request_id = ANY($1) ORDER BY id",
        [wrong.headers["x-request-id"], nobody.headers["x-request-id"]],
    )
    assert [row["action"] for row in rows] == ["auth.sign_in_failed", "auth.sign_in_failed"]
    assert (rows[0]["actor_type"], rows[0]["target_type"], rows[0]["target_id"]) == (
        "user",
        "user",
        str(user.id),
    )
    assert rows[0]["after"] == '{"reason": "wrong_password"}'
    assert (rows[1]["actor_type"], rows[1]["target_type"]) == ("system", "email_sha256")
    assert rows[1]["target_id"] == hashlib.sha256(unknown.encode()).hexdigest()[:32]
    stored = repr([dict(row) for row in rows])
    assert unknown not in stored
    assert "the wrong password" not in stored


async def test_the_sixth_attempt_is_locked_out_even_with_the_right_password(
    api: httpx.AsyncClient, migrated: PostgresServer
) -> None:
    """SEC-AUTH-01."""
    user = await make_user(migrated)
    failures = [
        await api.post(SIGN_IN, json=_credentials(user.email, "the wrong password"))
        for _ in range(5)
    ]
    locked = await api.post(SIGN_IN, json=_credentials(user.email))

    assert [response.status_code for response in failures] == [401] * 5
    assert locked.status_code == 429
    body = locked.json()
    assert body["code"] == "rate_limited"
    assert 890 <= body["retry_after_seconds"] <= 900
    assert locked.headers["retry-after"] == str(body["retry_after_seconds"])
    assert "set-cookie" not in locked.headers
    actions = await fetch(
        migrated,
        "SELECT action, count(*) AS n FROM ops.audit_logs WHERE target_id = $1 GROUP BY action",
        str(user.id),
    )
    assert {row["action"]: row["n"] for row in actions} == {
        "auth.sign_in_failed": 5,
        "auth.lockout": 1,
    }


async def test_a_successful_sign_in_clears_the_failure_count(
    api: httpx.AsyncClient, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    for _ in range(4):
        await api.post(SIGN_IN, json=_credentials(user.email, "the wrong password"))
    assert (await api.post(SIGN_IN, json=_credentials(user.email))).status_code == 200
    for _ in range(4):
        response = await api.post(SIGN_IN, json=_credentials(user.email, "the wrong password"))
        assert response.status_code == 401


async def test_a_hash_with_old_parameters_is_replaced_on_sign_in(
    api: httpx.AsyncClient, migrated: PostgresServer
) -> None:
    old = PasswordHasher(time_cost=1, memory_cost=8192, parallelism=1).hash(PASSWORD)
    user = await make_user(migrated, password_hash=old)

    assert (await api.post(SIGN_IN, json=_credentials(user.email))).status_code == 200

    row = await fetchrow(migrated, "SELECT password_hash FROM auth.users WHERE id = $1", user.id)
    assert row["password_hash"].startswith("$argon2id$v=19$m=19456,t=2,p=1$")
    assert (await api.post(SIGN_IN, json=_credentials(user.email))).status_code == 200


async def test_an_unverified_user_can_sign_in(
    api: httpx.AsyncClient, migrated: PostgresServer
) -> None:
    user = await make_user(migrated, verified=False)
    response = await api.post(SIGN_IN, json=_credentials(user.email))
    assert response.status_code == 200
    me = await api.get(ME, headers=cookie(_session_cookie(response)))
    assert me.json()["data"]["user"]["email_verified"] is False


async def test_a_user_with_two_factor_gets_a_session_that_is_not_yet_usable(
    api: httpx.AsyncClient, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    await execute(
        migrated,
        "INSERT INTO auth.totp_secrets (user_id, secret_encrypted, confirmed_at) "
        "VALUES ($1, '\\x01', now())",
        user.id,
    )

    response = await api.post(SIGN_IN, json=_credentials(user.email))

    assert response.status_code == 200
    assert response.json() == {"status": "totp_required"}
    lifetime = re.search(r"max-age=(\d+)", response.headers["set-cookie"].lower())
    assert lifetime is not None
    assert 590 <= int(lifetime[1]) <= 600
    token = _session_cookie(response)
    assert (await api.get(ME, headers=cookie(token))).status_code == 401
    row = await fetchrow(
        migrated,
        "SELECT state, fresh_until FROM auth.sessions WHERE token_hash = $1",
        hashlib.sha256(token.encode()).digest(),
    )
    assert (row["state"], row["fresh_until"]) == ("pending_totp", None)


async def test_an_unconfirmed_secret_does_not_demand_a_code(
    api: httpx.AsyncClient, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    await execute(
        migrated,
        "INSERT INTO auth.totp_secrets (user_id, secret_encrypted) VALUES ($1, '\\x01')",
        user.id,
    )
    response = await api.post(SIGN_IN, json=_credentials(user.email))
    assert response.json() == {"status": "signed_in"}


async def test_sign_in_stops_when_redis_cannot_count(
    app_settings: Settings, black_hole: str, migrated: PostgresServer
) -> None:
    """A limiter that cannot count must not wave attempts through (docs/19 section 2.9)."""
    user = await make_user(migrated)
    settings = app_settings.model_copy(update={"redis_url": SecretStr(f"redis://{black_hole}/0")})
    application = create_app(settings)
    async with LifespanManager(application):
        transport = httpx.ASGITransport(app=application, raise_app_exceptions=False)
        async with httpx.AsyncClient(
            transport=transport, base_url=BASE_URL, headers={"Origin": BASE_URL}
        ) as api:
            response = await api.post(SIGN_IN, json=_credentials(user.email))
    assert response.status_code == 503
    assert response.json()["code"] == "service_unavailable"
    assert "set-cookie" not in response.headers


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/auth/register",
        "/api/v1/auth/verify-email/request",
        "/api/v1/auth/verify-email",
        SIGN_IN,
        SIGN_OUT,
    ],
)
async def test_every_public_auth_route_needs_our_origin(api: httpx.AsyncClient, path: str) -> None:
    response = await api.post(path, json={}, headers={"Origin": "https://evil.example"})
    assert response.status_code == 403
    assert response.json()["code"] == "origin_not_allowed"


async def test_nothing_secret_is_logged_by_a_sign_in(
    api: httpx.AsyncClient, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    stream = io.StringIO()
    configure_logging(service="api", version="test", level="debug", stream=stream)

    ok = await api.post(SIGN_IN, json=_credentials(user.email))
    await api.post(SIGN_IN, json=_credentials(user.email, "the wrong password"))

    logged = stream.getvalue()
    assert PASSWORD not in logged
    assert "the wrong password" not in logged
    assert _session_cookie(ok) not in logged
    assert user.email not in logged


# ---------------------------------------------------------------------------------------------
# Sign-out


async def test_sign_out_ends_the_session_everywhere(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token = _session_cookie(await api.post(SIGN_IN, json=_credentials(user.email)))
    assert (await api.get(ME, headers=cookie(token))).status_code == 200

    response = await api.post(SIGN_OUT, headers=cookie(token))

    assert response.status_code == 204
    cleared = response.headers["set-cookie"].lower()
    assert cleared.startswith("__host-session=")
    assert "max-age=0" in cleared
    assert (await api.get(ME, headers=cookie(token))).status_code == 401
    row = await fetchrow(
        migrated,
        "SELECT revoked_at FROM auth.sessions WHERE token_hash = $1",
        hashlib.sha256(token.encode()).digest(),
    )
    assert row["revoked_at"] is not None
    assert await resources.redis.keys("session:*") == []
    assert await audit_actions(migrated, response.headers["x-request-id"]) == ["auth.sign_out"]


async def test_a_pending_session_can_sign_out(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, session = await open_session(resources, user, state="pending_totp")
    response = await api.post(SIGN_OUT, headers=cookie(token))
    assert response.status_code == 204
    row = await fetchrow(
        migrated, "SELECT revoked_at FROM auth.sessions WHERE id = $1", session.session_id
    )
    assert row["revoked_at"] is not None


@pytest.mark.parametrize(
    "headers", [{}, {"Cookie": f"{COOKIE}={'q' * 43}"}, {"Cookie": f"{COOKIE}=x"}]
)
async def test_sign_out_without_a_live_session_still_clears_the_cookie(
    api: httpx.AsyncClient, headers: dict[str, str]
) -> None:
    response = await api.post(SIGN_OUT, headers=headers)
    assert response.status_code == 204
    assert "max-age=0" in response.headers["set-cookie"].lower()


async def test_an_expired_session_can_still_sign_out(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, session = await open_session(resources, user)
    await execute(
        migrated,
        "UPDATE auth.sessions SET idle_expires_at = now() - interval '1 second' WHERE id = $1",
        session.session_id,
    )
    response = await api.post(SIGN_OUT, headers=cookie(token))
    assert response.status_code == 204
    assert "max-age=0" in response.headers["set-cookie"].lower()


def test_an_address_that_is_not_an_ip_is_not_recorded() -> None:
    unknown = request_info(client_host="testclient", user_agent="ua", request_id="req_x")
    missing = request_info(client_host=None, user_agent=None, request_id=None)
    v6 = request_info(client_host="2001:DB8::1", user_agent=None, request_id=None)
    assert (unknown.ip, unknown.throttle_ip) == (None, "unknown")
    assert (missing.ip, missing.throttle_ip) == (None, "unknown")
    assert v6.ip == "2001:db8::1"


async def test_a_password_changed_between_verification_and_session_creation_stops_the_sign_in(
    api: httpx.AsyncClient, migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The ordering that keeps "revoke every session" complete (a reset racing a sign-in)."""
    user = await make_user(migrated)
    real = repository.lock_password_hash

    async def changed_meanwhile(
        db: AsyncSession, user_id: uuid.UUID, *, exclusive: bool
    ) -> str | None:
        await execute(
            migrated,
            "UPDATE auth.users SET password_hash = $1 WHERE id = $2",
            hash_password("a completely different password"),
            user_id,
        )
        return await real(db, user_id, exclusive=exclusive)

    monkeypatch.setattr(repository, "lock_password_hash", changed_meanwhile)

    response = await api.post(SIGN_IN, json=_credentials(user.email))

    assert response.status_code == 401
    assert response.json()["code"] == "invalid_credentials"
    assert "set-cookie" not in response.headers
    sessions = await fetchrow(
        migrated, "SELECT count(*) AS n FROM auth.sessions WHERE user_id = $1", user.id
    )
    assert sessions["n"] == 0
    failure = await fetchrow(
        migrated,
        "SELECT action, after FROM ops.audit_logs WHERE request_id = $1",
        response.headers["x-request-id"],
    )
    assert (failure["action"], failure["after"]) == (
        "auth.sign_in_failed",
        '{"reason": "changed_during_sign_in"}',
    )


async def test_the_sign_in_lock_waits_for_a_password_change_in_progress(
    api: httpx.AsyncClient, migrated: PostgresServer
) -> None:
    """A change holds the user row; the sign-in blocks on it, then sees the new hash and stops."""
    user = await make_user(migrated)
    changer = await asyncpg.connect(migrated.url())
    try:
        transaction = changer.transaction()
        await transaction.start()
        await changer.execute(
            "UPDATE auth.users SET password_hash = $1 WHERE id = $2",
            hash_password("a completely different password"),
            user.id,
        )
        pending = asyncio.ensure_future(api.post(SIGN_IN, json=_credentials(user.email)))
        await asyncio.sleep(0.5)
        assert not pending.done(), "the sign-in must wait for the row lock"
        await transaction.commit()
        response = await pending
    finally:
        await changer.close()
    assert response.status_code == 401


async def test_sign_ins_at_once_for_a_hash_that_needs_replacing_all_succeed(
    api: httpx.AsyncClient, migrated: PostgresServer
) -> None:
    """Each wants to rewrite the hash. None may deadlock, and none may be refused for it."""
    old = PasswordHasher(time_cost=1, memory_cost=8192, parallelism=1).hash(PASSWORD)
    user = await make_user(migrated, password_hash=old)

    responses = await asyncio.gather(
        *(api.post(SIGN_IN, json=_credentials(user.email)) for _ in range(6))
    )

    assert [response.status_code for response in responses] == [200] * 6
    row = await fetchrow(migrated, "SELECT password_hash FROM auth.users WHERE id = $1", user.id)
    assert row["password_hash"].startswith("$argon2id$v=19$m=19456,t=2,p=1$")
    sessions = await fetchrow(
        migrated, "SELECT count(*) AS n FROM auth.sessions WHERE user_id = $1", user.id
    )
    assert sessions["n"] == 6


async def test_a_user_deleted_between_verification_and_session_creation_is_refused(
    api: httpx.AsyncClient, migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await make_user(migrated)
    real = repository.lock_password_hash

    async def deleted_meanwhile(
        db: AsyncSession, user_id: uuid.UUID, *, exclusive: bool
    ) -> str | None:
        await execute(migrated, "DELETE FROM auth.users WHERE id = $1", user_id)
        return await real(db, user_id, exclusive=exclusive)

    monkeypatch.setattr(repository, "lock_password_hash", deleted_meanwhile)
    response = await api.post(SIGN_IN, json=_credentials(user.email))
    assert response.status_code == 401


async def test_sign_ins_from_one_address_are_limited(
    api: httpx.AsyncClient, migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("sightline.api.auth.service.SIGN_INS_PER_HOUR_PER_IP", 3)
    user = await make_user(migrated)
    statuses = [
        (await api.post(SIGN_IN, json=_credentials(user.email))).status_code for _ in range(4)
    ]
    assert statuses == [200, 200, 200, 429]
