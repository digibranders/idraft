"""What the API and the worker both do to a project's crawls (plan decisions D10 and D16): find
the crawl in scope, give pages their rule tiers, and recompute the tier flow.

Every statement names the workspace, because the worker bypasses row-level security.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Final
from uuid import UUID

from sqlalchemy import bindparam, delete, func, insert, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.crawl.tiers import MatchType, TierRule, first_match
from idraft.db.tables import (
    crawl_pages,
    crawl_runs,
    crawl_tier_flow,
    crawl_tier_stats,
    project_pages,
    tier_rules,
    urls,
)

# Crawls whose data the screens show; the latest of them is `run=latest`.
DATA_STATES: Final = ("ready", "stopped_at_ceiling")
ACTIVE_STATES: Final = ("queued", "crawling", "processing")
# A tier change recomputes the flow in the request up to this many links (spec 6.6).
INLINE_FLOW_LINKS: Final = 200_000
_ROWS_PER_STATEMENT: Final = 5_000


async def latest_run(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> UUID | None:
    found: UUID | None = (
        await db.execute(
            select(crawl_runs.c.id)
            .where(
                crawl_runs.c.workspace_id == workspace_id,
                crawl_runs.c.project_id == project_id,
                crawl_runs.c.state.in_(DATA_STATES),
            )
            .order_by(crawl_runs.c.created_at.desc(), crawl_runs.c.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return found


async def project_rules(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> list[TierRule]:
    rows = await db.execute(
        select(tier_rules).where(
            tier_rules.c.workspace_id == workspace_id, tier_rules.c.project_id == project_id
        )
    )
    return [
        TierRule(
            rule_id=row.id,
            position=row.position,
            match_type=MatchType(row.match_type),
            value=row.value,
            tier_id=row.tier_id,
        )
        for row in rows
    ]


def _chunks[T](items: Sequence[T]) -> list[Sequence[T]]:
    return [
        items[start : start + _ROWS_PER_STATEMENT]
        for start in range(0, len(items), _ROWS_PER_STATEMENT)
    ]


async def apply_rules(db: AsyncSession, *, workspace_id: UUID, project_id: UUID) -> int:
    """Give every page of the latest crawl, and every URL that has a rule tier, the tier of the
    first rule that matches its path; a page with a manual tier is left as it is. Returns the
    rows added, changed or removed."""
    rules = await project_rules(db, workspace_id, project_id)
    run_id = await latest_run(db, workspace_id, project_id)
    current_rows = (
        await db.execute(
            select(
                project_pages.c.url_id,
                project_pages.c.tier_id,
                project_pages.c.tier_source,
                project_pages.c.rule_id,
                urls.c.path,
            )
            .join(urls, urls.c.id == project_pages.c.url_id)
            .where(
                project_pages.c.workspace_id == workspace_id,
                project_pages.c.project_id == project_id,
            )
        )
    ).all()
    current = {row.url_id: row for row in current_rows}
    # Paths come from joins, not from an id list: a crawl has far more pages than one statement
    # can take as parameters.
    paths: dict[int, str] = {row.url_id: row.path for row in current_rows}
    if run_id is not None:
        crawled = await db.execute(
            select(urls.c.id, urls.c.path)
            .join(crawl_pages, crawl_pages.c.url_id == urls.c.id)
            .where(crawl_pages.c.workspace_id == workspace_id, crawl_pages.c.run_id == run_id)
        )
        paths.update(dict(crawled.all()))
    added: list[dict[str, object]] = []
    changed: list[dict[str, object]] = []
    removed: list[int] = []
    for url_id, path in paths.items():
        row = current.get(url_id)
        if row is not None and row.tier_source == "manual":
            continue
        match = first_match(rules, path)
        if match is None:
            if row is not None:
                removed.append(url_id)
        elif row is None:
            added.append(
                {
                    "project_id": project_id,
                    "url_id": url_id,
                    "workspace_id": workspace_id,
                    "tier_id": match.tier_id,
                    "tier_source": "rule",
                    "rule_id": match.rule_id,
                }
            )
        elif (row.tier_id, row.rule_id) != (match.tier_id, match.rule_id):
            changed.append({"b_url": url_id, "b_tier": match.tier_id, "b_rule": match.rule_id})
    for chunk in _chunks(added):
        await db.execute(insert(project_pages), list(chunk))
    if changed:
        await db.execute(
            update(project_pages)
            .where(
                project_pages.c.workspace_id == workspace_id,
                project_pages.c.project_id == project_id,
                project_pages.c.url_id == bindparam("b_url"),
            )
            .values(tier_id=bindparam("b_tier"), rule_id=bindparam("b_rule"), set_at=func.now()),
            changed,
        )
    for gone in _chunks(removed):
        await db.execute(
            delete(project_pages).where(
                project_pages.c.workspace_id == workspace_id,
                project_pages.c.project_id == project_id,
                project_pages.c.url_id.in_(gone),
                project_pages.c.tier_source == "rule",
            )
        )
    return len(added) + len(changed) + len(removed)


_FLOW = text(
    """
    WITH pairs AS (
        SELECT DISTINCT l.source_url_id, l.target_url_id, l.scope
        FROM seo.crawl_links l
        WHERE l.run_id = CAST(:run_id AS uuid) AND l.workspace_id = CAST(:workspace_id AS uuid)
          AND l.source_url_id <> l.target_url_id
    ), tagged AS (
        SELECT p.source_url_id, p.target_url_id, p.scope,
               fp.tier_id AS from_tier, tp.tier_id AS to_tier
        FROM pairs p
        LEFT JOIN core.project_pages fp ON fp.workspace_id = CAST(:workspace_id AS uuid)
             AND fp.project_id = CAST(:project_id AS uuid) AND fp.url_id = p.source_url_id
        LEFT JOIN core.project_pages tp ON tp.workspace_id = CAST(:workspace_id AS uuid)
             AND tp.project_id = CAST(:project_id AS uuid) AND tp.url_id = p.target_url_id
    )
    INSERT INTO seo.crawl_tier_flow (run_id, workspace_id, scope, from_tier_id, to_tier_id, links)
    SELECT CAST(:run_id AS uuid), CAST(:workspace_id AS uuid), scope, from_tier, to_tier, count(*)
    FROM tagged GROUP BY scope, from_tier, to_tier
    UNION ALL
    SELECT CAST(:run_id AS uuid), CAST(:workspace_id AS uuid), 'all', from_tier, to_tier,
           count(DISTINCT (source_url_id, target_url_id))
    FROM tagged GROUP BY from_tier, to_tier
    """
)
_STATS = text(
    """
    INSERT INTO seo.crawl_tier_stats (run_id, workspace_id, tier_id, pages, equity_share,
                                      average_depth)
    SELECT CAST(:run_id AS uuid), CAST(:workspace_id AS uuid), pp.tier_id, count(*),
           coalesce(sum(cp.equity_share), 0), avg(cp.click_depth)
    FROM seo.crawl_pages cp
    LEFT JOIN core.project_pages pp ON pp.workspace_id = CAST(:workspace_id AS uuid)
         AND pp.project_id = cp.project_id AND pp.url_id = cp.url_id
    WHERE cp.run_id = CAST(:run_id AS uuid) AND cp.workspace_id = CAST(:workspace_id AS uuid)
    GROUP BY pp.tier_id
    """
)


async def recompute_tier_flow(db: AsyncSession, *, workspace_id: UUID, run_id: UUID) -> None:
    """The flow matrix and the per-tier strip of one crawl, from its links and today's tiers."""
    project_id: UUID = (
        await db.execute(
            select(crawl_runs.c.project_id).where(
                crawl_runs.c.workspace_id == workspace_id, crawl_runs.c.id == run_id
            )
        )
    ).scalar_one()
    keys = {
        "run_id": str(run_id),
        "workspace_id": str(workspace_id),
        "project_id": str(project_id),
    }
    for table in (crawl_tier_flow, crawl_tier_stats):
        await db.execute(
            delete(table).where(table.c.run_id == run_id, table.c.workspace_id == workspace_id)
        )
    await db.execute(_FLOW, keys)
    await db.execute(_STATS, {"run_id": keys["run_id"], "workspace_id": keys["workspace_id"]})
    await db.execute(
        update(crawl_runs)
        .where(crawl_runs.c.workspace_id == workspace_id, crawl_runs.c.id == run_id)
        .values(tier_flow_stale=False)
    )


async def tiers_changed(db: AsyncSession, *, workspace_id: UUID, project_id: UUID) -> None:
    """After a tier, rule or tier-level change: the latest crawl's flow, now or by the tick."""
    run_id = await latest_run(db, workspace_id, project_id)
    if run_id is None:
        return
    links: int = (
        await db.execute(
            select(crawl_runs.c.links_stored).where(
                crawl_runs.c.workspace_id == workspace_id, crawl_runs.c.id == run_id
            )
        )
    ).scalar_one()
    if links <= INLINE_FLOW_LINKS:
        await recompute_tier_flow(db, workspace_id=workspace_id, run_id=run_id)
    else:
        await db.execute(
            update(crawl_runs)
            .where(crawl_runs.c.workspace_id == workspace_id, crawl_runs.c.id == run_id)
            .values(tier_flow_stale=True)
        )
