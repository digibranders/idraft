"""What every step of the seed needs: who it acts as, where prompts may run, and its error.

The seed acts as an existing owner of the workspace, through the services the routes use, so its
permissions are the owner's and every write is audited with that owner as the actor and
`SEED_INFO`'s user agent. It never creates a user or a workspace: a development database gets both
from the app (docs/ops/dev-eventus-seed.md).
"""

from __future__ import annotations

import uuid
from collections.abc import Collection
from datetime import UTC, datetime, timedelta
from typing import Final
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.auth.sessions import SessionContext
from idraft.api.permissions import Role
from idraft.api.request_info import RequestInfo
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import user_transaction
from idraft.db.tables import locations, memberships, users, workspaces
from idraft.domain.ai_engines import COUNTRY

Sessions = async_sessionmaker[AsyncSession]

SEED_INFO: Final = RequestInfo(
    ip=None, user_agent="python -m idraft.cli seed-eventus", request_id=None
)


class SeedError(Exception):
    """The seed stopped. The message says why and what to do; the CLI prints it as it is."""


def seed_access(user_id: UUID, workspace_id: UUID) -> WorkspaceAccess:
    """An owner's access to the whole workspace, as `workspace_member` builds one for a request.
    The session is not stored anywhere: the services read only the user and the workspace."""
    now = datetime.now(UTC)
    return WorkspaceAccess(
        session=SessionContext(
            session_id=uuid.uuid4(),
            user_id=user_id,
            state="active",
            fresh_until=None,
            idle_expires_at=now + timedelta(hours=1),
            absolute_expires_at=now + timedelta(hours=1),
            last_seen_at=now,
        ),
        workspace_id=workspace_id,
        role=Role.OWNER,
        project_ids=None,
    )


async def find_owner(sessions: Sessions, workspace_slug: str) -> WorkspaceAccess:
    """The most recently created active user who owns the active workspace with this slug.

    The API role sees a membership only as its own user (row-level security), and `auth.users`
    has no row policy, so each active user is asked in turn, newest first.
    shortcut: one query per user, fine for a development database; a seed for a large one would
    take the owner's email instead.
    """
    async with sessions() as db, db.begin():
        user_ids: list[UUID] = list(
            (
                await db.execute(
                    select(users.c.id)
                    .where(users.c.disabled_at.is_(None))
                    .order_by(users.c.created_at.desc(), users.c.id.desc())
                )
            ).scalars()
        )
    owned = (
        select(memberships.c.workspace_id)
        .join(workspaces, workspaces.c.id == memberships.c.workspace_id)
        .where(
            workspaces.c.slug == workspace_slug,
            workspaces.c.status == "active",
            memberships.c.role == Role.OWNER.value,
        )
    )
    for user_id in user_ids:
        async with user_transaction(sessions, user_id) as db:
            workspace_id: UUID | None = (
                await db.execute(owned.where(memberships.c.user_id == user_id))
            ).scalar_one_or_none()
        if workspace_id is not None:
            return seed_access(user_id, workspace_id)
    raise SeedError(
        f"No active workspace {workspace_slug!r} with an active owner was found. Sign in to the "
        "app at APP_ORIGIN and create it, or name another with --workspace."
    )


async def country_locations(sessions: Sessions, countries: Collection[str]) -> dict[str, int]:
    """The active country location of each of these countries, by ISO code."""
    wanted = sorted(set(countries))
    async with sessions() as db, db.begin():
        rows = await db.execute(
            select(locations.c.country_iso, func.min(locations.c.id))
            .where(
                locations.c.location_type == COUNTRY,
                locations.c.is_active,
                locations.c.country_iso.in_(wanted),
            )
            .group_by(locations.c.country_iso)
        )
        found = {str(row[0]): int(row[1]) for row in rows}
    missing = [country for country in wanted if country not in found]
    if missing:
        raise SeedError(
            f"core.locations has no active country location for {', '.join(missing)}. Load "
            "them first with python -m idraft.worker.sync_locations "
            "(docs/ops/dev-eventus-seed.md, step 4). Nothing was written."
        )
    return found
