"""Rules for workspaces (docs/19-api-specification.md section 3.2.1)."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.api import audit
from sightline.api.auth import repository as users
from sightline.api.auth.sessions import SessionContext
from sightline.api.permissions import Role
from sightline.api.problems import (
    DuplicateError,
    EmailNotVerifiedError,
    ForbiddenError,
    NotFoundError,
    UnauthenticatedError,
    invalid_field,
)
from sightline.api.request_info import RequestInfo
from sightline.api.workspaces import repository
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.api.workspaces.repository import SlugTakenError, WorkspaceRecord
from sightline.db.engine import user_transaction, workspace_transaction

_AUDITED = ("name", "slug", "logo", "timezone")


def _slug_taken() -> DuplicateError:
    # The other workspace is not named: it may belong to someone else.
    return DuplicateError("A workspace with this slug already exists.")


class WorkspaceService:
    def __init__(
        self,
        *,
        sessions: async_sessionmaker[AsyncSession],
        registration: Literal["invited", "open"],
    ) -> None:
        self._sessions = sessions
        self._registration = registration

    async def list(self, session: SessionContext) -> list[WorkspaceRecord]:
        async with user_transaction(self._sessions, session.user_id) as db:
            return await repository.list_for_user(db, session.user_id)

    async def create(
        self, *, session: SessionContext, name: str, slug: str, timezone: str, info: RequestInfo
    ) -> WorkspaceRecord:
        """A new workspace owned by the caller, with the default quotas."""
        async with self._sessions() as db, db.begin():
            user = await users.get_user(db, session.user_id)
            if user is None or user.disabled_at is not None:
                # The account was removed or disabled while its session was cached.
                raise UnauthenticatedError
            if user.email_verified_at is None:
                raise EmailNotVerifiedError(
                    "Verify your email address before creating a workspace."
                )
            if self._registration == "invited" and not user.is_platform_operator:
                # An invited person joins the workspace they were invited to. A second workspace
                # would have its own quotas and its own provider spend.
                raise ForbiddenError("Only a platform operator can create a workspace.")
            await self._check_timezone(db, timezone)
            workspace_id = await repository.new_id(db)
        try:
            async with workspace_transaction(self._sessions, workspace_id, user_id=user.id) as db:
                workspace = await repository.insert_workspace(
                    db, workspace_id=workspace_id, name=name, slug=slug, timezone=timezone
                )
                await repository.insert_membership(
                    db, workspace_id=workspace_id, user_id=user.id, role=Role.OWNER
                )
                await repository.insert_default_quotas(db, workspace_id)
                await audit.record(
                    db,
                    workspace_id=workspace_id,
                    actor_id=user.id,
                    action="workspace.created",
                    target_type="workspace",
                    target_id=workspace_id,
                    info=info,
                    after={"name": name, "slug": slug, "timezone": timezone},
                )
        except SlugTakenError:
            raise _slug_taken() from None
        return workspace

    async def get(self, access: WorkspaceAccess) -> WorkspaceRecord:
        async with workspace_transaction(
            self._sessions, access.workspace_id, user_id=access.user_id
        ) as db:
            workspace = await repository.get(db, access.workspace_id)
        if workspace is None:
            raise NotFoundError
        return workspace

    async def update(
        self, *, access: WorkspaceAccess, changes: Mapping[str, str | None], info: RequestInfo
    ) -> WorkspaceRecord:
        """Change the given fields. Nothing is written, or logged, when nothing differs."""
        try:
            async with workspace_transaction(
                self._sessions, access.workspace_id, user_id=access.user_id
            ) as db:
                current = await repository.get(db, access.workspace_id, for_update=True)
                if current is None:
                    raise NotFoundError
                differing = {
                    field: value
                    for field, value in changes.items()
                    if getattr(current, field) != value
                }
                if not differing:
                    return current
                timezone = differing.get("timezone")
                if timezone is not None:
                    await self._check_timezone(db, timezone)
                updated = await repository.update_workspace(db, access.workspace_id, differing)
                await audit.record(
                    db,
                    workspace_id=access.workspace_id,
                    actor_id=access.user_id,
                    action="workspace.updated",
                    target_type="workspace",
                    target_id=access.workspace_id,
                    info=info,
                    before={field: getattr(current, field) for field in differing},
                    after=differing,
                )
                return updated
        except SlugTakenError:
            raise _slug_taken() from None

    @staticmethod
    async def _check_timezone(db: AsyncSession, timezone: str) -> None:
        if not await repository.timezone_exists(db, timezone):
            raise invalid_field("timezone", code="timezone_unknown", message="Unknown time zone.")
