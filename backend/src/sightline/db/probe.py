"""A bounded look at the database for the readiness check.

It opens its own connection, so a busy request pool never reads as "database down", and it ends
the connection without a graceful close, so a server that has stopped answering cannot hold the
probe past its timeout.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

import asyncpg
import structlog

_REVISION = "SELECT version_num FROM ops.alembic_version"
_NOT_MIGRATED = (
    asyncpg.UndefinedTableError,
    asyncpg.InvalidSchemaNameError,
    asyncpg.InsufficientPrivilegeError,
)
_log = structlog.get_logger(__name__)


@dataclass(frozen=True)
class DatabaseProbe:
    reachable: bool
    revision: str | None


async def probe_database(dsn: str, *, within_seconds: float) -> DatabaseProbe:
    connection: asyncpg.Connection | None = None
    try:
        async with asyncio.timeout(within_seconds):
            connection = await asyncpg.connect(dsn, timeout=within_seconds)
            try:
                revision = await connection.fetchval(_REVISION)
            except _NOT_MIGRATED:
                revision = None
        return DatabaseProbe(reachable=True, revision=revision)
    except Exception as error:
        # A probe reports; it never raises into the health route. The type is enough to act on
        # and, unlike the message, cannot carry a host name or credentials.
        _log.warning("database probe failed", error_kind=type(error).__name__)
        return DatabaseProbe(reachable=False, revision=None)
    finally:
        if connection is not None:
            connection.terminate()
