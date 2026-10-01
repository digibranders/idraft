"""What the running application holds, typed once so routes never reach into `app.state`."""

from __future__ import annotations

from dataclasses import dataclass

import httpx
from fastapi import Request
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from sightline.api.auth.service import AuthService
from sightline.api.auth.sessions import SessionStore
from sightline.api.entities.project_service import ProjectEntityService
from sightline.api.entities.service import EntityService
from sightline.api.keywords.service import KeywordService
from sightline.api.projects.service import ProjectService
from sightline.api.taxonomy.service import TaxonomyService
from sightline.api.workspaces.invitations import InvitationService
from sightline.api.workspaces.members import MemberService
from sightline.api.workspaces.service import WorkspaceService
from sightline.config.settings import Settings
from sightline.db.migrate import MigrationState
from sightline.providers.email import EmailSender


@dataclass(frozen=True)
class Resources:
    settings: Settings
    engine: AsyncEngine
    sessions: async_sessionmaker[AsyncSession]
    redis: Redis
    migrations: MigrationState
    http: httpx.AsyncClient
    email: EmailSender
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


def get_resources(request: Request) -> Resources:
    """FastAPI dependency. The lifespan sets this before the first request is served."""
    resources = request.app.state.resources
    if not isinstance(resources, Resources):  # pragma: no cover - a wiring error, not a request
        raise TypeError("application resources are not initialised")
    return resources
