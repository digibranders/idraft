"""Liveness, readiness and the full health report (docs/19-api-specification.md section 3.12).

Liveness and readiness reveal no versions, hostnames or error messages. Readiness reports
booleans only; the reason for a failure goes to the log. The full report is the one place that
says more, so it is not public: it needs `HEALTH_TOKEN`, and without one it does not exist.
"""

from __future__ import annotations

import asyncio
import hmac
from typing import Annotated, Literal

import structlog
from fastapi import APIRouter, Depends, Header, Response
from pydantic import BaseModel
from redis.asyncio import Redis

from idraft.api.access import public
from idraft.api.health_report import FullHealth, build
from idraft.api.problems import NotFoundError, UnauthenticatedError
from idraft.api.resources import Resources, get_resources
from idraft.db.probe import probe_database

CHECK_TIMEOUT_SECONDS = 1.0
router = APIRouter(prefix="/api", tags=["health"], dependencies=[Depends(public)])
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


def _bearer(authorization: str | None) -> str | None:
    scheme, _, token = (authorization or "").partition(" ")
    return token.strip() if scheme.lower() == "bearer" and token.strip() else None


@router.get(
    "/internal/health",
    summary="Full health",
    include_in_schema=False,
    responses={503: {"model": FullHealth}},
)
async def full_health(
    response: Response,
    resources: Annotated[Resources, Depends(get_resources)],
    authorization: Annotated[str | None, Header()] = None,
) -> FullHealth:
    """The stores, the schema, the workers, the provider and collection, behind a bearer token.
    503 only when the API cannot serve; a worker that is gone or a provider that is paused is a 200
    with `degraded`, which a monitor reads from the body."""
    expected = resources.settings.health_token
    if expected is None:
        raise NotFoundError
    given = _bearer(authorization)
    if given is None or not hmac.compare_digest(
        given.encode(), expected.get_secret_value().encode()
    ):
        raise UnauthenticatedError(headers={"WWW-Authenticate": "Bearer"})
    report = await build(resources)
    if report.status == "down":
        response.status_code = 503
    return report
