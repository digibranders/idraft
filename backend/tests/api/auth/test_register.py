"""Registration and email verification (docs/19 section 3.1, docs/24 section 2; SEC-AUTH-02)."""

import asyncio
import hashlib
import io
import json
import re
import uuid
from datetime import timedelta

import httpx
import pytest

from idraft.api.auth import passwords
from idraft.api.auth.throttle import LoginThrottle, ThrottleUnavailableError
from idraft.api.request_info import request_info
from idraft.config.logging import configure_logging
from tests.api.auth.support import (
    PASSWORD,
    RecordingEmailSender,
    audit_actions,
    execute,
    fetch,
    fetchrow,
    make_invitation,
    make_user,
    new_email,
)
from tests.api.conftest import AppFactory
from tests.conftest import PostgresServer

REGISTER = "/api/v1/auth/register"
REQUEST = "/api/v1/auth/verify-email/request"
VERIFY = "/api/v1/auth/verify-email"


def _body(email: str, **changes: object) -> dict[str, object]:
    return {"name": "Jane Doe", "email": email, "password": PASSWORD, **changes}


def _token(mailbox: RecordingEmailSender) -> str:
    (link,) = re.findall(r"#token=(\S+)", mailbox.messages[-1].text)
    return str(link)


async def _user_count(pg: PostgresServer, email: str) -> int:
    row = await fetchrow(pg, "SELECT count(*) AS n FROM auth.users WHERE email = $1", email)
    return int(row["n"])


# ---------------------------------------------------------------------------------------------
# Registration by invitation (the default)


async def test_without_an_invitation_registration_is_closed(
    api: httpx.AsyncClient, migrated: PostgresServer, mailbox: RecordingEmailSender
) -> None:
    email = new_email()
    response = await api.post(REGISTER, json=_body(email))
    assert response.status_code == 403
    assert response.json()["code"] == "registration_closed"
    assert await _user_count(migrated, email) == 0
    assert mailbox.messages == []


async def test_every_unusable_invitation_gets_the_same_answer(
    api: httpx.AsyncClient, migrated: PostgresServer
) -> None:
    email = new_email()
    tokens = {
        "unknown": "z" * 43,
        "expired": await make_invitation(migrated, email=email, expires_in=timedelta(seconds=-1)),
        "cancelled": await make_invitation(migrated, email=email, status="cancelled"),
        "accepted": await make_invitation(migrated, email=email, status="accepted"),
        "someone else's": await make_invitation(migrated, email=new_email()),
    }
    bodies = []
    for label, token in tokens.items():
        response = await api.post(REGISTER, json=_body(email, invitation_token=token))
        assert response.status_code == 403, label
        body = response.json()
        body.pop("request_id")
        bodies.append(body)
    assert all(body == bodies[0] for body in bodies)
    assert bodies[0]["code"] == "registration_closed"
    assert await _user_count(migrated, email) == 0


async def test_a_valid_invitation_creates_a_verified_account_without_an_email(
    api: httpx.AsyncClient, migrated: PostgresServer, mailbox: RecordingEmailSender
) -> None:
    email = new_email()
    token = await make_invitation(migrated, email=email.upper())

    response = await api.post(REGISTER, json=_body(email, invitation_token=token))

    assert response.status_code == 201
    body = response.json()
    assert body["email_verified"] is True
    row = await fetchrow(migrated, "SELECT * FROM auth.users WHERE id = $1::uuid", body["user_id"])
    assert row["email"] == email
    assert row["email_verified_at"] is not None
    assert row["is_platform_operator"] is False
    assert mailbox.messages == []
    assert await audit_actions(migrated, response.headers["x-request-id"]) == ["auth.register"]


# ---------------------------------------------------------------------------------------------
# Open registration


async def test_open_registration_creates_an_unverified_account_and_sends_one_email(
    client_for: AppFactory, migrated: PostgresServer, mailbox: RecordingEmailSender
) -> None:
    email = new_email()
    async with client_for(registration="open") as api:
        response = await api.post(REGISTER, json=_body(f"  {email}  ", name="  Jane   Doe "))

    assert response.status_code == 201
    assert response.json()["email_verified"] is False
    row = await fetchrow(migrated, "SELECT * FROM auth.users WHERE email = $1", email)
    assert (row["name"], row["email_verified_at"]) == ("Jane   Doe", None)
    assert [message.to for message in mailbox.messages] == [email]
    assert mailbox.messages[0].subject == "Confirm your email address"


async def test_what_is_stored_cannot_be_replayed(
    client_for: AppFactory, migrated: PostgresServer, mailbox: RecordingEmailSender
) -> None:
    """SEC-AUTH-02."""
    email = new_email()
    stream = io.StringIO()
    async with client_for(registration="open") as api:
        configure_logging(service="api", version="test", level="debug", stream=stream)
        response = await api.post(REGISTER, json=_body(email))
    token = _token(mailbox)

    user = await fetchrow(migrated, "SELECT * FROM auth.users WHERE email = $1", email)
    assert user["password_hash"].startswith("$argon2id$v=19$m=19456,t=2,p=1$")
    stored = await fetch(
        migrated, "SELECT * FROM auth.verification_tokens WHERE user_id = $1", user["id"]
    )
    assert [row["token_hash"] for row in stored] == [hashlib.sha256(token.encode()).digest()]
    assert stored[0]["purpose"] == "email_verification"
    for leaked in (PASSWORD, token):
        assert leaked not in response.text
        assert leaked not in stream.getvalue()
        assert leaked not in repr([dict(row) for row in stored]) + repr(dict(user))


@pytest.mark.parametrize(
    ("password", "reason"),
    [
        ("tiny pw", "too_short"),
        ("x" * 129, "too_long"),
    ],
)
async def test_a_weak_password_is_refused_with_its_reason(
    client_for: AppFactory, migrated: PostgresServer, password: str, reason: str
) -> None:
    email = "new-account@client.example"
    async with client_for(registration="open") as api:
        response = await api.post(REGISTER, json=_body(email, password=password))
    assert response.status_code == 422
    body = response.json()
    assert (body["code"], body["reason"]) == ("weak_password", reason)
    assert password not in response.text
    assert await _user_count(migrated, email) == 0


async def test_a_breached_password_is_refused(
    client_for: AppFactory, migrated: PostgresServer
) -> None:
    digest = hashlib.sha1(PASSWORD.encode(), usedforsecurity=False).hexdigest().upper()
    seen: list[str] = []

    def pwned(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(200, text=f"{digest[5:]}:42\r\n")

    email = new_email()
    async with client_for(
        registration="open",
        breached_password_check=True,
        http_transport=httpx.MockTransport(pwned),
    ) as api:
        response = await api.post(REGISTER, json=_body(email))

    assert response.status_code == 422
    assert response.json()["reason"] == "breached"
    assert seen == [f"https://api.pwnedpasswords.com/range/{digest[:5]}"]
    assert await _user_count(migrated, email) == 0


async def test_an_existing_email_is_a_duplicate_in_any_letter_case(
    client_for: AppFactory, migrated: PostgresServer, mailbox: RecordingEmailSender
) -> None:
    existing = await make_user(migrated)
    async with client_for(registration="open") as api:
        response = await api.post(REGISTER, json=_body(existing.email.upper()))
    assert response.status_code == 409
    assert response.json()["code"] == "duplicate"
    assert mailbox.messages == []
    assert await _user_count(migrated, existing.email) == 1


@pytest.mark.parametrize(
    "body",
    [
        {"name": "", "email": "a@b.example", "password": PASSWORD},
        {"name": "x" * 121, "email": "a@b.example", "password": PASSWORD},
        {"name": "Jane\u0000", "email": "a@b.example", "password": PASSWORD},
        {"name": "Jane\u202e", "email": "a@b.example", "password": PASSWORD},
        {"name": "Jane", "email": "not an address", "password": PASSWORD},
        {"name": "Jane", "email": "a@b.example, c@d.example", "password": PASSWORD},
        {"name": "Jane", "email": "a@b.example", "password": "x" * 1025},
        {
            "name": "Jane",
            "email": "a@b.example",
            "password": PASSWORD,
            "is_platform_operator": True,
        },
        {"name": "Jane", "email": "a@b.example"},
    ],
)
async def test_a_malformed_body_is_a_validation_error(
    client_for: AppFactory, body: dict[str, object]
) -> None:
    async with client_for(registration="open") as api:
        response = await api.post(REGISTER, json=body)
    assert response.status_code == 422
    assert response.json()["code"] == "validation_failed"
    assert PASSWORD not in response.text


@pytest.mark.parametrize(
    ("path", "raw"),
    [
        (REGISTER, b'{"name": "Jane", "email": "a@b.example", "password": "\\ud800 long enough"}'),
        (
            REGISTER,
            b'{"name": "Ja\\ud800ne", "email": "a@b.example", "password": "long enough pw"}',
        ),
        (
            REGISTER,
            b'{"name": "Jane", "email": "a\\ud800@b.example", "password": "long enough pw"}',
        ),
        (VERIFY, b'{"token": "\\ud800"}'),
        (REQUEST, b'{"email": "a\\ud800@b.example"}'),
        ("/api/v1/auth/sign-in", b'{"email": "a@b.example", "password": "\\ud800"}'),
    ],
)
async def test_text_that_utf8_cannot_carry_is_a_validation_error_not_a_crash(
    client_for: AppFactory, path: str, raw: bytes
) -> None:
    """JSON can carry a lone surrogate. The hashers and the database cannot."""
    async with client_for(registration="open") as api:
        response = await api.post(path, content=raw, headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert response.json()["code"] == "validation_failed"


async def test_registrations_from_one_address_are_limited(client_for: AppFactory) -> None:
    async with client_for(registration="open") as api:
        statuses = [
            (await api.post(REGISTER, json=_body(new_email(), password="short"))).status_code
            for _ in range(11)
        ]
    assert statuses == [422] * 10 + [429]


# ---------------------------------------------------------------------------------------------
# Email verification


async def test_the_emailed_token_verifies_the_address_once(
    client_for: AppFactory, migrated: PostgresServer, mailbox: RecordingEmailSender
) -> None:
    email = new_email()
    async with client_for(registration="open") as api:
        await api.post(REGISTER, json=_body(email))
        token = _token(mailbox)
        first = await api.post(VERIFY, json={"token": token})
        second = await api.post(VERIFY, json={"token": token})

    assert first.status_code == 200
    assert second.status_code == 400
    assert second.json()["code"] == "invalid_token"
    row = await fetchrow(
        migrated, "SELECT email_verified_at FROM auth.users WHERE email = $1", email
    )
    assert row["email_verified_at"] is not None
    assert await audit_actions(migrated, first.headers["x-request-id"]) == ["auth.email_verified"]
    assert await audit_actions(migrated, second.headers["x-request-id"]) == []


async def test_every_unusable_token_gets_the_same_answer(
    client_for: AppFactory, migrated: PostgresServer, mailbox: RecordingEmailSender
) -> None:
    email = new_email()
    async with client_for(registration="open") as api:
        await api.post(REGISTER, json=_body(email))
        expired = _token(mailbox)
        await execute(
            migrated,
            "UPDATE auth.verification_tokens SET expires_at = now() - interval '1 second' "
            "WHERE token_hash = $1",
            hashlib.sha256(expired.encode()).digest(),
        )
        wrong_purpose = "w" * 43
        user = await fetchrow(migrated, "SELECT id FROM auth.users WHERE email = $1", email)
        await execute(
            migrated,
            "INSERT INTO auth.verification_tokens (user_id, purpose, token_hash, expires_at) "
            "VALUES ($1, 'password_reset', $2, now() + interval '1 hour')",
            user["id"],
            hashlib.sha256(wrong_purpose.encode()).digest(),
        )
        bodies = []
        for token in (expired, wrong_purpose, "made-up-token", "x" * 128):
            response = await api.post(VERIFY, json={"token": token})
            assert response.status_code == 400
            body = response.json()
            body.pop("request_id")
            bodies.append(body)
    assert all(body == bodies[0] for body in bodies)
    row = await fetchrow(
        migrated, "SELECT email_verified_at FROM auth.users WHERE email = $1", email
    )
    assert row["email_verified_at"] is None


async def test_two_uses_of_one_token_at_once_cannot_both_succeed(
    client_for: AppFactory, mailbox: RecordingEmailSender
) -> None:
    async with client_for(registration="open") as api:
        await api.post(REGISTER, json=_body(new_email()))
        token = _token(mailbox)
        responses = await asyncio.gather(
            *(api.post(VERIFY, json={"token": token}) for _ in range(8))
        )
    assert sorted(response.status_code for response in responses) == [200] + [400] * 7


async def test_a_new_link_replaces_the_old_one(
    client_for: AppFactory, mailbox: RecordingEmailSender
) -> None:
    email = new_email()
    async with client_for(registration="open") as api:
        await api.post(REGISTER, json=_body(email))
        first = _token(mailbox)
        assert (await api.post(REQUEST, json={"email": email})).status_code == 202
        second = _token(mailbox)
        assert first != second
        assert (await api.post(VERIFY, json={"token": first})).status_code == 400
        assert (await api.post(VERIFY, json={"token": second})).status_code == 200


async def test_a_verification_request_says_the_same_for_every_address(
    client_for: AppFactory, migrated: PostgresServer, mailbox: RecordingEmailSender
) -> None:
    verified = await make_user(migrated)
    disabled = await make_user(migrated, verified=False, disabled=True)
    unverified = await make_user(migrated, verified=False)
    async with client_for(registration="open") as api:
        answers = []
        for email in (new_email(), verified.email, disabled.email, unverified.email):
            response = await api.post(REQUEST, json={"email": email})
            assert response.status_code == 202
            answers.append(response.json())
    assert all(answer == {"status": "accepted"} for answer in answers)
    assert [message.to for message in mailbox.messages] == [unverified.email]


async def test_at_most_three_emails_an_hour_go_to_one_address(
    client_for: AppFactory, migrated: PostgresServer, mailbox: RecordingEmailSender
) -> None:
    user = await make_user(migrated, verified=False)
    async with client_for(registration="open") as api:
        for _ in range(5):
            assert (await api.post(REQUEST, json={"email": user.email})).status_code == 202
    assert len(mailbox.messages) == 3


async def test_a_failing_email_provider_does_not_fail_the_request(
    client_for: AppFactory, migrated: PostgresServer, mailbox: RecordingEmailSender
) -> None:
    class Broken:
        async def send(self, message: object) -> None:
            raise RuntimeError("provider down with SECRET detail")

    stream = io.StringIO()
    email = new_email()
    async with client_for(registration="open") as api:
        api._transport.app.state.resources.auth._email = Broken()  # type: ignore[attr-defined]
        configure_logging(service="api", version="test", level="info", stream=stream)
        response = await api.post(REGISTER, json=_body(email))
    assert response.status_code == 201
    lines = [json.loads(raw) for raw in stream.getvalue().splitlines()]
    (failure,) = [line for line in lines if line["msg"] == "email was not sent"]
    assert failure["error_kind"] == "RuntimeError"
    assert "SECRET" not in stream.getvalue()
    assert await _user_count(migrated, email) == 1


async def test_background_work_that_fails_is_logged_and_nothing_else(
    client_for: AppFactory,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await make_user(migrated, verified=False)
    stream = io.StringIO()

    async def broken(*args: object, **kwargs: object) -> None:
        raise RuntimeError("the database went away with SECRET detail")

    monkeypatch.setattr("idraft.api.auth.repository.find_user_by_email", broken)
    async with client_for(registration="open") as api:
        configure_logging(service="api", version="test", level="info", stream=stream)
        response = await api.post(REQUEST, json={"email": user.email})

    assert response.status_code == 202
    lines = [json.loads(raw) for raw in stream.getvalue().splitlines()]
    (failure,) = [line for line in lines if line["msg"] == "background auth work failed"]
    assert failure["error_kind"] == "RuntimeError"
    assert "SECRET" not in stream.getvalue()
    assert mailbox.messages == []


async def test_an_email_request_is_dropped_when_the_limiter_cannot_count(
    client_for: AppFactory,
    migrated: PostgresServer,
    mailbox: RecordingEmailSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await make_user(migrated, verified=False)
    stream = io.StringIO()
    async with client_for(registration="open") as api:
        first = await api.post(REQUEST, json={"email": user.email})

        async def unavailable(self: object, *args: object, **kwargs: object) -> bool:
            raise ThrottleUnavailableError

        # The per-address limit passed before the response; the per-mailbox one runs after it.
        monkeypatch.setattr(LoginThrottle, "allow", unavailable)
        service = api._transport.app.state.resources.auth  # type: ignore[attr-defined]
        configure_logging(service="api", version="test", level="info", stream=stream)
        await service.request_email_verification(
            email=user.email,
            info=request_info(client_host="203.0.113.7", user_agent=None, request_id=None),
        )

    assert first.status_code == 202
    assert len(mailbox.messages) == 1
    assert "email request dropped: throttle unavailable" in stream.getvalue()


@pytest.mark.parametrize(
    ("invited", "typed"),
    [
        ("stra\u00dfe-x@corp.example", "strasse-x@corp.example"),
        ("\ufb01nance@corp.example", "finance@corp.example"),
        ("jane@corp.example", "jane@corp.example.evil.test"),
        ("jane@corp.example", "jane+other@corp.example"),
    ],
)
async def test_an_invitation_verifies_only_the_address_it_was_sent_to(
    api: httpx.AsyncClient, migrated: PostgresServer, invited: str, typed: str
) -> None:
    """Two addresses that fold to the same text are still two accounts to the database."""
    unique = uuid.uuid4().hex[:8]
    invited, typed = f"{unique}{invited}", f"{unique}{typed}"
    token = await make_invitation(migrated, email=invited)

    response = await api.post(REGISTER, json=_body(typed, invitation_token=token))

    assert response.status_code == 403
    assert response.json()["code"] == "registration_closed"
    assert await _user_count(migrated, typed) == 0


async def test_an_invitation_cancelled_while_the_password_was_hashed_is_not_honoured(
    api: httpx.AsyncClient, migrated: PostgresServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    email = new_email()
    token = await make_invitation(migrated, email=email)
    real = passwords.hash_password

    def hash_after_cancelling(password: str) -> str:
        encoded = real(password)
        asyncio.run(
            execute(
                migrated, "UPDATE auth.invitations SET status = 'cancelled' WHERE email = $1", email
            )
        )
        return encoded

    monkeypatch.setattr("idraft.api.auth.service.hash_password", hash_after_cancelling)
    response = await api.post(REGISTER, json=_body(email, invitation_token=token))

    assert response.status_code == 403
    assert await _user_count(migrated, email) == 0


@pytest.mark.parametrize(
    "email", ["jane\u202e@client.example", "jane\u200b@client.example", "jane\u009f@client.example"]
)
async def test_an_email_with_invisible_characters_is_a_validation_error(
    client_for: AppFactory, email: str
) -> None:
    async with client_for(registration="open") as api:
        response = await api.post(REGISTER, json=_body(email))
    assert response.status_code == 422


async def test_token_attempts_from_one_address_are_limited(client_for: AppFactory) -> None:
    async with client_for(registration="open") as api:
        statuses = [
            (await api.post(VERIFY, json={"token": f"guess-{index}"})).status_code
            for index in range(61)
        ]
    assert statuses == [400] * 60 + [429]
