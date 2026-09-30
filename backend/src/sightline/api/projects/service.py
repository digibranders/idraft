"""Rules for projects (docs/19-api-specification.md section 3.3)."""

from __future__ import annotations

from collections.abc import Collection, Mapping
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.api import audit
from sightline.api.problems import DuplicateError, ForbiddenError, NotFoundError, QuotaExceededError
from sightline.api.projects import repository
from sightline.api.projects.repository import ProjectRecord, ProjectSlugTakenError
from sightline.api.request_info import RequestInfo
from sightline.api.workspaces import repository as workspaces
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.api.workspaces.service import check_timezone
from sightline.db.engine import workspace_transaction


def _slug_taken() -> DuplicateError:
    return DuplicateError("A project with this slug already exists in the workspace.")


class ProjectService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    async def page(
        self, access: WorkspaceAccess, *, statuses: Collection[str], offset: int, limit: int
    ) -> tuple[list[ProjectRecord], int]:
        """The projects the member can see, in these statuses."""
        async with workspace_transaction(
            self._sessions, access.workspace_id, user_id=access.user_id
        ) as db:
            return await repository.list_projects(
                db,
                access.workspace_id,
                statuses=statuses,
                visible=access.project_ids,
                offset=offset,
                limit=limit,
            )

    async def create(
        self,
        *,
        access: WorkspaceAccess,
        name: str,
        slug: str,
        timezone: str | None,
        deep_check_weekday: int,
        default_language_code: str | None,
        info: RequestInfo,
    ) -> ProjectRecord:
        if access.project_ids is not None:
            # They could not see what they had just made.
            raise ForbiddenError("A member limited to some projects cannot create one.")
        try:
            async with workspace_transaction(
                self._sessions, access.workspace_id, user_id=access.user_id
            ) as db:
                if timezone is None:
                    workspace = await workspaces.get(db, access.workspace_id)
                    if workspace is None:
                        raise NotFoundError
                    timezone = workspace.timezone
                else:
                    await check_timezone(db, timezone)
                limit = await repository.lock_project_limit(db, access.workspace_id)
                used = await repository.count_projects(db, access.workspace_id)
                if used >= limit:
                    raise QuotaExceededError(
                        "The workspace has as many projects as its plan allows.",
                        limit=limit,
                        used=used,
                        requested=1,
                    )
                project_id = await repository.insert_project(
                    db,
                    workspace_id=access.workspace_id,
                    name=name,
                    slug=slug,
                    timezone=timezone,
                    deep_check_weekday=deep_check_weekday,
                    default_language_code=default_language_code,
                    created_by=access.user_id,
                )
                await audit.record(
                    db,
                    workspace_id=access.workspace_id,
                    actor_id=access.user_id,
                    action="project.created",
                    target_type="project",
                    target_id=project_id,
                    info=info,
                    after={
                        "name": name,
                        "slug": slug,
                        "timezone": timezone,
                        "deep_check_weekday": deep_check_weekday,
                        "default_language_code": default_language_code,
                    },
                )
                project = await repository.get_project(db, access.workspace_id, project_id)
        except ProjectSlugTakenError:
            raise _slug_taken() from None
        if project is None:  # pragma: no cover - inserted by this transaction
            raise NotFoundError
        return project

    async def get(self, access: WorkspaceAccess, project_id: UUID) -> ProjectRecord:
        async with workspace_transaction(
            self._sessions, access.workspace_id, user_id=access.user_id
        ) as db:
            project = await repository.get_project(db, access.workspace_id, project_id)
        if project is None:
            raise NotFoundError
        return project

    async def update(
        self,
        *,
        access: WorkspaceAccess,
        project_id: UUID,
        changes: Mapping[str, str | int | None],
        info: RequestInfo,
    ) -> tuple[ProjectRecord, bool]:
        """Change the given fields. Returns the project and whether its time zone changed.

        Nothing is written, or logged, when nothing differs.
        """
        try:
            async with workspace_transaction(
                self._sessions, access.workspace_id, user_id=access.user_id
            ) as db:
                current = await repository.get_project(
                    db, access.workspace_id, project_id, for_update=True
                )
                if current is None:
                    raise NotFoundError
                differing = {
                    field: value
                    for field, value in changes.items()
                    if getattr(current, field) != value
                }
                if not differing:
                    return current, False
                timezone = differing.get("timezone")
                if isinstance(timezone, str):
                    await check_timezone(db, timezone)
                await repository.update_project(
                    db,
                    workspace_id=access.workspace_id,
                    project_id=project_id,
                    changes=differing,
                    now=datetime.now(UTC),
                )
                await audit.record(
                    db,
                    workspace_id=access.workspace_id,
                    actor_id=access.user_id,
                    action="project.updated",
                    target_type="project",
                    target_id=project_id,
                    info=info,
                    before={field: getattr(current, field) for field in differing},
                    after=differing,
                )
                updated = await repository.get_project(db, access.workspace_id, project_id)
        except ProjectSlugTakenError:
            raise _slug_taken() from None
        if updated is None:  # pragma: no cover - the row was locked by this transaction
            raise NotFoundError
        return updated, "timezone" in differing
