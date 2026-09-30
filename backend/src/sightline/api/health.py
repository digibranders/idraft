"""Liveness and readiness (docs/19-api-specification.md section 3.12).

Both reveal no versions, hostnames or error messages. Readiness reports booleans only.
"""

from __future__ import annotations

import asyncio
from typing import Literal

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine

from sightline.db.migrate import current_revision

CHECK_TIMEOUT_SECONDS = 1.0
router = APIRouter(prefix="/api", tags=["health"])


class Health(BaseModel):
    status: Literal["ok"]


class ReadinessChecks(BaseModel):
    postgres: bool
    redis: bool
    migrations: bool


class Readiness(BaseModel):
    status: Literal["ready", "not_ready"]
    checks: ReadinessChecks


async def _check_database(engine: AsyncEngine, head: str) -> tuple[bool, bool]:
    """Whether PostgreSQL answers, and whether its schema is at the revision this build expects."""
    try:
        async with asyncio.timeout(CHECK_TIMEOUT_SECONDS), engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
            return True, await current_revision(connection) == head
    except (SQLAlchemyError, OSError, TimeoutError):
        return False, False


async def _check_redis(redis: Redis) -> bool:
    try:
        async with asyncio.timeout(CHECK_TIMEOUT_SECONDS):
            await redis.ping()
    except (RedisError, OSError, TimeoutError):
        return False
    return True


@router.get("/healthz", summary="Liveness")
async def healthz() -> Health:
    return Health(status="ok")


@router.get("/readyz", summary="Readiness", responses={503: {"model": Readiness}})
async def readyz(request: Request, response: Response) -> Readiness:
    state = request.app.state
    (postgres, migrations), redis = await asyncio.gather(
        _check_database(state.engine, state.migration_head), _check_redis(state.redis)
    )
    ready = postgres and redis and migrations
    if not ready:
        response.status_code = 503
    return Readiness(
        status="ready" if ready else "not_ready",
        checks=ReadinessChecks(postgres=postgres, redis=redis, migrations=migrations),
    )
