"""A crawl with one known case of each word of the Pages spec section 4 (live, variant, redirected,
client error, server error, blocked, other), for the tests of the page views."""

from __future__ import annotations

import uuid
from typing import Final

from tests.api.auth.support import Workspace, execute
from tests.api.internal_links.support import seed_crawl, seed_tiers
from tests.conftest import PostgresServer

# path, status, resource_type, is_indexable, in_sitemap, click_depth, is_orphan
_PAGES: Final = [
    ("/", 200, "html", True, True, 0, False),
    ("/pricing", 200, "html", True, True, 1, False),
    ("/blog/", 200, "html", True, False, 1, False),
    ("/blog/a", 200, "html", True, True, 2, False),
    ("/blog/b", 200, "html", False, True, 2, False),
    ("/blog/deep", 200, "html", True, False, 9, False),
    ("/docs/lost", 200, "html", True, False, None, True),
    ("/blog/a-variant", 200, "html", False, True, 2, False),
    ("/old", 301, "redirect", False, True, 3, False),
    ("/gone", 404, "broken", False, True, 3, False),
    ("/down", 500, "broken", False, False, None, True),
    ("/private", 403, "broken", False, False, None, False),
    ("/file.pdf", 200, "other", False, False, 2, False),
    ("/unknown", None, "other", False, False, None, False),
]
SITEMAP_PAGES: Final = 7

EXPECTED: Final = {
    "addresses": 14,
    "live": 7,
    "variant": 1,
    "redirected": 1,
    "client_error": 1,
    "server_error": 1,
    "blocked": 1,
    "other": 2,
    "indexable": 6,
    "not_indexable": 1,
    "reachable": 6,
    "unreachable": 1,
    "orphans": 2,
    "indexable_in_sitemap": 3,
    "indexable_missing": 3,
    "listed_not_live": 2,
    "listed_not_indexable": 1,
}


async def inventory_site(
    pg: PostgresServer, workspace: Workspace, project_id: uuid.UUID, *, sitemap: bool = True
) -> tuple[uuid.UUID, dict[str, int], list[uuid.UUID]]:
    """A finished crawl with one known case of each word of spec section 4. Returns the run id, the
    url ids by path and the tier ids. Without `sitemap` the crawl found none: no page is in it and
    `sitemap_pages` is null."""
    tiers = await seed_tiers(pg, workspace)
    # `seed_crawl` takes a status that is a number: the page without one is set to null below.
    run_id, ids = await seed_crawl(
        pg, workspace, project_id, [(page[0], page[1] or 200) for page in _PAGES]
    )
    for path, status, resource_type, indexable, listed, depth, orphan in _PAGES:
        await execute(
            pg,
            "UPDATE seo.crawl_pages SET status_code = $3::smallint, resource_type = $4, "
            "is_indexable = $5, in_sitemap = $6, click_depth = $7, is_orphan = $8 "
            "WHERE run_id = $1 AND url_id = $2",
            run_id,
            ids[path],
            status,
            resource_type,
            indexable,
            listed and sitemap,
            depth,
            orphan,
        )
    # The one case that is not indexable on purpose; the check allows these reasons only.
    await execute(
        pg,
        "UPDATE seo.crawl_pages SET non_indexable_reason = 'meta_tag' "
        "WHERE run_id = $1 AND url_id = $2",
        run_id,
        ids["/blog/b"],
    )
    await execute(
        pg,
        "UPDATE seo.crawl_pages SET variant_of_url_id = $3, canonical_url_id = $3 "
        "WHERE run_id = $1 AND url_id = $2",
        run_id,
        ids["/blog/a-variant"],
        ids["/blog/a"],
    )
    await execute(
        pg,
        "UPDATE seo.crawl_pages SET redirect_url_id = $3 WHERE run_id = $1 AND url_id = $2",
        run_id,
        ids["/old"],
        ids["/pricing"],
    )
    await execute(
        pg,
        "UPDATE seo.crawl_runs SET sitemap_pages = $2::integer WHERE id = $1",
        run_id,
        SITEMAP_PAGES if sitemap else None,
    )
    for path, tier in (("/pricing", tiers[0]), ("/blog/a", tiers[2])):
        await execute(
            pg,
            "INSERT INTO core.project_pages (project_id, url_id, workspace_id, tier_id, "
            "tier_source) VALUES ($1, $2, $3, $4, 'manual')",
            project_id,
            ids[path],
            workspace.id,
            tier,
        )
    return run_id, ids, tiers
