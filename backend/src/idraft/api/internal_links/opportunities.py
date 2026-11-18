"""Link opportunities (spec 7.10, plan 04 D11 to D13). The mentions of a crawl are stored by
`crawl_enrich`; this reads them the way the screen needs: pairs with no editorial link in the
crawl's own links, from sources reachable from the start page, to live indexable targets, with
today's tiers and the people's decisions."""

from __future__ import annotations

from contextlib import AbstractAsyncContextManager
from typing import Any, Final, Literal, cast
from uuid import UUID

from sqlalchemy import ARRAY, BigInteger, CursorResult, bindparam, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api import audit
from idraft.api.ai.engine_service import live_project
from idraft.api.internal_links.csv_export import EXPORT_ROWS_MAX, csv_text
from idraft.api.internal_links.reads import load_tiers, read_scope
from idraft.api.request_info import RequestInfo
from idraft.api.schemas.internal_links_extra import (
    ChangePage,
    DecisionResult,
    Opportunity,
    OpportunityCounts,
    OpportunityDecisions,
    OpportunityMeta,
    OpportunityPage,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction

ROWS_MAX: Final = EXPORT_ROWS_MAX
CSV_HEADER: Final = ("Source URL", "Target URL", "Anchor", "Context", "Status")
# The rows of one crawl that are opportunities, with decisions and tiers. `{filters}` is a closed
# set of fragments built below, never text from the request.
_BASE = """
    SELECT m.source_url_id, m.target_url_id, m.phrase, m.context, m.origin,
           coalesce(d.status, 'open') AS status,
           su.canonical_url AS source_url, su.path AS source_path,
           tu.canonical_url AS target_url, tu.path AS target_path,
           sp.tier_id AS source_tier, tp.tier_id AS target_tier,
           tl.position AS target_position, scp.equity_share AS source_equity
    FROM seo.crawl_mentions m
    JOIN seo.crawl_pages scp ON scp.run_id = m.run_id AND scp.url_id = m.source_url_id
         AND scp.workspace_id = m.workspace_id
         AND scp.status_code = 200 AND scp.is_indexable AND scp.click_depth IS NOT NULL
    JOIN seo.crawl_pages tcp ON tcp.run_id = m.run_id AND tcp.url_id = m.target_url_id
         AND tcp.workspace_id = m.workspace_id AND tcp.status_code = 200 AND tcp.is_indexable
    JOIN core.urls su ON su.id = m.source_url_id
    JOIN core.urls tu ON tu.id = m.target_url_id
    LEFT JOIN core.project_pages sp ON sp.workspace_id = m.workspace_id
         AND sp.project_id = CAST(:project_id AS uuid) AND sp.url_id = m.source_url_id
    LEFT JOIN core.project_pages tp ON tp.workspace_id = m.workspace_id
         AND tp.project_id = CAST(:project_id AS uuid) AND tp.url_id = m.target_url_id
    LEFT JOIN core.page_tier_levels tl ON tl.id = tp.tier_id AND tl.workspace_id = tp.workspace_id
    LEFT JOIN core.link_opportunity_decisions d ON d.workspace_id = m.workspace_id
         AND d.project_id = CAST(:project_id AS uuid)
         AND d.source_url_id = m.source_url_id AND d.target_url_id = m.target_url_id
    WHERE m.run_id = CAST(:run_id AS uuid) AND m.workspace_id = CAST(:workspace_id AS uuid)
      AND m.source_url_id <> m.target_url_id
      AND NOT EXISTS (
          SELECT 1 FROM seo.crawl_links l
          WHERE l.run_id = m.run_id AND l.workspace_id = m.workspace_id
            AND l.source_url_id = m.source_url_id AND l.target_url_id = m.target_url_id
            AND l.scope = 'editorial')
"""
_ORDER = (
    "ORDER BY coalesce(tl.position, 99), scp.equity_share DESC NULLS LAST, su.path, tu.path, "
    "m.source_url_id, m.target_url_id"
)
_VALID_PAIRS = text(
    """
    SELECT source_url_id, target_url_id FROM seo.crawl_mentions
    WHERE run_id = CAST(:run_id AS uuid) AND workspace_id = CAST(:workspace_id AS uuid)
      AND (source_url_id, target_url_id) IN (SELECT * FROM unnest(:sources, :targets))
    """
).bindparams(
    bindparam("sources", type_=ARRAY(BigInteger)), bindparam("targets", type_=ARRAY(BigInteger))
)
_REOPEN = text(
    """
    DELETE FROM core.link_opportunity_decisions
    WHERE workspace_id = CAST(:workspace_id AS uuid) AND project_id = CAST(:project_id AS uuid)
      AND (source_url_id, target_url_id) IN (SELECT * FROM unnest(:sources, :targets))
    """
).bindparams(
    bindparam("sources", type_=ARRAY(BigInteger)), bindparam("targets", type_=ARRAY(BigInteger))
)
_DECIDE = text(
    """
    INSERT INTO core.link_opportunity_decisions
        (project_id, workspace_id, source_url_id, target_url_id, status, decided_by)
    SELECT CAST(:project_id AS uuid), CAST(:workspace_id AS uuid), pair.source, pair.target,
           :status, CAST(:user_id AS uuid)
    FROM unnest(:sources, :targets) AS pair(source, target)
    ON CONFLICT (project_id, source_url_id, target_url_id) DO UPDATE
    SET status = EXCLUDED.status, decided_by = EXCLUDED.decided_by, decided_at = now()
    WHERE core.link_opportunity_decisions.status <> EXCLUDED.status
    """
).bindparams(
    bindparam("sources", type_=ARRAY(BigInteger)), bindparam("targets", type_=ARRAY(BigInteger))
)


def _filters(status: str | None, tier: str | None, query: str | None) -> tuple[str, dict[str, Any]]:
    clauses: list[str] = []
    params: dict[str, Any] = {}
    if status is not None:
        clauses.append("AND coalesce(d.status, 'open') = :status")
        params["status"] = status
    if tier == "none":
        clauses.append("AND tl.position IS NULL")
    elif tier is not None:
        clauses.append("AND tl.position = :tier")
        params["tier"] = int(tier)
    if query:
        clauses.append("AND (su.path ILIKE :q ESCAPE '\\' OR tu.path ILIKE :q ESCAPE '\\')")
        params["q"] = (
            "%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        )
    return " ".join(clauses), params


class OpportunityService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _read(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(
            self._sessions,
            access.workspace_id,
            user_id=access.user_id,
            isolation_level="REPEATABLE READ",
        )

    async def list(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        run: UUID | None,
        status: Literal["open", "accepted", "dismissed"] | None,
        tier: str | None,
        query: str | None,
        offset: int,
        limit: int,
    ) -> OpportunityPage:
        async with self._read(access) as db:
            scope = await read_scope(db, access, project_id, run)
            scope.require_links()
            tiers = await load_tiers(db, access.workspace_id)
            keys = {
                "run_id": str(scope.run_id),
                "workspace_id": str(access.workspace_id),
                "project_id": str(project_id),
            }
            filters, extra = _filters(status, tier, query)
            found = (
                await db.execute(
                    text(f"{_BASE} {filters} {_ORDER} LIMIT :limit OFFSET :offset"),
                    {**keys, **extra, "limit": limit, "offset": offset},
                )
            ).all()
            total: int = (
                await db.execute(
                    text(f"SELECT count(*) FROM ({_BASE} {filters}) counted"),  # noqa: S608
                    {**keys, **extra},
                )
            ).scalar_one()
            by_status = {
                row.status: row.n
                for row in await db.execute(
                    text(f"SELECT status, count(*) AS n FROM ({_BASE}) s GROUP BY status"),  # noqa: S608
                    keys,
                )
            }
        return OpportunityPage(
            data=[
                Opportunity(
                    key=f"{row.source_url_id}>{row.target_url_id}",
                    source=ChangePage(
                        url_id=str(row.source_url_id),
                        url=row.source_url,
                        path=row.source_path,
                        tier=tiers.ref(row.source_tier),
                    ),
                    target=ChangePage(
                        url_id=str(row.target_url_id),
                        url=row.target_url,
                        path=row.target_path,
                        tier=tiers.ref(row.target_tier),
                    ),
                    phrase=row.phrase,
                    context=row.context,
                    anchor=row.phrase,
                    source_equity_share=row.source_equity,
                    status=row.status,
                    origin=row.origin,
                )
                for row in found
            ],
            meta=OpportunityMeta(
                run_id=scope.run_id,
                total=total,
                counts=OpportunityCounts(
                    open=by_status.get("open", 0),
                    accepted=by_status.get("accepted", 0),
                    dismissed=by_status.get("dismissed", 0),
                ),
            ),
        )

    @staticmethod
    def _csv(rows: OpportunityPage) -> str:
        return csv_text(
            CSV_HEADER,
            (
                (row.source.url, row.target.url, row.anchor, row.context, row.status)
                for row in rows.data
            ),
        )

    async def list_csv(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        run: UUID | None,
        status: Literal["open", "accepted", "dismissed"] | None,
        tier: str | None,
        query: str | None,
    ) -> str:
        """The list as it is filtered on screen."""
        return self._csv(
            await self.list(
                access,
                project_id,
                run=run,
                status=status,
                tier=tier,
                query=query,
                offset=0,
                limit=ROWS_MAX,
            )
        )

    async def planned_csv(
        self, access: WorkspaceAccess, project_id: UUID, *, run: UUID | None
    ) -> str:
        """Accepted rows, or every open row when nothing is accepted (spec 7.10)."""
        for status in ("accepted", "open"):
            rows = await self.list(
                access,
                project_id,
                run=run,
                status=status,
                tier=None,
                query=None,
                offset=0,
                limit=ROWS_MAX,
            )
            if rows.data:
                break
        return self._csv(rows)

    async def decide(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        body: OpportunityDecisions,
        info: RequestInfo,
    ) -> DecisionResult:
        """Accept, dismiss or reopen pairs that are mentions of the latest crawl. A pair that
        is not one is counted in neither number."""
        async with workspace_transaction(
            self._sessions, access.workspace_id, user_id=access.user_id
        ) as db:
            await live_project(db, access, project_id, lock=True)
            scope = await read_scope(db, access, project_id, None)
            scope.require_links()
            asked = sorted({(item.source_url_id, item.target_url_id) for item in body.items})
            valid = (
                await db.execute(
                    _VALID_PAIRS,
                    {
                        "run_id": str(scope.run_id),
                        "workspace_id": str(access.workspace_id),
                        "sources": [source for source, _ in asked],
                        "targets": [target for _, target in asked],
                    },
                )
            ).all()
            keys: dict[str, Any] = {
                "workspace_id": str(access.workspace_id),
                "project_id": str(project_id),
                "sources": [row.source_url_id for row in valid],
                "targets": [row.target_url_id for row in valid],
            }
            if body.status == "open":
                result = await db.execute(_REOPEN, keys)
            else:
                result = await db.execute(
                    _DECIDE, {**keys, "status": body.status, "user_id": str(access.user_id)}
                )
            changed = cast("CursorResult[Any]", result).rowcount
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="link_opportunity.decided",
                target_type="project",
                target_id=project_id,
                info=info,
                after={"status": body.status, "pairs": len(valid), "changed": changed},
            )
            return DecisionResult(matched=len(valid), changed=changed)
