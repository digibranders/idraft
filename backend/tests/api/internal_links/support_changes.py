"""Two crawls of one project, the second after changes, for the tests of the change store,
the Changes reads, extras and opportunities (plan 04)."""

from __future__ import annotations

import uuid

from tests.api.auth.support import Workspace, execute
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
