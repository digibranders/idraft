"""What the running application holds, typed once so routes never reach into `app.state`."""

from __future__ import annotations

from dataclasses import dataclass

import httpx
from fastapi import Request
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from idraft.api.auth.service import AuthService
from idraft.api.auth.sessions import SessionStore
from idraft.api.entities.project_service import ProjectEntityService
from idraft.api.entities.service import EntityService
from idraft.api.imports.service import ImportService
from idraft.api.keywords.group_service import GroupService
from idraft.api.keywords.service import KeywordService
from idraft.api.operations.costs import CostService
from idraft.api.operations.runs import RunService
from idraft.api.operations.schedules import ScheduleService
from idraft.api.operations.settings import SettingsService
from idraft.api.projects.service import ProjectService
from idraft.api.ranks.service import RankService
from idraft.api.taxonomy.service import TaxonomyService
from idraft.api.workspaces.invitations import InvitationService
from idraft.api.workspaces.members import MemberService
from idraft.api.workspaces.service import WorkspaceService
from idraft.config.settings import Settings
from idraft.db.migrate import MigrationState
from idraft.providers.email import EmailSender
from idraft.storage.raw import ObjectStore


@dataclass(frozen=True)
class Resources:
    settings: Settings
    engine: AsyncEngine
    sessions: async_sessionmaker[AsyncSession]
    redis: Redis
    migrations: MigrationState
    http: httpx.AsyncClient
    email: EmailSender
    # Where keyword import sources are kept; None without R2 settings.
    import_store: ObjectStore | None
    session_store: SessionStore
    auth: AuthService
    workspaces: WorkspaceService
    members: MemberService
    invitations: InvitationService
    projects: ProjectService
    entities: EntityService
    project_entities: ProjectEntityService
    taxonomy: TaxonomyService
    keywords: KeywordService
    keyword_groups: GroupService
    runs: RunService
    schedules: ScheduleService
    project_settings: SettingsService
    costs: CostService
    imports: ImportService
    ranks: RankService


def get_resources(request: Request) -> Resources:
    """FastAPI dependency. The lifespan sets this before the first request is served."""
    resources = request.app.state.resources
    if not isinstance(resources, Resources):  # pragma: no cover - a wiring error, not a request
        raise TypeError("application resources are not initialised")
    return resources
