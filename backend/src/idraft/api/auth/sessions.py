"""Server-side sessions with a Redis read-through cache (docs/24-security.md section 2).

The cookie holds an opaque token. The database holds its SHA-256, so reading the table yields
nothing that can be replayed. Redis holds a 60 second copy keyed by the same hash, so most requests
do not touch PostgreSQL. Revocation is immediate: it writes a short-lived tombstone that outlives
any cached copy, including one written by a request that read the row just before the revocation.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

import structlog
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.auth import repository
from idraft.api.auth.repository import SessionRecord, SessionState
from idraft.api.auth.tokens import hash_token, new_token

SESSION_IDLE = timedelta(days=7)
SESSION_ABSOLUTE = timedelta(days=30)
PENDING_TOTP_LIFETIME = timedelta(minutes=10)
FRESH_FOR = timedelta(minutes=10)
# Where a client sends the user to re-enter a credential when a session is not fresh enough.
REAUTH_URL = "/api/v1/me/reauthenticate"
TOUCH_INTERVAL = timedelta(seconds=60)
CACHE_TTL_SECONDS = 60
# A cached session is about 300 bytes. Anything much larger was not written by this code.
CACHE_VALUE_MAX = 2048
_MAC_HEX = 64
# Longer than the cache: a copy written after the revocation expires before its tombstone does.
TOMBSTONE_TTL_SECONDS = 2 * CACHE_TTL_SECONDS
# What Redis failing looks like from here: its own errors, a closed socket, a timeout.
_CACHE_ERRORS = (RedisError, OSError, TimeoutError)
_log = structlog.get_logger(__name__)


class ExpiredSession(Exception):  # noqa: N818 - a state of the session, reported as 401
    """The token names a session that is past its idle or absolute lifetime."""


@dataclass(frozen=True, slots=True)
class SessionContext:
    """What a request knows about its session."""

    session_id: UUID
    user_id: UUID
    state: SessionState
    fresh_until: datetime | None
    idle_expires_at: datetime
    absolute_expires_at: datetime
    last_seen_at: datetime

    def is_fresh(self, now: datetime) -> bool:
        """Whether the user proved who they are recently enough for a sensitive action."""
        return self.fresh_until is not None and now < self.fresh_until

    def is_expired(self, now: datetime) -> bool:
        return now >= self.idle_expires_at or now >= self.absolute_expires_at


def _context(record: SessionRecord) -> SessionContext:
    return SessionContext(
        session_id=record.id,
        user_id=record.user_id,
        state=record.state,
        fresh_until=record.fresh_until,
        idle_expires_at=record.idle_expires_at,
        absolute_expires_at=record.absolute_expires_at,
        last_seen_at=record.last_seen_at,
    )


def _encode(context: SessionContext) -> str:
    return json.dumps(
        {
            "session_id": str(context.session_id),
            "user_id": str(context.user_id),
            "state": context.state,
            "fresh_until": None if context.fresh_until is None else context.fresh_until.isoformat(),
            "idle_expires_at": context.idle_expires_at.isoformat(),
            "absolute_expires_at": context.absolute_expires_at.isoformat(),
            "last_seen_at": context.last_seen_at.isoformat(),
        }
    )


def _instant(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.utcoffset() is None:
        raise ValueError("a cached time must carry its zone")
    return parsed


def _decode(payload: str) -> SessionContext | None:
    """The cached session, or None when the entry is not one we wrote."""
    try:
        fields = json.loads(payload)
        fresh_until = fields["fresh_until"]
        state = fields["state"]
        if state not in ("pending_totp", "active"):
            return None
        return SessionContext(
            session_id=UUID(fields["session_id"]),
            user_id=UUID(fields["user_id"]),
            state=state,
            fresh_until=None if fresh_until is None else _instant(fresh_until),
            idle_expires_at=_instant(fields["idle_expires_at"]),
            absolute_expires_at=_instant(fields["absolute_expires_at"]),
            last_seen_at=_instant(fields["last_seen_at"]),
        )
    except (ValueError, KeyError, TypeError, AttributeError, RecursionError):
        return None


def _cache_key(token_hash: bytes) -> str:
    return f"session:{token_hash.hex()}"


def _tombstone_key(token_hash: bytes) -> str:
    return f"session-revoked:{token_hash.hex()}"


class SessionStore:
    def __init__(
        self, sessions: async_sessionmaker[AsyncSession], redis: Redis, *, cache_key: bytes
    ) -> None:
        """`cache_key` authenticates cached entries: writing to Redis is not enough to forge one."""
        self._sessions = sessions
        self._redis = redis
        self._cache_key = cache_key

    async def create(
        self,
        db: AsyncSession,
        *,
        user_id: UUID,
        state: SessionState,
        fresh: bool,
        ip: str | None,
        user_agent: str | None,
        now: datetime,
        absolute_expires_at: datetime | None = None,
    ) -> tuple[str, SessionContext]:
        """Insert a session in the caller's transaction. Returns the token for the cookie.

        `absolute_expires_at` is given when a session is rotated: the new one inherits the end of
        the one it replaces, so rotating never extends the absolute lifetime.
        """
        token = new_token()
        longest = now + SESSION_ABSOLUTE
        absolute = longest if absolute_expires_at is None else min(absolute_expires_at, longest)
        lifetime = PENDING_TOTP_LIFETIME if state == "pending_totp" else SESSION_IDLE
        record = await repository.insert_session(
            db,
            token_hash=hash_token(token),
            user_id=user_id,
            state=state,
            fresh_until=now + FRESH_FOR if fresh else None,
            idle_expires_at=min(now + lifetime, absolute),
            absolute_expires_at=absolute,
            ip=ip,
            user_agent=None if user_agent is None else user_agent[:512],
            now=now,
        )
        return token, _context(record)

    async def load(self, token: str, *, now: datetime) -> SessionContext | None:
        """The session for a cookie value, or None. Raises ExpiredSession for an expired one."""
        token_hash = hash_token(token)
        cached, revoked = await self._read_cache(token_hash)
        if revoked:
            return None
        context = cached or await self._read_database(token_hash)
        if context is None:
            return None
        if context.is_expired(now):
            raise ExpiredSession
        # A last-seen time in the future is never ours: treat it as stale, so the database decides.
        stale = now - context.last_seen_at >= TOUCH_INTERVAL or context.last_seen_at > now
        if context.state == "active" and stale:
            context = await self._touch(context, now)
            if context is None:
                return None
            await self._write_cache(token_hash, context)
        elif cached is None:
            await self._write_cache(token_hash, context)
        return context

    async def revoke(
        self, db: AsyncSession, *, session_id: UUID, user_id: UUID, now: datetime
    ) -> bytes | None:
        """Revoke one session of this user in the caller's transaction.

        Returns the token hash to pass to `forget` once the transaction has committed.
        """
        return await repository.revoke_session(db, session_id=session_id, user_id=user_id, now=now)

    async def revoke_all(
        self, db: AsyncSession, *, user_id: UUID, except_session_id: UUID | None, now: datetime
    ) -> list[bytes]:
        """Revoke the user's sessions, optionally sparing one. Pass the result to `forget`."""
        return await repository.revoke_user_sessions(
            db, user_id=user_id, except_session_id=except_session_id, now=now
        )

    async def forget(self, token_hashes: Sequence[bytes]) -> None:
        """Make revocations visible at once. Call after the revoking transaction has committed."""
        if not token_hashes:
            return
        try:
            async with self._redis.pipeline(transaction=False) as pipe:
                for token_hash in token_hashes:
                    pipe.set(_tombstone_key(token_hash), b"1", ex=TOMBSTONE_TTL_SECONDS)
                    pipe.delete(_cache_key(token_hash))
                await pipe.execute()
        except _CACHE_ERRORS as error:
            # The database already says revoked. A cached copy can outlive this by at most its TTL.
            _log.error(
                "session cache eviction failed",
                error_kind=type(error).__name__,
                sessions=len(token_hashes),
            )

    async def _read_cache(self, token_hash: bytes) -> tuple[SessionContext | None, bool]:
        try:
            cached, tombstone = await self._redis.mget(
                _cache_key(token_hash), _tombstone_key(token_hash)
            )
        except _CACHE_ERRORS as error:
            _log.warning("session cache unavailable", error_kind=type(error).__name__)
            return None, False
        if tombstone is not None:
            return None, True
        return (None if cached is None else self._open(token_hash, cached)), False

    async def _write_cache(self, token_hash: bytes, context: SessionContext) -> None:
        try:
            await self._redis.set(
                _cache_key(token_hash), self._seal(token_hash, context), ex=CACHE_TTL_SECONDS
            )
        except _CACHE_ERRORS as error:
            _log.warning("session cache unavailable", error_kind=type(error).__name__)

    def _mac(self, token_hash: bytes, payload: str) -> str:
        # Bound to the token hash, so an entry copied under another key does not verify.
        return hmac.new(self._cache_key, token_hash + payload.encode(), hashlib.sha256).hexdigest()

    def _seal(self, token_hash: bytes, context: SessionContext) -> str:
        payload = _encode(context)
        return self._mac(token_hash, payload) + payload

    def _open(self, token_hash: bytes, raw: bytes | str) -> SessionContext | None:
        """The cached session if the entry is ours and intact, else None (a cache miss)."""
        if len(raw) > CACHE_VALUE_MAX:
            return None
        try:
            text = raw.decode() if isinstance(raw, bytes) else raw
        except UnicodeDecodeError:
            return None
        mac, payload = text[:_MAC_HEX], text[_MAC_HEX:]
        if not hmac.compare_digest(mac.encode(), self._mac(token_hash, payload).encode()):
            return None
        return _decode(payload)

    async def _read_database(self, token_hash: bytes) -> SessionContext | None:
        async with self._sessions() as db, db.begin():
            record = await repository.find_live_session(db, token_hash)
        return None if record is None else _context(record)

    async def _touch(self, context: SessionContext, now: datetime) -> SessionContext | None:
        async with self._sessions() as db, db.begin():
            record = await repository.touch_session(
                db,
                session_id=context.session_id,
                last_seen_at=now,
                idle_expires_at=min(now + SESSION_IDLE, context.absolute_expires_at),
            )
        return None if record is None else _context(record)
