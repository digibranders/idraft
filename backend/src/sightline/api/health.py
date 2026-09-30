"""Liveness and readiness (docs/19-api-specification.md section 3.12).

Both reveal no versions, hostnames or error messages. Readiness reports booleans only; the reason
for a failure goes to the log.
"""

from __future__ import annotations

import asyncio
from typing import Annotated, Literal

import structlog
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from redis.asyncio import Redis

from sightline.api.resources import Resources, get_resources
from sightline.db.probe import probe_database

CHECK_TIMEOUT_SECONDS = 1.0
router = APIRouter(prefix="/api", tags=["health"])
_log = structlog.get_logger(__name__)


class Health(BaseModel):
    status: Literal["ok"]


class ReadinessChecks(BaseModel):
    postgres: bool
    redis: bool
    migrations: bool


class Readiness(BaseModel):
    status: Literal["ready", "not_ready"]
    checks: ReadinessChecks


async def _redis_answers(redis: Redis) -> bool:
    try:
        async with asyncio.timeout(CHECK_TIMEOUT_SECONDS):
            await redis.ping()
    except Exception as error:
        # As with the database probe: report, never raise, and log the type only.
        _log.warning("redis probe failed", error_kind=type(error).__name__)
        return False
    return True


@router.get("/healthz", summary="Liveness")
async def healthz() -> Health:
    return Health(status="ok")


@router.get("/readyz", summary="Readiness", responses={503: {"model": Readiness}})
async def readyz(
    response: Response, resources: Annotated[Resources, Depends(get_resources)]
) -> Readiness:
    database, redis = await asyncio.gather(
        probe_database(resources.settings.asyncpg_dsn, within_seconds=CHECK_TIMEOUT_SECONDS),
        _redis_answers(resources.redis),
    )
    checks = ReadinessChecks(
        postgres=database.reachable,
        redis=redis,
        migrations=database.reachable and resources.migrations.is_current(database.revision),
    )
    ready = checks.postgres and checks.redis and checks.migrations
    if not ready:
        response.status_code = 503
    return Readiness(status="ready" if ready else "not_ready", checks=checks)
