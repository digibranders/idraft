"""What the running application holds, typed once so routes never reach into `app.state`."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Request
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from sightline.config.settings import Settings
from sightline.db.migrate import MigrationState


@dataclass(frozen=True)
class Resources:
    settings: Settings
    engine: AsyncEngine
    sessions: async_sessionmaker[AsyncSession]
    redis: Redis
    migrations: MigrationState


def get_resources(request: Request) -> Resources:
    """FastAPI dependency. The lifespan sets this before the first request is served."""
    resources = request.app.state.resources
    if not isinstance(resources, Resources):  # pragma: no cover - a wiring error, not a request
        raise TypeError("application resources are not initialised")
    return resources
