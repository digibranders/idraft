"""Project settings (docs/19-api-specification.md section 3.3; doc 04 section 4): the `seo`
defaults tracked keyword creation uses. They are stored in `core.projects.settings`; a change
is a JSON merge patch of the `seo` part, so members left out keep their value, and the parts
this version does not edit (`ai`, `matrix`) are kept as they are. Every change is audited.
"""

from __future__ import annotations

from collections.abc import Mapping
from contextlib import AbstractAsyncContextManager
from typing import Any
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.api import audit
from sightline.api.problems import NotFoundError
from sightline.api.request_info import RequestInfo
from sightline.api.schemas.operations import ProjectSettings, ProjectSettingsPatch, SeoSettings
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.db.engine import workspace_transaction
from sightline.db.tables import projects


def _view(stored: Mapping[str, Any], entity_config_version: int) -> ProjectSettings:
    return ProjectSettings(
        seo=SeoSettings.model_validate(stored.get("seo") or {}),
        entity_config_version=entity_config_version,
    )


def _seo_snapshot(stored: Mapping[str, Any]) -> audit.Snapshot:
    """The `seo` settings as an audit entry holds them: one member per setting."""
    seo = SeoSettings.model_validate(stored.get("seo") or {}).model_dump(mode="json")
    return {f"seo.{name}": value for name, value in seo.items()}


class SettingsService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    @staticmethod
    async def _stored(
        db: AsyncSession, access: WorkspaceAccess, project_id: UUID, *, lock: bool
    ) -> tuple[dict[str, Any], int]:
        """The project's stored settings and entity version. With `lock`, the project is held
        (FOR NO KEY UPDATE) so two changes at once do not lose one another's members."""
        statement = select(projects.c.settings, projects.c.entity_config_version).where(
            projects.c.workspace_id == access.workspace_id,
            projects.c.id == project_id,
            projects.c.deleted_at.is_(None),
        )
        if lock:
            statement = statement.with_for_update(key_share=True)
        row = (await db.execute(statement)).one_or_none()
        if row is None:
            raise NotFoundError
        return dict(row.settings or {}), row.entity_config_version

    async def get(self, access: WorkspaceAccess, project_id: UUID) -> ProjectSettings:
        async with self._transaction(access) as db:
            stored, version = await self._stored(db, access, project_id, lock=False)
        return _view(stored, version)

    async def update(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        body: ProjectSettingsPatch,
        info: RequestInfo,
    ) -> ProjectSettings:
        async with self._transaction(access) as db:
            stored, version = await self._stored(db, access, project_id, lock=True)
            changed = dict(stored)
            changed["seo"] = {
                **(stored.get("seo") or {}),
                **body.seo.model_dump(mode="json", exclude_unset=True),
            }
            await db.execute(
                update(projects)
                .where(projects.c.workspace_id == access.workspace_id, projects.c.id == project_id)
                .values(settings=changed, updated_at=func.now())
            )
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="project.settings_updated",
                target_type="project",
                target_id=project_id,
                info=info,
                before=_seo_snapshot(stored),
                after=_seo_snapshot(changed),
            )
        return _view(changed, version)
