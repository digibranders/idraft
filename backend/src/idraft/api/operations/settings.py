"""Project settings (docs/19-api-specification.md section 3.3; doc 04 section 4): the `seo`
defaults tracked keyword creation uses and the `internal_links` crawl settings (internal links
plan 02). They are stored in `core.projects.settings`; a change is a JSON merge patch of those
parts, so members left out keep their value, and the parts this version does not edit (`ai`,
`matrix`) are kept as they are. Every change is audited.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from typing import Any
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api import audit
from idraft.api.problems import NotFoundError, invalid_field
from idraft.api.request_info import RequestInfo
from idraft.api.schemas.operations import (
    InternalLinksSettings,
    ProjectSettings,
    ProjectSettingsPatch,
    SeoSettings,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.crawl.hosts import is_site_host
from idraft.db.engine import workspace_transaction
from idraft.db.tables import domains, projects


def _view(stored: Mapping[str, Any], entity_config_version: int) -> ProjectSettings:
    return ProjectSettings(
        seo=SeoSettings.model_validate(stored.get("seo") or {}),
        internal_links=InternalLinksSettings.model_validate(stored.get("internal_links") or {}),
        entity_config_version=entity_config_version,
    )


def _snapshot(stored: Mapping[str, Any]) -> audit.Snapshot:
    """Both parts as an audit entry holds them: one member per setting."""
    seo = SeoSettings.model_validate(stored.get("seo") or {}).model_dump(mode="json")
    links = InternalLinksSettings.model_validate(stored.get("internal_links") or {}).model_dump(
        mode="json"
    )
    return {
        **{f"seo.{name}": value for name, value in seo.items()},
        **{f"internal_links.{name}": value for name, value in links.items()},
    }


def _check_subdomains(site_host: str | None, names: Sequence[str]) -> None:
    """Every allowed subdomain is the project's site or a host under it: a crawl stays on the
    client's own site. Without a website there is nothing to be under."""
    bare = None if site_host is None else site_host.removeprefix("www.")
    strangers = [name for name in names if site_host is None or not is_site_host(site_host, name)]
    if strangers:
        raise invalid_field(
            "internal_links.allowed_subdomains",
            code="not_a_site_host",
            message=(
                "Each host must be the project's website or a subdomain of it "
                f"({bare}): {', '.join(strangers)}."
                if bare is not None
                else "The project has no website yet, so it has no subdomains."
            ),
        )


class SettingsService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    @staticmethod
    async def _stored(
        db: AsyncSession, access: WorkspaceAccess, project_id: UUID, *, lock: bool
    ) -> tuple[dict[str, Any], int, str | None]:
        """The project's stored settings, entity version and website host. With `lock`, the
        project is held (FOR NO KEY UPDATE) so two changes at once do not lose one another's
        members."""
        statement = (
            select(
                projects.c.settings,
                projects.c.entity_config_version,
                domains.c.host.label("site_host"),
            )
            .outerjoin(domains, domains.c.id == projects.c.primary_domain_id)
            .where(
                projects.c.workspace_id == access.workspace_id,
                projects.c.id == project_id,
                projects.c.deleted_at.is_(None),
            )
        )
        if lock:
            statement = statement.with_for_update(of=projects, key_share=True)
        row = (await db.execute(statement)).one_or_none()
        if row is None:
            raise NotFoundError
        return dict(row.settings or {}), row.entity_config_version, row.site_host

    async def get(self, access: WorkspaceAccess, project_id: UUID) -> ProjectSettings:
        async with self._transaction(access) as db:
            stored, version, _ = await self._stored(db, access, project_id, lock=False)
        return _view(stored, version)

    async def update(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        body: ProjectSettingsPatch,
        info: RequestInfo,
    ) -> ProjectSettings:
        async with self._transaction(access) as db:
            stored, version, site_host = await self._stored(db, access, project_id, lock=True)
            if body.internal_links is not None and body.internal_links.allowed_subdomains:
                _check_subdomains(site_host, body.internal_links.allowed_subdomains)
            changed = dict(stored)
            for part, patch in (("seo", body.seo), ("internal_links", body.internal_links)):
                if patch is None:
                    continue
                given = patch.model_dump(mode="json", exclude_unset=True)
                merged = {**(stored.get(part) or {}), **given}
                if "alerts" in given:  # a merge patch goes one level deeper here
                    merged["alerts"] = {
                        **((stored.get(part) or {}).get("alerts") or {}),
                        **given["alerts"],
                    }
                changed[part] = merged
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
                before=_snapshot(stored),
                after=_snapshot(changed),
            )
        return _view(changed, version)
