"""The state of an authorization in progress, kept in Redis (docs/24-security.md section 6).

`state` is a random single-use token; what it stands for (who started the connection, for which
project, and the PKCE verifier) is stored under its hash for ten minutes, so a copy of Redis holds
nothing that completes a flow. Consuming it deletes it in the same command, so a second use finds
nothing. If Redis cannot be reached the flow stops: a state that cannot be stored cannot be
checked.
"""

from __future__ import annotations

import hashlib
import json
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from redis.asyncio import Redis
from redis.exceptions import RedisError

from idraft.api.problems import ServiceUnavailableError

STATE_TTL = timedelta(minutes=10)
_PREFIX = "oauth:state:"
_STATE_BYTES = 32
_REDIS_ERRORS = (RedisError, OSError, TimeoutError)


@dataclass(frozen=True, slots=True)
class PendingAuthorization:
    user_id: UUID
    workspace_id: UUID
    project_id: UUID
    product: str
    verifier: str


def _key(state: str) -> str:
    return _PREFIX + hashlib.sha256(state.encode("utf-8", "surrogatepass")).hexdigest()


class OAuthStateStore:
    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    async def create(self, pending: PendingAuthorization) -> tuple[str, datetime]:
        """A new state for `pending`, and when it stops working."""
        state = secrets.token_urlsafe(_STATE_BYTES)
        value = json.dumps(
            {
                "user_id": str(pending.user_id),
                "workspace_id": str(pending.workspace_id),
                "project_id": str(pending.project_id),
                "product": pending.product,
                "verifier": pending.verifier,
            }
        )
        try:
            await self._redis.set(_key(state), value, ex=int(STATE_TTL.total_seconds()), nx=True)
        except _REDIS_ERRORS:
            raise ServiceUnavailableError("Could not start the connection. Try again.") from None
        return state, datetime.now(UTC) + STATE_TTL

    async def consume(self, state: str) -> PendingAuthorization | None:
        """What `state` stands for, once. None when it is unknown, expired or already used, or
        when Redis cannot say: a callback that cannot be checked is refused."""
        try:
            raw = await self._redis.getdel(_key(state))
        except _REDIS_ERRORS:
            return None
        if raw is None:
            return None
        try:
            found = json.loads(raw)
            return PendingAuthorization(
                user_id=UUID(found["user_id"]),
                workspace_id=UUID(found["workspace_id"]),
                project_id=UUID(found["project_id"]),
                product=str(found["product"]),
                verifier=str(found["verifier"]),
            )
        except (ValueError, KeyError, TypeError):
            return None
