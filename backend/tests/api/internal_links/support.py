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
            "status_code, resource_type, links_state) VALUES ($1, $2, $3, $4, $6, $5, "
            "CASE WHEN $5 BETWEEN 300 AND 399 THEN 'redirect' WHEN $5 >= 400 THEN 'broken' "
            "ELSE 'html' END, 'from_html')",
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
