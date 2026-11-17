"""Helpers for the internal links route tests: tiers, crawls, pages and links written
directly, so a route test needs no worker."""

from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from idraft.crawl.scopes import scope_of
from idraft.crawl.tiers import DEFAULT_TIERS
from tests.api.auth.support import Workspace, execute, fetch, fetchrow
from tests.conftest import PostgresServer


def tiers_url(workspace: Workspace, *parts: object) -> str:
    return "/".join([f"/api/v1/workspaces/{workspace.id}/page-tiers", *map(str, parts)])


async def seed_tiers(pg: PostgresServer, workspace: Workspace, count: int = 4) -> list[uuid.UUID]:
    """The workspace's default tiers (decision D17), the first `count` of them."""
    ids = []
    for position, (name, description) in enumerate(DEFAULT_TIERS[:count], start=1):
        row = await fetchrow(
            pg,
            "INSERT INTO core.page_tier_levels (workspace_id, position, name, description) "
            "VALUES ($1, $2, $3, $4) RETURNING id",
            workspace.id,
            position,
            name,
            description,
        )
        ids.append(row["id"])
    return ids


async def url_id(pg: PostgresServer, url: str) -> int:
    """The `core.urls` row of an https URL on example.com, made when missing."""
    host, _, path = url.removeprefix("https://").partition("/")
    path = "/" + path
    await execute(
        pg,
        "INSERT INTO core.domains (host, registrable_domain, public_suffix) "
        "VALUES ($1, 'example.com', 'com') ON CONFLICT (host) DO NOTHING",
        host,
    )
    row = await fetchrow(
        pg,
        "INSERT INTO core.urls (url_hash, canonical_url, domain_id, path, canonicalizer_version) "
        "SELECT $1, $2, id, $3, 1 FROM core.domains WHERE host = $4 "
        "ON CONFLICT (url_hash) DO UPDATE SET path = excluded.path RETURNING id",
        hashlib.sha256(f"{host}{path}".encode()).digest(),
        f"https://{host}{path}",
        path,
        host,
    )
    found: int = row["id"]
    return found


@dataclass(frozen=True)
class SeedLink:
    source: str
    target: str
    placement: str = "content"
    anchor: str = ""
    followed: bool = True


async def seed_crawl(
    pg: PostgresServer,
    workspace: Workspace,
    project_id: uuid.UUID,
    pages: Sequence[tuple[str, int]],
    links: Sequence[SeedLink] = (),
    *,
    state: str = "ready",
) -> tuple[uuid.UUID, dict[str, int]]:
    """A finished crawl of `pages` (path, status) on example.com with `links` between them.
    Counts and metrics are left at their defaults; tests that need them set them."""
    run = await fetchrow(
        pg,
        "INSERT INTO seo.crawl_runs (workspace_id, project_id, trigger, state, target_host, "
        "settings, ceiling, finished_at) VALUES ($1, $2, 'manual', $3, 'example.com', '{}', "
        "2000, now()) RETURNING id",
        workspace.id,
        project_id,
        state,
    )
    run_id: uuid.UUID = run["id"]
    ids = {}
    for path, status in pages:
        ids[path] = await url_id(pg, f"https://example.com{path}")
        await execute(
            pg,
            "INSERT INTO seo.crawl_pages (run_id, url_id, workspace_id, project_id, crawled_url, "
            "status_code, resource_type, links_state) VALUES ($1, $2, $3, $4, $6, $5::smallint, "
            "CASE WHEN $5::smallint BETWEEN 300 AND 399 THEN 'redirect' "
            "WHEN $5::smallint >= 400 THEN 'broken' ELSE 'html' END, 'from_html')",
            run_id,
            ids[path],
            workspace.id,
            project_id,
            status,
            f"https://example.com{path}",
        )
    await execute(pg, "SELECT seo.add_crawl_links_partition($1)", run_id)
    for link in links:
        await execute(
            pg,
            "INSERT INTO seo.crawl_links (run_id, workspace_id, source_url_id, target_url_id, "
            "anchor, kind, placement, scope, is_followed) "
            "VALUES ($1, $2, $3, $4, $5, 'text', $6, $7, $8)",
            run_id,
            workspace.id,
            ids[link.source],
            ids[link.target],
            link.anchor,
            link.placement,
            scope_of(link.placement).value,
            link.followed,
        )
    return run_id, ids


async def set_website(pg: PostgresServer, project_id: uuid.UUID, host: str = "example.com") -> None:
    await url_id(pg, f"https://{host}/")
    await execute(
        pg,
        "UPDATE core.projects SET primary_domain_id = "
        "(SELECT id FROM core.domains WHERE host = $1) WHERE id = $2",
        host,
        project_id,
    )


READ_PAGES = [
    ("/", 200),
    ("/pricing", 200),
    ("/blog", 200),
    ("/blog/a", 200),
    ("/blog/b", 200),
    ("/old", 301),
    ("/gone", 404),
]
READ_LINKS = [
    SeedLink("/", "/pricing", "navigation", "Pricing"),
    SeedLink("/", "/blog", "navigation", "Blog"),
    SeedLink("/blog", "/blog/a", "content", "Post A"),
    SeedLink("/blog", "/blog/b", "content", "Post B"),
    SeedLink("/blog/a", "/pricing", "content", "See plans"),
    SeedLink("/pricing", "/blog/a", "content", "Read the guide"),
    SeedLink("/blog/a", "/blog/b", "auto_generated", "Next"),
    SeedLink("/blog/b", "/blog/a", "auto_generated", "Previous"),
    SeedLink("/blog/b", "/old", "content", "Old"),
    SeedLink("/blog/b", "/gone", "content", "Gone"),
]

# The counts ingest writes (Task 11), for a seeded crawl.
_INCOMING_SQL = """
UPDATE seo.crawl_pages p SET
    linking_pages_editorial = c.e, linking_pages_auto = c.a, linking_pages_template = c.t,
    linking_pages_all = c.n
FROM (SELECT target_url_id AS url_id,
             count(DISTINCT source_url_id) FILTER (WHERE scope = 'editorial') AS e,
             count(DISTINCT source_url_id) FILTER (WHERE scope = 'auto_generated') AS a,
             count(DISTINCT source_url_id) FILTER (WHERE scope = 'template') AS t,
             count(DISTINCT source_url_id) AS n
      FROM seo.crawl_links WHERE run_id = $1 GROUP BY target_url_id) c
WHERE p.run_id = $1 AND p.url_id = c.url_id
"""
_OUTGOING_SQL = """
UPDATE seo.crawl_pages p SET
    outlinks_editorial = c.e, outlinks_auto = c.a, outlinks_template = c.t, outlinks_all = c.n
FROM (SELECT source_url_id AS url_id,
             count(DISTINCT target_url_id) FILTER (WHERE scope = 'editorial') AS e,
             count(DISTINCT target_url_id) FILTER (WHERE scope = 'auto_generated') AS a,
             count(DISTINCT target_url_id) FILTER (WHERE scope = 'template') AS t,
             count(DISTINCT target_url_id) AS n
      FROM seo.crawl_links WHERE run_id = $1 GROUP BY source_url_id) c
WHERE p.run_id = $1 AND p.url_id = c.url_id
"""


async def set_counts(pg: PostgresServer, run_id: uuid.UUID) -> None:
    """The per-page link counts of a seeded crawl, as ingest would write them."""
    for statement in (_INCOMING_SQL, _OUTGOING_SQL):
        await execute(pg, statement, run_id)


async def read_site(
    pg: PostgresServer, workspace: Workspace, project_id: uuid.UUID
) -> tuple[uuid.UUID, dict[str, int], list[uuid.UUID]]:
    """A finished crawl with counts and metrics set as ingest would, and tiers: /pricing is a
    manual T1, /blog/a a manual T3."""
    tiers = await seed_tiers(pg, workspace)
    run_id, ids = await seed_crawl(pg, workspace, project_id, READ_PAGES, READ_LINKS)
    await execute(
        pg,
        "UPDATE seo.crawl_pages SET redirect_url_id = $2 WHERE run_id = $1 AND url_id = $3",
        run_id,
        ids["/pricing"],
        ids["/old"],
    )
    await set_counts(pg, run_id)
    depth = {"/": 0, "/pricing": 1, "/blog": 1, "/blog/a": 2, "/blog/b": 2, "/old": 3, "/gone": 3}
    share = {
        "/": 0.2,
        "/pricing": 0.3,
        "/blog": 0.1,
        "/blog/a": 0.2,
        "/blog/b": 0.1,
        "/old": 0.05,
        "/gone": 0.05,
    }
    for path, url in ids.items():
        await execute(
            pg,
            "UPDATE seo.crawl_pages SET click_depth = $3, equity_share = $4 "
            "WHERE run_id = $1 AND url_id = $2",
            run_id,
            url,
            depth[path],
            share[path],
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


async def audit_rows(
    pg: PostgresServer, workspace: Workspace, action: str
) -> list[dict[str, object]]:
    """The entries of one action, `before` and `after` decoded (asyncpg gives jsonb as text)."""
    rows = await fetch(
        pg,
        "SELECT before, after FROM ops.audit_logs WHERE workspace_id = $1 AND action = $2 "
        "ORDER BY id",
        workspace.id,
        action,
    )
    return [
        {name: None if row[name] is None else json.loads(row[name]) for name in ("before", "after")}
        for row in rows
    ]
