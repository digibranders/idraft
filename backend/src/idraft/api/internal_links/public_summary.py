"""The client summary behind a shared link (plan 06 Task 5, decision D15).

No session is involved. The token's hash finds one share through a definer function; an
unknown, an expired and a revoked link all end as `None`, so nobody can tell them apart. The
summary is then built with the same services the signed-in screens use, as a viewer limited to
the one project the share names, and cut down to `ClientSummary`.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from typing import Final
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api import limits
from idraft.api.auth.sessions import SessionContext
from idraft.api.auth.throttle import LoginThrottle
from idraft.api.internal_links.changes import ChangeService
from idraft.api.internal_links.problems import LinksDroppedError
from idraft.api.internal_links.reads import LinkReadService
from idraft.api.internal_links.shares import hash_token
from idraft.api.permissions import Role
from idraft.api.projects import repository as projects
from idraft.api.schemas.internal_links import TierRef
from idraft.api.schemas.internal_links_summary import (
    LOST_LINKS_MAX,
    ClientSummary,
    LostState,
    SummaryFlowCell,
    SummaryLost,
    SummaryLostLink,
    SummaryTier,
    SummaryWorklist,
    SummaryWorklistKey,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.collectors.crawl_store import latest_run
from idraft.crawl.scopes import LinkScope
from idraft.db.engine import workspace_transaction
from idraft.db.tables import crawl_runs

# What `secrets.token_urlsafe(32)` makes: anything else cannot be a token, whatever it says.
IP_PER_MINUTE: Final = 30
TOKEN_PER_HOUR: Final = 120
TOKEN_PATTERN: Final = re.compile(r"[A-Za-z0-9_-]{43}")
WORKLISTS: Final[tuple[SummaryWorklistKey, ...]] = (
    "under_linked_t1",
    "orphans",
    "editorial_orphans",
    "deep_only_through_auto",
    "broken_and_redirected",
    "links_to_non_indexable",
    "weak_outlinks",
)
# The counts that depend on links we may not have seen, when pages refused the crawler.
UNSEEN_LINKS: Final = frozenset(
    {"under_linked_t1", "orphans", "editorial_orphans", "deep_only_through_auto", "weak_outlinks"}
)
_LOOKUP = text(
    "SELECT workspace_id, project_id, created_by, expires_at, revoked_at "
    "FROM core.client_summary_share_by_token(:token_hash)"
)


def _code(tier: TierRef | None) -> str | None:
    return None if tier is None else tier.code


class PublicSummaryService:
    def __init__(
        self,
        *,
        sessions: async_sessionmaker[AsyncSession],
        reads: LinkReadService,
        changes: ChangeService,
        throttle: LoginThrottle,
    ) -> None:
        self._throttle = throttle
        self._sessions = sessions
        self._reads = reads
        self._changes = changes

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
        await limits.enforce(self._throttle, "share-ip", ip, limit=IP_PER_MINUTE, window_seconds=60)
        if TOKEN_PATTERN.fullmatch(token) is not None:
            await limits.enforce(
                self._throttle,
                "share-token",
                hash_token(token).hex(),
                limit=TOKEN_PER_HOUR,
                window_seconds=3600,
            )

    async def read(self, token: str, *, ip: str) -> ClientSummary | None:
        await self._limit(token, ip)
        share = await self._share(token)
        if share is None:
            return None
        workspace_id, project_id, creator = share
        access = self._access(workspace_id, project_id, creator)
        async with workspace_transaction(self._sessions, workspace_id) as db:
            project = await projects.get_project(db, workspace_id, project_id)
            run = await latest_run(db, workspace_id, project_id)
            if project is None or run is None:
                return None
            found = (
                await db.execute(
                    select(
                        crawl_runs.c.finished_at,
                        crawl_runs.c.created_at,
                        crawl_runs.c.links_dropped_at,
                        crawl_runs.c.previous_run_id,
                        crawl_runs.c.pages_blocked,
                    ).where(crawl_runs.c.workspace_id == workspace_id, crawl_runs.c.id == run)
                )
            ).one()
            previous_dropped = False
            if found.previous_run_id is not None:
                previous_dropped = (
                    await db.execute(
                        select(crawl_runs.c.links_dropped_at).where(
                            crawl_runs.c.workspace_id == workspace_id,
                            crawl_runs.c.id == found.previous_run_id,
                        )
                    )
                ).scalar_one_or_none() is not None
        flow = await self._reads.tier_flow(access, project_id, run=run, view=LinkScope.EDITORIAL)
        worklists = await self._reads.worklists(access, project_id, run=run)
        summary = await self._changes.summary(access, project_id, run=run)
        lost = await self._lost(
            access,
            project_id,
            run,
            state=summary.state,
            dropped=found.links_dropped_at is not None or previous_dropped,
        )
        tiers = sorted(flow.tiers, key=lambda stat: (stat.tier is None, _code(stat.tier) or ""))
        return ClientSummary(
            host=project.primary_host,
            crawled_at=found.finished_at or found.created_at,
            pages=sum(stat.pages for stat in flow.tiers),
            pages_blocked=found.pages_blocked,
            tiers=[
                SummaryTier(
                    code=_code(stat.tier),
                    name=None if stat.tier is None else stat.tier.name,
                    pages=stat.pages,
                    average_depth=stat.average_depth,
                )
                for stat in tiers
            ],
            flow=[
                SummaryFlowCell(
                    from_code=_code(cell.from_tier), to_code=_code(cell.to_tier), links=cell.links
                )
                for cell in flow.cells
            ],
            worklists=[
                SummaryWorklist(
                    key=key,
                    count=getattr(worklists, key),
                    may_be_incomplete=worklists.may_be_incomplete and key in UNSEEN_LINKS,
                )
                for key in WORKLISTS
            ],
            lost=lost,
            important_max_position=summary.important_max_position,
            generated_at=datetime.now(UTC),
        )

    async def _lost(
        self, access: WorkspaceAccess, project_id: UUID, run: UUID, *, state: str, dropped: bool
    ) -> SummaryLost:
        if state not in ("ready", "pending"):
            return _unavailable("no_comparison")
        if dropped:
            return _unavailable("dropped")
        try:
            page = await self._changes.links(
                access,
                project_id,
                run=run,
                change="lost",
                link_scope="editorial",
                only="top",
                offset=0,
                limit=LOST_LINKS_MAX,
            )
        except LinksDroppedError:
            return _unavailable("dropped")
        return SummaryLost(
            state="available",
            total=page.meta.total,
            links=[
                SummaryLostLink(
                    from_path=link.source.path, to_path=link.target.path, anchor=link.anchor
                )
                for link in page.data[:LOST_LINKS_MAX]
            ],
        )


def _unavailable(state: LostState) -> SummaryLost:
    return SummaryLost(state=state, total=None, links=[])
