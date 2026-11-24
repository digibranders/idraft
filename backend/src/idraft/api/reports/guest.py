"""The report behind a guest link.

No session is involved. The token's hash finds one share through a definer function; an unknown,
an expired and a revoked link all end as `None`, so nobody can tell them apart. The report is
then read with the same services the signed-in screens use, as a viewer limited to the one
project the share names, and cut down to `ClientReport`: nothing in it comes from another
project, and nothing in it is a cost, a prompt text or an answer.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Final
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api import limits
from idraft.api.ai.sources import SourceQuery, SourceService
from idraft.api.ai.summary import SummaryQuery, SummaryService
from idraft.api.auth.sessions import SessionContext
from idraft.api.auth.throttle import LoginThrottle
from idraft.api.internal_links.public_summary import (
    IP_PER_MINUTE,
    TOKEN_PATTERN,
    TOKEN_PER_HOUR,
)
from idraft.api.internal_links.shares import hash_token
from idraft.api.pagination import OffsetParams
from idraft.api.permissions import Role
from idraft.api.projects import repository as projects
from idraft.api.schemas.ai import EngineSummary, PromptsSummary
from idraft.api.schemas.ai_reports import (
    ClientReport,
    ReportBrand,
    ReportBrandEngine,
    ReportDomain,
    ReportEngine,
    ReportWeek,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction

DOMAINS_MAX: Final = 10
_LOOKUP = text(
    "SELECT workspace_id, project_id, created_by, expires_at, revoked_at "
    "FROM core.ai_report_share_by_token(:token_hash)"
)


def _engine(engine: EngineSummary) -> ReportEngine:
    return ReportEngine(
        engine_code=engine.engine_code,
        mentioned=engine.mentioned,
        cited=engine.cited,
        weeks=[
            ReportWeek(
                week_start=week.week_start,
                is_pooled=week.is_pooled,
                mentioned=week.mentioned,
                cited=week.cited,
            )
            for week in engine.series or []
        ],
    )


def _brands(data: PromptsSummary, engines: list[EngineSummary]) -> list[ReportBrand]:
    return [
        ReportBrand(
            name=entity.name,
            role=entity.role,
            engines=[
                ReportBrandEngine(
                    engine_code=engine.engine_code,
                    mentioned=cells.mentioned,
                )
                for engine in engines
                for cells in engine.entities or []
                if cells.entity_id == entity.entity_id
            ],
        )
        for entity in sorted(data.entities, key=lambda entity: entity.role != "own")
    ]


class ClientReportService:
    def __init__(
        self,
        *,
        sessions: async_sessionmaker[AsyncSession],
        summaries: SummaryService,
        sources: SourceService,
        throttle: LoginThrottle,
    ) -> None:
        self._sessions = sessions
        self._summaries = summaries
        self._sources = sources
        self._throttle = throttle

    async def _share(self, token: str) -> tuple[UUID, UUID, UUID] | None:
        """(workspace, project, creator) of a share that works now, else None."""
        if TOKEN_PATTERN.fullmatch(token) is None:
            return None
        async with self._sessions() as db, db.begin():
            row = (await db.execute(_LOOKUP, {"token_hash": hash_token(token)})).one_or_none()
        if row is None or row.revoked_at is not None or row.expires_at <= datetime.now(UTC):
            return None
        return row.workspace_id, row.project_id, row.created_by

    @staticmethod
    def _access(workspace_id: UUID, project_id: UUID, creator: UUID) -> WorkspaceAccess:
        now = datetime.now(UTC)
        return WorkspaceAccess(
            session=SessionContext(
                session_id=uuid.uuid4(),
                user_id=creator,
                state="active",
                fresh_until=None,
                idle_expires_at=now,
                absolute_expires_at=now,
                last_seen_at=now,
            ),
            workspace_id=workspace_id,
            role=Role.VIEWER,
            project_ids=frozenset({project_id}),
        )

    async def _limit(self, token: str, ip: str) -> None:
        """30 requests a minute per address and 120 an hour per link; past either it is 429. A
        string that cannot be a token counts against the address only."""
        await limits.enforce(
            self._throttle, "report-ip", ip, limit=IP_PER_MINUTE, window_seconds=60
        )
        if TOKEN_PATTERN.fullmatch(token) is not None:
            await limits.enforce(
                self._throttle,
                "report-token",
                hash_token(token).hex(),
                limit=TOKEN_PER_HOUR,
                window_seconds=3600,
            )

    async def read(self, token: str, *, ip: str) -> ClientReport | None:
        await self._limit(token, ip)
        share = await self._share(token)
        if share is None:
            return None
        workspace_id, project_id, creator = share
        access = self._access(workspace_id, project_id, creator)
        async with workspace_transaction(self._sessions, workspace_id) as db:
            project = await projects.get_project(db, workspace_id, project_id)
        if project is None:
            return None
        data = await self._summaries.summary(
            access,
            project_id,
            SummaryQuery(include=frozenset({"total", "entities", "series"}), rows="none"),
        )
        if data.total is None:
            return None
        domains = await self._sources.domains(
            access,
            project_id,
            SourceQuery(),
            sort="-citation_units",
            page=OffsetParams(offset=0, limit=DOMAINS_MAX),
        )
        engines = data.total.engines
        return ClientReport(
            host=project.primary_host or project.name,
            window_from=data.window.from_,
            window_to=data.window.to,
            timezone=data.window.timezone,
            generated_at=datetime.now(UTC),
            prompt_count=data.total.prompt_count,
            engines=[_engine(engine) for engine in engines],
            brands=_brands(data, engines),
            cited_domains=[
                ReportDomain(
                    registrable_domain=row.registrable_domain,
                    domain_role=row.domain_role,
                    citation_units=row.citation_units,
                    source_share=row.source_share,
                )
                for row in domains.data
            ],
        )
