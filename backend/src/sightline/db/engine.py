"""Async engine, session factory and the per-transaction tenant setting.

The API role is subject to row-level security. Policies compare `workspace_id` with
`NULLIF(current_setting('app.workspace_id', true), '')::uuid`, so a transaction that never calls
`workspace_transaction` sees no tenant rows (docs/04-data-model.md section 13).
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from sightline.config.settings import Settings

_SET_WORKSPACE = text("SELECT set_config('app.workspace_id', :workspace_id, true)")


def create_engine(settings: Settings) -> AsyncEngine:
    return create_async_engine(
        settings.sqlalchemy_url,
        pool_size=settings.db_pool_size,
        max_overflow=0,
        pool_pre_ping=True,
        connect_args={
            "server_settings": {
                "statement_timeout": settings.db_statement_timeout,
                "application_name": f"sightline-{settings.process_role}",
            }
        },
    )


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


@asynccontextmanager
async def workspace_transaction(
    sessions: async_sessionmaker[AsyncSession], workspace_id: UUID
) -> AsyncIterator[AsyncSession]:
    """One transaction scoped to one workspace. Commits on success, rolls back on error."""
    async with sessions() as session, session.begin():
        await session.execute(_SET_WORKSPACE, {"workspace_id": str(workspace_id)})
        yield session
