"""ops.record_auth_event: the one way the API writes an audit row that has no workspace."""

from __future__ import annotations

import json
import uuid

import asyncpg
import pytest

from tests.conftest import PostgresServer
from tests.db.support import scoped

CALL = "SELECT ops.record_auth_event($1, $2, $3, $4, $5, $6, $7, $8::jsonb)"
ROWS = "SELECT * FROM ops.audit_logs WHERE request_id = $1"


def _request_id() -> str:
    return f"req_{uuid.uuid4().hex}"


async def _record_as_api(
    db: asyncpg.Connection[asyncpg.Record],
    *,
    action: str = "auth.sign_in",
    user_id: uuid.UUID | None,
    request_id: str,
    user_agent: str | None = "pytest",
    details: dict[str, object] | None = None,
) -> None:
    await db.execute("SET LOCAL ROLE app_api")
    try:
        await db.execute(
            CALL,
            action,
            user_id,
            "user",
            str(user_id) if user_id else "unknown",
            "203.0.113.7",
            user_agent,
            request_id,
            json.dumps(details) if details is not None else None,
        )
    finally:
        await db.execute("RESET ROLE")


async def test_the_api_records_an_event_without_a_workspace(migrated: PostgresServer) -> None:
    user_id, request_id = uuid.uuid4(), _request_id()
    async with scoped(migrated, "superuser") as db:
        await _record_as_api(
            db, user_id=user_id, request_id=request_id, details={"method": "password"}
        )
        rows = await db.fetch(ROWS, request_id)
        clock = await db.fetchval("SELECT transaction_timestamp()")

    assert len(rows) == 1
    row = rows[0]
    assert row["workspace_id"] is None
    assert (row["actor_type"], row["actor_id"]) == ("user", str(user_id))
    assert (row["action"], row["target_type"], row["target_id"]) == (
        "auth.sign_in",
        "user",
        str(user_id),
    )
    assert json.loads(row["after"]) == {"method": "password"}
    assert row["before"] is None
    assert str(row["ip"]) == "203.0.113.7"
    assert row["user_agent"] == "pytest"
    assert isinstance(row["id"], int)
    assert row["occurred_at"] == clock


async def test_an_event_without_a_user_is_recorded_as_anonymous(migrated: PostgresServer) -> None:
    request_id = _request_id()
    async with scoped(migrated, "superuser") as db:
        await _record_as_api(db, action="auth.sign_in_failed", user_id=None, request_id=request_id)
        row = await db.fetchrow(ROWS, request_id)
    assert row is not None
    assert (row["actor_type"], row["actor_id"]) == ("system", "anonymous")
    assert row["after"] is None


@pytest.mark.parametrize(
    "action",
    [
        "project.delete",
        "auth",
        "auth.",
        "authxsign_in",
        "auth_sign_in",
        "AUTH.sign_in",
        "auth.sign in",
        "auth.sign_in\n",
        "auth.x\nproject.delete",
        "auth.\u00e9",
        "auth....",
        "auth._",
        "auth.sign__in",
        "auth.sign_in.",
        "auth." + "a" * 61,
        "",
    ],
)
async def test_only_auth_actions_are_accepted(migrated: PostgresServer, action: str) -> None:
    async with scoped(migrated, "app_api") as db:
        with pytest.raises(asyncpg.CheckViolationError, match="auth event action"):
            await db.execute(CALL, action, None, "user", "x", None, None, _request_id(), None)


async def test_a_null_action_is_refused(migrated: PostgresServer) -> None:
    async with scoped(migrated, "app_api") as db:
        with pytest.raises(asyncpg.CheckViolationError, match="auth event action"):
            await db.execute(CALL, None, None, "user", "x", None, None, None, None)


async def test_a_long_user_agent_is_cut_to_512_characters(migrated: PostgresServer) -> None:
    request_id = _request_id()
    async with scoped(migrated, "superuser") as db:
        await _record_as_api(db, user_id=None, request_id=request_id, user_agent="a" * 2000)
        stored = await db.fetchval(
            "SELECT length(user_agent) FROM ops.audit_logs WHERE request_id = $1", request_id
        )
    assert stored == 512


async def test_the_api_cannot_read_the_event_back_under_any_workspace(
    migrated: PostgresServer,
) -> None:
    request_id = _request_id()
    async with scoped(migrated, "app_api", workspace_id=uuid.uuid4()) as db:
        await db.execute(CALL, "auth.sign_in", None, "user", "x", None, None, request_id, None)
        assert await db.fetchval("SELECT count(*) FROM ops.audit_logs") == 0


async def test_the_api_still_cannot_insert_such_a_row_directly(migrated: PostgresServer) -> None:
    async with scoped(migrated, "app_api") as db:
        with pytest.raises(asyncpg.InsufficientPrivilegeError, match="row-level security"):
            await db.execute(
                "INSERT INTO ops.audit_logs (actor_type, actor_id, action, target_type, target_id) "
                "VALUES ('user', 'u', 'auth.sign_in', 'user', 'u')"
            )


async def test_the_worker_cannot_call_it(migrated: PostgresServer) -> None:
    async with scoped(migrated, "app_worker") as db:
        with pytest.raises(asyncpg.InsufficientPrivilegeError, match="permission denied"):
            await db.execute(CALL, "auth.sign_in", None, "user", "x", None, None, None, None)


@pytest.mark.parametrize(
    "action", ["auth.sign_in", "auth.totp.enabled", "auth.a", "auth." + "a" * 59]
)
async def test_well_formed_auth_actions_are_accepted(migrated: PostgresServer, action: str) -> None:
    async with scoped(migrated, "app_api") as db:
        await db.execute(CALL, action, None, "user", "x", None, None, _request_id(), None)


@pytest.mark.parametrize(("target_type", "target_id"), [(None, "x"), ("user", None), (None, None)])
async def test_a_missing_target_is_refused_without_echoing_the_row(
    migrated: PostgresServer, target_type: str | None, target_id: str | None
) -> None:
    async with scoped(migrated, "app_api") as db:
        with pytest.raises(asyncpg.CheckViolationError) as error:
            await db.execute(
                CALL,
                "auth.sign_in",
                None,
                target_type,
                target_id,
                None,
                None,
                _request_id(),
                '{"note": "SENSITIVE"}',
            )
    assert "auth event target must be given" in str(error.value)
    assert "SENSITIVE" not in str(error.value) + str(error.value.as_dict())
