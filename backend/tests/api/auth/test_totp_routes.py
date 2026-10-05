"""Two-factor: enrolment, verification, recovery codes, disable, and re-authentication
(docs/19 section 3.1, docs/24 section 2; SEC-AUTH-03)."""

import asyncio
import hashlib
import io
import re
from datetime import UTC, datetime, timedelta

import httpx
import pyotp
import pytest

from sightline.api.auth import repository
from sightline.api.auth.tokens import derive_key
from sightline.api.auth.totp import TotpCipher, hash_recovery_code
from sightline.api.resources import Resources
from sightline.config.logging import configure_logging
from tests.api.auth.support import (
    COOKIE,
    PASSWORD,
    RecordingEmailSender,
    User,
    add_member,
    audit_actions,
    cookie,
    execute,
    fetchrow,
    make_user,
    make_workspace,
    open_session,
)
from tests.conftest import PostgresServer

SETUP = "/api/v1/auth/totp/setup"
CONFIRM = "/api/v1/auth/totp/setup/confirm"
VERIFY = "/api/v1/auth/totp/verify"
RECOVERY = "/api/v1/auth/totp/recovery-codes"
DISABLE = "/api/v1/auth/totp/disable"
REAUTH = "/api/v1/me/reauthenticate"
SIGN_IN = "/api/v1/auth/sign-in"
SIGN_OUT = "/api/v1/auth/sign-out"
ME = "/api/v1/me"
CURRENT = "/api/v1/_probe/current"
FRESH = "/api/v1/_probe/fresh"


def _code(secret: str) -> str:
    return pyotp.TOTP(secret).now()


def _new_cookie(response: httpx.Response) -> str:
    header = response.headers["set-cookie"]
    assert header.startswith(f"{COOKIE}=")
    return header.split(";")[0].split("=", 1)[1]


async def _enrol(
    api: httpx.AsyncClient, resources: Resources, pg: PostgresServer, user: User
) -> tuple[str, str, list[str]]:
    """Set up and confirm two-factor. Returns the session token, the secret and the codes."""
    token, _ = await open_session(resources, user, fresh=True)
    setup = await api.post(SETUP, headers=cookie(token))
    assert setup.status_code == 200, setup.text
    secret = setup.json()["secret"]
    confirmed = await api.post(CONFIRM, json={"code": _code(secret)}, headers=cookie(token))
    assert confirmed.status_code == 200, confirmed.text
    # The step just used cannot be used again; move the marker back so tests can verify at once.
    await execute(
        pg,
        "UPDATE auth.totp_secrets SET last_used_step = last_used_step - 5 WHERE user_id = $1",
        user.id,
    )
    return token, secret, confirmed.json()["recovery_codes"]


async def _pending(api: httpx.AsyncClient, user: User) -> str:
    response = await api.post(SIGN_IN, json={"email": user.email, "password": PASSWORD})
    assert response.json() == {"status": "totp_required"}
    return _new_cookie(response)


# ---------------------------------------------------------------------------------------------
# Enrolment


async def test_setup_needs_a_fresh_session(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    stale, _ = await open_session(resources, user)
    assert (await api.post(SETUP)).status_code == 401
    refused = await api.post(SETUP, headers=cookie(stale))
    assert refused.status_code == 403
    assert refused.json()["code"] == "fresh_session_required"


async def test_setup_returns_a_secret_that_is_stored_encrypted_and_not_yet_enabled(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, _ = await open_session(resources, user, fresh=True)

    response = await api.post(SETUP, headers=cookie(token))

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert re.fullmatch(r"[A-Z2-7]{32}", body["secret"])
    assert body["otpauth_uri"].startswith("otpauth://totp/Sightline:")
    assert f"secret={body['secret']}" in body["otpauth_uri"]
    row = await fetchrow(migrated, "SELECT * FROM auth.totp_secrets WHERE user_id = $1", user.id)
    assert row["confirmed_at"] is None
    assert body["secret"].encode() not in row["secret_encrypted"]
    cipher = TotpCipher(derive_key(resources.settings.totp_key, b"sightline totp secrets v1"))
    assert cipher.decrypt(row["secret_encrypted"], user_id=user.id) == body["secret"]
    me = await api.get(ME, headers=cookie(token))
    assert me.json()["data"]["user"]["two_factor_enabled"] is False
    assert (await api.post(SIGN_IN, json={"email": user.email, "password": PASSWORD})).json() == {
        "status": "signed_in"
    }


async def test_a_second_setup_replaces_the_first_secret(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, _ = await open_session(resources, user, fresh=True)
    first = (await api.post(SETUP, headers=cookie(token))).json()["secret"]
    second = (await api.post(SETUP, headers=cookie(token))).json()["secret"]
    assert first != second

    old = await api.post(CONFIRM, json={"code": _code(first)}, headers=cookie(token))
    new = await api.post(CONFIRM, json={"code": _code(second)}, headers=cookie(token))

    assert old.status_code == 401
    assert old.json()["code"] == "invalid_code"
    assert new.status_code == 200


async def test_confirming_enables_two_factor_and_ends_other_sessions(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, _ = await open_session(resources, user, fresh=True)
    other, _ = await open_session(resources, user)
    assert (await api.get(CURRENT, headers=cookie(other))).status_code == 200
    secret = (await api.post(SETUP, headers=cookie(token))).json()["secret"]

    response = await api.post(CONFIRM, json={"code": _code(secret)}, headers=cookie(token))

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    codes = response.json()["recovery_codes"]
    assert len(codes) == 10
    assert len(set(codes)) == 10
    assert all(re.fullmatch(r"[A-Z2-7]{4}(-[A-Z2-7]{4}){3}", code) for code in codes)
    row = await fetchrow(migrated, "SELECT * FROM auth.totp_secrets WHERE user_id = $1", user.id)
    assert row["confirmed_at"] is not None
    assert sorted(row["recovery_code_hashes"]) == sorted(hash_recovery_code(c) for c in codes)
    assert not set(codes) & set(row["recovery_code_hashes"])
    assert (await api.get(CURRENT, headers=cookie(token))).status_code == 200
    assert (await api.get(CURRENT, headers=cookie(other))).status_code == 401
    assert (await api.get(ME, headers=cookie(token))).json()["data"]["user"]["two_factor_enabled"]
    assert await audit_actions(migrated, response.headers["x-request-id"]) == ["auth.totp.enabled"]


async def test_the_code_that_confirmed_cannot_be_used_again_to_sign_in(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """SEC-AUTH-03: a code is good once."""
    user = await make_user(migrated)
    token, _ = await open_session(resources, user, fresh=True)
    secret = (await api.post(SETUP, headers=cookie(token))).json()["secret"]
    code = _code(secret)
    assert (await api.post(CONFIRM, json={"code": code}, headers=cookie(token))).status_code == 200

    pending = await _pending(api, user)
    replay = await api.post(VERIFY, json={"code": code}, headers=cookie(pending))

    assert replay.status_code == 401
    assert replay.json()["code"] == "invalid_code"


async def test_setup_and_confirm_refuse_when_already_enabled(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, secret, _ = await _enrol(api, resources, migrated, user)

    again = await api.post(SETUP, headers=cookie(token))
    confirm = await api.post(CONFIRM, json={"code": _code(secret)}, headers=cookie(token))

    assert (again.status_code, again.json()["code"]) == (409, "totp_already_enabled")
    assert (confirm.status_code, confirm.json()["code"]) == (409, "totp_already_enabled")


async def test_confirm_without_a_setup_is_a_conflict(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, _ = await open_session(resources, user, fresh=True)
    response = await api.post(CONFIRM, json={"code": "123456"}, headers=cookie(token))
    assert (response.status_code, response.json()["code"]) == (409, "conflict")


@pytest.mark.parametrize("code", ["", "12345", "1234567", "abcdef", "12 456", "١٢٣٤٥٦"])
async def test_a_malformed_code_is_a_validation_error(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, code: str
) -> None:
    user = await make_user(migrated)
    token, _ = await open_session(resources, user, fresh=True)
    await api.post(SETUP, headers=cookie(token))
    response = await api.post(CONFIRM, json={"code": code}, headers=cookie(token))
    assert response.status_code == 422


# ---------------------------------------------------------------------------------------------
# Signing in with the second factor


async def test_the_whole_path_from_password_to_a_full_session(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    _, secret, _ = await _enrol(api, resources, migrated, user)
    pending = await _pending(api, user)
    assert (await api.get(ME, headers=cookie(pending))).status_code == 401

    response = await api.post(VERIFY, json={"code": _code(secret)}, headers=cookie(pending))

    assert (response.status_code, response.json()) == (200, {"status": "ok"})
    full = _new_cookie(response)
    assert full != pending
    assert "max-age=259" in response.headers["set-cookie"].lower()
    assert (await api.get(ME, headers=cookie(full))).status_code == 200
    assert (await api.get(FRESH, headers=cookie(full))).status_code == 200
    # The pending session was replaced, not upgraded: its token is dead.
    assert (await api.get("/api/v1/_probe/pending", headers=cookie(pending))).status_code == 401
    assert await audit_actions(migrated, response.headers["x-request-id"]) == ["auth.totp.verified"]
    row = await fetchrow(
        migrated,
        "SELECT after FROM ops.audit_logs WHERE request_id = $1",
        response.headers["x-request-id"],
    )
    assert row["after"] == '{"method": "code", "recovery_codes_left": 10}'


async def test_a_pending_session_can_do_nothing_but_verify_and_sign_out(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    await _enrol(api, resources, migrated, user)
    pending = await _pending(api, user)
    for method, path in [
        ("GET", ME),
        ("GET", "/api/v1/auth/sessions"),
        ("POST", "/api/v1/auth/sessions/revoke-others"),
        ("POST", SETUP),
        ("POST", RECOVERY),
        ("POST", DISABLE),
        ("POST", REAUTH),
        ("PATCH", ME),
    ]:
        response = await api.request(method, path, headers=cookie(pending), json={})
        assert response.status_code == 401, (method, path)
    assert (await api.post(SIGN_OUT, headers=cookie(pending))).status_code == 204


async def test_a_pending_session_expires_after_ten_minutes(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    _, secret, _ = await _enrol(api, resources, migrated, user)
    pending = await _pending(api, user)
    row = await fetchrow(
        migrated,
        "SELECT id, idle_expires_at - created_at AS life FROM auth.sessions "
        "WHERE user_id = $1 AND state = 'pending_totp'",
        user.id,
    )
    # Ten minutes. The expiry is the application's clock and the creation time the database's,
    # which are a few milliseconds apart in either direction.
    assert 595 <= row["life"].total_seconds() <= 601
    await execute(
        migrated,
        "UPDATE auth.sessions SET idle_expires_at = now() - interval '1 second' WHERE id = $1",
        row["id"],
    )
    response = await api.post(VERIFY, json={"code": _code(secret)}, headers=cookie(pending))
    assert response.status_code == 401
    assert response.json()["code"] == "session_expired"


async def test_a_code_works_once_even_when_posted_twice_at_the_same_moment(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """SEC-AUTH-03."""
    user = await make_user(migrated)
    _, secret, _ = await _enrol(api, resources, migrated, user)
    first, second = await _pending(api, user), await _pending(api, user)
    code = _code(secret)

    responses = await asyncio.gather(
        api.post(VERIFY, json={"code": code}, headers=cookie(first)),
        api.post(VERIFY, json={"code": code}, headers=cookie(second)),
    )

    assert sorted(response.status_code for response in responses) == [200, 401]


async def test_a_wrong_code_is_refused_counted_and_recorded(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    _, secret, _ = await _enrol(api, resources, migrated, user)
    pending = await _pending(api, user)
    wrong = "000000" if _code(secret) != "000000" else "111111"

    responses = [
        await api.post(VERIFY, json={"code": wrong}, headers=cookie(pending)) for _ in range(6)
    ]

    assert [response.status_code for response in responses] == [401] * 5 + [429]
    assert responses[0].json()["code"] == "invalid_code"
    assert "set-cookie" not in responses[0].headers
    assert await audit_actions(migrated, responses[0].headers["x-request-id"]) == [
        "auth.totp.verify_failed"
    ]
    assert await audit_actions(migrated, responses[4].headers["x-request-id"]) == [
        "auth.totp.verify_failed",
        "auth.lockout",
    ]
    locked = await api.post(VERIFY, json={"code": _code(secret)}, headers=cookie(pending))
    assert locked.status_code == 429


async def test_a_recovery_code_works_once(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    _, _, codes = await _enrol(api, resources, migrated, user)
    typed = codes[3].lower().replace("-", " ")

    first = await api.post(
        VERIFY, json={"recovery_code": typed}, headers=cookie(await _pending(api, user))
    )
    second = await api.post(
        VERIFY, json={"recovery_code": codes[3]}, headers=cookie(await _pending(api, user))
    )

    assert first.status_code == 200
    assert second.status_code == 401
    row = await fetchrow(
        migrated,
        "SELECT cardinality(recovery_code_hashes) AS left FROM auth.totp_secrets "
        "WHERE user_id = $1",
        user.id,
    )
    assert row["left"] == 9
    audit = await fetchrow(
        migrated,
        "SELECT after FROM ops.audit_logs WHERE request_id = $1",
        first.headers["x-request-id"],
    )
    assert audit["after"] == '{"method": "recovery_code", "recovery_codes_left": 9}'
    assert (await api.get(ME, headers=cookie(_new_cookie(first)))).status_code == 200


async def test_one_recovery_code_posted_twice_at_once_succeeds_once(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    _, _, codes = await _enrol(api, resources, migrated, user)
    first, second = await _pending(api, user), await _pending(api, user)
    responses = await asyncio.gather(
        api.post(VERIFY, json={"recovery_code": codes[0]}, headers=cookie(first)),
        api.post(VERIFY, json={"recovery_code": codes[0]}, headers=cookie(second)),
    )
    assert sorted(response.status_code for response in responses) == [200, 401]


@pytest.mark.parametrize(
    "body", [{}, {"code": "123456", "recovery_code": "AAAA-AAAA-AAAA-AAAA"}, {"other": 1}]
)
async def test_verify_takes_exactly_one_of_code_and_recovery_code(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, body: dict[str, object]
) -> None:
    user = await make_user(migrated)
    await _enrol(api, resources, migrated, user)
    response = await api.post(VERIFY, json=body, headers=cookie(await _pending(api, user)))
    assert response.status_code == 422


async def test_verify_without_two_factor_enabled_is_an_invalid_code(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, _ = await open_session(resources, user)
    response = await api.post(VERIFY, json={"code": "123456"}, headers=cookie(token))
    assert (response.status_code, response.json()["code"]) == (401, "invalid_code")
    assert (await api.post(VERIFY, json={"code": "123456"})).status_code == 401


async def test_an_active_session_that_verifies_is_rotated_and_made_fresh(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    _, secret, _ = await _enrol(api, resources, migrated, user)
    stale, session = await open_session(resources, user)
    assert (await api.get(FRESH, headers=cookie(stale))).status_code == 403

    response = await api.post(VERIFY, json={"code": _code(secret)}, headers=cookie(stale))

    rotated = _new_cookie(response)
    assert (await api.get(FRESH, headers=cookie(rotated))).status_code == 200
    assert (await api.get(CURRENT, headers=cookie(stale))).status_code == 401
    row = await fetchrow(
        migrated,
        "SELECT absolute_expires_at FROM auth.sessions WHERE token_hash = $1",
        hashlib.sha256(rotated.encode()).digest(),
    )
    assert row["absolute_expires_at"] == session.absolute_expires_at


# ---------------------------------------------------------------------------------------------
# Recovery codes and disable


async def test_new_recovery_codes_replace_the_old_ones(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, _, old = await _enrol(api, resources, migrated, user)

    response = await api.post(RECOVERY, headers=cookie(token))

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    new = response.json()["recovery_codes"]
    assert len(new) == 10
    assert not set(new) & set(old)
    assert (
        await api.post(
            VERIFY, json={"recovery_code": old[0]}, headers=cookie(await _pending(api, user))
        )
    ).status_code == 401
    assert (
        await api.post(
            VERIFY, json={"recovery_code": new[0]}, headers=cookie(await _pending(api, user))
        )
    ).status_code == 200
    assert await audit_actions(migrated, response.headers["x-request-id"]) == [
        "auth.totp.recovery_codes_replaced"
    ]


async def test_recovery_codes_need_two_factor_and_a_fresh_session(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    fresh, _ = await open_session(resources, user, fresh=True)
    stale, _ = await open_session(resources, user)
    not_enabled = await api.post(RECOVERY, headers=cookie(fresh))
    assert (not_enabled.status_code, not_enabled.json()["code"]) == (409, "totp_not_enabled")
    assert (await api.post(RECOVERY, headers=cookie(stale))).status_code == 403


@pytest.mark.parametrize("role", ["viewer", "editor", "analyst", "billing"])
async def test_a_member_whose_role_allows_it_can_disable_two_factor(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, role: str
) -> None:
    user = await make_user(migrated)
    await add_member(migrated, await make_workspace(migrated), user, role)
    token, _, _ = await _enrol(api, resources, migrated, user)
    other, _ = await open_session(resources, user)

    response = await api.post(DISABLE, headers=cookie(token))

    assert (response.status_code, response.json()) == (200, {"status": "ok"})
    gone = await fetchrow(
        migrated, "SELECT count(*) AS n FROM auth.totp_secrets WHERE user_id = $1", user.id
    )
    assert gone["n"] == 0
    assert (await api.get(CURRENT, headers=cookie(other))).status_code == 401
    assert (await api.post(SIGN_IN, json={"email": user.email, "password": PASSWORD})).json() == {
        "status": "signed_in"
    }
    assert await audit_actions(migrated, response.headers["x-request-id"]) == ["auth.totp.disabled"]


@pytest.mark.parametrize("role", ["owner", "admin"])
async def test_an_owner_or_admin_cannot_disable_two_factor(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, role: str
) -> None:
    user = await make_user(migrated)
    await add_member(migrated, await make_workspace(migrated), user, "viewer")
    await add_member(migrated, await make_workspace(migrated), user, role)
    token, _, _ = await _enrol(api, resources, migrated, user)

    response = await api.post(DISABLE, headers=cookie(token))

    assert response.status_code == 403
    assert response.json()["code"] == "two_factor_required_for_role"
    kept = await fetchrow(
        migrated, "SELECT count(*) AS n FROM auth.totp_secrets WHERE user_id = $1", user.id
    )
    assert kept["n"] == 1


async def test_disable_needs_a_fresh_session_and_is_a_no_op_without_two_factor(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    fresh, _ = await open_session(resources, user, fresh=True)
    stale, _ = await open_session(resources, user)
    assert (await api.post(DISABLE, headers=cookie(stale))).status_code == 403
    response = await api.post(DISABLE, headers=cookie(fresh))
    assert response.status_code == 200
    assert await audit_actions(migrated, response.headers["x-request-id"]) == []
    assert (await api.get(CURRENT, headers=cookie(stale))).status_code == 200


# ---------------------------------------------------------------------------------------------
# Re-authentication


async def test_reauthenticating_with_the_password_rotates_the_session_and_makes_it_fresh(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    stale, session = await open_session(resources, user)
    before = datetime.now(UTC)

    response = await api.post(REAUTH, json={"password": PASSWORD}, headers=cookie(stale))

    assert response.status_code == 200
    fresh_until = datetime.fromisoformat(response.json()["fresh_until"])
    assert 595 <= (fresh_until - before).total_seconds() <= 605
    rotated = _new_cookie(response)
    assert rotated != stale
    assert (await api.get(FRESH, headers=cookie(rotated))).status_code == 200
    assert (await api.get(CURRENT, headers=cookie(stale))).status_code == 401
    row = await fetchrow(
        migrated,
        "SELECT absolute_expires_at FROM auth.sessions WHERE user_id = $1 AND revoked_at IS NULL",
        user.id,
    )
    assert row["absolute_expires_at"] == session.absolute_expires_at
    assert await audit_actions(migrated, response.headers["x-request-id"]) == [
        "auth.reauthenticated"
    ]


async def test_reauthenticating_with_a_totp_code_works_once(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    _, secret, _ = await _enrol(api, resources, migrated, user)
    stale, _ = await open_session(resources, user)
    code = _code(secret)

    first = await api.post(REAUTH, json={"totp_code": code}, headers=cookie(stale))
    rotated = _new_cookie(first)
    replay = await api.post(REAUTH, json={"totp_code": code}, headers=cookie(rotated))

    assert first.status_code == 200
    assert (replay.status_code, replay.json()["code"]) == (401, "invalid_credentials")
    assert (await api.get(FRESH, headers=cookie(rotated))).status_code == 200


async def test_a_wrong_credential_does_not_refresh_and_counts_as_a_failure(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    stale, _ = await open_session(resources, user)

    wrong_password = await api.post(
        REAUTH, json={"password": "not my password!"}, headers=cookie(stale)
    )
    no_totp = await api.post(REAUTH, json={"totp_code": "123456"}, headers=cookie(stale))

    for response in (wrong_password, no_totp):
        assert (response.status_code, response.json()["code"]) == (401, "invalid_credentials")
        assert "set-cookie" not in response.headers
    assert await audit_actions(migrated, wrong_password.headers["x-request-id"]) == [
        "auth.reauthenticate_failed"
    ]
    assert (await api.get(FRESH, headers=cookie(stale))).status_code == 403
    statuses = [
        (
            await api.post(REAUTH, json={"password": "not my password!"}, headers=cookie(stale))
        ).status_code
        for _ in range(4)
    ]
    assert statuses == [401, 401, 401, 429]


@pytest.mark.parametrize("body", [{}, {"password": PASSWORD, "totp_code": "123456"}])
async def test_reauthenticate_takes_exactly_one_credential(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, body: dict[str, object]
) -> None:
    user = await make_user(migrated)
    token, _ = await open_session(resources, user)
    assert (await api.post(REAUTH, json=body, headers=cookie(token))).status_code == 422
    assert (await api.post(REAUTH, json={"password": PASSWORD})).status_code == 401


# ---------------------------------------------------------------------------------------------
# What never appears


async def test_no_secret_code_or_recovery_code_is_logged(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    stream = io.StringIO()
    configure_logging(service="api", version="test", level="debug", stream=stream)
    _, secret, codes = await _enrol(api, resources, migrated, user)
    pending = await _pending(api, user)
    code = _code(secret)
    await api.post(VERIFY, json={"code": code}, headers=cookie(pending))
    await api.post(
        VERIFY, json={"recovery_code": codes[0]}, headers=cookie(await _pending(api, user))
    )

    logged = stream.getvalue()
    assert secret not in logged
    assert code not in logged
    for recovery in codes:
        assert recovery not in logged
        assert recovery.replace("-", "") not in logged


async def test_a_stored_secret_that_cannot_be_decrypted_is_an_error_not_a_bypass(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    await _enrol(api, resources, migrated, user)
    await execute(
        migrated,
        "UPDATE auth.totp_secrets SET secret_encrypted = '\\x01deadbeef' WHERE user_id = $1",
        user.id,
    )
    pending = await _pending(api, user)
    response = await api.post(VERIFY, json={"code": "123456"}, headers=cookie(pending))
    assert response.status_code == 500
    assert (await api.get(ME, headers=cookie(pending))).status_code == 401


async def test_two_confirmations_at_once_enable_two_factor_once(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, _ = await open_session(resources, user, fresh=True)
    secret = (await api.post(SETUP, headers=cookie(token))).json()["secret"]
    code = _code(secret)

    responses = await asyncio.gather(
        *(api.post(CONFIRM, json={"code": code}, headers=cookie(token)) for _ in range(4))
    )

    assert sorted(response.status_code for response in responses) == [200, 409, 409, 409]
    (winner,) = [response for response in responses if response.status_code == 200]
    row = await fetchrow(
        migrated, "SELECT recovery_code_hashes FROM auth.totp_secrets WHERE user_id = $1", user.id
    )
    assert sorted(row["recovery_code_hashes"]) == sorted(
        hash_recovery_code(item) for item in winner.json()["recovery_codes"]
    )


async def test_a_wrong_first_code_does_not_enable_two_factor(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, _ = await open_session(resources, user, fresh=True)
    secret = (await api.post(SETUP, headers=cookie(token))).json()["secret"]
    wrong = "000000" if _code(secret) != "000000" else "111111"

    response = await api.post(CONFIRM, json={"code": wrong}, headers=cookie(token))

    assert (response.status_code, response.json()["code"]) == (401, "invalid_code")
    assert await audit_actions(migrated, response.headers["x-request-id"]) == [
        "auth.totp.confirm_failed"
    ]
    row = await fetchrow(
        migrated, "SELECT confirmed_at FROM auth.totp_secrets WHERE user_id = $1", user.id
    )
    assert row["confirmed_at"] is None


async def test_a_code_is_not_spent_on_a_session_that_ended_meanwhile(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The cache still says live, the database says revoked: no new session, and no used step."""
    user = await make_user(migrated)
    _, secret, _ = await _enrol(api, resources, migrated, user)
    dying, session = await open_session(resources, user)
    assert (await api.get(CURRENT, headers=cookie(dying))).status_code == 200
    await execute(
        migrated, "UPDATE auth.sessions SET revoked_at = now() WHERE id = $1", session.session_id
    )
    code = _code(secret)

    refused = await api.post(VERIFY, json={"code": code}, headers=cookie(dying))
    accepted = await api.post(
        VERIFY, json={"code": code}, headers=cookie(await _pending(api, user))
    )

    assert (refused.status_code, refused.json()["code"]) == (401, "invalid_code")
    assert "set-cookie" not in refused.headers
    assert accepted.status_code == 200


async def test_a_password_cannot_refresh_a_session_that_ended_meanwhile(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    dying, session = await open_session(resources, user)
    assert (await api.get(CURRENT, headers=cookie(dying))).status_code == 200
    await execute(
        migrated, "UPDATE auth.sessions SET revoked_at = now() WHERE id = $1", session.session_id
    )
    response = await api.post(REAUTH, json={"password": PASSWORD}, headers=cookie(dying))
    assert response.status_code == 401
    assert "set-cookie" not in response.headers
    live = await fetchrow(
        migrated,
        "SELECT count(*) AS n FROM auth.sessions WHERE user_id = $1 AND revoked_at IS NULL",
        user.id,
    )
    assert live["n"] == 0


async def test_a_right_code_clears_earlier_wrong_ones(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Four wrong codes, the right one, then four more wrong: no lockout. A fifth locks."""
    user = await make_user(migrated)
    _, secret, _ = await _enrol(api, resources, migrated, user)
    wrong = "000000" if _code(secret) != "000000" else "111111"
    pending = await _pending(api, user)
    for _ in range(4):
        await api.post(VERIFY, json={"code": wrong}, headers=cookie(pending))
    assert (
        await api.post(VERIFY, json={"code": _code(secret)}, headers=cookie(pending))
    ).status_code == 200

    again = await _pending(api, user)
    statuses = [
        (await api.post(VERIFY, json={"code": wrong}, headers=cookie(again))).status_code
        for _ in range(4)
    ]
    lockouts_before = await fetchrow(
        migrated,
        "SELECT count(*) AS n FROM ops.audit_logs WHERE target_id = $1 AND action = 'auth.lockout'",
        str(user.id),
    )
    fifth = await api.post(VERIFY, json={"code": wrong}, headers=cookie(again))

    assert statuses == [401] * 4
    assert lockouts_before["n"] == 0
    assert await audit_actions(migrated, fifth.headers["x-request-id"]) == [
        "auth.totp.verify_failed",
        "auth.lockout",
    ]


async def test_two_factor_routes_refuse_an_account_disabled_a_moment_ago(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, _ = await open_session(resources, user, fresh=True)
    assert (await api.get(CURRENT, headers=cookie(token))).status_code == 200
    await execute(migrated, "UPDATE auth.users SET disabled_at = now() WHERE id = $1", user.id)
    assert (await api.post(SETUP, headers=cookie(token))).status_code == 401
    assert (
        await api.post(REAUTH, json={"password": PASSWORD}, headers=cookie(token))
    ).status_code == 401


async def test_nothing_about_a_disabled_account_can_be_changed_from_a_cached_session(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The cache keeps a session for up to a minute. It is not trusted for account changes."""
    user = await make_user(migrated, name="Jane Doe")
    token, _, _ = await _enrol(api, resources, migrated, user)
    assert (await api.get(CURRENT, headers=cookie(token))).status_code == 200
    before = await fetchrow(
        migrated, "SELECT recovery_code_hashes FROM auth.totp_secrets WHERE user_id = $1", user.id
    )
    await execute(migrated, "UPDATE auth.users SET disabled_at = now() WHERE id = $1", user.id)

    answers = {
        "recovery codes": await api.post(RECOVERY, headers=cookie(token)),
        "disable": await api.post(DISABLE, headers=cookie(token)),
        "profile": await api.patch(ME, json={"name": "Mallory"}, headers=cookie(token)),
        "me": await api.get(ME, headers=cookie(token)),
    }

    assert {name: answer.status_code for name, answer in answers.items()} == dict.fromkeys(
        answers, 401
    )
    after = await fetchrow(
        migrated,
        "SELECT t.recovery_code_hashes, u.name FROM auth.totp_secrets t "
        "JOIN auth.users u ON u.id = t.user_id WHERE t.user_id = $1",
        user.id,
    )
    assert after["recovery_code_hashes"] == before["recovery_code_hashes"]
    assert after["name"] == "Jane Doe"


async def test_re_authentication_is_limited_per_user(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("sightline.api.auth.service.REAUTHENTICATIONS_PER_HOUR", 2)
    user = await make_user(migrated)
    token, _ = await open_session(resources, user)
    statuses = []
    for _ in range(3):
        response = await api.post(REAUTH, json={"password": PASSWORD}, headers=cookie(token))
        statuses.append(response.status_code)
        if response.status_code == 200:
            token = _new_cookie(response)
    assert statuses == [200, 200, 429]


async def test_signing_in_again_does_not_buy_more_guesses_at_the_code(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Someone who knows the password still gets five wrong codes, not five per sign-in."""
    user = await make_user(migrated)
    _, secret, _ = await _enrol(api, resources, migrated, user)
    wrong = "000000" if _code(secret) != "000000" else "111111"

    statuses = []
    for _ in range(5):
        pending = await _pending(api, user)
        statuses.append(
            (await api.post(VERIFY, json={"code": wrong}, headers=cookie(pending))).status_code
        )
    locked = await api.post(SIGN_IN, json={"email": user.email, "password": PASSWORD})

    assert statuses == [401] * 5
    assert locked.status_code == 429


async def test_with_two_factor_on_the_password_alone_cannot_make_a_session_fresh(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """A stolen cookie plus the password must not be enough to replace the recovery codes."""
    user = await make_user(migrated)
    _, secret, _ = await _enrol(api, resources, migrated, user)
    stale, _ = await open_session(resources, user)

    refused = await api.post(REAUTH, json={"password": PASSWORD}, headers=cookie(stale))

    assert (refused.status_code, refused.json()["code"]) == (403, "second_factor_required")
    assert "set-cookie" not in refused.headers
    assert (await api.post(RECOVERY, headers=cookie(stale))).status_code == 403
    assert (await api.post(DISABLE, headers=cookie(stale))).status_code == 403
    accepted = await api.post(REAUTH, json={"totp_code": _code(secret)}, headers=cookie(stale))
    assert accepted.status_code == 200


async def test_once_a_later_step_is_used_earlier_codes_are_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The next step's code is inside the drift window. Using it closes the steps before it."""
    user = await make_user(migrated)
    _, secret, _ = await _enrol(api, resources, migrated, user)
    totp = pyotp.TOTP(secret)
    now = datetime.now(UTC)
    ahead, current, behind = (
        totp.at(now + timedelta(seconds=30)),
        totp.at(now),
        totp.at(now - timedelta(seconds=30)),
    )

    first = await api.post(VERIFY, json={"code": ahead}, headers=cookie(await _pending(api, user)))
    later = [
        await api.post(VERIFY, json={"code": code}, headers=cookie(await _pending(api, user)))
        for code in (behind, current, ahead)
    ]

    assert first.status_code == 200
    assert [response.status_code for response in later] == [401, 401, 401]


async def test_a_code_from_two_steps_ago_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    _, secret, _ = await _enrol(api, resources, migrated, user)
    stale = pyotp.TOTP(secret).at(datetime.now(UTC) - timedelta(seconds=61))
    response = await api.post(
        VERIFY, json={"code": stale}, headers=cookie(await _pending(api, user))
    )
    assert response.status_code == 401


async def test_a_setup_that_replaces_the_secret_cannot_be_confirmed_by_the_old_code(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The code was checked against one secret; a second setup swapped it before the write."""
    user = await make_user(migrated)
    token, _ = await open_session(resources, user, fresh=True)
    first = (await api.post(SETUP, headers=cookie(token))).json()["secret"]
    checked = await fetchrow(
        migrated, "SELECT secret_encrypted FROM auth.totp_secrets WHERE user_id = $1", user.id
    )
    second = (await api.post(SETUP, headers=cookie(token))).json()["secret"]
    step = int(datetime.now(UTC).timestamp()) // 30

    async with resources.sessions() as db, db.begin():
        confirmed = await repository.confirm_totp(
            db,
            user_id=user.id,
            secret_encrypted=checked["secret_encrypted"],
            step=step,
            recovery_code_hashes=[],
            now=datetime.now(UTC),
        )

    assert first != second
    assert confirmed is False
    row = await fetchrow(
        migrated, "SELECT confirmed_at FROM auth.totp_secrets WHERE user_id = $1", user.id
    )
    assert row["confirmed_at"] is None


async def test_enrolling_after_wrong_codes_leaves_no_failures_behind(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, _ = await open_session(resources, user, fresh=True)
    secret = (await api.post(SETUP, headers=cookie(token))).json()["secret"]
    wrong = "000000" if _code(secret) != "000000" else "111111"
    for _ in range(4):
        await api.post(CONFIRM, json={"code": wrong}, headers=cookie(token))
    assert (
        await api.post(CONFIRM, json={"code": _code(secret)}, headers=cookie(token))
    ).status_code == 200

    typo = await api.post(SIGN_IN, json={"email": user.email, "password": "one typo here!"})

    assert typo.status_code == 401
    assert await audit_actions(migrated, typo.headers["x-request-id"]) == ["auth.sign_in_failed"]


async def test_the_user_is_told_when_their_second_factor_changes(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
) -> None:
    user = await make_user(migrated)
    token, _, _ = await _enrol(api, resources, migrated, user)
    await api.post(RECOVERY, headers=cookie(token))
    await api.post(DISABLE, headers=cookie(token))
    await api.post(DISABLE, headers=cookie(token))  # already off: nothing to report

    assert [(message.to, message.subject) for message in mailbox.messages] == [
        (user.email, "Two-factor sign-in was turned on"),
        (user.email, "Your recovery codes were replaced"),
        (user.email, "Two-factor sign-in was turned off"),
    ]
    for message in mailbox.messages:
        assert re.findall(r"https://\S+", message.text) == [
            "https://app.example.com/reset-password"
        ]
