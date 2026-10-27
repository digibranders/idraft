"""Password reset and change (docs/19 section 3.1, docs/24 section 2; SEC-AUTH-02 and 03)."""

import asyncio
import hashlib
import re
import uuid

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.api.auth import repository
from idraft.api.auth.passwords import hash_password, verify_password
from idraft.api.auth.throttle import LoginThrottle, ThrottleUnavailableError
from idraft.api.resources import Resources
from tests.api.auth.support import (
    PASSWORD,
    RecordingEmailSender,
    audit_actions,
    cookie,
    execute,
    fetch,
    fetchrow,
    make_user,
    new_email,
    open_session,
)
from tests.api.conftest import AppFactory
from tests.conftest import PostgresServer

REQUEST = "/api/v1/auth/password-reset/request"
CONFIRM = "/api/v1/auth/password-reset/confirm"
CHANGE = "/api/v1/auth/password/change"
SIGN_IN = "/api/v1/auth/sign-in"
CURRENT = "/api/v1/_probe/current"
NEW_PASSWORD = "a brand new passphrase 42"


def _token(mailbox: RecordingEmailSender) -> str:
    (token,) = re.findall(r"#token=(\S+)", mailbox.messages[-1].text)
    return str(token)


async def _reset_token(api: httpx.AsyncClient, mailbox: RecordingEmailSender, email: str) -> str:
    assert (await api.post(REQUEST, json={"email": email})).status_code == 202
    assert mailbox.messages[-1].subject == "Reset your password"
    return _token(mailbox)


async def _can_sign_in(api: httpx.AsyncClient, email: str, password: str) -> bool:
    response = await api.post(SIGN_IN, json={"email": email, "password": password})
    return response.status_code == 200


# ---------------------------------------------------------------------------------------------
# Reset


async def test_a_reset_request_says_the_same_for_every_address(
    api: httpx.AsyncClient, migrated: PostgresServer, mailbox: RecordingEmailSender
) -> None:
    user = await make_user(migrated)
    unverified = await make_user(migrated, verified=False)
    disabled = await make_user(migrated, disabled=True)
    for email in (new_email(), user.email.upper(), unverified.email, disabled.email):
        response = await api.post(REQUEST, json={"email": email})
        assert (response.status_code, response.json()) == (202, {"status": "accepted"})
    assert [message.to for message in mailbox.messages] == [user.email, unverified.email]
    assert {message.subject for message in mailbox.messages} == {"Reset your password"}


async def test_a_reset_sets_the_password_and_ends_every_session(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
) -> None:
    """SEC-AUTH-03."""
    user = await make_user(migrated, verified=False)
    tokens = [(await open_session(resources, user))[0] for _ in range(3)]
    for token in tokens:
        assert (await api.get(CURRENT, headers=cookie(token))).status_code == 200
    reset = await _reset_token(api, mailbox, user.email)

    response = await api.post(CONFIRM, json={"token": reset, "new_password": NEW_PASSWORD})

    assert (response.status_code, response.json()) == (200, {"status": "ok"})
    assert "set-cookie" not in response.headers, "a reset does not sign anyone in"
    for token in tokens:
        assert (await api.get(CURRENT, headers=cookie(token))).status_code == 401
    assert await resources.redis.keys("session:*") == []
    assert not await _can_sign_in(api, user.email, PASSWORD)
    assert await _can_sign_in(api, user.email, NEW_PASSWORD)
    row = await fetchrow(migrated, "SELECT * FROM auth.users WHERE id = $1", user.id)
    assert row["password_hash"].startswith("$argon2id$")
    assert row["email_verified_at"] is not None, "the emailed token proves the mailbox"
    assert await audit_actions(migrated, response.headers["x-request-id"]) == [
        "auth.password.reset"
    ]
    notice = mailbox.messages[-1]
    assert (notice.to, notice.subject) == (user.email, "Your password was changed")
    assert "every session was signed out" in notice.text
    assert NEW_PASSWORD not in notice.text


async def test_the_stored_reset_token_is_a_hash(
    api: httpx.AsyncClient, migrated: PostgresServer, mailbox: RecordingEmailSender
) -> None:
    """SEC-AUTH-02."""
    user = await make_user(migrated)
    token = await _reset_token(api, mailbox, user.email)
    rows = await fetch(
        migrated,
        "SELECT purpose, token_hash, expires_at - now() AS life FROM auth.verification_tokens "
        "WHERE user_id = $1",
        user.id,
    )
    assert [(row["purpose"], row["token_hash"]) for row in rows] == [
        ("password_reset", hashlib.sha256(token.encode()).digest())
    ]
    assert 3590 <= rows[0]["life"].total_seconds() <= 3600


async def test_a_reset_token_works_once(
    api: httpx.AsyncClient, migrated: PostgresServer, mailbox: RecordingEmailSender
) -> None:
    user = await make_user(migrated)
    token = await _reset_token(api, mailbox, user.email)
    body = {"token": token, "new_password": NEW_PASSWORD}
    assert (await api.post(CONFIRM, json=body)).status_code == 200
    again = await api.post(
        CONFIRM, json={"token": token, "new_password": "another long passphrase"}
    )
    assert again.status_code == 400
    assert again.json()["code"] == "invalid_token"
    assert await _can_sign_in(api, user.email, NEW_PASSWORD)


async def test_two_resets_with_one_token_at_once_cannot_both_succeed(
    api: httpx.AsyncClient, migrated: PostgresServer, mailbox: RecordingEmailSender
) -> None:
    user = await make_user(migrated)
    token = await _reset_token(api, mailbox, user.email)
    responses = await asyncio.gather(
        *(
            api.post(CONFIRM, json={"token": token, "new_password": f"passphrase number {index} !"})
            for index in range(5)
        )
    )
    assert sorted(response.status_code for response in responses) == [200, 400, 400, 400, 400]


async def test_every_unusable_reset_token_gets_the_same_answer(
    api: httpx.AsyncClient, migrated: PostgresServer, mailbox: RecordingEmailSender
) -> None:
    user = await make_user(migrated)
    expired = await _reset_token(api, mailbox, user.email)
    await execute(
        migrated,
        "UPDATE auth.verification_tokens SET expires_at = now() - interval '1 second' "
        "WHERE token_hash = $1",
        hashlib.sha256(expired.encode()).digest(),
    )
    verification = "v" * 43
    await execute(
        migrated,
        "INSERT INTO auth.verification_tokens (user_id, purpose, token_hash, expires_at) "
        "VALUES ($1, 'email_verification', $2, now() + interval '1 day')",
        user.id,
        hashlib.sha256(verification.encode()).digest(),
    )
    bodies = []
    for token in (expired, verification, "made-up"):
        response = await api.post(CONFIRM, json={"token": token, "new_password": NEW_PASSWORD})
        assert response.status_code == 400
        body = response.json()
        body.pop("request_id")
        bodies.append(body)
    assert all(body == bodies[0] for body in bodies)
    assert await _can_sign_in(api, user.email, PASSWORD)


@pytest.mark.parametrize(
    ("password", "reason"), [("tiny pw", "too_short"), ("x" * 129, "too_long")]
)
async def test_a_weak_new_password_is_refused_and_the_token_stays_usable(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
    password: str,
    reason: str,
) -> None:
    user = await make_user(migrated)
    token = await _reset_token(api, mailbox, user.email)

    refused = await api.post(CONFIRM, json={"token": token, "new_password": password})

    assert refused.status_code == 422
    assert (refused.json()["code"], refused.json()["reason"]) == ("weak_password", reason)
    assert await _can_sign_in(api, user.email, PASSWORD)
    accepted = await api.post(CONFIRM, json={"token": token, "new_password": NEW_PASSWORD})
    assert accepted.status_code == 200


async def test_a_breached_new_password_is_refused(
    client_for: AppFactory, migrated: PostgresServer, mailbox: RecordingEmailSender
) -> None:
    digest = hashlib.sha1(NEW_PASSWORD.encode(), usedforsecurity=False).hexdigest().upper()

    def pwned(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=f"{digest[5:]}:3\r\n")

    user = await make_user(migrated)
    async with client_for(
        breached_password_check=True, http_transport=httpx.MockTransport(pwned)
    ) as api:
        token = await _reset_token(api, mailbox, user.email)
        response = await api.post(CONFIRM, json={"token": token, "new_password": NEW_PASSWORD})
    assert response.status_code == 422
    assert response.json()["reason"] == "breached"


async def test_a_reset_lets_a_locked_out_user_back_in(
    api: httpx.AsyncClient, migrated: PostgresServer, mailbox: RecordingEmailSender
) -> None:
    user = await make_user(migrated)
    for _ in range(5):
        await api.post(SIGN_IN, json={"email": user.email, "password": "the wrong password"})
    assert (
        await api.post(SIGN_IN, json={"email": user.email, "password": PASSWORD})
    ).status_code == 429

    token = await _reset_token(api, mailbox, user.email)
    assert (
        await api.post(CONFIRM, json={"token": token, "new_password": NEW_PASSWORD})
    ).status_code == 200

    assert await _can_sign_in(api, user.email, NEW_PASSWORD)


async def test_a_disabled_user_cannot_reset(
    api: httpx.AsyncClient, migrated: PostgresServer, mailbox: RecordingEmailSender
) -> None:
    user = await make_user(migrated)
    token = await _reset_token(api, mailbox, user.email)
    await execute(migrated, "UPDATE auth.users SET disabled_at = now() WHERE id = $1", user.id)
    response = await api.post(CONFIRM, json={"token": token, "new_password": NEW_PASSWORD})
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_token"


# ---------------------------------------------------------------------------------------------
# Change


async def test_changing_the_password_needs_a_fresh_session(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, _ = await open_session(resources, user)
    body = {"current_password": PASSWORD, "new_password": NEW_PASSWORD}

    anonymous = await api.post(CHANGE, json=body)
    stale = await api.post(CHANGE, json=body, headers=cookie(token))

    assert anonymous.status_code == 401
    assert stale.status_code == 403
    assert stale.json()["code"] == "fresh_session_required"
    assert await _can_sign_in(api, user.email, PASSWORD)


async def test_a_change_keeps_this_session_and_ends_the_others(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
) -> None:
    """SEC-AUTH-03."""
    user = await make_user(migrated)
    mine, session = await open_session(resources, user, fresh=True)
    others = [(await open_session(resources, user))[0] for _ in range(2)]
    for token in others:
        assert (await api.get(CURRENT, headers=cookie(token))).status_code == 200

    response = await api.post(
        CHANGE,
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
        headers=cookie(mine),
    )

    assert (response.status_code, response.json()) == (200, {"status": "ok"})
    assert (await api.get(CURRENT, headers=cookie(mine))).status_code == 200
    for token in others:
        assert (await api.get(CURRENT, headers=cookie(token))).status_code == 401
    cached = [
        key.decode() if isinstance(key, bytes) else key
        for key in await resources.redis.keys("session:*")
    ]
    assert cached == [f"session:{hashlib.sha256(mine.encode()).hexdigest()}"]
    assert not await _can_sign_in(api, user.email, PASSWORD)
    assert await _can_sign_in(api, user.email, NEW_PASSWORD)
    assert await audit_actions(migrated, response.headers["x-request-id"]) == [
        "auth.password.changed"
    ]
    notice = mailbox.messages[-1]
    assert (notice.to, notice.subject) == (user.email, "Your password was changed")
    assert "every other session was signed out" in notice.text
    assert session.user_id == user.id


async def test_a_wrong_current_password_changes_nothing_and_counts_as_a_failure(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, _ = await open_session(resources, user, fresh=True)
    body = {"current_password": "not my password!", "new_password": NEW_PASSWORD}

    responses = [await api.post(CHANGE, json=body, headers=cookie(token)) for _ in range(6)]

    assert [response.status_code for response in responses] == [401] * 5 + [429]
    assert responses[0].json()["code"] == "invalid_credentials"
    assert await audit_actions(migrated, responses[0].headers["x-request-id"]) == [
        "auth.password.change_failed"
    ]
    row = await fetchrow(migrated, "SELECT password_hash FROM auth.users WHERE id = $1", user.id)
    assert row["password_hash"].startswith("$argon2id$")
    # The account is locked for sign-in now; the existing session still works.
    assert (await api.get(CURRENT, headers=cookie(token))).status_code == 200


@pytest.mark.parametrize(
    ("new_password", "reason"),
    [(PASSWORD, "unchanged"), ("tiny pw", "too_short"), ("x" * 129, "too_long")],
)
async def test_a_weak_or_unchanged_new_password_is_refused(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    new_password: str,
    reason: str,
) -> None:
    user = await make_user(migrated)
    token, _ = await open_session(resources, user, fresh=True)
    other, _ = await open_session(resources, user)

    response = await api.post(
        CHANGE,
        json={"current_password": PASSWORD, "new_password": new_password},
        headers=cookie(token),
    )

    assert response.status_code == 422
    assert (response.json()["code"], response.json()["reason"]) == ("weak_password", reason)
    assert (await api.get(CURRENT, headers=cookie(other))).status_code == 200


async def test_no_password_appears_in_a_response(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, _ = await open_session(resources, user, fresh=True)
    response = await api.post(
        CHANGE,
        json={"current_password": "not my password!", "new_password": NEW_PASSWORD},
        headers=cookie(token),
    )
    assert "not my password!" not in response.text
    assert NEW_PASSWORD not in response.text


async def test_a_reset_succeeds_even_if_the_account_lock_cannot_be_cleared(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await make_user(migrated)
    token = await _reset_token(api, mailbox, user.email)

    async def unavailable(self: object, *, email: str) -> None:
        raise ThrottleUnavailableError

    monkeypatch.setattr(LoginThrottle, "clear", unavailable)
    response = await api.post(CONFIRM, json={"token": token, "new_password": NEW_PASSWORD})
    monkeypatch.undo()

    assert response.status_code == 200
    assert await _can_sign_in(api, user.email, NEW_PASSWORD)


async def test_a_change_is_refused_when_the_account_is_gone(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, _ = await open_session(resources, user, fresh=True)
    assert (await api.get(CURRENT, headers=cookie(token))).status_code == 200
    await execute(migrated, "DELETE FROM auth.users WHERE id = $1", user.id)
    response = await api.post(
        CHANGE,
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
        headers=cookie(token),
    )
    assert response.status_code == 401


async def test_a_change_racing_another_change_is_decided_by_the_stored_password(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Someone else changed the password after ours was checked: our old one no longer counts."""
    user = await make_user(migrated)
    token, _ = await open_session(resources, user, fresh=True)
    other, _ = await open_session(resources, user)
    real = repository.lock_password_hash
    theirs = hash_password("the password someone else just set")

    async def changed_meanwhile(
        db: AsyncSession, user_id: uuid.UUID, *, exclusive: bool
    ) -> str | None:
        await execute(
            migrated, "UPDATE auth.users SET password_hash = $1 WHERE id = $2", theirs, user_id
        )
        return await real(db, user_id, exclusive=exclusive)

    monkeypatch.setattr(repository, "lock_password_hash", changed_meanwhile)
    response = await api.post(
        CHANGE,
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
        headers=cookie(token),
    )

    assert response.status_code == 401
    assert await audit_actions(migrated, response.headers["x-request-id"]) == [
        "auth.password.change_failed"
    ]
    row = await fetchrow(migrated, "SELECT password_hash FROM auth.users WHERE id = $1", user.id)
    assert row["password_hash"] == theirs
    assert (await api.get(CURRENT, headers=cookie(other))).status_code == 200


async def test_a_right_change_clears_earlier_wrong_attempts(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, _ = await open_session(resources, user, fresh=True)
    for _ in range(4):
        await api.post(
            CHANGE,
            json={"current_password": "not my password!", "new_password": NEW_PASSWORD},
            headers=cookie(token),
        )
    changed = await api.post(
        CHANGE,
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
        headers=cookie(token),
    )
    assert changed.status_code == 200

    typo = await api.post(SIGN_IN, json={"email": user.email, "password": "one typo here"})

    assert typo.status_code == 401
    assert await _can_sign_in(api, user.email, NEW_PASSWORD)


async def test_the_fifth_wrong_current_password_records_a_lockout(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, _ = await open_session(resources, user, fresh=True)
    body = {"current_password": "not my password!", "new_password": NEW_PASSWORD}
    responses = [await api.post(CHANGE, json=body, headers=cookie(token)) for _ in range(5)]
    assert await audit_actions(migrated, responses[4].headers["x-request-id"]) == [
        "auth.password.change_failed",
        "auth.lockout",
    ]


async def test_a_wrong_password_is_recorded_even_when_redis_cannot_count(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await make_user(migrated)
    token, _ = await open_session(resources, user, fresh=True)

    async def unavailable(self: object, *, email: str, ip: str) -> bool:
        raise ThrottleUnavailableError

    monkeypatch.setattr(LoginThrottle, "failure", unavailable)
    change = await api.post(
        CHANGE,
        json={"current_password": "not my password!", "new_password": NEW_PASSWORD},
        headers=cookie(token),
    )
    sign_in = await api.post(SIGN_IN, json={"email": user.email, "password": "wrong password"})

    assert (change.status_code, sign_in.status_code) == (503, 503)
    assert await audit_actions(migrated, change.headers["x-request-id"]) == [
        "auth.password.change_failed"
    ]
    assert await audit_actions(migrated, sign_in.headers["x-request-id"]) == ["auth.sign_in_failed"]


async def test_a_user_disabled_a_moment_ago_cannot_change_the_password_or_the_profile(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The session is still in the cache for up to a minute; the account check is not."""
    user = await make_user(migrated, name="Jane Doe")
    token, _ = await open_session(resources, user, fresh=True)
    assert (await api.get(CURRENT, headers=cookie(token))).status_code == 200
    await execute(migrated, "UPDATE auth.users SET disabled_at = now() WHERE id = $1", user.id)

    change = await api.post(
        CHANGE,
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
        headers=cookie(token),
    )
    await api.patch("/api/v1/me", json={"name": "Mallory"}, headers=cookie(token))

    assert change.status_code == 401
    row = await fetchrow(
        migrated, "SELECT name, password_hash FROM auth.users WHERE id = $1", user.id
    )
    assert row["name"] == "Jane Doe"
    assert verify_password(row["password_hash"], PASSWORD)


async def test_a_user_disabled_while_the_new_password_was_hashed_keeps_the_old_one(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await make_user(migrated)
    token = await _reset_token(api, mailbox, user.email)
    real = hash_password

    def hash_after_disabling(password: str) -> str:
        encoded = real(password)
        asyncio.run(
            execute(migrated, "UPDATE auth.users SET disabled_at = now() WHERE id = $1", user.id)
        )
        return encoded

    monkeypatch.setattr("idraft.api.auth.service.hash_password", hash_after_disabling)
    response = await api.post(CONFIRM, json={"token": token, "new_password": NEW_PASSWORD})

    assert (response.status_code, response.json()["code"]) == (400, "invalid_token")
    row = await fetchrow(
        migrated,
        "SELECT u.password_hash, t.consumed_at FROM auth.users u "
        "JOIN auth.verification_tokens t ON t.user_id = u.id WHERE u.id = $1",
        user.id,
    )
    assert verify_password(row["password_hash"], PASSWORD)
    assert row["consumed_at"] is None


async def test_a_reset_does_not_remove_the_second_factor(
    api: httpx.AsyncClient, migrated: PostgresServer, mailbox: RecordingEmailSender
) -> None:
    user = await make_user(migrated)
    await execute(
        migrated,
        "INSERT INTO auth.totp_secrets (user_id, secret_encrypted, confirmed_at) "
        "VALUES ($1, '\\x01', now())",
        user.id,
    )
    token = await _reset_token(api, mailbox, user.email)
    assert (
        await api.post(CONFIRM, json={"token": token, "new_password": NEW_PASSWORD})
    ).status_code == 200

    response = await api.post(SIGN_IN, json={"email": user.email, "password": NEW_PASSWORD})

    assert response.json() == {"status": "totp_required"}


async def test_two_changes_at_once_from_two_sessions_leave_one_password(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    first, _ = await open_session(resources, user, fresh=True)
    second, _ = await open_session(resources, user, fresh=True)
    candidates = ["the first new passphrase", "the second new passphrase"]

    responses = await asyncio.gather(
        *(
            api.post(
                CHANGE,
                json={"current_password": PASSWORD, "new_password": candidate},
                headers=cookie(token),
            )
            for token, candidate in zip((first, second), candidates, strict=True)
        )
    )

    assert sorted(response.status_code for response in responses) == [200, 401]
    working = [
        item for item in [PASSWORD, *candidates] if await _can_sign_in(api, user.email, item)
    ]
    assert len(working) == 1
    assert working[0] in candidates
