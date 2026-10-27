"""Sessions: the cookie, the store, the dependencies (docs/24-security.md sections 2 and 2.1)."""

import dataclasses
import hashlib
import io
import json
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from asgi_lifespan import LifespanManager
from fastapi import FastAPI, Response
from pydantic import SecretStr

from idraft.api.auth.dependencies import clear_session_cookie, set_session_cookie
from idraft.api.main import create_app
from idraft.api.resources import Resources
from idraft.config.logging import configure_logging
from idraft.config.settings import Settings
from tests.api.auth.support import (
    cookie,
    execute,
    fetchrow,
    make_user,
    open_session,
    probes,
)
from tests.conftest import BASE_URL, PostgresServer

CURRENT = "/api/v1/_probe/current"
PENDING = "/api/v1/_probe/pending"
FRESH = "/api/v1/_probe/fresh"


def _capture() -> io.StringIO:
    stream = io.StringIO()
    configure_logging(service="api", version="test", level="info", stream=stream)
    return stream


def _lines(stream: io.StringIO) -> list[dict[str, Any]]:
    return [json.loads(raw) for raw in stream.getvalue().splitlines()]


async def _forget_cache(resources: Resources) -> None:
    await resources.redis.flushdb()


async def _keys(resources: Resources, pattern: str) -> list[str]:
    found = await resources.redis.keys(pattern)
    return sorted(key.decode() if isinstance(key, bytes) else key for key in found)


async def _cache_keys(resources: Resources) -> list[str]:
    return await _keys(resources, "session:*")


async def _cached(resources: Resources, key: str) -> bytes:
    value = await resources.redis.get(key)
    assert isinstance(value, bytes)
    return value


async def _cached_fields(resources: Resources, key: str) -> dict[str, Any]:
    """What a cache entry says, without its leading 64-character authentication code."""
    fields: dict[str, Any] = json.loads((await _cached(resources, key)).decode()[64:])
    return fields


async def _rewrite_cache(resources: Resources, token: str, fields: dict[str, Any]) -> None:
    """Replace a cache entry with different content, authenticated as the store would."""
    token_hash = hashlib.sha256(token.encode()).digest()
    text = json.dumps(fields)
    sealed = resources.session_store._mac(token_hash, text) + text
    await resources.redis.set(f"session:{token_hash.hex()}", sealed, ex=60)


async def test_no_cookie_is_unauthenticated(api: httpx.AsyncClient) -> None:
    response = await api.get(CURRENT)
    assert response.status_code == 401
    assert response.json()["code"] == "unauthenticated"


async def test_a_malformed_or_unknown_cookie_is_unauthenticated(api: httpx.AsyncClient) -> None:
    for value in ["x", "a" * 43, "a" * 500, "not/base64url+chars=", ""]:
        response = await api.get(CURRENT, headers=cookie(value))
        assert response.status_code == 401, value
        assert response.json()["code"] == "unauthenticated"


async def test_an_active_session_authenticates(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, session = await open_session(resources, user)
    response = await api.get(CURRENT, headers=cookie(token))
    assert response.status_code == 200
    assert response.json() == {
        "user_id": str(user.id),
        "session_id": str(session.session_id),
        "state": "active",
    }


async def test_only_the_hash_of_the_token_is_stored(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, session = await open_session(resources, user)
    await api.get(CURRENT, headers=cookie(token))

    row = await fetchrow(migrated, "SELECT * FROM auth.sessions WHERE id = $1", session.session_id)
    assert row["token_hash"] == hashlib.sha256(token.encode()).digest()
    assert token not in repr(dict(row))

    keys = await _keys(resources, "*")
    assert keys == [f"session:{hashlib.sha256(token.encode()).hexdigest()}"]
    stored = (await _cached(resources, keys[0])).decode()
    assert token not in stored
    assert set(await _cached_fields(resources, keys[0])) == {
        "session_id",
        "user_id",
        "state",
        "fresh_until",
        "idle_expires_at",
        "absolute_expires_at",
        "last_seen_at",
    }
    assert 0 < await resources.redis.ttl(keys[0]) <= 60


async def test_a_new_session_lasts_seven_days_idle_and_thirty_at_most(
    resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    before = datetime.now(UTC)
    _, session = await open_session(resources, user)
    assert timedelta(days=7) - timedelta(seconds=5) <= session.idle_expires_at - before
    assert session.idle_expires_at - before <= timedelta(days=7, seconds=5)
    assert timedelta(days=30) - timedelta(seconds=5) <= session.absolute_expires_at - before
    assert session.fresh_until is None


async def test_a_revoked_session_is_unauthenticated(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, session = await open_session(resources, user)
    await execute(
        migrated, "UPDATE auth.sessions SET revoked_at = now() WHERE id = $1", session.session_id
    )
    response = await api.get(CURRENT, headers=cookie(token))
    assert response.status_code == 401
    assert response.json()["code"] == "unauthenticated"


async def test_the_session_of_a_disabled_user_is_unauthenticated(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated, disabled=True)
    token, _ = await open_session(resources, user)
    assert (await api.get(CURRENT, headers=cookie(token))).status_code == 401


async def test_a_session_past_its_idle_or_absolute_lifetime_is_expired(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    for column in ("idle_expires_at", "absolute_expires_at"):
        token, session = await open_session(resources, user)
        await execute(
            migrated,
            f"UPDATE auth.sessions SET {column} = now() - interval '1 second' WHERE id = $1",
            session.session_id,
        )
        response = await api.get(CURRENT, headers=cookie(token))
        assert response.status_code == 401, column
        assert response.json()["code"] == "session_expired", column


async def test_a_session_that_expires_while_cached_stops_working(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The cached copy carries the expiry times, so the cache cannot outlive the session."""
    user = await make_user(migrated)
    token, _ = await open_session(resources, user)
    assert (await api.get(CURRENT, headers=cookie(token))).status_code == 200

    (key,) = await _cache_keys(resources)
    cached = await _cached_fields(resources, key)
    cached["idle_expires_at"] = (datetime.now(UTC) - timedelta(seconds=1)).isoformat()
    await _rewrite_cache(resources, token, cached)

    response = await api.get(CURRENT, headers=cookie(token))
    assert response.json()["code"] == "session_expired"


async def test_a_pending_session_is_refused_by_ordinary_routes(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, session = await open_session(resources, user, state="pending_totp")
    before = datetime.now(UTC)

    refused = await api.get(CURRENT, headers=cookie(token))
    accepted = await api.get(PENDING, headers=cookie(token))

    assert refused.status_code == 401
    assert refused.json()["code"] == "unauthenticated"
    assert accepted.status_code == 200
    assert accepted.json()["state"] == "pending_totp"
    assert session.idle_expires_at - before <= timedelta(minutes=10, seconds=5)


async def test_a_request_within_a_minute_does_not_write_to_the_database(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, session = await open_session(resources, user)
    read = (
        "SELECT last_seen_at, idle_expires_at, xmin::text AS version "
        "FROM auth.sessions WHERE id = $1"
    )
    before = await fetchrow(migrated, read, session.session_id)

    for _ in range(3):
        assert (await api.get(CURRENT, headers=cookie(token))).status_code == 200

    after = await fetchrow(migrated, read, session.session_id)
    assert dict(after) == dict(before)


async def test_after_a_minute_the_session_slides_but_never_past_its_absolute_end(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, session = await open_session(resources, user)
    await execute(
        migrated,
        "UPDATE auth.sessions SET last_seen_at = now() - interval '61 seconds', "
        "idle_expires_at = now() + interval '1 hour', "
        "absolute_expires_at = now() + interval '3 days' WHERE id = $1",
        session.session_id,
    )
    await _forget_cache(resources)

    assert (await api.get(CURRENT, headers=cookie(token))).status_code == 200

    row = await fetchrow(
        migrated,
        "SELECT now() - last_seen_at < interval '5 seconds' AS seen_now, "
        "idle_expires_at = absolute_expires_at AS capped FROM auth.sessions WHERE id = $1",
        session.session_id,
    )
    assert (row["seen_now"], row["capped"]) == (True, True)


async def test_sliding_extends_the_idle_lifetime_to_seven_days(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, session = await open_session(resources, user)
    await execute(
        migrated,
        "UPDATE auth.sessions SET last_seen_at = now() - interval '2 days', "
        "idle_expires_at = now() + interval '5 days' WHERE id = $1",
        session.session_id,
    )
    await _forget_cache(resources)

    assert (await api.get(CURRENT, headers=cookie(token))).status_code == 200

    row = await fetchrow(
        migrated,
        "SELECT idle_expires_at - now() AS left FROM auth.sessions WHERE id = $1",
        session.session_id,
    )
    assert timedelta(days=6, hours=23) < row["left"] <= timedelta(days=7)


async def test_revoking_takes_effect_on_the_next_request(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, session = await open_session(resources, user)
    assert (await api.get(CURRENT, headers=cookie(token))).status_code == 200

    async with resources.sessions() as db, db.begin():
        revoked = await resources.session_store.revoke(
            db, session_id=session.session_id, user_id=user.id, now=datetime.now(UTC)
        )
    assert revoked is not None
    await resources.session_store.forget([revoked])

    assert (await api.get(CURRENT, headers=cookie(token))).status_code == 401
    assert await _cache_keys(resources) == []


async def test_a_revoked_session_cannot_be_put_back_in_the_cache_by_a_slow_reader(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """A request that read the row just before the revocation must not cache it afterwards."""
    user = await make_user(migrated)
    token, session = await open_session(resources, user)
    assert (await api.get(CURRENT, headers=cookie(token))).status_code == 200
    (key,) = await _cache_keys(resources)
    stale = await _cached(resources, key)

    async with resources.sessions() as db, db.begin():
        revoked = await resources.session_store.revoke(
            db, session_id=session.session_id, user_id=user.id, now=datetime.now(UTC)
        )
    assert revoked is not None
    await resources.session_store.forget([revoked])
    await resources.redis.set(key, stale, ex=60)  # the slow reader writes what it read

    assert (await api.get(CURRENT, headers=cookie(token))).status_code == 401


async def test_a_session_revoked_while_its_cached_copy_is_due_a_touch_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The cache says live and stale; the write that would slide it finds the row revoked."""
    user = await make_user(migrated)
    token, session = await open_session(resources, user)
    assert (await api.get(CURRENT, headers=cookie(token))).status_code == 200
    (key,) = await _cache_keys(resources)
    cached = await _cached_fields(resources, key)
    cached["last_seen_at"] = (datetime.now(UTC) - timedelta(minutes=5)).isoformat()
    await _rewrite_cache(resources, token, cached)
    await execute(
        migrated, "UPDATE auth.sessions SET revoked_at = now() WHERE id = $1", session.session_id
    )

    assert (await api.get(CURRENT, headers=cookie(token))).status_code == 401


async def test_forgetting_nothing_does_nothing(resources: Resources) -> None:
    await resources.session_store.forget([])
    assert await _keys(resources, "*") == []


async def test_a_failed_eviction_is_logged_and_does_not_fail_the_request(
    app_settings: Settings, black_hole: str
) -> None:
    settings = app_settings.model_copy(update={"redis_url": SecretStr(f"redis://{black_hole}/0")})
    application = create_app(settings)
    async with LifespanManager(application):
        stream = _capture()
        await application.state.resources.session_store.forget([b"\x01" * 32])
    (line,) = [entry for entry in _lines(stream) if entry["msg"] == "session cache eviction failed"]
    assert line["level"] == "error"
    assert line["sessions"] == 1


async def test_revoking_someone_elses_session_does_nothing(
    resources: Resources, migrated: PostgresServer
) -> None:
    owner, other = await make_user(migrated), await make_user(migrated)
    _, session = await open_session(resources, owner)
    async with resources.sessions() as db, db.begin():
        revoked = await resources.session_store.revoke(
            db, session_id=session.session_id, user_id=other.id, now=datetime.now(UTC)
        )
    assert revoked is None


async def test_revoke_all_can_spare_the_current_session(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user, bystander = await make_user(migrated), await make_user(migrated)
    kept_token, kept = await open_session(resources, user)
    other_tokens = [(await open_session(resources, user))[0] for _ in range(3)]
    bystander_token, _ = await open_session(resources, bystander)
    for token in [kept_token, *other_tokens, bystander_token]:
        assert (await api.get(CURRENT, headers=cookie(token))).status_code == 200

    async with resources.sessions() as db, db.begin():
        hashes = await resources.session_store.revoke_all(
            db, user_id=user.id, except_session_id=kept.session_id, now=datetime.now(UTC)
        )
    await resources.session_store.forget(hashes)

    assert len(hashes) == 3
    assert (await api.get(CURRENT, headers=cookie(kept_token))).status_code == 200
    assert (await api.get(CURRENT, headers=cookie(bystander_token))).status_code == 200
    for token in other_tokens:
        assert (await api.get(CURRENT, headers=cookie(token))).status_code == 401


async def test_revoke_all_without_an_exception_ends_every_session(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    tokens = [(await open_session(resources, user))[0] for _ in range(2)]
    async with resources.sessions() as db, db.begin():
        hashes = await resources.session_store.revoke_all(
            db, user_id=user.id, except_session_id=None, now=datetime.now(UTC)
        )
    await resources.session_store.forget(hashes)
    assert len(hashes) == 2
    for token in tokens:
        assert (await api.get(CURRENT, headers=cookie(token))).status_code == 401


async def test_a_session_still_works_when_redis_cannot_be_reached(
    app_settings: Settings, black_hole: str, migrated: PostgresServer
) -> None:
    settings = app_settings.model_copy(update={"redis_url": SecretStr(f"redis://{black_hole}/0")})
    application = create_app(settings)
    application.include_router(probes)
    async with LifespanManager(application):
        resources = application.state.resources
        user = await make_user(migrated)
        token, _ = await open_session(resources, user)
        transport = httpx.ASGITransport(app=application, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url=BASE_URL) as client:
            response = await client.get(CURRENT, headers=cookie(token))
            unknown = await client.get(CURRENT, headers=cookie("b" * 43))
    assert response.status_code == 200
    assert unknown.status_code == 401


async def test_a_corrupt_cache_entry_falls_back_to_the_database(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, _ = await open_session(resources, user)
    key = f"session:{hashlib.sha256(token.encode()).hexdigest()}"
    assert (await api.get(CURRENT, headers=cookie(token))).status_code == 200
    fields = await _cached_fields(resources, key)
    await _rewrite_cache(resources, token, fields | {"state": "superuser"})
    assert (await api.get(CURRENT, headers=cookie(token))).json()["state"] == "active"
    for garbage in [
        b"not json",
        b"{}",
        b'{"session_id": "nope"}',
        b"[]",
        json.dumps(fields).encode(),
    ]:
        await resources.redis.set(key, garbage, ex=60)
        response = await api.get(CURRENT, headers=cookie(token))
        assert response.status_code == 200, garbage
        assert response.json()["state"] == "active"


async def test_a_fresh_session_passes_and_a_stale_one_is_told_how_to_refresh(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    fresh_token, fresh = await open_session(resources, user, fresh=True)
    stale_token, _ = await open_session(resources, user)
    assert fresh.fresh_until is not None
    assert fresh.fresh_until - datetime.now(UTC) <= timedelta(minutes=10)

    assert (await api.get(FRESH, headers=cookie(fresh_token))).status_code == 200
    refused = await api.get(FRESH, headers=cookie(stale_token))
    assert refused.status_code == 403
    assert refused.json()["code"] == "fresh_session_required"
    assert refused.json()["reauth_url"] == "/api/v1/me/reauthenticate"

    await execute(
        migrated,
        "UPDATE auth.sessions SET fresh_until = now() - interval '1 second' WHERE id = $1",
        fresh.session_id,
    )
    await _forget_cache(resources)
    assert (await api.get(FRESH, headers=cookie(fresh_token))).status_code == 403


async def test_log_lines_of_an_authenticated_request_carry_the_user(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, _ = await open_session(resources, user)
    stream = _capture()

    await api.get(CURRENT, headers=cookie(token))
    await api.get("/api/v1/_probe/boom", headers=cookie(token))
    await api.get("/api/v1/_probe/open")

    lines = _lines(stream)
    finished = [line for line in lines if line["msg"] == "request finished"]
    assert [line.get("user_id") for line in finished] == [str(user.id), str(user.id), None]
    assert "user_id" not in finished[2]
    (unhandled,) = [line for line in lines if line["msg"] == "unhandled exception"]
    assert unhandled["user_id"] == str(user.id)
    assert token not in stream.getvalue()


async def test_the_user_of_one_request_does_not_leak_into_the_next_log_line(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, _ = await open_session(resources, user)
    await api.get(CURRENT, headers=cookie(token))
    stream = _capture()

    await api.get(CURRENT)  # anonymous: 401

    (line,) = [entry for entry in _lines(stream) if entry["msg"] == "request finished"]
    assert "user_id" not in line


def test_the_cookie_has_exactly_the_documented_attributes() -> None:
    response = Response()
    set_session_cookie(response, "tok", max_age=600)
    header = response.headers["set-cookie"]
    name_value, *attributes = [part.strip() for part in header.split(";")]
    assert name_value == "__Host-session=tok"
    assert sorted(attribute.lower() for attribute in attributes) == [
        "httponly",
        "max-age=600",
        "path=/",
        "samesite=lax",
        "secure",
    ]


def test_clearing_the_cookie_keeps_the_attributes_the_prefix_requires() -> None:
    response = Response()
    clear_session_cookie(response)
    header = response.headers["set-cookie"].lower()
    assert header.startswith('__host-session="";') or header.startswith("__host-session=;")
    for attribute in ("max-age=0", "path=/", "secure", "httponly", "samesite=lax"):
        assert attribute in header
    assert "domain" not in header


async def test_the_probe_routes_are_not_part_of_the_real_application(app: FastAPI) -> None:
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url=BASE_URL) as client:
        assert (await client.get(CURRENT)).status_code == 404


async def test_touching_the_session_of_a_user_disabled_meanwhile_ends_it(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The cached copy is due a touch; the write finds the user disabled."""
    user = await make_user(migrated)
    token, session = await open_session(resources, user)
    await execute(
        migrated,
        "UPDATE auth.sessions SET last_seen_at = now() - interval '5 minutes' WHERE id = $1",
        session.session_id,
    )
    assert (await api.get(CURRENT, headers=cookie(token))).status_code == 200
    await execute(migrated, "UPDATE auth.users SET disabled_at = now() WHERE id = $1", user.id)
    await execute(
        migrated,
        "UPDATE auth.sessions SET last_seen_at = now() - interval '5 minutes' WHERE id = $1",
        session.session_id,
    )
    (key,) = await _cache_keys(resources)
    await resources.redis.delete(key)
    assert (await api.get(CURRENT, headers=cookie(token))).status_code == 401


async def test_a_cached_entry_written_by_someone_else_is_ignored(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Writing to Redis is not enough to become another user: entries are authenticated."""
    victim, attacker = await make_user(migrated), await make_user(migrated)
    token, _ = await open_session(resources, attacker)
    assert (await api.get(CURRENT, headers=cookie(token))).status_code == 200
    (key,) = await _cache_keys(resources)
    sealed = (await _cached(resources, key)).decode()
    mac, payload = sealed[:64], sealed[64:]
    forged = json.dumps(json.loads(payload) | {"user_id": str(victim.id)})

    for value in (mac + forged, forged, "0" * 64 + forged, mac + payload + " "):
        await resources.redis.set(key, value)  # no expiry, as an attacker would write it
        response = await api.get(CURRENT, headers=cookie(token))
        assert response.json()["user_id"] == str(attacker.id), value


async def test_a_cached_entry_cannot_be_moved_to_another_token(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    owner = await make_user(migrated)
    token, _ = await open_session(resources, owner)
    assert (await api.get(CURRENT, headers=cookie(token))).status_code == 200
    (key,) = await _cache_keys(resources)
    sealed = await _cached(resources, key)
    made_up = "m" * 43
    await resources.redis.set(f"session:{hashlib.sha256(made_up.encode()).hexdigest()}", sealed)

    assert (await api.get(CURRENT, headers=cookie(made_up))).status_code == 401


async def test_a_cached_entry_dated_in_the_future_is_checked_against_the_database(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Without this, a replayed copy with a far-future last-seen time would never be re-checked."""
    user = await make_user(migrated)
    token, session = await open_session(resources, user)
    store = resources.session_store
    token_hash = hashlib.sha256(token.encode()).digest()
    future = dataclasses.replace(
        (await store.load(token, now=datetime.now(UTC))) or session,
        last_seen_at=datetime.now(UTC) + timedelta(days=365),
    )
    await execute(
        migrated, "UPDATE auth.sessions SET revoked_at = now() WHERE id = $1", session.session_id
    )
    await resources.redis.set(f"session:{token_hash.hex()}", store._seal(token_hash, future))

    assert (await api.get(CURRENT, headers=cookie(token))).status_code == 401


async def test_cached_times_without_a_zone_are_a_cache_miss_not_a_crash(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    token, session = await open_session(resources, user)
    store = resources.session_store
    token_hash = hashlib.sha256(token.encode()).digest()
    assert (await api.get(CURRENT, headers=cookie(token))).status_code == 200
    (key,) = await _cache_keys(resources)
    payload = json.loads((await _cached(resources, key)).decode()[64:])
    for damage in (
        {"idle_expires_at": "2099-01-01T00:00:00"},
        {"absolute_expires_at": "2099-01-01"},
        {"last_seen_at": "yesterday"},
        {"fresh_until": "2099-01-01T00:00:00"},
    ):
        text = json.dumps(payload | damage)
        await resources.redis.set(key, store._mac(token_hash, text) + text, ex=60)
        response = await api.get(CURRENT, headers=cookie(token))
        assert response.status_code == 200, damage
    for junk in (b"[" * 200_000, b"\xff\xfe" * 40, b"x" * 5000):
        await resources.redis.set(key, junk, ex=60)
        assert (await api.get(CURRENT, headers=cookie(token))).status_code == 200
    assert session.user_id == user.id


async def test_a_rotated_session_cannot_outlive_the_policy(
    resources: Resources, migrated: PostgresServer
) -> None:
    user = await make_user(migrated)
    now = datetime.now(UTC)
    async with resources.sessions() as db, db.begin():
        _, inherited = await resources.session_store.create(
            db,
            user_id=user.id,
            state="active",
            fresh=True,
            ip=None,
            user_agent=None,
            now=now,
            absolute_expires_at=now + timedelta(days=3),
        )
        _, capped = await resources.session_store.create(
            db,
            user_id=user.id,
            state="active",
            fresh=True,
            ip=None,
            user_agent=None,
            now=now,
            absolute_expires_at=now + timedelta(days=400),
        )
    assert inherited.absolute_expires_at == now + timedelta(days=3)
    assert inherited.idle_expires_at == now + timedelta(days=3)
    assert capped.absolute_expires_at == now + timedelta(days=30)


def test_a_session_state_the_code_does_not_know_is_an_error() -> None:
    from idraft.api.auth.repository import _state

    assert (_state("active"), _state("pending_totp")) == ("active", "pending_totp")
    with pytest.raises(ValueError, match="unexpected session state"):
        _state("superuser")
