"""Two crawls of one project, the second after changes, for the tests of the change store,
the Changes reads, extras and opportunities (plan 04)."""

from __future__ import annotations

import uuid

from tests.api.auth.support import Workspace, execute, fetchrow
from tests.api.internal_links.support import SeedLink, seed_crawl, seed_tiers, set_counts
from tests.conftest import PostgresServer

PAGES = [("/", 200), ("/pricing", 200), ("/blog", 200), ("/blog/a", 200), ("/blog/b", 200)]
BEFORE = [
    SeedLink("/", "/pricing", "navigation", "Pricing"),
    SeedLink("/blog", "/pricing", "content", "See plans"),
    SeedLink("/blog/a", "/pricing", "content", "Plans"),
]
AFTER = [
    SeedLink("/", "/pricing", "navigation", "Pricing"),
    SeedLink("/blog/a", "/pricing", "navigation", "Plans"),
    SeedLink("/blog", "/blog/b", "content", "Click here"),
    SeedLink("/blog/a", "/blog/b", "content", "SOC pricing"),
]


async def two_crawls(
    pg: PostgresServer, workspace: Workspace, project_id: uuid.UUID
) -> tuple[uuid.UUID, uuid.UUID, dict[str, int], list[uuid.UUID]]:
    """(older run, newer run, url ids by path, tier ids). /pricing is a manual T1 and /blog/b a
    manual T3. Between the crawls /blog stopped linking to /pricing by a link in the text, and
    /blog/a kept a menu link to it; /blog/b gained two links in the text."""
    tiers = await seed_tiers(pg, workspace)
    older, ids = await seed_crawl(pg, workspace, project_id, PAGES, BEFORE)
    newer, _ = await seed_crawl(pg, workspace, project_id, PAGES, AFTER)
    for run in (older, newer):
        await set_counts(pg, run)
    for path, tier in (("/pricing", tiers[0]), ("/blog/b", tiers[2])):
        await execute(
            pg,
            "INSERT INTO core.project_pages (project_id, url_id, workspace_id, tier_id, "
            "tier_source) VALUES ($1, $2, $3, $4, 'manual')",
            project_id,
            ids[path],
            workspace.id,
            tier,
        )
    return older, newer, ids, tiers


async def track_keyword(
    pg: PostgresServer,
    workspace: Workspace,
    project_id: uuid.UUID,
    text: str,
    target_url_id: int | None,
    *,
    rank: int | None,
    change: int | None,
    volume: int | None,
) -> None:
    """A tracked keyword of a page with its current rank and change, and its search volume as
    the keyword list reads it (`seo.keyword_metrics_current`, source `dataforseo_labs`, which
    needs a snapshot row)."""
    row = await fetchrow(
        pg,
        "WITH k AS (INSERT INTO seo.keywords (workspace_id, text, normalized_text, "
        "language_code) VALUES ($1, $4, $4, 'en') RETURNING id), "
        "t AS (INSERT INTO seo.tracked_keywords (workspace_id, project_id, keyword_id, "
        "location_id, language_code, device, target_url_id) SELECT $1, $2, k.id, "
        "(SELECT default_location_id FROM core.projects WHERE id = $2), 'en', 'desktop', $3 "
        "FROM k RETURNING id, keyword_id, location_id), "
        "s AS (INSERT INTO seo.tracked_keyword_state (tracked_keyword_id, workspace_id, "
        "project_id, current_rank, rank_change) SELECT t.id, $1, $2, $5, $6 FROM t "
        "RETURNING tracked_keyword_id) "
        "SELECT t.keyword_id, t.location_id FROM t",
        workspace.id,
        project_id,
        target_url_id,
        text,
        rank,
        change,
    )
    if volume is None:
        return
    await execute(
        pg,
        "WITH snap AS (INSERT INTO seo.keyword_metric_snapshots (workspace_id, keyword_id, "
        "location_id, language_code, source, fetched_at, search_volume, is_material_change) "
        "VALUES ($1, $2, $3, 'en', 'dataforseo_labs', now(), $4, false) RETURNING id) "
        "INSERT INTO seo.keyword_metrics_current (keyword_id, location_id, language_code, "
        "source, workspace_id, snapshot_id, search_volume, fetched_at) "
        "SELECT $2, $3, 'en', 'dataforseo_labs', $1, snap.id, $4, now() FROM snap",
        workspace.id,
        row["keyword_id"],
        row["location_id"],
        volume,
    )
