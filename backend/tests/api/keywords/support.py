"""Helpers for the keyword route tests."""

from __future__ import annotations

import uuid
from typing import Any

import httpx

from tests.api.auth.support import Workspace, execute, fetchrow
from tests.api.entities.support import Caller
from tests.conftest import PostgresServer

LOCATION = 2840
OTHER_LOCATION = 2826


async def ensure_locations(pg: PostgresServer) -> None:
    await execute(
        pg,
        "INSERT INTO core.locations (id, name, country_iso, location_type) VALUES "
        "($1, 'United States', 'US', 'Country'), ($2, 'United Kingdom', 'GB', 'Country') "
        "ON CONFLICT (id) DO UPDATE SET is_active = true",
        LOCATION,
        OTHER_LOCATION,
    )


async def keyword_project(pg: PostgresServer, workspace: Workspace) -> uuid.UUID:
    """A project whose defaults are the United States in English."""
    await ensure_locations(pg)
    row = await fetchrow(
        pg,
        "INSERT INTO core.projects (workspace_id, name, slug, default_location_id, "
        "default_language_code) VALUES ($1, 'Site', $2, $3, 'en') RETURNING id",
        workspace.id,
        f"p-{uuid.uuid4().hex[:12]}",
        LOCATION,
    )
    project_id: uuid.UUID = row["id"]
    return project_id


def project_url(workspace: Workspace, project_id: uuid.UUID, *parts: object) -> str:
    return "/".join([f"/api/v1/workspaces/{workspace.id}/projects/{project_id}", *map(str, parts)])


def keywords_url(workspace: Workspace, *parts: object) -> str:
    return "/".join([f"/api/v1/workspaces/{workspace.id}/keywords", *map(str, parts)])


async def track(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project_id: uuid.UUID,
    caller: Caller,
    keyword: str,
    **body: Any,
) -> httpx.Response:
    return await api.post(
        project_url(workspace, project_id, "tracked-keywords"),
        json={"keyword": keyword, **body},
        headers=caller.headers,
    )


async def tracked_id(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project_id: uuid.UUID,
    caller: Caller,
    keyword: str,
    **body: Any,
) -> str:
    response = await track(api, workspace, project_id, caller, keyword, **body)
    assert response.status_code == 201, response.text
    found: str = response.json()["data"][0]["tracked_keyword_id"]
    return found


def errors(response: httpx.Response) -> list[tuple[str, str]]:
    return [(error["path"], error["code"]) for error in response.json()["errors"]]


async def set_metrics(
    pg: PostgresServer,
    workspace: Workspace,
    tracked_keyword_id: str,
    *,
    search_volume: int | None,
    keyword_difficulty: int | None = None,
    cpc_usd: str | None = None,
) -> None:
    """Current Labs metrics for the tracked keyword's keyword, location and language."""
    tracked = await fetchrow(
        pg,
        "SELECT keyword_id, location_id, language_code FROM seo.tracked_keywords WHERE id = $1",
        uuid.UUID(tracked_keyword_id),
    )
    snapshot = await fetchrow(
        pg,
        "INSERT INTO seo.keyword_metric_snapshots (workspace_id, keyword_id, location_id, "
        "language_code, source, fetched_at, search_volume, cpc_usd, keyword_difficulty, "
        "is_material_change) VALUES ($1, $2, $3, $4, 'dataforseo_labs', now(), $5, "
        "$6::numeric, $7, true) RETURNING id",
        workspace.id,
        tracked["keyword_id"],
        tracked["location_id"],
        tracked["language_code"],
        search_volume,
        cpc_usd,
        keyword_difficulty,
    )
    await execute(
        pg,
        "INSERT INTO seo.keyword_metrics_current (keyword_id, location_id, language_code, "
        "source, workspace_id, snapshot_id, search_volume, cpc_usd, keyword_difficulty, "
        "fetched_at) VALUES ($1, $2, $3, 'dataforseo_labs', $4, $5, $6, $7::numeric, $8, now())",
        tracked["keyword_id"],
        tracked["location_id"],
        tracked["language_code"],
        workspace.id,
        snapshot["id"],
        search_volume,
        cpc_usd,
        keyword_difficulty,
    )


async def group(
    pg: PostgresServer,
    workspace: Workspace,
    project_id: uuid.UUID,
    name: str,
    parent: str | None = None,
) -> str:
    row = await fetchrow(
        pg,
        "INSERT INTO seo.keyword_groups (workspace_id, project_id, parent_id, name, path) "
        "VALUES ($1, $2, $3, $4, $5) RETURNING id",
        workspace.id,
        project_id,
        None if parent is None else uuid.UUID(parent),
        name,
        name,
    )
    return str(row["id"])


async def vocabulary(pg: PostgresServer, workspace: Workspace, *, single: bool = False) -> str:
    row = await fetchrow(
        pg,
        "INSERT INTO core.taxonomy_vocabularies (workspace_id, kind, name, is_hierarchical, "
        "is_single_valued) VALUES ($1, 'topic', $2, true, $3) RETURNING id",
        workspace.id,
        f"Topics {uuid.uuid4().hex[:6]}",
        single,
    )
    return str(row["id"])


async def term(
    pg: PostgresServer,
    workspace: Workspace,
    vocabulary_id: str,
    slug: str,
    parent: str | None = None,
) -> str:
    row = await fetchrow(
        pg,
        "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, parent_id, name, slug, "
        "path) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
        workspace.id,
        uuid.UUID(vocabulary_id),
        None if parent is None else uuid.UUID(parent),
        slug,
        slug,
        slug,
    )
    return str(row["id"])
