"""Async engine, session factory and the per-transaction tenant setting.

The API role is subject to row-level security. Policies compare `workspace_id` with
`auth.current_workspace_id()`, which reads the `app.workspace_id` setting of the transaction, so a
transaction that never calls `workspace_transaction` sees no tenant rows
(docs/04-data-model.md section 13).
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

POOL_TIMEOUT_SECONDS = 5.0
CONNECT_TIMEOUT_SECONDS = 5.0
_SET_WORKSPACE = text("SELECT set_config('app.workspace_id', :workspace_id, true)")
_SET_USER = text("SELECT set_config('app.user_id', :user_id, true)")


def create_engine(settings: Settings) -> AsyncEngine:
    return create_async_engine(
        settings.sqlalchemy_url,
        pool_size=settings.db_pool_size,
        max_overflow=0,
        pool_pre_ping=True,
        # Waiting for a connection, or for the server to accept one, must end well inside the
        # statement timeout, or a busy pool turns every request into a slow failure.
        pool_timeout=POOL_TIMEOUT_SECONDS,
        # Error messages name the statement but never its bound values (emails, hashes, keywords).
        hide_parameters=True,
        connect_args={
            "timeout": CONNECT_TIMEOUT_SECONDS,
            "server_settings": {
                "statement_timeout": settings.db_statement_timeout,
                "application_name": f"sightline-{settings.process_role}",
            },
        },
    )


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


@asynccontextmanager
async def workspace_transaction(
    sessions: async_sessionmaker[AsyncSession], workspace_id: UUID, *, user_id: UUID | None = None
) -> AsyncIterator[AsyncSession]:
    """One transaction scoped to one workspace. Commits on success, rolls back on error."""
    async with sessions() as session, session.begin():
        await session.execute(_SET_WORKSPACE, {"workspace_id": str(workspace_id)})
        if user_id is not None:
            await session.execute(_SET_USER, {"user_id": str(user_id)})
        yield session


@asynccontextmanager
async def user_transaction(
    sessions: async_sessionmaker[AsyncSession], user_id: UUID
) -> AsyncIterator[AsyncSession]:
    """One transaction that knows the user but no workspace yet.

    For the requests that run before a workspace is chosen, such as listing a user's workspaces:
    the user's own memberships and their workspaces are visible, and no other tenant data is.
    """
    async with sessions() as session, session.begin():
        await session.execute(_SET_USER, {"user_id": str(user_id)})
        yield session
